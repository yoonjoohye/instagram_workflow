"""사진과 주제로 게시물 만들기: 업로드 → 조사 → 구성·연출 설계 → 장별 이미지 연출·글자 합성 → 검수 후 게시.

Vercel 함수는 요청당 60초 제한이 있어 이미지를 한 장씩 요청해 만듭니다.
결과는 작업(GenerationJob)으로 저장되고 1장이면 IMAGE, 여러 장이면 CAROUSEL 로 게시됩니다.
"""
from __future__ import annotations

import json
import secrets

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from typing import Annotated, Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..config import settings
from ..db import get_db
from ..deps import current_account
from ..i18n import lang_of, norm_lang
from ..models import Account, GenerationJob, MediaBlob
from ..services import blobstore
from ..services import studio as svc
from .workflow import _job_dict

router = APIRouter(tags=["studio"])

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


class VideoIn(BaseModel):
    url: str = Field(max_length=1000)  # 브라우저가 Vercel Blob 에 올린 공개 주소
    cover_id: str = Field(max_length=40)  # 브라우저가 뽑은 대표 화면(사진 업로드 id)
    width: int = Field(default=0, ge=0, le=10000)
    height: int = Field(default=0, ge=0, le=10000)
    content_type: str = Field(default="video/mp4", max_length=32)


@router.post("/media/videos", status_code=status.HTTP_201_CREATED)
def register_video(body: VideoIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """Blob 에 올린 동영상을 게시물 재료로 등록합니다."""
    if not blobstore.is_our_blob(body.url):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "동영상 주소가 올바르지 않습니다.")
    _blobs(db, account, [body.cover_id])  # 대표 화면이 내 사진인지 확인
    blob = MediaBlob(
        id=secrets.token_urlsafe(18),
        account_id=account.id,
        kind="video",
        data=b"",
        url=body.url,
        cover_id=body.cover_id,
        content_type=body.content_type if body.content_type.startswith("video/") else "video/mp4",
        width=body.width,
        height=body.height,
    )
    db.add(blob)
    db.commit()
    return {"id": blob.id, "url": body.url, "thumbnail_url": _media_url(body.cover_id)}


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
    caption_format: str = Field(default="", max_length=2000)  # 캡션 양식 — 안에 적힌 사실도 확정 정보
    style: str = Field(default="", max_length=2000)  # 연출 방향 — 조사 방향도 여기에 맞춤
    language: str | None = Field(default=None, max_length=8)  # 화면 언어 (ko|en|ja) — 조사 요약을 이 언어로


class Source(BaseModel):
    title: str = Field(default="", max_length=200)
    uri: str = Field(max_length=2000)


class PlanIn(BaseModel):
    upload_ids: list[str] = Field(default_factory=list, max_length=svc.MAX_PHOTOS)  # 없으면 전부 새로 생성
    prompt: str = Field(min_length=2, max_length=2000)
    style: str = Field(default="", max_length=2000)  # 연출 방향 — 주제와 함께 절대 기준
    caption_format: str = Field(default="", max_length=2000)
    research_notes: str = Field(default="", max_length=8000)
    sources: list[Source] = Field(default_factory=list, max_length=20)
    reference_ids: list[str] = Field(default_factory=list, max_length=3)  # 연출 참고 이미지
    font: str = Field(default="auto", max_length=40)  # auto = Gemini 가 형식에 맞게 선택
    # 화면 언어 (ko|en|ja). 게시물 글은 사용자가 주제를 쓴 언어를 따르고, 애매할 때만 이 언어.
    language: str | None = Field(default=None, max_length=8)
    # feed = 피드 게시물(사진·캐러셀·릴스), story = 스토리(세로 9:16, 장마다 따로 올라감)
    post_type: Literal["feed", "story"] = "feed"


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


@router.get("/studio/fonts")
def fonts(request: Request) -> dict:
    """고를 수 있는 글씨체 목록 (미리보기 이미지 주소 포함). 이름은 화면 언어로."""
    lang = lang_of(request)
    return {
        "data": [
            {"key": k, "label": svc.font_label(k, lang), "preview": f"/api/py/studio/fonts/{k}.png?lang={lang}"}
            for k in svc.FONTS
        ]
    }


@router.get("/studio/fonts/{key}.png")
def font_preview(key: str, lang: str = "ko") -> Response:
    if key not in svc.FONTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "없는 글씨체입니다.")
    return Response(
        svc.font_preview(key, lang=norm_lang(lang)), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"}
    )


class PhotoQueryIn(BaseModel):
    prompt: str = Field(min_length=2, max_length=1000)
    today: str = Field(default="", max_length=10)  # 사용자 기기 날짜 (YYYY-MM-DD) — '어제' 같은 표현용


@router.post("/studio/photo-query")
def photo_query(body: PhotoQueryIn, account: Account = Depends(current_account)) -> dict:
    """기기 사진 자동 선택용: 주제를 영어 장면 묘사·장소·날짜로 바꿉니다 (사진 자체는 서버로 오지 않음)."""
    import datetime as _dt

    today = body.today if len(body.today) == 10 else _dt.date.today().isoformat()
    try:
        return svc.photo_query(body.prompt, today)
    except svc.GeminiError as exc:
        if svc.is_busy(exc):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Gemini 가 지금 혼잡하거나 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요. " f"({exc})",
            ) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"사진 검색 조건을 만들지 못했습니다: {exc}") from exc


@router.post("/studio/research")
def research(body: ResearchIn, request: Request, account: Account = Depends(current_account)) -> dict:
    """Gemini + Google 검색으로 주제를 조사합니다 (Vercel 시간 제한 때문에 설계와 나눠 호출)."""
    # 캡션 양식에 적은 사실(추천인 코드 등)도 확정 정보로 조사에 넘깁니다.
    result, warning = svc.research(
        body.prompt,
        body.caption_format,
        body.style,
        language=norm_lang(body.language or lang_of(request)),
    )
    return {**result, "warning": warning}


@router.post("/studio/plan", status_code=status.HTTP_201_CREATED)
def plan(body: PlanIn, request: Request, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """사진과 주제로 게시물 구성(장 수·장별 사진·레이아웃)과 캡션·해시태그를 설계합니다."""
    blobs = _blobs(db, account, body.upload_ids)
    refs = _blobs(db, account, body.reference_ids)
    # 동영상이 있으면 이미지 편집 없이 올린 원본 그대로 게시하고, Gemini 는 캡션·해시태그·음악만 만듭니다.
    original = any(b.kind == "video" for b in blobs)
    story = body.post_type == "story"
    kinds = ["video" if b.kind == "video" else "photo" for b in blobs]
    ai_images = [(db.get(MediaBlob, b.cover_id).data if b.kind == "video" else b.data) for b in blobs]  # type: ignore[union-attr]
    try:
        design, engine, warning = svc.plan_post(
            ai_images,
            references=[r.data for r in refs],
            prompt=body.prompt,
            style=body.style,
            caption_format=body.caption_format,
            research_notes=body.research_notes,
            language=norm_lang(body.language or lang_of(request)),
            original=original,
            kinds=kinds,
            story=story,
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
    if original:
        items = blobs[: svc.MAX_STORIES if story else 10]  # 캐러셀은 최대 10장
        media_kind = "STORIES" if story else "CAROUSEL" if len(items) > 1 else ("REELS" if items[0].kind == "video" else "IMAGE")
        assets = [_original_asset(b) for b in items]
    else:
        media_kind = "STORIES" if story else "CAROUSEL" if len(slides) > 1 else "IMAGE"
        assets = [
            {"type": "image", "url": "", "thumbnail_url": "", "meta": {"role": s["role"], "status": "pending"}}
            for s in slides
        ]
    job = GenerationJob(
        account_id=account.id,
        prompt=body.prompt,
        media_kind=media_kind,
        tone="",
        status="generating",
        # original/* 은 원본 게시 — 이미지별 다시 만들기를 쓰지 않습니다.
        provider=f"{'original' if original else 'studio'}/{engine}",
        error=warning,
        caption=design["caption"],
        # 양식 안에 해시태그 칸이 있으면 이미 캡션에 들어갔으므로 따로 붙이지 않습니다.
        hashtags=[] if design.get("hashtags_inline") else design["hashtags"],
        plan={
            **design,
            "upload_ids": body.upload_ids,
            "reference_ids": body.reference_ids,
            "style": body.style,
            # 사용자가 고른 글씨체가 있으면 Gemini 선택보다 우선
            "font": svc.font_key(body.font) if body.font in svc.FONTS else design.get("font", svc.DEFAULT_FONT),
            "topic": body.prompt,
            "sources": [s.model_dump() for s in body.sources],
            "original": original,
            "post_type": body.post_type,
        },
        assets=assets,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    # 원본 게시는 만들 이미지가 없으므로 slides 를 비워 보냅니다 (바로 finalize).
    return {"job": _job_dict(job), "slides": [] if original else slides, "engine": engine, "warning": warning}


class ManualIn(BaseModel):
    upload_ids: list[str] = Field(default_factory=list, max_length=10)  # 비우면 빈 작업 (AI 로 이미지를 만들어 채움)
    post_type: Literal["feed", "story"] = "feed"
    prompt: str = Field(default="", max_length=2000)  # 주제 메모 — 캡션을 쓸 때 참고
    style: str = Field(default="", max_length=2000)  # 고른 컨셉의 연출 방향
    caption_format: str = Field(default="", max_length=2000)  # 고른 컨셉의 캡션 양식
    write_caption: bool = False  # True 면 사진·주제·컨셉을 보고 캡션·해시태그를 바로 씀 (실패해도 작업은 만듦)
    template: str = Field(default="auto", max_length=40)  # 고른 컨셉 key (화면 표시용)
    language: str | None = Field(default=None, max_length=8)


def _original_asset(b: MediaBlob) -> dict:
    if b.kind == "video":
        return {"type": "video", "url": b.url, "thumbnail_url": _media_url(b.cover_id),
                "meta": {"role": "video", "status": "done", "engine": "original"}}
    return {"type": "image", "url": _media_url(b.id), "thumbnail_url": _media_url(b.id),
            "meta": {"role": "photo", "status": "done", "engine": "original"}}


@router.post("/studio/manual", status_code=status.HTTP_201_CREATED)
def manual(body: ManualIn, request: Request, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """AI 없이 고른 사진·동영상 그대로 작업 공간을 엽니다 (직접 편집·음악·캡션은 거기서)."""
    story = body.post_type == "story"
    blobs = _blobs(db, account, body.upload_ids)[:MAX_MEDIA]
    job = GenerationJob(
        account_id=account.id,
        prompt=body.prompt.strip() or "직접 만들기",
        media_kind="STORIES" if story else "IMAGE",
        tone="",
        status="ready",
        provider="original/manual",
        error="",
        caption="",
        hashtags=[],
        plan={
            "slides": [{"role": "photo"} for _ in blobs],
            "upload_ids": body.upload_ids,
            "topic": body.prompt.strip(),
            "style": body.style,
            "caption_format": body.caption_format,
            "template": body.template,
            "original": True,
            "post_type": body.post_type,
        },
        assets=[_original_asset(b) for b in blobs],
    )
    _sync_kind(job)
    if body.write_caption and not story and blobs:
        try:
            written = svc.rewrite_caption(
                topic=body.prompt.strip(), style=body.style, caption="", instruction="",
                caption_format=body.caption_format, language=norm_lang(body.language or lang_of(request)),
                images=_job_images(db, account, job), template=body.template,
            )
            job.caption, job.hashtags = written["caption"], written["hashtags"]
        except svc.GeminiError as exc:
            job.error = f"캡션을 자동으로 쓰지 못했습니다. '✨ 자동 작성'을 다시 눌러 주세요. ({exc})"
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_dict(job)


MAX_MEDIA = 10  # 캐러셀 최대 장수 (스토리도 같은 한도)
CAPTION_HISTORY = 10  # 기억해 두는 캡션 '바란 점' 개수


def _sync_kind(job: GenerationJob) -> None:
    """사진·동영상 수와 피드/스토리에 맞춰 게시 형태를 정합니다."""
    assets = [a for a in job.assets or [] if a.get("type") in ("image", "video")]
    if (job.plan or {}).get("post_type") == "story":
        job.media_kind = "STORIES"
    elif len(assets) > 1:
        job.media_kind = "CAROUSEL"
    else:
        job.media_kind = "REELS" if assets and assets[0]["type"] == "video" else "IMAGE"


def _draft(db: Session, account: Account, job_id: int) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id or not isinstance(job.plan, dict):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    if job.status in ("published", "publishing"):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 게시된 작업입니다.")
    return job


class SettingsIn(BaseModel):
    post_type: Literal["feed", "story"] | None = None
    prompt: str | None = Field(default=None, max_length=2000)  # 주제 메모
    style: str | None = Field(default=None, max_length=2000)
    caption_format: str | None = Field(default=None, max_length=2000)
    template: str | None = Field(default=None, max_length=40)
    caption_tone: Literal["casual", "polite"] | None = None  # 캡션 말투: 반말 / 해요체
    caption_length: Literal["auto", "short", "medium", "long"] | None = None
    caption_requests: list[Annotated[str, Field(max_length=500)]] | None = Field(default=None, max_length=CAPTION_HISTORY)


@router.patch("/studio/{job_id}/settings")
def update_settings(job_id: int, body: SettingsIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """작업 공간에서 컨셉·주제 메모·피드/스토리를 바꿉니다 (AI 버튼들이 참고)."""
    job = _draft(db, account, job_id)
    plan = dict(job.plan)
    if body.prompt is not None:
        plan["topic"] = body.prompt.strip()
        job.prompt = body.prompt.strip() or job.prompt
    for key in ("style", "caption_format", "template", "caption_tone", "caption_length", "caption_requests"):
        if getattr(body, key) is not None:
            plan[key] = getattr(body, key)
    if body.post_type is not None:
        plan["post_type"] = body.post_type
    job.plan = plan
    _sync_kind(job)
    flag_modified(job, "plan")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


class MediaAddIn(BaseModel):
    upload_ids: list[str] = Field(min_length=1, max_length=MAX_MEDIA)


@router.post("/studio/{job_id}/media")
def add_media(job_id: int, body: MediaAddIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """사진·동영상을 더 넣습니다 (올린 그대로)."""
    job = _draft(db, account, job_id)
    assets = list(job.assets or [])
    if len(assets) + len(body.upload_ids) > MAX_MEDIA:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"사진·동영상은 최대 {MAX_MEDIA}개까지 넣을 수 있습니다.")
    blobs = _blobs(db, account, body.upload_ids)
    plan = dict(job.plan)
    job.assets = assets + [_original_asset(b) for b in blobs]
    plan["slides"] = list(plan.get("slides") or []) + [{"role": "photo"} for _ in blobs]
    plan["upload_ids"] = list(plan.get("upload_ids") or []) + body.upload_ids
    plan.setdefault("original", True)
    job.plan = plan
    _sync_kind(job)
    flag_modified(job, "assets")
    flag_modified(job, "plan")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.delete("/studio/{job_id}/media/{index}")
def remove_media(job_id: int, index: int, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """한 장 빼기. 이 작업이 만든 이미지·영상만 지우고, 올린 원본은 남깁니다."""
    job = _draft(db, account, job_id)
    assets = list(job.assets or [])
    if not 0 <= index < len(assets):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이미지 번호가 올바르지 않습니다.")
    gone = assets.pop(index)
    meta = gone.get("meta") or {}
    for blob_id in (_blob_id(gone.get("url", "")), meta.get("visual_id"), (meta.get("edit") or {}).get("base_id"),
                    (meta.get("video_edit") or {}).get("cover_id")):
        if blob_id and (b := db.get(MediaBlob, blob_id)) is not None and b.account_id == account.id and b.kind in ("slide", "visual"):
            db.delete(b)
    if meta.get("video_edit"):
        from .video import discard_renders

        discard_renders(db, account, [gone.get("url", "")])
    plan = dict(job.plan)
    slides = list(plan.get("slides") or [])
    if index < len(slides):
        slides.pop(index)
    plan["slides"] = slides
    job.plan = plan
    job.assets = assets
    _sync_kind(job)
    flag_modified(job, "assets")
    flag_modified(job, "plan")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


class GenerateIn(BaseModel):
    instruction: str = Field(default="", max_length=1000)  # 어떤 이미지를 원하는지 (비우면 주제·컨셉으로)


@router.post("/studio/{job_id}/media/generate")
def generate_media(job_id: int, body: GenerateIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """주제 메모·컨셉·요청으로 새 이미지를 AI 로 만들어 한 장 추가합니다."""
    job = _draft(db, account, job_id)
    if len(job.assets or []) >= MAX_MEDIA:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"사진·동영상은 최대 {MAX_MEDIA}개까지 넣을 수 있습니다.")
    plan = dict(job.plan)
    story = plan.get("post_type") == "story"
    slide = {"role": "designed", "layout": "designed", "title": "", "body": "", "cta": "", "image_text": "", "visual": body.instruction.strip()}
    image, engine = svc.render_visual(
        [], slide, topic=plan.get("topic") or "", style=plan.get("style", ""), instruction=body.instruction.strip(), story=story,
    )
    if engine.startswith("basic"):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "이미지를 만들지 못했습니다. " + _image_failure_hint(engine))
    card = svc.to_jpeg(svc.cover_fit(image, svc.STORY_SIZE if story else svc.SIZE), 92)
    blob = _save_blob(db, account, card, *svc.image_size(card), kind="slide")
    asset = {
        "type": "image", "url": _media_url(blob.id), "thumbnail_url": _media_url(blob.id),
        "meta": {"role": "designed", "status": "done", "engine": engine, "generated": True, "prompt": body.instruction.strip(), "text_baked": True},
    }
    job.assets = list(job.assets or []) + [asset]
    plan["slides"] = list(plan.get("slides") or []) + [{"role": "photo"}]
    plan.setdefault("original", True)
    job.plan = plan
    _sync_kind(job)
    flag_modified(job, "assets")
    flag_modified(job, "plan")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.post("/studio/{job_id}/slides/{index}")
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
    # 원본 그대로 게시하는 작업: 처음부터 다시 만들 연출이 없으므로 '지금 이미지에서 고치기'만 됩니다 (동영상은 불가).
    if job.plan.get("original") and not (body and body.from_current):
        raise HTTPException(status.HTTP_409_CONFLICT, "원본 그대로 게시하는 작업은 이미지를 다시 만들 수 없습니다.")
    if (job.assets or [{}])[index if 0 <= index < len(job.assets or []) else 0].get("type") == "video":
        raise HTTPException(status.HTTP_409_CONFLICT, "동영상은 AI 로 고칠 수 없습니다.")
    slides = svc.slide_list(job.plan)
    if not 0 <= index < len(slides):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이미지 번호가 올바르지 않습니다.")
    story = job.plan.get("post_type") == "story"
    size = svc.STORY_SIZE if story else svc.SIZE
    slide = slides[index]
    uploads = _blobs(db, account, job.plan.get("upload_ids") or [])
    ids = slide.get("photos")
    if ids is None:  # 사진 여러 장 합치기 전에 만든 작업은 photo 하나
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
        edited, engine = svc.edit_visual(current.data, instruction, aspect="9:16" if story else svc.ASPECT[slide["role"]])
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
            story=story,
        )
    if body and body.strict and engine.startswith("basic"):
        # 사용자가 요청한 수정이 적용되지 않았는데 조용히 같은/보정본 이미지로 바꾸지 않습니다.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "이미지를 수정하지 못했습니다. " + _image_failure_hint(engine))
    if slide["role"] == "designed" and engine.startswith("basic") and slide.get("image_text"):
        # 이미지 생성이 실패하면 그림 속 글자(말풍선·손글씨)가 사라지므로 서버 글자로라도 내용을 살립니다.
        slide = {**slide, "role": "overlay", "title": slide["image_text"], "body": ""}
    if baked and job.plan.get("original"):
        card = edited  # 원본 사진은 비율을 그대로 (피드 4:5 로 자르지 않음)
    elif baked:
        card = svc.to_jpeg(svc.cover_fit(edited, size), 92)
    else:
        # accent: 포인트 색을 고를 수 있던 때 만든 작업은 그 색을 유지 (지금은 기본 색)
        card = svc.compose(
            edited, slide, accent=job.plan.get("accent", svc.ACCENT), font=job.plan.get("font", svc.DEFAULT_FONT), size=size
        )
    blob = _save_blob(db, account, card, *svc.image_size(card), kind="slide")
    # 글을 얹기 전 이미지도 보관해 '지금 이미지에서 고치기'에 씁니다.
    vw, vh = svc.image_size(edited)
    visual_blob = _save_blob(db, account, edited, vw, vh, kind="visual")

    # 다시 만들기라면 이전 이미지는 지워 DB 에 쌓이지 않게 합니다.
    previous = (assets[index].get("url") or "").rsplit("/media/", 1)[-1].removesuffix(".jpg")
    if previous and (old := db.get(MediaBlob, previous)) is not None and old.kind == "slide":
        db.delete(old)
    if (old_visual := db.get(MediaBlob, prev_meta.get("visual_id") or "")) is not None and old_visual.kind == "visual":
        db.delete(old_visual)
    # 직접 편집했던 이미지라면 편집 전 원본도 정리 (AI 로 새로 만들었으므로 편집 내용은 버림)
    _drop(db, account, ((prev_meta.get("edit") or {}).get("base_id") or ""), keep=blob.id)
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


def _blob_id(url: str) -> str:
    return (url or "").rsplit("/media/", 1)[-1].removesuffix(".jpg")


def _drop(db: Session, account: Account, blob_id: str, *, keep: str = "") -> None:
    """이 작업이 만든 이미지(slide)만 지웁니다. 사용자가 올린 원본(upload)은 남깁니다."""
    if not blob_id or blob_id == keep:
        return
    blob = db.get(MediaBlob, blob_id)
    if blob is not None and blob.account_id == account.id and blob.kind == "slide":
        db.delete(blob)


def _story_links(raw: str) -> list[dict]:
    try:
        items = json.loads(raw or "[]")
    except ValueError:
        return []
    out = []
    for it in items if isinstance(items, list) else []:
        url = str((it or {}).get("url", "")).strip()[:1000] if isinstance(it, dict) else ""
        if url.lower().startswith(("http://", "https://")):
            out.append({"kind": "post" if it.get("kind") == "post" else "link", "url": url})
    return out[:10]


MAX_LAYERS_BYTES = 1_500_000  # 편집 내용(JSON) 최대 크기


@router.post("/studio/{job_id}/slides/{index}/edit")
async def save_manual_edit(
    job_id: int,
    index: int,
    file: UploadFile = File(...),
    layers: str = Form(default=""),
    base_id: str = Form(max_length=40),
    links: str = Form(default="[]", max_length=20000),  # 스토리 링크·게시물 스티커 [{kind, url}]
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """편집기에서 직접 꾸민 이미지를 저장합니다.
    base_id(편집 전 원본)와 편집 내용(layers: 글자·스티커·그림·필터)을 함께 보관해 다시 열어 고칠 수 있게 합니다."""
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    if job.status == "published":
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 게시된 작업입니다.")
    assets = list(job.assets or [])
    if not 0 <= index < len(assets) or assets[index].get("type") != "image":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이미지 번호가 올바르지 않습니다.")
    if len(layers.encode()) > MAX_LAYERS_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "편집 내용이 너무 큽니다. 그림을 조금 줄여 주세요.")
    base = db.get(MediaBlob, base_id)
    if base is None or base.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이미지를 찾을 수 없습니다.")
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "사진이 너무 큽니다 (최대 8MB).")
    try:
        data, w, h = svc.normalize(raw, max_side=1920)
    except OSError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 파일을 읽을 수 없습니다.") from exc
    blob = _save_blob(db, account, data, w, h, kind="slide")

    prev = assets[index]
    prev_meta = prev.get("meta") or {}
    # 이전에 편집해 저장한 결과는 지우고(편집 전 원본은 남김), AI 의 글 얹기 전 이미지는 더 이상 쓰지 않으므로 정리
    _drop(db, account, _blob_id(prev.get("url", "")), keep=base_id)
    if (old_visual := db.get(MediaBlob, prev_meta.get("visual_id") or "")) is not None and old_visual.kind == "visual":
        db.delete(old_visual)
    assets[index] = {
        **prev,
        "url": _media_url(blob.id),
        "thumbnail_url": _media_url(blob.id),
        "meta": {
            **prev_meta,
            "status": "done",
            "edited": True,
            "edit": {"base_id": base_id, "layers": layers},
            # 인스타 API 로는 스토리에 누를 수 있는 링크를 못 붙여, 게시 후 앱에서 붙이도록 주소를 보여 줌
            "story_links": _story_links(links),
            # '지금 이미지에서 고치기'는 편집한 결과에서 (글자가 이미 들어가 있음)
            "visual_id": "",
            "text_baked": True,
        },
    }
    job.assets = assets
    flag_modified(job, "assets")
    db.commit()
    return {"index": index, "asset": assets[index]}


class ReorderIn(BaseModel):
    order: list[int] = Field(min_length=1, max_length=20)  # 새 순서대로 나열한 지금 번호들


@router.post("/studio/{job_id}/reorder")
def reorder(job_id: int, body: ReorderIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """장 순서 바꾸기 (끌어서 놓기). 이미지와 그 장의 구성(다시 만들기에 쓰임)을 함께 옮깁니다."""
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    if job.status in ("published", "publishing"):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 게시된 작업입니다.")
    assets = list(job.assets or [])
    if sorted(body.order) != list(range(len(assets))):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "순서가 올바르지 않습니다.")
    job.assets = [assets[i] for i in body.order]
    plan = dict(job.plan or {})
    slides = plan.get("slides")
    if isinstance(slides, list) and len(slides) == len(assets):
        plan["slides"] = [slides[i] for i in body.order]
        job.plan = plan
    flag_modified(job, "assets")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.get("/studio/fonts/{key}.font")
def font_file(key: str) -> Response:
    """편집기(브라우저)에서 같은 글씨체를 쓰도록 제목용 글꼴 파일을 줍니다."""
    if key not in svc.FONTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "없는 글씨체입니다.")
    path = svc.fonts.FONT_DIR / svc.FONTS[key]["title"]
    media = "font/otf" if path.suffix == ".otf" else "font/ttf"
    return Response(path.read_bytes(), media_type=media, headers={"Cache-Control": "public, max-age=2592000, immutable"})


class CaptionRewriteIn(BaseModel):
    instruction: str = Field(default="", max_length=500)  # 예: 더 짧게, 이모지 많이, 영어로
    caption: str = Field(default="", max_length=2200)  # 화면에서 지금 고치고 있는 캡션 (저장 전일 수 있음)
    language: str | None = Field(default=None, max_length=8)


@router.post("/studio/{job_id}/caption")
def rewrite_caption(
    job_id: int, body: CaptionRewriteIn, request: Request, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    """사진·주제를 보고 캡션을 씁니다 (비어 있으면 새로, 있으면 요청대로 다시. 처음 정한 캡션 양식 유지).
    저장은 화면에서 '임시저장'·'게시' 때."""
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    plan = dict(job.plan) if isinstance(job.plan, dict) else {}
    history = list(plan.get("caption_requests") or [])
    try:
        written = svc.rewrite_caption(
            topic=plan.get("topic") or job.prompt,
            style=plan.get("style", ""),
            caption=body.caption or job.caption,
            instruction=body.instruction,
            caption_format=plan.get("caption_format", ""),
            language=norm_lang(body.language or lang_of(request)),
            images=_job_images(db, account, job),
            template=plan.get("template", "auto"),
            tone=plan.get("caption_tone", "casual"),
            length=plan.get("caption_length", "auto"),
            history=history,
        )
    except svc.GeminiError as exc:
        if svc.is_busy(exc):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Gemini 가 지금 혼잡하거나 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요. " f"({exc})",
            ) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"캡션을 다시 쓰지 못했습니다: {exc}") from exc
    # 바란 점은 기록해 두고 다음 자동 작성에도 계속 반영 (같은 요청은 맨 뒤로)
    wish = body.instruction.strip()
    if wish and job.status not in ("published", "publishing"):
        history = [h for h in history if h != wish] + [wish]
        plan["caption_requests"] = history[-CAPTION_HISTORY:]
        job.plan = plan
        flag_modified(job, "plan")
        db.commit()
    return {**written, "requests": plan.get("caption_requests", [])}


def _job_images(db: Session, account: Account, job: GenerationJob) -> list[bytes]:
    """게시물의 사진들 (동영상은 대표 화면) — 글·해시태그를 쓸 때 Gemini 가 참고합니다."""
    images = []
    for a in job.assets or []:
        url = a.get("url", "") if a.get("type") == "image" else a.get("thumbnail_url", "")
        blob = db.get(MediaBlob, _blob_id(url))
        if blob is not None and blob.account_id == account.id and blob.data:
            images.append(blob.data)
    return images


class HashtagIn(BaseModel):
    caption: str = Field(default="", max_length=2200)  # 화면에서 지금 쓰고 있는 캡션
    hint: str = Field(default="", max_length=300)  # 원하는 방향 (예: 여행, 영어로)
    language: str | None = Field(default=None, max_length=8)


@router.post("/studio/{job_id}/hashtags")
def hashtags(
    job_id: int, body: HashtagIn, request: Request, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    """사진과 캡션을 보고 해시태그를 추천합니다 (저장은 화면에서 '임시저장'·'게시' 때)."""
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    plan = job.plan if isinstance(job.plan, dict) else {}
    try:
        tags = svc.suggest_hashtags(
            _job_images(db, account, job), topic=plan.get("topic") or job.prompt, caption=body.caption or job.caption, hint=body.hint,
            language=norm_lang(body.language or lang_of(request)),
        )
    except svc.GeminiError as exc:
        if svc.is_busy(exc):
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Gemini 가 지금 혼잡하거나 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요. " f"({exc})",
            ) from exc
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"해시태그를 만들지 못했습니다: {exc}") from exc
    if not tags:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "해시태그를 만들지 못했습니다: 결과 없음")
    return {"hashtags": tags}


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


@router.post("/studio/{job_id}/finalize")
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
