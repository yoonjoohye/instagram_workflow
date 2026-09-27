"""댓글 자동 응답 + 팔로워 전용 링크 전달.

흐름 (Meta 정책 때문에 두 단계입니다)
  1) 댓글 webhook  : 키워드 일치 → 공개 답글 + 비공개 DM("이 메시지에 답장하면 링크를 드려요")
                     비공개 DM 은 댓글당 1통·텍스트만 가능합니다.
  2) 메시지 webhook: 사용자가 DM 에 답장 → 이제 프로필 조회가 허용되므로
                     is_user_follow_business 확인 → 팔로워면 링크, 아니면 팔로우 안내.

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
    "public_reply": "DM으로 링크 보내드렸어요! 📩",
    "dm_prompt": "댓글 감사합니다! 링크를 받으시려면 이 메시지에 아무 답장이나 보내주세요 🙌",
    "link_message": "팔로우해 주셔서 감사해요! 요청하신 링크입니다 👇",
    "not_following_message": "링크는 팔로워분들께만 보내드리고 있어요. 팔로우 후 이 대화에 다시 메시지를 보내주세요!",
}

# DM 답장을 기다리는 상태 — 이 상태의 기록에 대해서만 링크를 보냅니다.
WAITING = ("dm_sent", "awaiting_follow")


def keyword_match(rule: AutoReplyRule, text: str) -> bool:
    keywords = [k.strip().lower() for k in (rule.keywords or "").split(",") if k.strip()]
    return not keywords or any(k in (text or "").lower() for k in keywords)


def _is_own(account: Account, user: dict[str, Any]) -> bool:
    """우리 계정이 단 답글도 comments webhook 으로 다시 들어오므로 걸러냅니다."""
    return str(user.get("id", "")) == account.ig_user_id or (
        bool(user.get("username")) and user.get("username") == account.username
    )


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
    if rule is None or not keyword_match(rule, text):
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
        status="replied",
    )
    db.add(record)
    db.commit()

    errors: list[str] = []
    replied = dm_sent = False
    if rule.public_reply.strip():
        try:
            client.reply_to_comment(comment_id, rule.public_reply.strip())
            replied = True
        except GraphError as exc:
            errors.append(f"공개 답글 실패: {exc}")

    if rule.link_url.strip():
        try:
            client.send_private_reply(comment_id, rule.dm_prompt.strip() or DEFAULTS["dm_prompt"])
            dm_sent = True
        except GraphError as exc:
            errors.append(f"DM 실패: {exc}")

    # DM 이 나갔으면 답장 대기, 공개 답글만 성공했으면 replied, 둘 다 실패면 failed.
    record.status = "dm_sent" if dm_sent else "replied" if replied else "failed" if errors else "skipped"
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
    """messaging webhook 한 건 처리."""
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
    if rule is None or not rule.link_url.strip():
        return "no_rule"
    if not record.commenter_id:
        record.commenter_id = sender_id

    if not profile:
        record.error = "팔로우 여부를 확인하지 못했습니다 (instagram_business_manage_messages 권한 확인)."
        db.commit()
        return "profile_error"

    try:
        if profile.get("is_user_follow_business"):
            text = (rule.link_message.strip() or DEFAULTS["link_message"]) + "\n" + rule.link_url.strip()
            client.send_message(sender_id, text)
            record.status = "link_sent"
        else:
            client.send_message(
                sender_id, rule.not_following_message.strip() or DEFAULTS["not_following_message"]
            )
            record.status = "awaiting_follow"
        record.error = ""
    except GraphError as exc:
        record.error = f"DM 전송 실패: {exc}"
    db.commit()
    return record.status
