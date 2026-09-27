"""프롬프트 → 미디어·음악·캡션 생성 → 검수 → Instagram 발행."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, AutoReplyRule, GenerationJob
from ..schemas import GenerateIn, JobPatch, PublishIn
from ..services import publishing
from ..services.generation import (
    GenerationRequest,
    active_engine_name,
    compose_caption,
    generate_caption,
    generate_media,
)
from ..services.meta_graph import GraphError

router = APIRouter(prefix="/workflow", tags=["workflow"])


def _job_dict(job: GenerationJob) -> dict:
    return {
        "id": job.id,
        "prompt": job.prompt,
        "media_kind": job.media_kind,
        "tone": job.tone,
        "language": job.language,
        "with_music": bool(job.with_music),
        "status": job.status,
        "provider": job.provider,
        "error": job.error,
        "caption": job.caption,
        "hashtags": job.hashtags or [],
        "assets": job.assets or [],
        "final_caption": compose_caption(job.caption, job.hashtags or []),
        "ig_media_id": job.ig_media_id,
        "permalink": job.permalink,
        "published_at": job.published_at.isoformat() if job.published_at else None,
        "created_at": job.created_at.isoformat(),
    }


@router.get("/engine")
def engine_status(account: Account = Depends(current_account)) -> dict:
    return {"media_engine": active_engine_name()}


@router.post("/generate", status_code=status.HTTP_201_CREATED)
def generate(
    body: GenerateIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """한 번의 프롬프트로 미디어 + (선택)음악 + 캡션을 만들어 초안 job 을 남깁니다."""
    count = 2 if body.media_kind == "CAROUSEL" and body.count < 2 else body.count
    if body.media_kind == "CAROUSEL" and count > 10:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "캐러셀은 최대 10장까지입니다.")
    if body.media_kind in {"IMAGE", "REELS", "STORIES"}:
        count = 1

    job = GenerationJob(
        account_id=account.id,
        prompt=body.prompt,
        media_kind=body.media_kind,
        tone=body.tone,
        language=body.language,
        with_music=int(body.with_music),
        status="generating",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        assets, engine, warning = generate_media(
            GenerationRequest(
                prompt=body.prompt,
                media_kind=body.media_kind,
                count=count,
                aspect_ratio=body.aspect_ratio,
                with_music=body.with_music,
                style=body.style,
            )
        )
        written = generate_caption(
            body.prompt, tone=body.tone, language=body.language, media_kind=body.media_kind
        )
    except Exception as exc:  # 생성 실패를 job 에 남겨 UI 에서 보이게 합니다.
        job.status = "failed"
        job.error = str(exc)
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"생성 실패: {exc}") from exc

    job.assets = [a.to_dict() for a in assets]
    job.provider = engine
    job.caption = written["caption"]
    job.hashtags = written["hashtags"]
    job.error = warning
    job.status = "ready"
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.get("/jobs")
def list_jobs(
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
    limit: int = 30,
) -> dict:
    rows = db.scalars(
        select(GenerationJob)
        .where(GenerationJob.account_id == account.id)
        .order_by(desc(GenerationJob.created_at))
        .limit(min(limit, 100))
    ).all()
    return {"data": [_job_dict(j) for j in rows]}


def _get_job(db: Session, account: Account, job_id: int) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "작업을 찾을 수 없습니다.")
    return job


@router.get("/jobs/{job_id}")
def get_job(
    job_id: int,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    return _job_dict(_get_job(db, account, job_id))


@router.patch("/jobs/{job_id}")
def patch_job(
    job_id: int,
    body: JobPatch,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """발행 전 사람이 캡션·해시태그·에셋을 손볼 수 있게 합니다."""
    job = _get_job(db, account, job_id)
    if job.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 발행된 게시물은 수정할 수 없습니다.")
    if body.caption is not None:
        job.caption = body.caption
    if body.hashtags is not None:
        job.hashtags = [t.lstrip("#").strip() for t in body.hashtags if t.strip()]
    if body.assets is not None:
        job.assets = body.assets
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_job(
    job_id: int,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> Response:
    db.delete(_get_job(db, account, job_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/publish")
def publish_job(
    body: PublishIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    job = _get_job(db, account, body.job_id)
    if job.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 발행된 작업입니다.")

    visual = [a for a in (job.assets or []) if a.get("type") in {"image", "video"}]
    if not visual:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "발행할 미디어가 없습니다.")

    caption = compose_caption(job.caption, job.hashtags or [])
    job.status = "publishing"
    job.error = ""
    db.commit()

    try:
        with graph_for(account) as client:
            limit = publishing.publishing_limit(client, account.ig_user_id)
            if limit["remaining"] <= 0:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"24시간 발행 한도를 모두 썼습니다 ({limit['used']}/{limit['total']}).",
                )

            if job.media_kind == "CAROUSEL":
                children = []
                for asset in visual[:10]:
                    child = publishing.create_container(
                        client,
                        account.ig_user_id,
                        kind="REELS" if asset["type"] == "video" else "IMAGE",
                        media_url=asset["url"],
                        is_carousel_item=True,
                    )
                    if asset["type"] == "video":
                        publishing.wait_until_finished(client, child)
                    children.append(child)
                container_id = publishing.create_container(
                    client,
                    account.ig_user_id,
                    kind="CAROUSEL",
                    caption=caption,
                    children=children,
                )
            else:
                asset = visual[0]
                container_id = publishing.create_container(
                    client,
                    account.ig_user_id,
                    kind=job.media_kind,  # type: ignore[arg-type]
                    media_url=asset["url"],
                    caption=caption,
                    cover_url=asset.get("thumbnail_url") or None,
                    share_to_feed=body.share_to_feed if job.media_kind == "REELS" else None,
                )

            job.ig_container_id = container_id
            db.commit()

            if job.media_kind in {"REELS", "CAROUSEL"} or visual[0]["type"] == "video":
                publishing.wait_until_finished(client, container_id)

            result = publishing.publish(client, account.ig_user_id, container_id)
    except HTTPException:
        job.status = "ready"
        db.commit()
        raise
    except GraphError as exc:
        job.status = "failed"
        job.error = str(exc)
        db.commit()
        raise HTTPException(exc.status, str(exc)) from exc

    job.ig_media_id = result["media_id"]
    job.permalink = result.get("permalink", "")
    job.published_at = dt.datetime.now(dt.timezone.utc)
    job.status = "published"
    # 게시 전에 만들어 둔 자동 응답 규칙을 실제 게시물에 연결합니다.
    rule = db.scalar(select(AutoReplyRule).where(AutoReplyRule.job_id == job.id))
    if rule is not None:
        rule.ig_media_id = job.ig_media_id
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.get("/quota")
def quota(account: Account = Depends(current_account)) -> dict:
    with graph_for(account) as client:
        try:
            return publishing.publishing_limit(client, account.ig_user_id)
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
