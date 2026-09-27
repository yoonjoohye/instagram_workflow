"""댓글 자동 응답 규칙 관리 + 처리 기록 + 설정 상태."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, AutoReplyRule, CommentReply, GenerationJob
from ..schemas import AutoReplyIn, AutoReplyMediaIn, AutoReplyToggle
from ..services.autoreply import DEFAULTS
from ..services.meta_graph import GraphError

router = APIRouter(prefix="/autoreply", tags=["autoreply"])


def _rule_dict(rule: AutoReplyRule | None, job: GenerationJob | None = None) -> dict:
    base = {
        "id": rule.id if rule else None,
        "exists": rule is not None,
        "job_id": rule.job_id if rule else (job.id if job else None),
        "ig_media_id": rule.ig_media_id if rule else (job.ig_media_id if job else ""),
        "enabled": bool(rule.enabled) if rule else False,
        "public_reply_enabled": bool(rule.public_reply_enabled) if rule else True,
        "public_reply": rule.public_reply if rule else DEFAULTS["public_reply"],
        "dm_enabled": bool(rule.dm_enabled) if rule else False,
        "dm_prompt": rule.dm_prompt if rule else DEFAULTS["dm_prompt"],
        "link_url": rule.link_url if rule else "",
        "link_message": rule.link_message if rule else DEFAULTS["link_message"],
        "not_following_message": rule.not_following_message
        if rule
        else DEFAULTS["not_following_message"],
    }
    if job is not None:
        visual = next((a for a in (job.assets or []) if a.get("type") != "audio"), None)
        base["post"] = {
            "prompt": job.prompt,
            "status": job.status,
            "permalink": job.permalink,
            "thumbnail_url": (visual or {}).get("thumbnail_url") or (visual or {}).get("url", ""),
        }
    elif rule is not None and (rule.post_caption or rule.post_thumbnail):
        base["post"] = {
            "prompt": rule.post_caption.split("\n")[0] or "(캡션 없음)",
            "status": "published",
            "permalink": rule.post_permalink,
            "thumbnail_url": rule.post_thumbnail,
        }
    return base


def _mark_enabled(rule: AutoReplyRule, on: bool) -> None:
    """꺼져 있다가 켜지는 순간을 기록 — 그 이후 댓글에만 반응합니다."""
    if on and not rule.enabled:
        rule.enabled_at = dt.datetime.now(dt.timezone.utc)
    rule.enabled = int(on)


def _apply(rule: AutoReplyRule, body: AutoReplyIn) -> None:
    # 두 스위치 중 하나라도 켜져 있으면 규칙이 동작합니다.
    _mark_enabled(rule, body.public_reply_enabled or body.dm_enabled)
    rule.keywords = ""  # 키워드 필터는 없앴습니다 — 모든 댓글에 반응
    rule.public_reply_enabled = int(body.public_reply_enabled)
    rule.public_reply = body.public_reply
    rule.dm_enabled = int(body.dm_enabled)
    rule.dm_prompt = body.dm_prompt
    rule.link_url = body.link_url.strip()
    rule.link_message = body.link_message
    rule.not_following_message = body.not_following_message


def _own_job(db: Session, account: Account, job_id: int) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "작업을 찾을 수 없습니다.")
    return job


@router.get("/status")
def setup_status(account: Account = Depends(current_account)) -> dict:
    """자동 응답이 실제로 동작하기 위한 준비 상태 (UI 체크리스트용)."""
    scopes = set(account.granted_scopes.split(",")) if account.granted_scopes else set()
    return {
        "auth_mode": settings.auth_mode,
        "webhook_url": settings.webhook_url,
        "verify_token_set": bool(settings.webhook_verify_token),
        "app_secret_set": bool(settings.webhook_secret),
        "messages_permission": bool(
            scopes & {"instagram_business_manage_messages", "instagram_manage_messages"}
        ),
        "comments_permission": bool(
            scopes & {"instagram_business_manage_comments", "instagram_manage_comments"}
        ),
    }


@router.post("/subscribe")
def subscribe(account: Account = Depends(current_account)) -> dict:
    """이 계정의 댓글·DM 이벤트를 앱 Webhook 으로 받도록 구독합니다."""
    if settings.auth_mode != "instagram":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Facebook 로그인 방식은 Meta 앱 대시보드에서 페이지 구독을 설정하세요.",
        )
    with graph_for(account) as client:
        try:
            return client.subscribe_webhooks()
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc


@router.get("/rules")
def list_rules(account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    rules = db.scalars(
        select(AutoReplyRule)
        .where(AutoReplyRule.account_id == account.id)
        .order_by(desc(AutoReplyRule.updated_at))
    ).all()
    return {"data": [_rule_dict(r, db.get(GenerationJob, r.job_id) if r.job_id else None) for r in rules]}


@router.get("/jobs/{job_id}")
def get_job_rule(
    job_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    job = _own_job(db, account, job_id)
    rule = db.scalar(select(AutoReplyRule).where(AutoReplyRule.job_id == job.id))
    return _rule_dict(rule, job)


@router.put("/jobs/{job_id}")
def save_job_rule(
    job_id: int,
    body: AutoReplyIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    job = _own_job(db, account, job_id)
    rule = db.scalar(select(AutoReplyRule).where(AutoReplyRule.job_id == job.id))
    if rule is None:
        rule = AutoReplyRule(account_id=account.id, job_id=job.id)
        db.add(rule)
    # 게시 전이면 비어 있고, 게시되면 workflow.publish 가 채웁니다.
    rule.ig_media_id = job.ig_media_id or ""
    _apply(rule, body)
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule, job)


def _media_rule(db: Session, account: Account, media_id: str) -> AutoReplyRule | None:
    return db.scalar(
        select(AutoReplyRule).where(
            AutoReplyRule.account_id == account.id, AutoReplyRule.ig_media_id == media_id
        )
    )


@router.get("/media/{media_id}")
def get_media_rule(
    media_id: str, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    """게시물 ID 기준 규칙 — 스튜디오 밖에서 올린 기존 게시물용 (스튜디오 게시물도 같은 규칙을 찾습니다)."""
    rule = _media_rule(db, account, media_id)
    job = db.get(GenerationJob, rule.job_id) if rule and rule.job_id else None
    data = _rule_dict(rule, job)
    data["ig_media_id"] = media_id
    return data


@router.put("/media/{media_id}")
def save_media_rule(
    media_id: str,
    body: AutoReplyMediaIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    rule = _media_rule(db, account, media_id)
    if rule is None:
        # 스튜디오에서 게시한 게시물이면 그 작업에 연결합니다.
        job = db.scalar(
            select(GenerationJob).where(
                GenerationJob.account_id == account.id, GenerationJob.ig_media_id == media_id
            )
        )
        rule = db.scalar(select(AutoReplyRule).where(AutoReplyRule.job_id == job.id)) if job else None
        if rule is None:
            rule = AutoReplyRule(account_id=account.id, job_id=job.id if job else None)
            db.add(rule)
    rule.ig_media_id = media_id
    _apply(rule, body)
    rule.post_caption = body.post_caption
    rule.post_thumbnail = body.post_thumbnail
    rule.post_permalink = body.post_permalink
    db.commit()
    db.refresh(rule)
    return _rule_dict(rule, db.get(GenerationJob, rule.job_id) if rule.job_id else None)


@router.patch("/rules/{rule_id}")
def toggle_rule(
    rule_id: int,
    body: AutoReplyToggle,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    rule = db.get(AutoReplyRule, rule_id)
    if not rule or rule.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "규칙을 찾을 수 없습니다.")
    _mark_enabled(rule, body.enabled)
    db.commit()
    return _rule_dict(rule, db.get(GenerationJob, rule.job_id) if rule.job_id else None)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_rule(
    rule_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> Response:
    rule = db.get(AutoReplyRule, rule_id)
    if not rule or rule.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "규칙을 찾을 수 없습니다.")
    db.delete(rule)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/logs")
def logs(
    limit: int = 50, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    rows = db.scalars(
        select(CommentReply)
        .where(CommentReply.account_id == account.id)
        .order_by(desc(CommentReply.updated_at))
        .limit(min(limit, 200))
    ).all()
    return {
        "data": [
            {
                "id": r.id,
                "rule_id": r.rule_id,
                "comment_id": r.comment_id,
                "ig_media_id": r.ig_media_id,
                "commenter_username": r.commenter_username,
                "comment_text": r.comment_text,
                "status": r.status,
                "error": r.error,
                "created_at": r.created_at.isoformat(),
                "updated_at": r.updated_at.isoformat(),
            }
            for r in rows
        ]
    }
