"""올린 동영상 편집: POST /studio/{job}/videos/{i}/edit → 자르기·소리 끄기·대표 화면,
POST /studio/{job}/videos/{i}/overlay → 꾸미기(글자·스티커·그림을 그린 투명 PNG 를 영상 전체에 겹침).

원본은 meta.video_edit.source 에 남겨 두고 언제나 원본에서 다시 만들므로, 몇 번을 고쳐도 화질이 떨어지지 않고
'원래대로'(reset)도 됩니다. 만든 영상은 Vercel Blob 에 두고 MediaBlob(kind="render") 로 기록합니다.
"""
from __future__ import annotations

import io
import secrets
import tempfile
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..db import get_db
from ..deps import current_account
from ..models import Account, GenerationJob, MediaBlob
from ..services import blobstore
from ..services.studio import image_size
from ..services.studio import video as vid
from .studio import _blob_id, _media_url, _save_blob
from .workflow import _job_dict

router = APIRouter(tags=["video"])


def _local_copy(blob: MediaBlob, dest: Path) -> Path:
    """영상을 임시 파일로 (Blob 에 있으면 내려받고, 로컬·테스트처럼 DB 에 있으면 그대로)."""
    if blob.data:
        dest.write_bytes(blob.data)
        return dest
    try:
        blobstore.download(blob.url, dest)
    except Exception as exc:  # noqa: BLE001 - 네트워크·크기 문제 모두 같은 안내
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "파일을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc
    return dest


def _store_video(db: Session, account: Account, data: bytes) -> str:
    """만든 영상을 공개 주소에 두고 그 주소를 돌려줍니다. Blob 이 없으면(로컬·테스트) DB 에."""
    if blobstore.enabled():
        try:
            url = blobstore.put("renders/video.mp4", data, "video/mp4")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "만든 영상을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc
        blob = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="render", data=b"", url=url, content_type="video/mp4")
        db.add(blob)
        db.commit()
        return url
    blob = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="render", data=data, content_type="video/mp4")
    db.add(blob)
    db.commit()
    return _media_url(blob.id)


def discard_renders(db: Session, account: Account, urls: list[str]) -> None:
    """편집으로 만든 영상(render)만 지웁니다. 사용자가 올린 원본 영상은 그대로."""
    for url in filter(None, urls):
        blob = db.get(MediaBlob, _blob_id(url))
        if blob is None:
            blob = db.query(MediaBlob).filter(MediaBlob.url == url, MediaBlob.account_id == account.id).first()
        if blob is None or blob.account_id != account.id or blob.kind != "render":
            continue
        if blob.url:
            blobstore.delete([blob.url])
        db.delete(blob)


def _encode(fn, *args, **kwargs) -> bytes:
    try:
        return fn(*args, **kwargs)
    except vid.VideoError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except TimeoutError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "영상이 너무 길어 시간 안에 처리하지 못했습니다.") from exc


class VideoEditIn(BaseModel):
    start: float = Field(default=0.0, ge=0, le=3600)
    end: float | None = Field(default=None, ge=0, le=3600)  # None = 끝까지
    mute: bool = False  # 소리 끄기
    cover_at: float | None = Field(default=None, ge=0, le=3600)  # 대표 화면 위치 (자른 영상 기준 초)
    reset: bool = False  # 원래대로


def _source_blob(db: Session, account: Account, url: str) -> MediaBlob:
    blob = db.get(MediaBlob, _blob_id(url))
    if blob is None:
        blob = db.query(MediaBlob).filter(MediaBlob.url == url, MediaBlob.account_id == account.id).first()
    if blob is None or blob.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "동영상을 찾을 수 없습니다.")
    return blob


def _video_job(db: Session, account: Account, job_id: int, index: int) -> tuple[GenerationJob, list[dict], dict]:
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    if job.status in ("published", "publishing"):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 게시된 작업입니다.")
    assets = list(job.assets or [])
    if not 0 <= index < len(assets) or assets[index].get("type") != "video":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "동영상 번호가 올바르지 않습니다.")
    return job, assets, assets[index]


def _apply(
    db: Session, account: Account, job: GenerationJob, assets: list[dict], index: int, *,
    start: float, end: float | None, mute: bool, cover_at: float | None, overlay_id: str = "", overlay_layers: str = "",
    reset: bool = False,
) -> dict:
    """원본에서 자르기·소리 끄기·꾸미기를 한 번에 다시 만들고 작업에 반영합니다 (원본은 meta.video_edit.source 에 그대로)."""
    asset = assets[index]
    meta = dict(asset.get("meta") or {})
    edit = meta.get("video_edit") or {}
    source = edit.get("source") or {"url": asset["url"], "thumbnail_url": asset.get("thumbnail_url", "")}
    previous_render = asset["url"] if asset["url"] != source["url"] else ""
    previous_cover = asset.get("thumbnail_url", "") if edit.get("cover_id") else ""
    previous_overlay = edit.get("overlay_id", "")
    overlay_blob = _own(db, account, overlay_id, "overlay") if overlay_id else None

    if reset:
        meta.pop("video_edit", None)
        new = {**asset, "url": source["url"], "thumbnail_url": source["thumbnail_url"], "meta": meta}
        overlay_id = ""
    else:
        with tempfile.TemporaryDirectory(prefix="iaw-ve-") as tmp:
            src = _local_copy(_source_blob(db, account, source["url"]), Path(tmp) / "src")
            plain = not (start > 0 or end or mute or overlay_blob)
            url, cover_url, cover_id = source["url"], source["thumbnail_url"], ""
            out = src
            if not plain:
                overlay_path = None
                if overlay_blob is not None:
                    overlay_path = Path(tmp) / "overlay.png"
                    overlay_path.write_bytes(overlay_blob.data)
                data = _encode(vid.edit_video, src, start=start, end=end, mute=mute, overlay=overlay_path)
                out = Path(tmp) / "out.mp4"
                out.write_bytes(data)
                url = _store_video(db, account, data)
            if cover_at is not None or not plain:
                # 자르거나 꾸미면 대표 화면도 새로 뽑습니다 (잘린 부분일 수 있고, 꾸민 글자가 보이게).
                frame = _encode(vid.frame_at, out, cover_at or 0.0)
                cover = _save_blob(db, account, frame, *image_size(frame), kind="slide")
                cover_url, cover_id = _media_url(cover.id), cover.id
            duration = vid.probe(out)["duration"]
        meta["video_edit"] = {
            "source": source, "start": start, "end": end, "mute": mute,
            "cover_at": cover_at, "cover_id": cover_id, "duration": round(duration, 2),
            "overlay_id": overlay_id, "overlay_url": overlay_url(overlay_id) if overlay_id else "", "overlay_layers": overlay_layers,
        }
        new = {**asset, "url": url, "thumbnail_url": cover_url, "meta": meta}

    if previous_render and previous_render != new["url"]:
        discard_renders(db, account, [previous_render])
    if previous_cover and previous_cover != new["thumbnail_url"]:
        old = db.get(MediaBlob, _blob_id(previous_cover))
        if old is not None and old.account_id == account.id and old.kind == "slide":
            db.delete(old)
    if previous_overlay and previous_overlay != overlay_id:
        old = db.get(MediaBlob, previous_overlay)
        if old is not None and old.account_id == account.id and old.kind == "overlay":
            db.delete(old)
    assets[index] = new
    job.assets = assets
    flag_modified(job, "assets")
    db.commit()
    db.refresh(job)
    return {"index": index, "asset": new, "job": _job_dict(job)}


def overlay_url(blob_id: str) -> str:
    return _media_url(blob_id).removesuffix(".jpg") + ".png"


def _own(db: Session, account: Account, blob_id: str, kind: str) -> MediaBlob:
    blob = db.get(MediaBlob, blob_id)
    if blob is None or blob.account_id != account.id or blob.kind != kind:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "꾸민 그림을 찾을 수 없습니다.")
    return blob


@router.post("/studio/{job_id}/videos/{index}/edit")
def edit_video(
    job_id: int, index: int, body: VideoEditIn, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    job, assets, asset = _video_job(db, account, job_id, index)
    edit = (asset.get("meta") or {}).get("video_edit") or {}
    # 자르기를 바꿔도 꾸미기는 그대로
    return _apply(
        db, account, job, assets, index, start=body.start, end=body.end, mute=body.mute, cover_at=body.cover_at,
        overlay_id=edit.get("overlay_id", ""), overlay_layers=edit.get("overlay_layers", ""), reset=body.reset,
    )


MAX_OVERLAY_BYTES = 8 * 1024 * 1024


@router.post("/studio/{job_id}/videos/{index}/overlay")
async def overlay_video(
    job_id: int,
    index: int,
    file: UploadFile | None = File(default=None),  # 꾸민 것만 그린 투명 PNG (영상과 같은 비율). 없으면 꾸미기 지우기
    layers: str = Form(default="", max_length=2_000_000),  # 다시 꾸밀 때 불러올 편집기 상태
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    job, assets, asset = _video_job(db, account, job_id, index)
    edit = (asset.get("meta") or {}).get("video_edit") or {}
    overlay_id = ""
    if file is not None:
        raw = await file.read()
        if len(raw) > MAX_OVERLAY_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "꾸민 그림이 너무 큽니다 (최대 8MB).")
        try:
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 파일을 읽을 수 없습니다.") from exc
        if img.getchannel("A").getbbox() is not None:  # 아무것도 없으면 꾸미기 지우기
            buf = io.BytesIO()
            img.save(buf, "PNG", optimize=True)
            blob = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="overlay", data=buf.getvalue(),
                             content_type="image/png", width=img.width, height=img.height)
            db.add(blob)
            db.commit()
            overlay_id = blob.id
    return _apply(
        db, account, job, assets, index, start=edit.get("start", 0.0), end=edit.get("end"), mute=edit.get("mute", False),
        cover_at=edit.get("cover_at"), overlay_id=overlay_id, overlay_layers=layers if overlay_id else "",
    )
