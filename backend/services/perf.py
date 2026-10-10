"""게시물 성과를 템플릿별로 모읍니다.

우리 서비스로 게시한 글은 어떤 디자인 템플릿으로 만들었는지 알고 있어서(GenerationJob.template_*),
게시 후 Instagram 인사이트(도달·좋아요·댓글·저장·공유)를 붙여 두면 '이 템플릿으로 올린 글은 실제로 어땠는지'를 보여 줄 수 있습니다.
- sync: 크론이 매일, 게시 후 SYNC_DAYS 일 동안의 피드 게시물 성과를 갱신
- summary: 템플릿별 평균 (모두의 템플릿 카드·내 템플릿·기본 템플릿 고르기에서)
- versus_account: 내 계정 평균과 비교한 배수 (예: 저장 2.3배)
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Account, GenerationJob
from .insights import media_insights
from .meta_graph import GraphClient

log = logging.getLogger(__name__)

SYNC_DAYS = 30  # 게시 후 이 기간까지만 갱신 (그 뒤로는 거의 변하지 않음)
RESYNC = dt.timedelta(hours=20)
MAX_PER_RUN = 40  # 크론 한 번에 계정당 이만큼만 (Graph 호출 수·60초 제한)
METRICS = ("reach", "likes", "comments", "saved", "shares")


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    if t is None:
        return None
    return t.replace(tzinfo=dt.timezone.utc) if t.tzinfo is None else t


def sync(db: Session, account: Account, client: GraphClient, *, now: dt.datetime | None = None) -> int:
    """게시한 피드 글(스토리 빼고)의 성과를 갱신합니다. 갱신한 개수."""
    now = now or dt.datetime.now(dt.timezone.utc)
    since = now - dt.timedelta(days=SYNC_DAYS)
    jobs = db.scalars(
        select(GenerationJob).where(
            GenerationJob.account_id == account.id,
            GenerationJob.status == "published",
            GenerationJob.media_kind != "STORIES",
            GenerationJob.ig_media_id != "",
        )
    ).all()
    due = [
        j for j in jobs
        if (_aware(j.published_at) or now) >= since and (j.perf_synced_at is None or now - _aware(j.perf_synced_at) >= RESYNC)
    ]
    done = 0
    for job in due[:MAX_PER_RUN]:
        product = "REELS" if job.media_kind == "REELS" else "FEED"
        got = media_insights(client, {"id": job.ig_media_id, "media_product_type": product})
        if not got:  # 지웠거나 권한 문제 — 다음에 다시
            continue
        job.perf = {k: int(got.get(k) or 0) for k in METRICS}
        job.perf_synced_at = now
        done += 1
    if done:
        db.commit()
    return done


def _avg(rows: list[dict[str, Any]]) -> dict[str, float]:
    n = len(rows) or 1
    out = {k: round(sum(r.get(k, 0) for r in rows) / n, 1) for k in METRICS}
    reach = sum(r.get("reach", 0) for r in rows)
    acts = sum(r.get("likes", 0) + r.get("comments", 0) + r.get("saved", 0) + r.get("shares", 0) for r in rows)
    out["rate"] = round(acts / reach * 100, 1) if reach else 0.0  # 도달 대비 반응 (%)
    return out


def _measured(db: Session, *where) -> list[GenerationJob]:
    return [j for j in db.scalars(select(GenerationJob).where(GenerationJob.perf_synced_at.is_not(None), *where)) if j.perf]


def summary(db: Session, kind: str, ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """템플릿 id → {posts, reach, likes, comments, saved, shares, rate} (성과가 모인 글만)"""
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    by: dict[str, list[dict[str, Any]]] = {}
    for j in _measured(db, GenerationJob.template_kind == kind, GenerationJob.template_id.in_(ids)):
        by.setdefault(j.template_id, []).append(j.perf)
    return {tid: {"posts": len(rows), **_avg(rows)} for tid, rows in by.items()}


def versus_account(db: Session, account: Account) -> dict[str, Any]:
    """내 계정에서 템플릿별 성과를 내 평균과 비교: {'builtin:cn-minimal': {posts, saved_x, reach_x, rate}, ...}
    (내 글이 3개 이상 모였을 때만 — 너무 적으면 비교가 의미 없어서)"""
    mine = _measured(db, GenerationJob.account_id == account.id)
    if len(mine) < 3:
        return {}
    base = _avg([j.perf for j in mine])
    by: dict[str, list[dict[str, Any]]] = {}
    for j in mine:
        if j.template_id:
            by.setdefault(f"{j.template_kind}:{j.template_id}", []).append(j.perf)
    out = {}
    for key, rows in by.items():
        a = _avg(rows)
        out[key] = {
            "posts": len(rows),
            "reach_x": round(a["reach"] / base["reach"], 2) if base["reach"] else None,
            "saved_x": round(a["saved"] / base["saved"], 2) if base["saved"] else None,
            "rate": a["rate"],
        }
    return out
