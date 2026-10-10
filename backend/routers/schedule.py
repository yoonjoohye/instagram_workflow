"""예약 게시 · 매주 반복.

- 예약: 작업을 status=scheduled 로 두고 시각(scheduled_at)이 되면 올립니다.
- 올리는 주체: GitHub Actions 가 10분마다 /cron/publish-due 를 부르고(Vercel 무료 요금제 크론은 하루 한 번뿐),
  회원이 화면을 열 때도 /workflow/scheduled/run 으로 그 계정의 밀린 예약을 올립니다 — 둘이 겹쳐도 한 번만 올라가게
  작업을 'scheduled → publishing' 으로 먼저 바꾼(가져간) 쪽만 올립니다.
- 매주 반복: 올린 뒤 다음 주 같은 시각을 권하는 초안을 만들어 둡니다(사진·글 그대로 복사).
  내용을 바꿔야 하는 정기 게시물(이번 주 메뉴 등)이 많아서, 같은 글이 저절로 다시 올라가지는 않게 회원이 확인하고 예약합니다.
"""
from __future__ import annotations

import datetime as dt
import logging
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, GenerationJob, MediaBlob
from ..schemas import PublishIn
from ..services import insights as insights_svc
from ..services.meta_graph import GraphError
from .workflow import _get_job, _job_dict, publish_job

router = APIRouter(tags=["schedule"])
log = logging.getLogger(__name__)

MAX_AHEAD = dt.timedelta(days=60)
RUN_BUDGET = 40.0  # Vercel 60초 안에서
RETRY_AFTER = dt.timedelta(minutes=30)  # 한도 초과 등 잠깐의 문제면 이만큼 뒤에 다시
MAX_TRIES = 3
SCHEDULABLE = {"ready", "failed", "deleted", "expired"}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _aware(t: dt.datetime) -> dt.datetime:
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def _has_video(job: GenerationJob) -> bool:
    return any(a.get("type") == "video" for a in job.assets or [])


class ScheduleIn(BaseModel):
    at: dt.datetime  # 시간대가 붙은 ISO 시각
    repeat_weekly: bool = False


@router.post("/workflow/jobs/{job_id}/schedule")
def schedule(job_id: int, body: ScheduleIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    job = _get_job(db, account, job_id)
    if job.status not in SCHEDULABLE | {"scheduled"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "지금은 예약할 수 없는 작업입니다.")
    if not any(a.get("type") in {"image", "video"} for a in job.assets or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "올릴 사진이나 동영상을 먼저 넣어 주세요.")
    at = _aware(body.at)
    if at < _now() + dt.timedelta(minutes=1):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "지금보다 나중 시각을 골라 주세요.")
    if at > _now() + MAX_AHEAD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "예약은 60일 안으로만 할 수 있습니다.")
    if body.repeat_weekly and _has_video(job):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "매주 반복은 사진 게시물만 할 수 있습니다.")
    if job.status in ("deleted", "expired"):  # 인스타에서 지웠거나 끝난 것을 다시 올림 — 지난번 기록은 지움 (publish_job 과 같게)
        job.plan = {k: v for k, v in (job.plan or {}).items() if k not in ("story_media_ids", "container_fingerprint")}
        job.ig_container_id = ""
    job.status = "scheduled"
    job.scheduled_at = at
    job.repeat_weekly = int(body.repeat_weekly)
    job.error = ""
    plan = dict(job.plan or {})
    plan.pop("schedule_tries", None)
    plan.pop("repeat", None)  # 다음 주 초안이었다면 이제 예약됨
    job.plan = plan
    db.commit()
    return _job_dict(job)


@router.delete("/workflow/jobs/{job_id}/schedule")
def unschedule(job_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    job = _get_job(db, account, job_id)
    if job.status == "scheduled":
        job.status = "ready"
    job.scheduled_at = None
    db.commit()
    return _job_dict(job)


@router.get("/studio/best-times")
def best_times(account: Account = Depends(current_account)) -> dict:
    """팔로워가 가장 많이 접속하는 시간 (인사이트 기준 최근 7일 평균) — 예약 시각 고를 때"""
    try:
        with graph_for(account) as client:
            hours = insights_svc.online_followers(client, account.ig_user_id)
    except (GraphError, HTTPException):
        hours = []
    top = sorted(range(len(hours)), key=lambda h: hours[h], reverse=True)[:3] if hours else []
    return {"hours": top, "online": hours}


# ── 올리기 ────────────────────────────────────────────────
def _copy_blob(db: Session, blob_id: str) -> str:
    src = db.get(MediaBlob, blob_id)
    if src is None:
        return blob_id
    dup = MediaBlob(id=secrets.token_urlsafe(18), account_id=src.account_id, kind=src.kind, data=src.data, url=src.url,
                    content_type=src.content_type, width=src.width, height=src.height)
    db.add(dup)
    return dup.id


def _next_week_draft(db: Session, job: GenerationJob) -> GenerationJob:
    """올린 게시물을 다음 주 초안으로 복사 — 작업을 지우면 함께 지워지는 그림(slide·visual)은 따로 복사해 둠"""
    assets = []
    for a in job.assets or []:
        a = {**a, "meta": dict(a.get("meta") or {})}
        url = a.get("url") or ""
        if "/api/py/media/" in url:
            old = url.rsplit("/media/", 1)[1].split(".")[0]
            blob = db.get(MediaBlob, old)
            if blob is not None and blob.kind in ("slide", "visual"):
                new = _copy_blob(db, old)
                a["url"] = url.replace(old, new)
                a["thumbnail_url"] = (a.get("thumbnail_url") or url).replace(old, new)
        if a["meta"].get("visual_id"):
            a["meta"]["visual_id"] = _copy_blob(db, a["meta"]["visual_id"])
        assets.append(a)
    when = _aware(job.scheduled_at or _now()) + dt.timedelta(days=7)
    plan = {k: v for k, v in (job.plan or {}).items() if k not in ("story_media_ids", "container_fingerprint", "story_fit", "feed_fit", "schedule_tries")}
    plan["repeat"] = {"of": job.id, "suggest_at": when.isoformat()}
    draft = GenerationJob(
        account_id=job.account_id, prompt=job.prompt, media_kind=job.media_kind, tone=job.tone, language=job.language,
        status="ready", provider=job.provider, error="", caption=job.caption, hashtags=list(job.hashtags or []),
        assets=assets, plan=plan, template_kind=job.template_kind, template_id=job.template_id, repeat_weekly=1,
    )
    db.add(draft)
    return draft


def _claim(db: Session, job_id: int) -> bool:
    """여러 곳에서 동시에 불러도 한 곳만 올리게: scheduled 인 것만 publishing 으로 바꿈"""
    res = db.execute(update(GenerationJob).where(GenerationJob.id == job_id, GenerationJob.status == "scheduled").values(status="publishing"))
    db.commit()
    return res.rowcount == 1


def _publish_one(db: Session, job: GenerationJob) -> str:
    account = db.get(Account, job.account_id)
    if account is None:
        return "skipped"
    try:
        publish_job(PublishIn(job_id=job.id), account, db)
    except HTTPException as exc:
        db.refresh(job)
        tries = int((job.plan or {}).get("schedule_tries", 0)) + 1
        if exc.status_code in (429, 500, 502, 503, 504) and tries < MAX_TRIES:
            # 한도·일시 오류: 잠시 뒤 다시
            job.status = "scheduled"
            job.scheduled_at = _now() + RETRY_AFTER
            job.plan = {**(job.plan or {}), "schedule_tries": tries}
        else:
            job.status = "failed"
            job.error = f"예약 게시 실패: {exc.detail}"
        db.commit()
        return "retry" if job.status == "scheduled" else "failed"
    db.refresh(job)
    if job.status == "publishing":  # 스토리 여러 장을 나눠 올리는 중 — 다음 번에 이어서
        job.status = "scheduled"
        db.commit()
        return "partial"
    if job.status == "published" and job.repeat_weekly:
        _next_week_draft(db, job)
        db.commit()
    return job.status


def run_due(db: Session, account_id: int | None = None, budget: float = RUN_BUDGET) -> dict:
    start = time.monotonic()
    q = select(GenerationJob.id).where(GenerationJob.status == "scheduled", GenerationJob.scheduled_at <= _now())
    if account_id is not None:
        q = q.where(GenerationJob.account_id == account_id)
    ids = list(db.scalars(q.order_by(GenerationJob.scheduled_at)))
    out: dict[str, int] = {}
    for job_id in ids:
        if time.monotonic() - start > budget:
            break
        if not _claim(db, job_id):
            continue
        job = db.get(GenerationJob, job_id)
        try:
            result = _publish_one(db, job)
        except Exception as exc:  # noqa: BLE001 — 하나가 실패해도 나머지는 계속
            log.exception("scheduled publish crashed job=%s", job_id)
            db.rollback()
            job = db.get(GenerationJob, job_id)
            job.status, job.error = "failed", f"예약 게시 실패: {exc}"
            db.commit()
            result = "failed"
        out[result] = out.get(result, 0) + 1
    return {"due": len(ids), **out}


@router.get("/cron/publish-due")
def cron_publish_due(request: Request, db: Session = Depends(get_db)) -> dict:
    """시각이 된 예약 게시물을 올림 (모든 계정)"""
    header = request.headers.get("authorization", "")
    allowed = {f"Bearer {s}" for s in (settings.cron_secret, settings.scheduler_secret) if s}
    if allowed and header not in allowed:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "인증 실패")
    return run_due(db)


@router.post("/workflow/scheduled/run")
def run_mine(account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """화면을 열 때: 내 계정의 밀린 예약을 올림 (크론이 늦어도 바로)"""
    return run_due(db, account.id, budget=25.0)
