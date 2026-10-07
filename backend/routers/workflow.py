"""만든 게시물(작업) 목록·검수 중 수정·삭제, Instagram 게시와 발행 한도."""
from __future__ import annotations

import datetime as dt
import time

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, AutoReplyRule, GenerationJob, MediaBlob
from ..schemas import JobPatch, PublishIn
from ..services import blobstore, media_sync, publishing
from ..services.meta_graph import GraphError

router = APIRouter(prefix="/workflow", tags=["workflow"])


def compose_caption(caption: str, hashtags: list[str]) -> str:
    """Instagram 에 실제로 올라갈 최종 문자열 (본문 + 빈 줄 + 해시태그)."""
    body = caption.strip()
    if not hashtags:
        return body
    return f"{body}\n\n" + " ".join(f"#{t.lstrip('#')}" for t in hashtags)


def _story_progress(job: GenerationJob) -> dict | None:
    if job.media_kind != "STORIES":
        return None
    ids = (job.plan or {}).get("story_media_ids") or [] if isinstance(job.plan, dict) else []
    total = len([a for a in (job.assets or []) if a.get("type") in {"image", "video"}])
    return {"done": sum(1 for i in ids if i), "total": total}


def _job_dict(job: GenerationJob) -> dict:
    return {
        "id": job.id,
        "prompt": job.prompt,
        "media_kind": job.media_kind,
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
        # 스토리: 올린 개수 / 전체 (여러 개를 이어서 올리는 중일 때 화면에 표시)
        "story_progress": _story_progress(job),
        # 인스타 음악 추천·선택 (사진 게시물은 게시 후 인스타 앱에서 추가)
        "music": (job.plan or {}).get("music") if isinstance(job.plan, dict) else None,
    }


@router.get("/jobs")
def list_jobs(
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
    limit: int = 30,
) -> dict:
    media_sync.try_sync(db, account)  # Instagram 에서 지운 게시물 반영
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
    # 올린 동영상은 Blob 에 있어 따로 지웁니다 (다른 작업이 같은 영상을 쓰지 않을 때만).
    video_urls = [a.get("url", "") for a in (job.assets or []) if a.get("type") == "video"]
    in_use = {
        a.get("url")
        for other in db.scalars(select(GenerationJob).where(GenerationJob.account_id == account.id, GenerationJob.id != job.id))
        for a in (other.assets or [])
        if a.get("type") == "video"
    }
    blobstore.delete([u for u in video_urls if u not in in_use])
    for blob in db.scalars(select(MediaBlob).where(MediaBlob.account_id == account.id, MediaBlob.kind == "video")):
        if blob.url in video_urls and blob.url not in in_use:
            db.delete(blob)
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

    if job.media_kind == "STORIES":
        return _publish_stories(db, account, job, visual)

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

            # 이전 시도에서 만든 컨테이너가 아직 처리 중이거나 끝났다면(큰 동영상) 새로 만들지 않고 이어서 발행합니다.
            # 캡션·미디어가 그때와 같을 때만.
            fingerprint = f"{caption}|{'|'.join(a['url'] for a in visual)}"
            container_id = None
            if job.ig_container_id and (job.plan or {}).get("container_fingerprint") == fingerprint:
                try:
                    code = publishing.container_status(client, job.ig_container_id).get("status_code")
                except GraphError:
                    code = None
                if code in {"FINISHED", "IN_PROGRESS"}:
                    container_id = job.ig_container_id

            if container_id:
                pass
            elif job.media_kind == "CAROUSEL":
                children = []
                video_children = []
                for asset in visual[:10]:
                    child = publishing.create_container(
                        client,
                        account.ig_user_id,
                        kind="REELS" if asset["type"] == "video" else "IMAGE",
                        media_url=asset["url"],
                        is_carousel_item=True,
                    )
                    if asset["type"] == "video":
                        video_children.append(child)
                    children.append(child)
                # 동영상은 인스타그램에서 동시에 처리되므로 모두 만든 뒤 한꺼번에 기다립니다.
                for child in video_children:
                    publishing.wait_until_finished(client, child)
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
            job.plan = {**(job.plan or {}), "container_fingerprint": fingerprint}
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


STORY_TIME_BUDGET = 40.0  # Vercel 60초 안에서 이만큼만 올리고, 나머지는 다음 요청에서 이어서
_now = time.monotonic  # 테스트에서 바꿔 끼울 수 있게


def _publish_stories(db: Session, account: Account, job: GenerationJob, visual: list[dict]) -> dict:
    """스토리는 한 장씩 따로 올라갑니다. 올린 것은 plan["story_media_ids"] 에 기록해 두고, 시간이 모자라면
    status 를 publishing 으로 두고 돌려줍니다 → 화면이 같은 요청을 다시 보내 이어서 올립니다."""
    started = _now()
    done: list[str | None] = list((job.plan or {}).get("story_media_ids") or [None] * len(visual))
    done += [None] * (len(visual) - len(done))
    job.status = "publishing"
    job.error = ""
    db.commit()
    try:
        with graph_for(account) as client:
            remaining_needed = sum(1 for d in done if not d)
            limit = publishing.publishing_limit(client, account.ig_user_id)
            if limit["remaining"] < remaining_needed:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"24시간 발행 한도를 모두 썼습니다 ({limit['used']}/{limit['total']}).",
                )
            for i, asset in enumerate(visual):
                if done[i]:
                    continue
                if _now() - started > STORY_TIME_BUDGET:
                    break
                container = publishing.create_container(client, account.ig_user_id, kind="STORIES", media_url=asset["url"])
                if asset["type"] == "video":
                    publishing.wait_until_finished(client, container)
                result = publishing.publish(client, account.ig_user_id, container)
                done[i] = result["media_id"]
                # 새 리스트로 넣어야 DB 가 바뀐 것으로 알아챕니다 (같은 리스트를 고치면 저장이 안 됨)
                job.plan = {**(job.plan or {}), "story_media_ids": list(done)}
                if not job.ig_media_id:
                    job.ig_media_id, job.permalink = result["media_id"], result.get("permalink", "")
                db.commit()
    except HTTPException:
        job.status = "ready" if not any(done) else "publishing"
        db.commit()
        raise
    except GraphError as exc:
        job.status = "failed"
        job.error = str(exc)
        db.commit()
        raise HTTPException(exc.status, str(exc)) from exc

    if all(done):
        job.status = "published"
        job.published_at = dt.datetime.now(dt.timezone.utc)
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
