"""내 스티커: 사용자가 만든 스티커(투명 PNG)를 계정에 저장해 두고 편집기에서 다시 씁니다.

사진에서 배경을 지운 것, 또는 편집기에서 고른 글자·그림을 PNG 로 받아 MediaBlob(kind="sticker") 로 보관합니다.
주소는 /api/py/media/<id>.png (공개·추측 불가 주소 — 편집기 캔버스가 불러옴).
"""
from __future__ import annotations

import io
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account
from ..models import Account, MediaBlob

router = APIRouter(tags=["stickers"])

MAX_BYTES = 4 * 1024 * 1024
MAX_SIDE = 1024
MAX_STICKERS = 60


def sticker_url(blob_id: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/api/py/media/{blob_id}.png"


def _png(raw: bytes) -> tuple[bytes, int, int]:
    """투명도를 살린 PNG 로 (긴 변 1024 이하, 투명한 가장자리는 잘라냄)."""
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 파일을 읽을 수 없습니다.") from exc
    box = img.getchannel("A").getbbox()
    if box is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "빈 이미지는 스티커로 만들 수 없습니다.")
    img = img.crop(box)
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue(), img.width, img.height


def _row(b: MediaBlob) -> dict:
    return {"id": b.id, "url": sticker_url(b.id), "width": b.width, "height": b.height}


@router.get("/studio/stickers")
def list_stickers(account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(
        select(MediaBlob)
        .where(MediaBlob.account_id == account.id, MediaBlob.kind == "sticker")
        .order_by(MediaBlob.created_at.desc())
        .limit(MAX_STICKERS)
    ).all()
    return {"data": [_row(b) for b in rows]}


@router.post("/studio/stickers", status_code=status.HTTP_201_CREATED)
async def add_sticker(file: UploadFile = File(...), account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "스티커 이미지가 너무 큽니다 (최대 4MB).")
    count = len(db.scalars(select(MediaBlob.id).where(MediaBlob.account_id == account.id, MediaBlob.kind == "sticker")).all())
    if count >= MAX_STICKERS:
        raise HTTPException(status.HTTP_409_CONFLICT, f"스티커는 {MAX_STICKERS}개까지 저장할 수 있습니다. 안 쓰는 스티커를 지워 주세요.")
    data, w, h = _png(raw)
    blob = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="sticker", data=data, content_type="image/png", width=w, height=h)
    db.add(blob)
    db.commit()
    return _row(blob)


@router.delete("/studio/stickers/{blob_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_sticker(blob_id: str, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> Response:
    blob = db.get(MediaBlob, blob_id)
    if blob is None or blob.account_id != account.id or blob.kind != "sticker":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "스티커를 찾을 수 없습니다.")
    db.delete(blob)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
