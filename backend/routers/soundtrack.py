"""음악 넣기·동영상 편집.

- 사진 게시물에 음악 넣기  PUT /studio/{job}/soundtrack  → 피드는 릴스(음악 있는 영상 하나), 스토리는 장마다 영상
                          DELETE 로 빼면 다시 사진으로 올라갑니다. 사진을 고치면 영상은 '다시 만들기 필요' 상태가 됩니다.
- 올린 동영상 편집         POST /studio/{job}/videos/{i}/edit → 자르기·소리 끄기·음악·대표 화면. 원본은 남겨 두고
                          언제나 원본에서 다시 만들므로 몇 번을 고쳐도 화질이 떨어지지 않고 '원래대로'도 됩니다.
- 음악                     기본 제공 곡(GET /studio/tracks) 또는 내 음원(브라우저가 Blob 에 올린 뒤 POST /media/audio)

인스타그램 음악 라이브러리의 곡은 API 로 붙일 수 없어 다루지 않습니다 (게시 후 인스타 앱에서 직접 추가).
"""
from __future__ import annotations

import secrets
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..db import get_db
from ..deps import current_account
from ..models import Account, GenerationJob, MediaBlob
from ..services import blobstore
from ..services.studio import image_size
from ..services.studio import soundtrack as st
from ..services.studio.limits import SIZE, STORY_SIZE
from .studio import _blob_id, _media_url, _save_blob
from .workflow import _job_dict, assets_fingerprint

router = APIRouter(tags=["soundtrack"])


# ── 음악 ─────────────────────────────────────────────────────────────────


@router.get("/studio/tracks")
def tracks() -> dict:
    return {"data": [{"key": k, "title": t, "url": f"/api/py/studio/tracks/{k}.m4a"} for k, t in st.TRACKS.items()]}


@router.get("/studio/tracks/{key}.m4a")
def track_file(key: str) -> Response:
    try:
        path = st.track_path(key)
    except st.SoundtrackError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return Response(path.read_bytes(), media_type="audio/mp4", headers={"Cache-Control": "public, max-age=2592000"})


class AudioIn(BaseModel):
    url: str = Field(max_length=1000)  # 브라우저가 Vercel Blob 에 올린 공개 주소
    name: str = Field(default="", max_length=120)  # 파일 이름 (화면 표시용)
    content_type: str = Field(default="audio/mpeg", max_length=32)


@router.post("/media/audio", status_code=status.HTTP_201_CREATED)
def register_audio(body: AudioIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """Blob 에 올린 내 음원을 등록합니다."""
    if not blobstore.is_our_blob(body.url):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "음원 주소가 올바르지 않습니다.")
    blob = MediaBlob(
        id=secrets.token_urlsafe(18), account_id=account.id, kind="audio", data=b"", url=body.url,
        content_type=body.content_type if body.content_type.startswith("audio/") else "audio/mpeg",
        cover_id=body.name[:40],  # 오디오에는 대표 화면이 없어 이름을 여기에 둡니다
    )
    db.add(blob)
    db.commit()
    return {"id": blob.id, "name": body.name, "url": body.url}


class MusicSource(BaseModel):
    track: str = Field(default="", max_length=40)  # 기본 제공 곡 key
    audio_id: str = Field(default="", max_length=40)  # 내 음원 (/media/audio)
    offset: float = Field(default=0.0, ge=0, le=600)  # 곡의 몇 초부터
    volume: float = Field(default=1.0, ge=0, le=2)


def _music_file(db: Session, account: Account, music: MusicSource | None, tmp: str) -> tuple[Path | None, dict | None]:
    """음악 파일 경로와 화면에 돌려줄 정보."""
    if music is None or not (music.track or music.audio_id):
        return None, None
    info = music.model_dump()
    if music.track:
        if music.track not in st.TRACKS:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "없는 음악입니다.")
        info["name"], info["url"] = st.TRACKS[music.track], f"/api/py/studio/tracks/{music.track}.m4a"
        return st.track_path(music.track), info
    blob = db.get(MediaBlob, music.audio_id)
    if blob is None or blob.account_id != account.id or blob.kind != "audio":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "음원을 찾을 수 없습니다.")
    info["name"], info["url"] = blob.cover_id or "audio", blob.url  # 화면에서 다시 들어 볼 수 있게
    return _local_copy(blob, Path(tmp) / "music"), info


def _local_copy(blob: MediaBlob, dest: Path) -> Path:
    """영상·음원을 임시 파일로 (Blob 에 있으면 내려받고, 로컬·테스트처럼 DB 에 있으면 그대로)."""
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
    """이 기능이 만든 영상(render)만 지웁니다. 사용자가 올린 원본 영상은 그대로."""
    for url in filter(None, urls):
        blob = db.get(MediaBlob, _blob_id(url))
        if blob is None:
            blob = db.query(MediaBlob).filter(MediaBlob.url == url, MediaBlob.account_id == account.id).first()
        if blob is None or blob.account_id != account.id or blob.kind != "render":
            continue
        if blob.url:
            blobstore.delete([blob.url])
        db.delete(blob)


def _editable_job(db: Session, account: Account, job_id: int) -> GenerationJob:
    job = db.get(GenerationJob, job_id)
    if not job or job.account_id != account.id or not isinstance(job.plan, dict):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시물 작업을 찾을 수 없습니다.")
    if job.status in ("published", "publishing"):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 게시된 작업입니다.")
    return job


def _encode(fn, *args, **kwargs) -> bytes:
    try:
        return fn(*args, **kwargs)
    except (st.SoundtrackError, TimeoutError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, st.SoundtrackError) else "영상이 너무 길어 시간 안에 처리하지 못했습니다.") from exc


# ── 사진 게시물에 음악 넣기 ───────────────────────────────────────────────


class SoundtrackIn(MusicSource):
    seconds: float = Field(default=3.0, ge=2, le=15)  # 사진 한 장을 보여 주는 시간


@router.put("/studio/{job_id}/soundtrack")
def build_soundtrack(job_id: int, body: SoundtrackIn, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """사진에 음악을 입혀 영상으로 만듭니다 (피드 → 릴스 한 개, 스토리 → 장마다 영상)."""
    job = _editable_job(db, account, job_id)
    assets = list(job.assets or [])
    story = job.plan.get("post_type") == "story"
    images = [i for i, a in enumerate(assets) if a.get("type") == "image" and a.get("url")]
    if not images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "음악을 넣을 사진이 없습니다.")
    if not story and len(images) != len(assets):
        raise HTTPException(status.HTTP_409_CONFLICT, "동영상이 섞인 게시물은 동영상마다 '영상 편집'에서 음악을 넣어 주세요.")
    if not (body.track or body.audio_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "음악을 골라 주세요.")

    photos = {}
    for i in images:
        blob = db.get(MediaBlob, _blob_id(assets[i]["url"]))
        if blob is None or blob.account_id != account.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "사진을 찾을 수 없습니다.")
        photos[i] = blob.data

    with tempfile.TemporaryDirectory(prefix="iaw-st-") as tmp:
        audio, info = _music_file(db, account, body, tmp)
        outputs: list[dict] = []
        if story:
            # 스토리는 한 장씩 따로 올라가므로 장마다 영상. 음악은 이어지도록 장마다 시작 위치를 옮깁니다.
            for n, i in enumerate(images):
                data = _encode(st.slideshow, [photos[i]], seconds=body.seconds, size=STORY_SIZE, audio=audio,
                               offset=body.offset + n * body.seconds, volume=body.volume)
                outputs.append({"index": i, "url": _store_video(db, account, data), "thumbnail_url": assets[i]["url"]})
        else:
            seconds = max(body.seconds, 3.0 / len(images))  # 릴스는 3초 이상
            size = SIZE if not job.plan.get("original") else STORY_SIZE  # 원본 사진(비율 제각각)은 세로 영상에 맞춤
            data = _encode(st.slideshow, [photos[i] for i in images], seconds=seconds, size=size, audio=audio,
                           offset=body.offset, volume=body.volume)
            outputs.append({"index": 0, "url": _store_video(db, account, data), "thumbnail_url": assets[0]["url"]})

    old = job.plan.get("soundtrack") or {}
    discard_renders(db, account, [o.get("url", "") for o in old.get("outputs") or []])
    job.plan = {
        **job.plan,
        "soundtrack": {**(info or {}), "seconds": body.seconds, "outputs": outputs, "fingerprint": assets_fingerprint(job)},
        # 다른 미디어로 바뀌므로 진행 중이던 컨테이너는 쓰지 않음
        "container_fingerprint": "",
    }
    flag_modified(job, "plan")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


@router.delete("/studio/{job_id}/soundtrack")
def remove_soundtrack(job_id: int, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """음악 빼기 → 다시 사진(캐러셀·사진 스토리)으로 올라갑니다."""
    job = _editable_job(db, account, job_id)
    old = job.plan.get("soundtrack") or {}
    discard_renders(db, account, [o.get("url", "") for o in old.get("outputs") or []])
    job.plan = {k: v for k, v in job.plan.items() if k != "soundtrack"}
    flag_modified(job, "plan")
    db.commit()
    db.refresh(job)
    return _job_dict(job)


# ── 올린 동영상 편집 ──────────────────────────────────────────────────────


class VideoEditIn(BaseModel):
    start: float = Field(default=0.0, ge=0, le=3600)
    end: float | None = Field(default=None, ge=0, le=3600)  # None = 끝까지
    mute: bool = False  # 원래 소리 끄기
    original_volume: float = Field(default=1.0, ge=0, le=2)  # 음악과 섞을 때 원래 소리 크기
    cover_at: float | None = Field(default=None, ge=0, le=3600)  # 대표 화면 위치 (자른 영상 기준 초)
    music: MusicSource | None = None
    reset: bool = False  # 원래대로


def _source_blob(db: Session, account: Account, url: str) -> MediaBlob:
    blob = db.get(MediaBlob, _blob_id(url))
    if blob is None:
        blob = db.query(MediaBlob).filter(MediaBlob.url == url, MediaBlob.account_id == account.id).first()
    if blob is None or blob.account_id != account.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "동영상을 찾을 수 없습니다.")
    return blob


@router.post("/studio/{job_id}/videos/{index}/edit")
def edit_video(
    job_id: int, index: int, body: VideoEditIn, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    job = _editable_job(db, account, job_id)
    assets = list(job.assets or [])
    if not 0 <= index < len(assets) or assets[index].get("type") != "video":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "동영상 번호가 올바르지 않습니다.")
    asset = assets[index]
    meta = dict(asset.get("meta") or {})
    edit = meta.get("video_edit") or {}
    source = edit.get("source") or {"url": asset["url"], "thumbnail_url": asset.get("thumbnail_url", "")}
    previous_render = asset["url"] if asset["url"] != source["url"] else ""
    previous_cover = asset.get("thumbnail_url", "") if edit.get("cover_id") else ""

    if body.reset:
        meta.pop("video_edit", None)
        new = {**asset, "url": source["url"], "thumbnail_url": source["thumbnail_url"], "meta": meta}
    else:
        with tempfile.TemporaryDirectory(prefix="iaw-ve-") as tmp:
            src = _local_copy(_source_blob(db, account, source["url"]), Path(tmp) / "src")
            audio, info = _music_file(db, account, body.music, tmp)
            plain = not (body.start > 0 or body.end or body.mute or audio or body.original_volume != 1)
            url, cover_url, cover_id = source["url"], source["thumbnail_url"], ""
            out = src
            if not plain:
                data = _encode(st.edit_video, src, start=body.start, end=body.end, mute=body.mute, audio=audio,
                               offset=body.music.offset if body.music else 0, volume=body.music.volume if body.music else 1,
                               original_volume=body.original_volume)
                out = Path(tmp) / "out.mp4"
                out.write_bytes(data)
                url = _store_video(db, account, data)
            if body.cover_at is not None or not plain:
                # 자르면 원래 대표 화면이 잘린 부분일 수 있어 새로 뽑습니다.
                frame = _encode(st.frame_at, out, body.cover_at or 0.0)
                cover = _save_blob(db, account, frame, *image_size(frame), kind="slide")
                cover_url, cover_id = _media_url(cover.id), cover.id
            duration = st.probe(out)["duration"]
        meta["video_edit"] = {
            "source": source, "start": body.start, "end": body.end, "mute": body.mute,
            "original_volume": body.original_volume, "cover_at": body.cover_at, "cover_id": cover_id,
            "music": info, "duration": round(duration, 2),
        }
        new = {**asset, "url": url, "thumbnail_url": cover_url, "meta": meta}

    if previous_render and previous_render != new["url"]:
        discard_renders(db, account, [previous_render])
    if previous_cover and previous_cover != new["thumbnail_url"]:
        old = db.get(MediaBlob, _blob_id(previous_cover))
        if old is not None and old.account_id == account.id and old.kind == "slide":
            db.delete(old)
    assets[index] = new
    job.assets = assets
    flag_modified(job, "assets")
    db.commit()
    db.refresh(job)
    return {"index": index, "asset": new, "job": _job_dict(job)}
