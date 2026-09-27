"""댓글 자동 응답: 고정 답글 + 팔로우 여부에 따라 다른 DM.

규칙은 두 스위치로 동작합니다.
  public_reply_enabled : 모든 댓글에 같은 고정 문구로 공개 답글
  dm_enabled           : 댓글 작성자에게 DM — 팔로워/비팔로워에게 다른 문구

팔로우 여부(is_user_follow_business)는 상대가 우리 계정에 DM 을 보낸 적이 있어야만
조회됩니다(Meta 정책). 그래서 DM 은 이렇게 보냅니다.
  - 조회 가능  → 댓글 즉시 팔로워/비팔로워 문구를 비공개 답장(private reply)으로 전송
  - 조회 불가  → '답장 주시면 보내드려요' 안내를 먼저 보내고, 상대가 답장하면
                 그때 팔로우 여부를 확인해 알맞은 문구 전송
비공개 답장은 댓글당 1통·텍스트만 가능하고, 이후 메시지는 상대가 답장해야 보낼 수 있습니다.

문서: https://developers.facebook.com/docs/instagram-platform/private-replies
      https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import desc, or_, select
from sqlalchemy.orm import Session

from ..models import Account, AutoReplyRule, CommentReply
from .meta_graph import GraphClient, GraphError

log = logging.getLogger(__name__)

DEFAULTS = {
    "public_reply": "댓글 감사합니다! 😊",
    "link_message": "팔로우해 주셔서 감사해요! 🎁\n요청하신 링크입니다 👇",
    "not_following_message": "링크는 팔로워분들께만 보내드리고 있어요. 팔로우 후 이 대화에 다시 메시지를 보내주세요!",
    "dm_prompt": "댓글 감사합니다! 이 메시지에 아무 답장이나 보내주시면 안내해 드릴게요 🙌",
}

# DM 답장을 기다리는 상태 — 이 상태의 기록에 대해서만 이어서 DM 을 보냅니다.
WAITING = ("dm_sent", "awaiting_follow")


def follower_message(rule: AutoReplyRule) -> str:
    """팔로워에게 보낼 DM 본문: 문구 + 링크 (둘 중 하나만 있어도 됩니다)."""
    return "\n".join(p for p in (rule.link_message.strip(), rule.link_url.strip()) if p) or DEFAULTS["link_message"]


def non_follower_message(rule: AutoReplyRule) -> str:
    return rule.not_following_message.strip() or DEFAULTS["not_following_message"]


def _is_own(account: Account, user: dict[str, Any]) -> bool:
    """우리 계정이 단 답글도 comments webhook 으로 다시 들어오므로 걸러냅니다."""
    return str(user.get("id", "")) == account.ig_user_id or (
        bool(user.get("username")) and user.get("username") == account.username
    )


def _follow_status(client: GraphClient, user_id: str) -> bool | None:
    """True/False = 팔로우 여부, None = 아직 조회 권한 없음(상대가 DM 을 보낸 적 없음)."""
    if not user_id:
        return None
    try:
        profile = client.messaging_profile(user_id)
    except GraphError:
        return None
    value = profile.get("is_user_follow_business")
    return bool(value) if value is not None else None


def handle_comment(db: Session, account: Account, client: GraphClient, value: dict[str, Any]) -> str:
    """comments webhook 한 건 처리. 처리 결과 상태를 돌려줍니다 (테스트·로그용)."""
    comment_id = str(value.get("id") or "")
    media_id = str((value.get("media") or {}).get("id") or "")
    user = value.get("from") or {}
    text = value.get("text") or ""
    if not comment_id or not media_id or _is_own(account, user):
        return "ignored"

    rule = db.scalar(
        select(AutoReplyRule).where(
            AutoReplyRule.account_id == account.id,
            AutoReplyRule.ig_media_id == media_id,
            AutoReplyRule.enabled == 1,
        )
    )
    if rule is None or not (rule.public_reply_enabled or rule.dm_enabled):
        return "no_rule"
    if db.scalar(select(CommentReply.id).where(CommentReply.comment_id == comment_id)):
        return "duplicate"  # Meta 는 같은 이벤트를 재전송할 수 있습니다.

    record = CommentReply(
        account_id=account.id,
        rule_id=rule.id,
        comment_id=comment_id,
        ig_media_id=media_id,
        commenter_id=str(user.get("id") or ""),
        commenter_username=user.get("username") or "",
        comment_text=text[:1000],
        status="skipped",
    )
    db.add(record)
    db.commit()

    errors: list[str] = []
    replied = False
    if rule.public_reply_enabled:
        try:
            client.reply_to_comment(comment_id, rule.public_reply.strip() or DEFAULTS["public_reply"])
            replied = True
        except GraphError as exc:
            errors.append(f"답글 실패: {exc}")

    dm_status = ""
    if rule.dm_enabled:
        following = _follow_status(client, record.commenter_id)
        if following is None:
            dm_text, dm_status = rule.dm_prompt.strip() or DEFAULTS["dm_prompt"], "dm_sent"
        elif following:
            dm_text, dm_status = follower_message(rule), "link_sent"
        else:
            dm_text, dm_status = non_follower_message(rule), "awaiting_follow"
        try:
            client.send_private_reply(comment_id, dm_text)
        except GraphError as exc:
            errors.append(f"DM 실패: {exc}")
            dm_status = ""

    record.status = dm_status or ("replied" if replied else "failed" if errors else "skipped")
    record.error = " / ".join(errors)
    db.commit()
    return record.status


def _find_waiting(db: Session, account: Account, sender_id: str, username: str) -> CommentReply | None:
    """DM 을 보낸 사람의 대기 중인 기록. ID 가 다르게 올 수 있어 사용자명으로도 찾습니다."""
    conditions = [CommentReply.commenter_id == sender_id]
    if username:
        conditions.append(CommentReply.commenter_username == username)
    return db.scalar(
        select(CommentReply)
        .where(
            CommentReply.account_id == account.id,
            CommentReply.status.in_(WAITING),
            or_(*conditions),
        )
        .order_by(desc(CommentReply.created_at))
        .limit(1)
    )


def handle_message(db: Session, account: Account, client: GraphClient, event: dict[str, Any]) -> str:
    """messaging webhook 한 건 처리 — 안내 DM 에 답장이 오면 팔로우 여부에 맞는 문구를 보냅니다."""
    message = event.get("message") or {}
    sender_id = str((event.get("sender") or {}).get("id") or "")
    if not message or message.get("is_echo") or not sender_id or sender_id == account.ig_user_id:
        return "ignored"

    # 상대가 방금 메시지를 보냈으므로 이제 프로필(팔로우 여부) 조회가 허용됩니다.
    try:
        profile = client.messaging_profile(sender_id)
    except GraphError as exc:
        log.warning("messaging profile lookup failed: %s", exc)
        profile = {}

    record = _find_waiting(db, account, sender_id, profile.get("username") or "")
    if record is None:
        return "no_pending"  # 자동 응답과 무관한 일반 DM 은 건드리지 않습니다.
    rule = db.get(AutoReplyRule, record.rule_id) if record.rule_id else None
    if rule is None or not rule.enabled or not rule.dm_enabled:
        return "no_rule"
    if not record.commenter_id:
        record.commenter_id = sender_id

    if "is_user_follow_business" not in profile:
        record.error = "팔로우 여부를 확인하지 못했습니다 (instagram_business_manage_messages 권한 확인)."
        db.commit()
        return "profile_error"

    try:
        if profile.get("is_user_follow_business"):
            client.send_message(sender_id, follower_message(rule))
            record.status = "link_sent"
        else:
            client.send_message(sender_id, non_follower_message(rule))
            record.status = "awaiting_follow"
        record.error = ""
    except GraphError as exc:
        record.error = f"DM 전송 실패: {exc}"
    db.commit()
    return record.status
