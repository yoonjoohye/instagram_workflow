"""올린 동영상 편집: POST /studio/{job}/videos/{i}/edit → 자르기·소리 크기·배경 음악·대표 화면,
POST /studio/{job}/videos/{i}/overlay → 꾸미기(글자·스티커·그림을 그린 투명 PNG 들을 각자 정한 시간 동안 겹침),
POST /studio/{job}/videos/{i}/audio → 덧붙일 소리 파일 올리기 (적용은 edit 에서).

원본은 meta.video_edit.source 에 남겨 두고 언제나 원본에서 다시 만들므로, 몇 번을 고쳐도 화질이 떨어지지 않고
'원래대로'(reset)도 됩니다. 만든 영상은 Vercel Blob 에 두고 MediaBlob(kind="render") 로 기록합니다.
"""
from __future__ import annotations

import io
import json
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


class AudioIn(BaseModel):
    id: str = Field(max_length=40)  # /audio 로 올린 소리 파일
    at: float = Field(default=0.0, ge=0, le=3600)  # 원본 영상 기준 몇 초부터 들릴지
    offset: float = Field(default=0.0, ge=0, le=3600)  # 소리 파일의 몇 초 지점부터
    volume: float = Field(default=1.0, ge=0, le=2)


class VideoEditIn(BaseModel):
    start: float = Field(default=0.0, ge=0, le=3600)
    end: float | None = Field(default=None, ge=0, le=3600)  # None = 끝까지
    mute: bool = False  # 소리 끄기
    volume: float | None = Field(default=None, ge=0, le=2)  # 원본 소리 크기 (보내지 않으면 그대로)
    audio: AudioIn | None = None  # 덧붙인 소리 (필드를 보내지 않으면 그대로, null 이면 빼기)
    cover_at: float | None = Field(default=None, ge=0, le=3600)  # 대표 화면 위치 (자른 영상 기준 초)
    reset: bool = False  # 원래대로


def _state(edit: dict) -> dict:
    """저장된 편집 상태 (예전 방식: 영상 전체에 겹친 그림 한 장 → 시간 없는 꾸미기 하나)"""
    layers = list(edit.get("overlays") or [])
    if not layers and edit.get("overlay_id"):
        layers = [{"id": edit["overlay_id"], "start": None, "end": None}]
    return {
        "start": edit.get("start", 0.0), "end": edit.get("end"), "mute": edit.get("mute", False),
        "volume": edit.get("volume", 1.0), "cover_at": edit.get("cover_at"),
        "overlays": [{"id": o["id"], "start": o.get("start"), "end": o.get("end")} for o in layers],
        "overlay_layers": edit.get("overlay_layers", ""), "audio": edit.get("audio"),
    }


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
    db: Session, account: Account, job: GenerationJob, assets: list[dict], index: int, state: dict, *, reset: bool = False,
) -> dict:
    """원본에서 자르기·소리·꾸미기·음악을 한 번에 다시 만들고 작업에 반영합니다 (원본은 meta.video_edit.source 에 그대로)."""
    asset = assets[index]
    meta = dict(asset.get("meta") or {})
    edit = meta.get("video_edit") or {}
    source = edit.get("source") or {"url": asset["url"], "thumbnail_url": asset.get("thumbnail_url", "")}
    previous_render = asset["url"] if asset["url"] != source["url"] else ""
    previous_cover = asset.get("thumbnail_url", "") if edit.get("cover_id") else ""
    previous = _state(edit)
    start, end, mute, volume = state["start"], state["end"], state["mute"], state["volume"]
    overlays, audio = ([], None) if reset else (state["overlays"], state["audio"])
    overlay_blobs = [_own(db, account, o["id"], "overlay") for o in overlays]
    audio_blob = _own(db, account, audio["id"], "audio") if audio else None

    if reset:
        meta.pop("video_edit", None)
        new = {**asset, "url": source["url"], "thumbnail_url": source["thumbnail_url"], "meta": meta}
    else:
        with tempfile.TemporaryDirectory(prefix="iaw-ve-") as tmp:
            src = _local_copy(_source_blob(db, account, source["url"]), Path(tmp) / "src")
            plain = not (start > 0 or end or mute or overlays or audio or abs(volume - 1) > 0.01)
            url, cover_url, cover_id = source["url"], source["thumbnail_url"], ""
            out = src
            if not plain:
                # 시간은 원본 기준으로 저장해 두고, 만들 때 자른 영상 기준으로 바꿈
                rel = lambda x: None if x is None else x - start  # noqa: E731
                layers = []
                for i, (o, blob) in enumerate(zip(overlays, overlay_blobs)):
                    path = Path(tmp) / f"overlay{i}.png"
                    path.write_bytes(blob.data)
                    layers.append(vid.Layer(path, rel(o.get("start")), rel(o.get("end"))))
                music = None
                if audio and audio_blob is not None:
                    at = audio.get("at", 0.0) - start
                    offset = audio.get("offset", 0.0) + max(0.0, -at)  # 자른 앞부분에서 시작하던 소리는 그만큼 건너뜀
                    music = vid.Music(_local_copy(audio_blob, Path(tmp) / "music"), max(0.0, at), offset, audio.get("volume", 1.0))
                data = _encode(vid.edit_video, src, start=start, end=end, mute=mute, layers=layers, music=music, volume=volume)
                out = Path(tmp) / "out.mp4"
                out.write_bytes(data)
                url = _store_video(db, account, data)
            if state["cover_at"] is not None or not plain:
                # 자르거나 꾸미면 대표 화면도 새로 뽑습니다 (잘린 부분일 수 있고, 꾸민 글자가 보이게).
                frame = _encode(vid.frame_at, out, state["cover_at"] or 0.0)
                cover = _save_blob(db, account, frame, *image_size(frame), kind="slide")
                cover_url, cover_id = _media_url(cover.id), cover.id
            duration = vid.probe(out)["duration"]
        meta["video_edit"] = {
            "source": source, "start": start, "end": end, "mute": mute, "volume": volume,
            "cover_at": state["cover_at"], "cover_id": cover_id, "duration": round(duration, 2),
            "overlays": [{**o, "url": overlay_url(o["id"])} for o in overlays],
            "overlay_layers": state["overlay_layers"] if overlays else "",
            "audio": {**audio, "url": audio_blob.url or _media_url(audio["id"]), "name": audio_blob.cover_id or "", "duration": audio_blob.width / 1000}
            if audio and audio_blob is not None else None,
        }
        new = {**asset, "url": url, "thumbnail_url": cover_url, "meta": meta}

    if previous_render and previous_render != new["url"]:
        discard_renders(db, account, [previous_render])
    if previous_cover and previous_cover != new["thumbnail_url"]:
        old = db.get(MediaBlob, _blob_id(previous_cover))
        if old is not None and old.account_id == account.id and old.kind == "slide":
            db.delete(old)
    # 더는 쓰지 않는 꾸민 그림·소리 파일 지우기
    keep = {o["id"] for o in overlays} | ({audio["id"]} if audio else set())
    stale = [o["id"] for o in previous["overlays"]] + ([previous["audio"]["id"]] if previous["audio"] else [])
    discard_assets(db, account, [i for i in stale if i not in keep])
    assets[index] = new
    job.assets = assets
    flag_modified(job, "assets")
    db.commit()
    db.refresh(job)
    return {"index": index, "asset": new, "job": _job_dict(job)}


def discard_assets(db: Session, account: Account, ids: list[str]) -> None:
    """동영상 꾸미기 그림(overlay)·덧붙인 소리(audio) 지우기"""
    for blob_id in ids:
        old = db.get(MediaBlob, blob_id)
        if old is not None and old.account_id == account.id and old.kind in ("overlay", "audio"):
            if old.url:
                blobstore.delete([old.url])
            db.delete(old)


def edit_assets(edit: dict) -> list[str]:
    """편집 상태가 쓰는 꾸민 그림·소리 파일 id 들 (게시물을 지울 때 함께 지우려고)"""
    st = _state(edit)
    return [o["id"] for o in st["overlays"]] + ([st["audio"]["id"]] if st["audio"] else [])


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
    state = _state((asset.get("meta") or {}).get("video_edit") or {})
    # 자르기를 바꿔도 꾸미기는 그대로. 소리 크기·음악은 보낸 것만 바꿈
    state.update(start=body.start, end=body.end, mute=body.mute, cover_at=body.cover_at)
    if body.volume is not None:
        state["volume"] = body.volume
    if "audio" in body.model_fields_set:
        state["audio"] = body.audio.model_dump() if body.audio else None
    return _apply(db, account, job, assets, index, state, reset=body.reset)


MAX_OVERLAY_BYTES = 8 * 1024 * 1024
MAX_OVERLAYS = 30


def _read_overlay(raw: bytes) -> Image.Image | None:
    if len(raw) > MAX_OVERLAY_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "꾸민 그림이 너무 큽니다 (최대 8MB).")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 파일을 읽을 수 없습니다.") from exc
    return img if img.getchannel("A").getbbox() is not None else None  # 아무것도 없으면 빼기


def _parse_timings(raw: str, n: int) -> list[tuple[float | None, float | None]]:
    try:
        items = json.loads(raw) if raw else []
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "꾸미기 시간이 올바르지 않습니다.") from exc
    out: list[tuple[float | None, float | None]] = []
    for i in range(n):
        item = items[i] if isinstance(items, list) and i < len(items) and isinstance(items[i], (list, tuple)) else [None, None]
        s, e = (list(item) + [None, None])[:2]
        s = float(s) if isinstance(s, (int, float)) and 0 <= s <= 3600 else None
        e = float(e) if isinstance(e, (int, float)) and 0 <= e <= 3600 else None
        if s is not None and e is not None and e <= s:
            e = None
        out.append((s, e))
    return out


@router.post("/studio/{job_id}/videos/{index}/overlay")
async def overlay_video(
    job_id: int,
    index: int,
    # 꾸민 것을 시간별로 나눠 그린 투명 PNG 들 (영상과 같은 비율). 하나도 없으면 꾸미기 지우기
    files: list[UploadFile] = File(default=[]),
    file: UploadFile | None = File(default=None),  # (예전 방식) 영상 전체에 겹칠 한 장
    timings: str = Form(default="", max_length=20_000),  # [[시작, 끝], ...] 원본 영상 기준 초, null 은 처음/끝
    layers: str = Form(default="", max_length=2_000_000),  # 다시 꾸밀 때 불러올 편집기 상태
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    job, assets, asset = _video_job(db, account, job_id, index)
    state = _state((asset.get("meta") or {}).get("video_edit") or {})
    uploads = [*files, *([file] if file is not None else [])]
    if len(uploads) > MAX_OVERLAYS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "꾸미기는 30개까지 넣을 수 있습니다.")
    times = _parse_timings(timings, len(uploads))
    overlays = []
    for up, (s, e) in zip(uploads, times):
        img = _read_overlay(await up.read())
        if img is None:
            continue
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        blob = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="overlay", data=buf.getvalue(),
                         content_type="image/png", width=img.width, height=img.height)
        db.add(blob)
        db.commit()
        overlays.append({"id": blob.id, "start": s, "end": e})
    state.update(overlays=overlays, overlay_layers=layers if overlays else "")
    return _apply(db, account, job, assets, index, state)


MAX_AUDIO_BYTES = 60 * 1024 * 1024
AUDIO_TYPES = {"audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave",
               "audio/ogg", "audio/webm", "audio/flac", "video/mp4", "video/quicktime"}


@router.post("/studio/{job_id}/videos/{index}/audio", status_code=status.HTTP_201_CREATED)
async def upload_audio(
    job_id: int,
    index: int,
    file: UploadFile | None = File(default=None),  # 작은 파일은 바로
    url: str = Form(default="", max_length=1000),  # 큰 파일은 브라우저가 Blob 에 올린 주소
    name: str = Form(default="", max_length=120),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """덧붙일 소리 파일(음악·녹음, 또는 소리가 있는 영상)을 올립니다. 영상에 넣는 건 edit 에서."""
    _video_job(db, account, job_id, index)
    if file is None and not url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "소리 파일이 없습니다.")
    if url and not blobstore.is_our_blob(url):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "소리 파일 주소가 올바르지 않습니다.")
    content_type = (file.content_type if file is not None else "") or "audio/mpeg"
    if file is not None and content_type not in AUDIO_TYPES and not content_type.startswith("audio/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "소리 파일(mp3·m4a·wav 등)만 넣을 수 있습니다.")
    with tempfile.TemporaryDirectory(prefix="iaw-au-") as tmp:
        path = Path(tmp) / "audio"
        if file is not None:
            raw = await file.read()
            if len(raw) > MAX_AUDIO_BYTES:
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "소리 파일이 너무 큽니다 (최대 60MB).")
            path.write_bytes(raw)
        else:
            try:
                blobstore.download(url, path, max_bytes=MAX_AUDIO_BYTES)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, "소리 파일을 가져오지 못했습니다.") from exc
        info = vid.probe(path)
        if not info["has_audio"] or info["duration"] <= 0.2:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "소리를 읽을 수 없는 파일입니다.")
        data = b"" if url else path.read_bytes()
    # 길이(ms)는 width 에, 파일 이름은 cover_id 에 보관 (따로 칸을 늘리지 않으려고)
    clean = name.rsplit("/", 1)[-1][:40]
    blob = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="audio", data=data, url=url,
                     content_type=content_type, width=int(info["duration"] * 1000), height=0, cover_id=clean)
    db.add(blob)
    db.commit()
    return {"id": blob.id, "url": url or _media_url(blob.id), "name": clean, "duration": round(info["duration"], 2)}
