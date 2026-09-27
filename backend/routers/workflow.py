"""프롬프트 → 미디어·음악·캡션 생성 → 검수 → Instagram 발행."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, AutoReplyRule, GenerationJob, MediaBlob
from ..schemas import JobPatch, PublishIn
from ..services import publishing
from ..services.meta_graph import GraphError

router = APIRouter(prefix="/workflow", tags=["workflow"])


def compose_caption(caption: str, hashtags: list[str]) -> str:
    """Instagram 에 실제로 올라갈 최종 문자열 (본문 + 빈 줄 + 해시태그)."""
    body = caption.strip()
    if not hashtags:
        return body
    return f"{body}\n\n" + " ".join(f"#{t.lstrip('#')}" for t in hashtags)


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
        # 게시물 만들기: Gemini 가 주제 조사에 참고한 출처
        "sources": (job.plan or {}).get("sources", []) if isinstance(job.plan, dict) else [],
        # 게시물 만들기: 주제·연출 방향에서 뽑은 요구사항과 반영 위치 (검수용)
        "requirements": (job.plan or {}).get("requirements", []) if isinstance(job.plan, dict) else [],
    }


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
    job = _get_job(db, account, job_id)
    # 이 작업이 만든 이미지(완성본·글 얹기 전 이미지)도 함께 지웁니다. 사용자가 올린 원본 사진은 남깁니다.
    for asset in job.assets or []:
        ids = [(asset.get("url") or "").rsplit("/media/", 1)[-1].removesuffix(".jpg"), (asset.get("meta") or {}).get("visual_id")]
        for blob_id in filter(None, ids):
            blob = db.get(MediaBlob, blob_id)
            if blob is not None and blob.account_id == account.id and blob.kind in ("slide", "visual"):
                db.delete(blob)
    db.delete(job)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _current_media_url(url: str) -> str:
    """우리 서버 이미지(/api/py/media/…)는 만든 뒤 도메인이 바뀌었을 수 있어 현재 공개 주소로 맞춥니다.
    (Instagram 은 이 주소에서 직접 이미지를 가져갑니다.)"""
    marker = "/api/py/media/"
    if marker not in url:
        return url
    return settings.public_base_url.rstrip("/") + url[url.index(marker):]


@router.post("/publish")
def publish_job(
    body: PublishIn,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    job = _get_job(db, account, body.job_id)
    if job.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 발행된 작업입니다.")

    visual = [
        {**a, "url": _current_media_url(a.get("url", "")), "thumbnail_url": _current_media_url(a.get("thumbnail_url", ""))}
        for a in (job.assets or [])
        if a.get("type") in {"image", "video"}
    ]
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
