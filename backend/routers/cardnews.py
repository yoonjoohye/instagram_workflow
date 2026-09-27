"""사진과 주제로 게시물 만들기: 업로드 → 조사 → 구성·연출 설계 → 장별 이미지 연출·글자 합성 → 검수 후 게시.

Vercel 함수는 요청당 60초 제한이 있어 이미지를 한 장씩 요청해 만듭니다.
결과는 작업(GenerationJob)으로 저장되고 1장이면 IMAGE, 여러 장이면 CAROUSEL 로 게시됩니다.
(경로 이름 /cardnews 는 내부용입니다.)
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..config import settings
from ..db import get_db
from ..deps import current_account
from ..models import Account, GenerationJob, MediaBlob
from ..services import cardnews as svc
from .workflow import _job_dict

router = APIRouter(tags=["cardnews"])

MAX_UPLOAD_BYTES = 8 * 1024 * 1024


def _media_url(blob_id: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/py/media/{blob_id}.jpg"


def _save_blob(db: Session, account: Account, data: bytes, width: int, height: int, kind: str) -> MediaBlob:
    blob = MediaBlob(
        id=secrets.token_urlsafe(18), account_id=account.id, kind=kind, data=data, width=width, height=height
    )
    db.add(blob)
    db.commit()
    return blob


@router.post("/media/uploads", status_code=status.HTTP_201_CREATED)
async def upload(
    file: UploadFile = File(...),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """사진 한 장 업로드. 회전 보정·축소 후 JPEG 로 보관합니다."""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "사진이 너무 큽니다 (최대 8MB).")
    try:
        data, w, h = svc.normalize(raw)
    except OSError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 파일을 읽을 수 없습니다.") from exc
    blob = _save_blob(db, account, data, w, h, "upload")
    return {"id": blob.id, "url": _media_url(blob.id), "width": w, "height": h}


@router.get("/media/{blob_id}.jpg")
def serve_media(blob_id: str, db: Session = Depends(get_db)) -> Response:
    """공개 이미지 주소 — Instagram 게시 API 가 여기서 사진을 가져갑니다."""
    blob = db.get(MediaBlob, blob_id)
    if blob is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이미지를 찾을 수 없습니다.")
    return Response(
        blob.data,
        media_type=blob.content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


class ResearchIn(BaseModel):
    prompt: str = Field(min_length=2, max_length=2000)
    notes: str = Field(default="", max_length=3000)  # (예전 필드) 사용자 확정 정보
    caption_format: str = Field(default="", max_length=2000)  # 캡션 양식 — 안에 적힌 사실도 확정 정보


class Source(BaseModel):
    title: str = Field(default="", max_length=200)
    uri: str = Field(max_length=2000)


class PlanIn(BaseModel):
    upload_ids: list[str] = Field(default_factory=list, max_length=svc.MAX_PHOTOS)  # 없으면 전부 새로 생성
    prompt: str = Field(min_length=2, max_length=2000)
    tone: str = Field(default="친근한", max_length=64)
    style: str = Field(default="", max_length=300)  # 연출 방향 (선택)
    caption_format: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=3000)
    research_notes: str = Field(default="", max_length=8000)
    sources: list[Source] = Field(default_factory=list, max_length=20)
    reference_ids: list[str] = Field(default_factory=list, max_length=3)  # 연출 참고 이미지
    accent: str = Field(default="#6c5ce7", pattern=r"^#[0-9a-fA-F]{6}$")


class RenderIn(BaseModel):
    instruction: str | None = Field(default=None, max_length=300)  # 이 슬라이드만 다시 편집할 때


def _blobs(db: Session, account: Account, ids: list[str]) -> list[MediaBlob]:
    blobs = [db.get(MediaBlob, i) for i in ids]
    if any(b is None or b.account_id != account.id for b in blobs):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "업로드한 사진을 찾을 수 없습니다.")
    return blobs  # type: ignore[return-value]


def _own_job(db: Session, account: Account, job_id: int) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id or not isinstance(job.plan, dict) or not job.plan.get("slides"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    return job


@router.post("/cardnews/research")
def research(body: ResearchIn, account: Account = Depends(current_account)) -> dict:
    """Gemini + Google 검색으로 주제를 조사합니다 (Vercel 시간 제한 때문에 설계와 나눠 호출)."""
    # 캡션 양식에 적은 사실(추천인 코드 등)도 확정 정보로 조사에 넘깁니다.
    result, warning = svc.research(body.prompt, "\n".join(p for p in (body.notes, body.caption_format) if p.strip()))
    return {**result, "warning": warning}


@router.post("/cardnews/plan", status_code=status.HTTP_201_CREATED)
def plan(body: PlanIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """사진과 주제로 표지·내용·결론 구성과 캡션·해시태그를 설계합니다."""
    blobs = _blobs(db, account, body.upload_ids)
    refs = _blobs(db, account, body.reference_ids)
    design, engine, warning = svc.plan_cardnews(
        [b.data for b in blobs],
        references=[r.data for r in refs],
        prompt=body.prompt,
        tone=body.tone,
        style=body.style,
        caption_format=body.caption_format,
        notes=body.notes,
        research_notes=body.research_notes,
    )
    slides = svc.slide_list(design)
    job = GenerationJob(
        account_id=account.id,
        prompt=body.prompt,
        media_kind="CAROUSEL" if len(slides) > 1 else "IMAGE",
        tone=body.tone,
        status="generating",
        provider=f"studio/{engine}",
        error=warning,
        caption=design["caption"],
        # 양식 안에 해시태그 칸이 있으면 이미 캡션에 들어갔으므로 따로 붙이지 않습니다.
        hashtags=[] if design.get("hashtags_inline") else design["hashtags"],
        plan={
            **design,
            "upload_ids": body.upload_ids,
            "reference_ids": body.reference_ids,
            "style": body.style,
            "accent": body.accent,
            "topic": body.prompt,
            "sources": [s.model_dump() for s in body.sources],
        },
        assets=[
            {"type": "image", "url": "", "thumbnail_url": "", "meta": {"role": s["role"], "status": "pending"}}
            for s in slides
        ],
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return {"job": _job_dict(job), "slides": slides, "engine": engine, "warning": warning}


@router.post("/cardnews/{job_id}/slides/{index}")
def render_slide(
    job_id: int,
    index: int,
    body: RenderIn | None = None,
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """한 장을 이미지 연출(편집·생성) + 글자 합성해 만듭니다 (다시 만들기에도 사용)."""
    job = _own_job(db, account, job_id)
    if job.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 게시된 작업입니다.")
    slides = svc.slide_list(job.plan)
    if not 0 <= index < len(slides):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이미지 번호가 올바르지 않습니다.")
    slide = slides[index]
    uploads = _blobs(db, account, job.plan.get("upload_ids") or [])
    photo = slide.get("photo", -1)
    source = uploads[photo].data if isinstance(photo, int) and 0 <= photo < len(uploads) else None

    instruction = body.instruction if body and body.instruction else ""
    references = [b.data for b in _blobs(db, account, job.plan.get("reference_ids") or [])]
    edited, engine = svc.render_visual(
        source,
        slide,
        topic=job.plan.get("topic") or job.prompt,
        style=job.plan.get("style", ""),
        instruction=instruction,
        references=references,
        art_style=job.plan.get("art_style", ""),
        post_format=job.plan.get("format", ""),
    )
    if slide["role"] == "designed" and engine.startswith("basic") and slide.get("image_text"):
        # 이미지 생성이 실패하면 그림 속 글자(말풍선·손글씨)가 사라지므로 서버 글자로라도 내용을 살립니다.
        slide = {**slide, "role": "overlay", "title": slide["image_text"], "body": ""}
    card = svc.compose(
        edited, slide, index=index, total=len(slides), handle=account.username, accent=job.plan.get("accent", "#6c5ce7")
    )
    blob = _save_blob(db, account, card, *svc.SIZE, kind="slide")

    assets = list(job.assets or [])
    # 다시 만들기라면 이전 슬라이드 이미지는 지워 DB 에 쌓이지 않게 합니다.
    previous = (assets[index].get("url") or "").rsplit("/media/", 1)[-1].removesuffix(".jpg")
    if previous and (old := db.get(MediaBlob, previous)) is not None and old.kind == "slide":
        db.delete(old)
    assets[index] = {
        "type": "image",
        "url": _media_url(blob.id),
        "thumbnail_url": _media_url(blob.id),
        "meta": {
            "role": slide["role"],
            "status": "done",
            "engine": engine,
            "generated": source is None,
            "instruction": instruction or slide.get("visual", ""),
        },
    }
    job.assets = assets
    flag_modified(job, "assets")
    db.commit()
    return {"index": index, "asset": assets[index], "engine": engine}


@router.post("/cardnews/{job_id}/finalize")
def finalize(job_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """모든 슬라이드가 준비되면 검수 대기 상태로 바꿉니다."""
    job = _own_job(db, account, job_id)
    pending = [i for i, a in enumerate(job.assets or []) if not a.get("url")]
    if pending:
        raise HTTPException(status.HTTP_409_CONFLICT, f"아직 만들지 않은 이미지가 있습니다: {pending}")
    failed = [a["meta"].get("engine", "") for a in job.assets if str(a["meta"].get("engine", "")).startswith("basic")]
    notes = [job.error] if job.error else []
    if failed:
        reason = failed[0].removeprefix("basic (").removesuffix(")")
        low = reason.lower()
        if "quota" in low or "exhausted" in low:
            hint = (
                "Gemini 이미지 모델 사용 한도가 없습니다 (무료 등급은 이미지 생성 한도가 0). "
                "Google AI Studio 에서 결제를 설정해 유료 등급으로 바꿔야 이미지 연출·생성이 동작합니다."
            )
        elif "not found" in low or "not supported" in low:
            hint = "설정한 Gemini 이미지 모델을 쓸 수 없습니다. GEMINI_IMAGE_MODEL 을 확인하세요."
        else:
            hint = f"원인: {reason[:200]}"
        notes.append(
            f"{len(failed)}/{len(job.assets)}장은 이미지 생성에 실패해 원본 사진 보정(또는 빈 배경)으로 대신 만들었습니다. {hint}"
        )
    job.error = " / ".join(notes)
    if job.status == "generating":
        job.status = "ready"
    db.commit()
    db.refresh(job)
    return _job_dict(job)
