"""Instagram 앱에서 직접 지운 게시물(과 끝나거나 지운 스토리)을 서비스 기록에 반영합니다.

게시물 목록(성과)은 매번 Instagram 에서 새로 가져오지만, 작업함(게시됨)·자동 응답 규칙·댓글 감정 기록은
게시물 ID 를 저장해 두므로 Instagram 에서 지워져도 남습니다. 저장된 ID 를 하나씩 조회해 없어진 것만 정리합니다.
"""
from __future__ import annotations

import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import Account, AutoReplyRule, CommentReply, CommentSentiment, GenerationJob
from .meta_graph import GraphClient, GraphError

log = logging.getLogger(__name__)

# 같은 계정을 너무 자주 확인하지 않게 (서버리스라 인스턴스마다 따로지만 대부분의 연속 호출은 막음)
_last_run: dict[int, dt.datetime] = {}
MIN_INTERVAL = dt.timedelta(seconds=60)


def _gone(client: GraphClient, media_id: str) -> bool:
    """확실히 삭제된 경우에만 True (일시적 오류·권한 문제는 지우지 않음)."""
    try:
        client.get(media_id, {"fields": "id"})
        return False
    except GraphError as exc:
        return "does not exist" in str(exc)


STORY_LIFETIME = dt.timedelta(hours=24)  # 스토리는 24시간 뒤 저절로 내려감
STORY_GRACE = dt.timedelta(minutes=5)  # 막 올린 스토리는 목록에 늦게 나타날 수 있어 기다림


def _aware(t: dt.datetime) -> dt.datetime:
    return t.replace(tzinfo=dt.timezone.utc) if t.tzinfo is None else t


def sync_stories(db: Session, account: Account, client: GraphClient) -> int:
    """게시한 스토리: 24시간이 지나면 'expired'(스토리 종료), 그 전에 지금 올라가 있는 스토리 목록에 없으면
    'deleted'(인스타에서 삭제됨). 여러 장이면 모두 없어졌을 때만. 바뀐 개수를 돌려줍니다."""
    jobs = list(
        db.scalars(
            select(GenerationJob).where(
                GenerationJob.account_id == account.id, GenerationJob.status == "published", GenerationJob.media_kind == "STORIES"
            )
        )
    )
    if not jobs:
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    changed = 0
    live_check = []
    for job in jobs:
        age = now - _aware(job.published_at) if job.published_at else STORY_LIFETIME
        if age >= STORY_LIFETIME:
            job.status = "expired"
            changed += 1
        elif age >= STORY_GRACE:
            live_check.append(job)
    if live_check:
        try:
            rows = client.get(f"{account.ig_user_id}/stories", {"fields": "id", "limit": 100}).get("data") or []
        except GraphError as exc:  # 권한·일시 오류면 이번엔 건너뜀 (지운 것으로 잘못 표시하지 않게)
            log.warning("story sync skipped: %s", exc)
            rows = None
        if rows is not None:
            live = {str(r.get("id")) for r in rows}
            for job in live_check:
                plan = job.plan if isinstance(job.plan, dict) else {}
                ids = [str(i) for i in (plan.get("story_media_ids") or [job.ig_media_id]) if i]
                if ids and not any(i in live for i in ids):
                    job.status = "deleted"
                    changed += 1
    if changed:
        db.commit()
    return changed


def sync_deleted(db: Session, account: Account, client: GraphClient, *, force: bool = False) -> dict[str, int]:
    now = dt.datetime.now(dt.timezone.utc)
    last = _last_run.get(account.id)
    if not force and last and now - last < MIN_INTERVAL:
        return {"checked": 0, "deleted": 0}
    _last_run[account.id] = now
    sync_stories(db, account, client)

    ids: set[str] = set()
    ids |= set(
        db.scalars(
            select(GenerationJob.ig_media_id).where(
                GenerationJob.account_id == account.id,
                GenerationJob.status == "published",
                GenerationJob.ig_media_id != "",
                GenerationJob.media_kind != "STORIES",  # 스토리는 24시간 뒤 원래 사라짐
            )
        )
    )
    ids |= set(db.scalars(select(AutoReplyRule.ig_media_id).where(AutoReplyRule.account_id == account.id, AutoReplyRule.ig_media_id != "")))
    ids |= set(db.scalars(select(CommentSentiment.ig_media_id).where(CommentSentiment.account_id == account.id).distinct()))
    ids = {i for i in ids if i}
    if not ids:
        return {"checked": 0, "deleted": 0}

    with ThreadPoolExecutor(max_workers=6) as pool:
        flags = dict(zip(ids, pool.map(lambda i: _gone(client, i), ids)))
    gone = [i for i, g in flags.items() if g]
    if gone:
        # 작업함: 기록은 남기고 'Instagram 에서 삭제됨' 으로 (다시 게시할 수 있게)
        for job in db.scalars(select(GenerationJob).where(GenerationJob.account_id == account.id, GenerationJob.ig_media_id.in_(gone))):
            job.status = "deleted"
        db.execute(delete(AutoReplyRule).where(AutoReplyRule.account_id == account.id, AutoReplyRule.ig_media_id.in_(gone), AutoReplyRule.job_id.is_(None)))
        # 스튜디오 게시물의 규칙은 작업에 묶여 있어 남기되, 지워진 게시물 연결만 끊습니다.
        for rule in db.scalars(select(AutoReplyRule).where(AutoReplyRule.account_id == account.id, AutoReplyRule.ig_media_id.in_(gone))):
            rule.ig_media_id = ""
        db.execute(delete(CommentSentiment).where(CommentSentiment.account_id == account.id, CommentSentiment.ig_media_id.in_(gone)))
        db.execute(delete(CommentReply).where(CommentReply.account_id == account.id, CommentReply.ig_media_id.in_(gone)))
        db.commit()
        log.info("synced %d deleted media for account %s", len(gone), account.id)
    return {"checked": len(ids), "deleted": len(gone)}


def try_sync(db: Session, account: Account) -> None:
    """목록 API 에서 호출. 토큰·네트워크 문제로 실패해도 목록은 그대로 보여 줍니다."""
    from ..deps import graph_for  # 순환 import 방지

    try:
        with graph_for(account) as client:
            sync_deleted(db, account, client)
    except Exception as exc:  # noqa: BLE001
        log.warning("deleted-media sync skipped: %s", exc)
