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
    style: str = Field(default="", max_length=2000)  # 연출 방향 — 조사 방향도 여기에 맞춤


class Source(BaseModel):
    title: str = Field(default="", max_length=200)
    uri: str = Field(max_length=2000)


class PlanIn(BaseModel):
    upload_ids: list[str] = Field(default_factory=list, max_length=svc.MAX_PHOTOS)  # 없으면 전부 새로 생성
    prompt: str = Field(min_length=2, max_length=2000)
    tone: str = Field(default="", max_length=64)  # (사용 안 함) 예전 요청 호환용
    style: str = Field(default="", max_length=2000)  # 연출 방향 — 주제와 함께 절대 기준
    caption_format: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=3000)
    research_notes: str = Field(default="", max_length=8000)
    sources: list[Source] = Field(default_factory=list, max_length=20)
    reference_ids: list[str] = Field(default_factory=list, max_length=3)  # 연출 참고 이미지
    accent: str = Field(default="#6c5ce7", pattern=r"^#[0-9a-fA-F]{6}$")
    font: str = Field(default="auto", max_length=40)  # auto = Gemini 가 형식에 맞게 선택


class RenderIn(BaseModel):
    instruction: str | None = Field(default=None, max_length=1000)  # 이 이미지만의 프롬프트
    # True 면 지금 이미지(글 얹기 전)에서 요청한 부분만 고치고, False 면 원본 사진으로 처음부터 다시 만듭니다.
    from_current: bool = False
    # 검수 화면에서 직접 요청한 수정이면 True — 이미지 연출이 실패했을 때 기본 편집본으로 덮어쓰지 않고 오류를 알립니다.
    strict: bool = False


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


@router.get("/cardnews/fonts")
def fonts() -> dict:
    """고를 수 있는 글씨체 목록 (미리보기 이미지 주소 포함)."""
    return {
        "data": [
            {"key": k, "label": v["label"], "preview": f"/api/py/cardnews/fonts/{k}.png"} for k, v in svc.FONTS.items()
        ]
    }


@router.get("/cardnews/fonts/{key}.png")
def font_preview(key: str) -> Response:
    if key not in svc.FONTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "없는 글씨체입니다.")
    return Response(svc.font_preview(key), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.post("/cardnews/research")
def research(body: ResearchIn, account: Account = Depends(current_account)) -> dict:
    """Gemini + Google 검색으로 주제를 조사합니다 (Vercel 시간 제한 때문에 설계와 나눠 호출)."""
    # 캡션 양식에 적은 사실(추천인 코드 등)도 확정 정보로 조사에 넘깁니다.
    result, warning = svc.research(
        body.prompt, "\n".join(p for p in (body.notes, body.caption_format) if p.strip()), body.style
    )
    return {**result, "warning": warning}


@router.post("/cardnews/plan", status_code=status.HTTP_201_CREATED)
def plan(body: PlanIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """사진과 주제로 게시물 구성(장 수·장별 사진·레이아웃)과 캡션·해시태그를 설계합니다."""
    blobs = _blobs(db, account, body.upload_ids)
    refs = _blobs(db, account, body.reference_ids)
    try:
        design, engine, warning = svc.plan_cardnews(
            [b.data for b in blobs],
            references=[r.data for r in refs],
            prompt=body.prompt,
            style=body.style,
            caption_format=body.caption_format,
            notes=body.notes,
            research_notes=body.research_notes,
        )
    except svc.GeminiError as exc:
        # 엉뚱한 기본 구성으로 만들지 않고 멈춥니다.
        if svc.is_busy(exc):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Gemini 가 지금 혼잡하거나 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요. " f"({exc})",
            ) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Gemini 로 게시물을 구성하지 못했습니다: {exc}") from exc
    slides = svc.slide_list(design)
    job = GenerationJob(
        account_id=account.id,
        prompt=body.prompt,
        media_kind="CAROUSEL" if len(slides) > 1 else "IMAGE",
        tone="",
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
            # 사용자가 고른 글씨체가 있으면 Gemini 선택보다 우선
            "font": svc.font_key(body.font) if body.font in svc.FONTS else design.get("font", svc.DEFAULT_FONT),
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
    ids = slide.get("photos")
    if ids is None:  # 예전 작업
        ids = [slide.get("photo", -1)]
    sources = [uploads[i].data for i in ids if isinstance(i, int) and 0 <= i < len(uploads)]

    instruction = (body.instruction or "").strip() if body else ""
    assets = list(job.assets or [])
    prev_meta = (assets[index].get("meta") or {}) if index < len(assets) else {}
    from_current = bool(body and body.from_current)
    if from_current and not instruction:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "무엇을 고칠지 적어 주세요.")
    # 글이 이미 들어간 이미지(예전 작업이거나 이전에 완성본을 고친 경우)는 그 위에 글을 다시 얹지 않습니다.
    baked = bool(prev_meta.get("text_baked"))
    current = db.get(MediaBlob, prev_meta.get("visual_id") or "") if from_current else None
    if from_current and current is None:
        # 글 얹기 전 이미지가 없는 예전 이미지: 완성본에서 바로 고칩니다.
        slide_id = (assets[index].get("url") or "").rsplit("/media/", 1)[-1].removesuffix(".jpg")
        current, baked = db.get(MediaBlob, slide_id), True
        if current is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "고칠 이미지를 찾지 못했습니다. '처음부터 다시'로 만들어 주세요.")
    if current is not None and current.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "고칠 이미지를 찾지 못했습니다.")
    if current is not None:
        edited, engine = svc.edit_visual(current.data, instruction, aspect=svc.ASPECT[slide["role"]])
    else:
        baked = False
        references = [b.data for b in _blobs(db, account, job.plan.get("reference_ids") or [])]
        edited, engine = svc.render_visual(
            sources,
            slide,
            topic=job.plan.get("topic") or job.prompt,
            style=job.plan.get("style", ""),
            instruction=instruction,
            references=references,
            art_style=job.plan.get("art_style", ""),
            post_format=job.plan.get("format", ""),
            font=job.plan.get("font", ""),
        )
    if body and body.strict and engine.startswith("basic"):
        # 사용자가 요청한 수정이 적용되지 않았는데 조용히 같은/보정본 이미지로 바꾸지 않습니다.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "이미지를 수정하지 못했습니다. " + _image_failure_hint(engine))
    if slide["role"] == "designed" and engine.startswith("basic") and slide.get("image_text"):
        # 이미지 생성이 실패하면 그림 속 글자(말풍선·손글씨)가 사라지므로 서버 글자로라도 내용을 살립니다.
        slide = {**slide, "role": "overlay", "title": slide["image_text"], "body": ""}
    if baked:
        card = svc.to_jpeg(svc.cover_fit(edited, svc.SIZE), 92)
    else:
        card = svc.compose(edited, slide, accent=job.plan.get("accent", "#6c5ce7"), font=job.plan.get("font", svc.DEFAULT_FONT))
    blob = _save_blob(db, account, card, *svc.SIZE, kind="slide")
    # 글을 얹기 전 이미지도 보관해 '지금 이미지에서 고치기'에 씁니다.
    vw, vh = svc.image_size(edited)
    visual_blob = _save_blob(db, account, edited, vw, vh, kind="visual")

    # 다시 만들기라면 이전 이미지는 지워 DB 에 쌓이지 않게 합니다.
    previous = (assets[index].get("url") or "").rsplit("/media/", 1)[-1].removesuffix(".jpg")
    if previous and (old := db.get(MediaBlob, previous)) is not None and old.kind == "slide":
        db.delete(old)
    if (old_visual := db.get(MediaBlob, prev_meta.get("visual_id") or "")) is not None and old_visual.kind == "visual":
        db.delete(old_visual)
    assets[index] = {
        "type": "image",
        "url": _media_url(blob.id),
        "thumbnail_url": _media_url(blob.id),
        "meta": {
            "role": slide["role"],
            "status": "done",
            "engine": engine,
            "generated": not sources,
            "photos": len(sources),
            "instruction": instruction or slide.get("visual", ""),
            "prompt": instruction,  # 사용자가 이 이미지에 적은 프롬프트
            "visual_id": visual_blob.id,
            "text_baked": baked,
        },
    }
    job.assets = assets
    flag_modified(job, "assets")
    db.commit()
    return {"index": index, "asset": assets[index], "engine": engine}


def _image_failure_hint(engine: str) -> str:
    reason = engine.removeprefix("basic (").removesuffix(")")
    low = reason.lower()
    if "quota" in low or "exhausted" in low:
        return (
            "Gemini 이미지 모델 사용 한도가 없습니다 (무료 등급은 이미지 생성 한도가 0). "
            "Google AI Studio 에서 결제를 설정해 유료 등급으로 바꿔야 이미지 연출·생성·수정이 동작합니다."
        )
    if "not found" in low or "not supported" in low:
        return "설정한 Gemini 이미지 모델을 쓸 수 없습니다. GEMINI_IMAGE_MODEL 을 확인하세요."
    return f"원인: {reason[:200]}"


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
        hint = _image_failure_hint(failed[0])
        notes.append(
            f"{len(failed)}/{len(job.assets)}장은 이미지 생성에 실패해 원본 사진 보정(또는 빈 배경)으로 대신 만들었습니다. {hint}"
        )
    job.error = " / ".join(notes)
    if job.status == "generating":
        job.status = "ready"
    db.commit()
    db.refresh(job)
    return _job_dict(job)
