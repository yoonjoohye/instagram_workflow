"""디자인 템플릿 (망고보드처럼): 템플릿·테마로 만든 장들로 작업 공간 만들기, '내 테마'·'내 템플릿' 저장.

장은 브라우저가 그립니다 (사진 편집기와 같은 캔버스). 서버는 장마다
- 바탕 그림(편집 전 원본, 다시 꾸밀 때 바탕) · 완성 그림(게시할 이미지) · 편집기 상태(글자·도형·사진 칸)를 받아
  사진 편집기에서 바로 이어서 고칠 수 있게 작업에 넣습니다.
편집기 상태 안의 바탕 그림 주소 자리는 __BG__ 로 받아 저장한 바탕 그림 주소로 바꿉니다.
"""
from __future__ import annotations

import json
import re
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..db import get_db
from ..deps import current_account, current_user
from ..models import Account, DesignTemplate, GenerationJob, MediaBlob, TemplateReaction, User
from ..services import studio as svc
from .studio import MAX_LAYERS_BYTES, MAX_UPLOAD_BYTES, UPLOAD_SIDE, _media_url, _save_blob, _sync_kind
from .workflow import _job_dict

router = APIRouter(tags=["designs"])

MAX_PAGES = 10
MAX_THEMES = 20
MAX_TEMPLATES = 40
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
_FONT = re.compile(r"^[a-z_]{2,30}$")
BG = "__BG__"


def _media_path(blob_id: str) -> str:
    """도메인과 상관없이 쓰이도록 상대 주소 (편집기는 같은 사이트에서 불러옴)"""
    return "/api/py/media/" + _media_url(blob_id).rsplit("/media/", 1)[1]


async def _image(up: UploadFile, max_side: int = UPLOAD_SIDE) -> tuple[bytes, int, int]:
    raw = await up.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "사진이 너무 큽니다 (최대 8MB).")
    try:
        return svc.normalize(raw, max_side=max_side)
    except OSError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이미지 파일을 읽을 수 없습니다.") from exc


def _pages(raw: str, n_files: int) -> list[str]:
    try:
        pages = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "디자인 내용이 올바르지 않습니다.") from exc
    if not isinstance(pages, list) or not pages or len(pages) > MAX_PAGES or any(not isinstance(p, str) for p in pages):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "디자인 내용이 올바르지 않습니다.")
    if len(pages) != n_files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "장마다 그림이 필요합니다.")
    for p in pages:
        if len(p.encode()) > MAX_LAYERS_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "편집 내용이 너무 큽니다. 그림을 조금 줄여 주세요.")
    return pages


@router.post("/studio/designs", status_code=status.HTTP_201_CREATED)
async def create_design(
    pages: str = Form(max_length=MAX_PAGES * MAX_LAYERS_BYTES),  # 장마다 편집기 상태 (JSON 문자열 목록, 바탕 주소 자리는 __BG__)
    bgs: list[UploadFile] = File(...),  # 장마다 바탕 그림
    imgs: list[UploadFile] = File(...),  # 장마다 완성 그림
    post_type: str = Form(default="feed", pattern=r"^(feed|story)$"),
    name: str = Form(default="", max_length=40),  # 고른 템플릿 이름 (작업 제목)
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """템플릿으로 만든 장들로 작업 공간을 엽니다. 장마다 사진 편집기에서 바로 이어서 고칠 수 있습니다."""
    layers = _pages(pages, len(imgs))
    if len(bgs) != len(imgs):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "장마다 그림이 필요합니다.")
    assets = []
    for bg_file, img_file, page in zip(bgs, imgs, layers):
        bg = _save_blob(db, account, *(await _image(bg_file)), kind="upload")
        data, w, h = await _image(img_file, max_side=1920)
        img = _save_blob(db, account, data, w, h, kind="slide")
        assets.append({
            "type": "image", "url": _media_url(img.id), "thumbnail_url": _media_url(img.id),
            "meta": {
                "role": "photo", "status": "done", "engine": "design", "edited": True, "text_baked": True,
                "edit": {"base_id": bg.id, "layers": page.replace(BG, _media_path(bg.id))},
            },
        })
    story = post_type == "story"
    job = GenerationJob(
        account_id=account.id, prompt=name.strip() or "디자인 템플릿", media_kind="STORIES" if story else "IMAGE",
        tone="", status="ready", provider="original/design", error="", caption="", hashtags=[],
        plan={"slides": [{"role": "photo"} for _ in assets], "original": True, "post_type": post_type, "design": name.strip()},
        assets=assets,
    )
    _sync_kind(job)
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_dict(job)


# ── 내 테마 ────────────────────────────────────────────────
class ThemeIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    colors: dict[str, str]
    fonts: dict[str, str]

    @field_validator("colors")
    @classmethod
    def _colors(cls, v: dict[str, str]) -> dict[str, str]:
        keys = ("bg", "surface", "text", "primary", "on_primary", "accent")
        if any(k not in v or not _COLOR.match(v[k]) for k in keys):
            raise ValueError("colors")
        return {k: v[k].lower() for k in keys}

    @field_validator("fonts")
    @classmethod
    def _fonts(cls, v: dict[str, str]) -> dict[str, str]:
        if any(k not in v or not _FONT.match(v[k]) for k in ("heading", "body")):
            raise ValueError("fonts")
        return {"heading": v["heading"], "body": v["body"]}


@router.get("/studio/themes")
def list_themes(user: User = Depends(current_user)) -> dict:
    return {"data": list(user.design_themes or [])}


@router.post("/studio/themes", status_code=status.HTTP_201_CREATED)
def save_theme(body: ThemeIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    themes = list(user.design_themes or [])
    name = body.name.strip()
    same = next((x for x in themes if x.get("name") == name), None)
    if same is not None:  # 같은 이름이면 덮어쓰기
        same.update(colors=body.colors, fonts=body.fonts)
        item = same
    else:
        if len(themes) >= MAX_THEMES:
            raise HTTPException(status.HTTP_409_CONFLICT, f"내 테마는 {MAX_THEMES}개까지 저장할 수 있습니다. 안 쓰는 테마를 지워 주세요.")
        item = {"id": secrets.token_urlsafe(6), "name": name, "colors": body.colors, "fonts": body.fonts}
        themes.append(item)
    user.design_themes = themes
    flag_modified(user, "design_themes")
    db.commit()
    return item


@router.delete("/studio/themes/{theme_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_theme(theme_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    themes = list(user.design_themes or [])
    kept = [x for x in themes if x.get("id") != theme_id]
    if len(kept) == len(themes):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "테마를 찾을 수 없습니다.")
    user.design_themes = kept
    flag_modified(user, "design_themes")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 내 템플릿 ──────────────────────────────────────────────
def _template_item(t: DesignTemplate, full: bool = False) -> dict:
    item = {"id": t.id, "name": t.name, "post_type": t.post_type, "pages": len(t.pages or []),
            "thumb_url": _media_url(t.thumb_id) if t.thumb_id else ""}
    if full:
        # 바탕 그림 주소를 채워서
        item["pages"] = [p.replace(f"__BG{i}__", _media_path(bid)) for i, (p, bid) in enumerate(zip(t.pages or [], t.bg_ids or []))]
    return item


def _mine(t: DesignTemplate) -> dict:
    """내 템플릿 목록용: 공개 여부·반응까지"""
    return {**_template_item(t), "is_public": bool(t.is_public), "hidden": bool(t.hidden), "category": t.category,
            "tags": list(t.tags or []), "description": t.description, "author_name": t.author_name,
            "uses": t.uses or 0, "likes": t.likes or 0, "saves": t.saves or 0, "remix_of": t.remix_of}


def _own_template(db: Session, user: User, template_id: str) -> DesignTemplate:
    t = db.get(DesignTemplate, template_id)
    if t is None or t.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "템플릿을 찾을 수 없습니다.")
    return t


@router.get("/studio/templates")
def list_templates(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.query(DesignTemplate).filter(DesignTemplate.user_id == user.id).order_by(DesignTemplate.created_at.desc()).all()
    return {"data": [_mine(t) for t in rows]}


@router.get("/studio/templates/{template_id}")
def get_template(template_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return _template_item(_own_template(db, user, template_id), full=True)


@router.post("/studio/templates", status_code=status.HTTP_201_CREATED)
async def save_template(
    pages: str = Form(max_length=MAX_PAGES * MAX_LAYERS_BYTES),  # 바탕 주소 자리는 __BG__
    bgs: list[UploadFile] = File(...),
    thumb: UploadFile = File(...),
    name: str = Form(min_length=1, max_length=40),
    post_type: str = Form(default="feed", pattern=r"^(feed|story)$"),
    user: User = Depends(current_user),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """꾸민 장(들)을 '내 템플릿'으로 저장 — 바탕 그림은 작업과 따로 보관해, 작업을 지워도 템플릿은 남음."""
    layers = _pages(pages, len(bgs))
    if db.query(DesignTemplate).filter(DesignTemplate.user_id == user.id).count() >= MAX_TEMPLATES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"내 템플릿은 {MAX_TEMPLATES}개까지 저장할 수 있습니다. 안 쓰는 템플릿을 지워 주세요.")
    bg_ids = [_save_blob(db, account, *(await _image(f)), kind="template").id for f in bgs]
    thumb_blob = _save_blob(db, account, *(await _image(thumb, max_side=540)), kind="template")
    t = DesignTemplate(
        id=secrets.token_urlsafe(12), user_id=user.id, name=name.strip(), post_type=post_type,
        pages=[p.replace(BG, f"__BG{i}__") for i, p in enumerate(layers)], bg_ids=bg_ids, thumb_id=thumb_blob.id,
    )
    db.add(t)
    db.commit()
    return _template_item(t)


@router.put("/studio/templates/{template_id}")
async def update_template(
    template_id: str,
    pages: str = Form(max_length=MAX_PAGES * MAX_LAYERS_BYTES),
    bgs: list[UploadFile] = File(...),
    thumb: UploadFile = File(...),
    name: str = Form(min_length=1, max_length=40),
    user: User = Depends(current_user),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """템플릿 고치기: 장·바탕·미리보기를 새것으로 바꾸고 예전 그림은 지움."""
    t = _own_template(db, user, template_id)
    layers = _pages(pages, len(bgs))
    old = [*(t.bg_ids or []), t.thumb_id]
    t.bg_ids = [_save_blob(db, account, *(await _image(f)), kind="template").id for f in bgs]
    t.thumb_id = _save_blob(db, account, *(await _image(thumb, max_side=540)), kind="template").id
    t.pages = [p.replace(BG, f"__BG{i}__") for i, p in enumerate(layers)]
    t.name = name.strip()
    for blob_id in old:
        blob = db.get(MediaBlob, blob_id) if blob_id else None
        if blob is not None and blob.kind == "template":
            db.delete(blob)
    db.commit()
    return _template_item(t)


@router.delete("/studio/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_template(template_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    t = _own_template(db, user, template_id)
    for blob_id in [*(t.bg_ids or []), t.thumb_id]:
        blob = db.get(MediaBlob, blob_id) if blob_id else None
        if blob is not None and blob.kind == "template":
            db.delete(blob)
    db.query(TemplateReaction).filter(TemplateReaction.template_id == t.id).delete()  # 모두의 템플릿 좋아요·보관·신고
    db.delete(t)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
