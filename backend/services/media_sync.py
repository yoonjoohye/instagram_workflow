"""Instagram 앱에서 직접 지운 게시물을 서비스 기록에 반영합니다.

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


def sync_deleted(db: Session, account: Account, client: GraphClient, *, force: bool = False) -> dict[str, int]:
    now = dt.datetime.now(dt.timezone.utc)
    last = _last_run.get(account.id)
    if not force and last and now - last < MIN_INTERVAL:
        return {"checked": 0, "deleted": 0}
    _last_run[account.id] = now

    ids: set[str] = set()
    ids |= set(
        db.scalars(
            select(GenerationJob.ig_media_id).where(
                GenerationJob.account_id == account.id, GenerationJob.status == "published", GenerationJob.ig_media_id != ""
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
