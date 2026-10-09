"""모두의 템플릿: 회원이 만든 템플릿을 공개해 다른 회원이 둘러보고 쓰고, 가져와 고쳐 다시 공개(리믹스)할 수 있게.

- 공개는 바로 (신고가 REPORT_HIDE 번 쌓이면 자동으로 숨김)
- 제작자는 공개할 때 정한 이름으로 표시 (회원 실명은 보이지 않음)
- 인기순 = 사용 수 + 좋아요·보관 가중치, 최신순 = 공개한 순서
- 리믹스: 원본을 내 템플릿으로 복사(그림도 복사) — 다시 공개하면 '원본: OO님의 템플릿'이 따라붙음
"""
from __future__ import annotations

import datetime as dt
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_account, current_user
from ..models import Account, DesignTemplate, MediaBlob, TemplateReaction, User
from .designs import _mine, _own_template, _template_item

router = APIRouter(tags=["community"])

REPORT_HIDE = 3
PAGE = 24
CATEGORIES = {"cardnews", "photo", "notice", "promo", "story", "etc"}


def _public(db: Session, template_id: str) -> DesignTemplate:
    t = db.get(DesignTemplate, template_id)
    if t is None or not t.is_public or t.hidden:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "템플릿을 찾을 수 없습니다.")
    return t


def _card(t: DesignTemplate, mine: dict[str, set[str]], origins: dict[str, DesignTemplate]) -> dict:
    o = origins.get(t.remix_of)
    return {
        **_template_item(t),
        "category": t.category, "tags": list(t.tags or []), "description": t.description,
        "author": {"id": t.user_id, "name": t.author_name}, "published_at": t.published_at.isoformat() if t.published_at else None,
        "uses": t.uses, "likes": t.likes, "saves": t.saves,
        "liked": t.id in mine.get("like", set()), "saved": t.id in mine.get("save", set()),
        "remix_of": {"id": o.id, "name": o.name, "author": o.author_name} if o is not None else None,
        "is_mine": False,
    }


def _cards(db: Session, user: User, rows: list[DesignTemplate]) -> list[dict]:
    ids = [t.id for t in rows]
    mine: dict[str, set[str]] = {}
    if ids:
        for r in db.query(TemplateReaction).filter(TemplateReaction.user_id == user.id, TemplateReaction.template_id.in_(ids)):
            mine.setdefault(r.kind, set()).add(r.template_id)
    origin_ids = [t.remix_of for t in rows if t.remix_of]
    origins = {o.id: o for o in db.query(DesignTemplate).filter(DesignTemplate.id.in_(origin_ids))} if origin_ids else {}
    out = []
    for t in rows:
        card = _card(t, mine, origins)
        card["is_mine"] = t.user_id == user.id
        out.append(card)
    return out


@router.get("/community/templates")
def browse(
    sort: str = Query(default="popular", pattern=r"^(popular|new)$"),
    category: str = Query(default="", max_length=20),
    q: str = Query(default="", max_length=40),  # 이름·태그·설명
    author: int | None = Query(default=None),
    page: int = Query(default=1, ge=1, le=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    """모두의 템플릿 둘러보기 (숨긴 것 빼고)."""
    query = db.query(DesignTemplate).filter(DesignTemplate.is_public == 1, DesignTemplate.hidden == 0)
    if category:
        query = query.filter(DesignTemplate.category == category)
    if author is not None:
        query = query.filter(DesignTemplate.user_id == author)
    rows = query.all()
    if q.strip():
        words = q.strip().lower().lstrip("#").split()
        def hit(t: DesignTemplate) -> bool:
            hay = " ".join([t.name, t.description, t.author_name, *[str(x) for x in (t.tags or [])]]).lower()
            return all(w in hay for w in words)
        rows = [t for t in rows if hit(t)]
    def when(t: DesignTemplate) -> dt.datetime:
        d = t.published_at or t.created_at or dt.datetime(2000, 1, 1)
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)  # SQLite 는 시간대를 빼고 돌려줌

    if sort == "new":
        rows.sort(key=when, reverse=True)
    else:
        rows.sort(key=lambda t: (t.uses + t.likes * 3 + t.saves * 2, when(t)), reverse=True)
    total = len(rows)
    rows = rows[(page - 1) * PAGE : page * PAGE]
    author_name = ""
    if author is not None:
        any_t = db.query(DesignTemplate).filter(DesignTemplate.user_id == author, DesignTemplate.is_public == 1).order_by(DesignTemplate.published_at.desc()).first()
        author_name = any_t.author_name if any_t else ""
    return {"data": _cards(db, user, rows), "total": total, "page": page, "has_more": page * PAGE < total,
            "author": {"id": author, "name": author_name} if author is not None else None}


@router.get("/community/templates/{template_id}")
def get_public(template_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """공개 템플릿 하나 (장까지 — 이걸로 게시물을 만들 때)."""
    t = _public(db, template_id)
    return {**_cards(db, user, [t])[0], "pages": _template_item(t, full=True)["pages"]}


@router.post("/community/templates/{template_id}/use")
def mark_used(template_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """이걸로 게시물을 만들었음 (인기순에 반영, 자기 템플릿은 세지 않음)."""
    t = _public(db, template_id)
    if t.user_id != user.id:
        t.uses = (t.uses or 0) + 1
        db.commit()
    return {"uses": t.uses}


def _react(db: Session, user: User, t: DesignTemplate, kind: str, on: bool, reason: str = "") -> bool:
    existing = db.query(TemplateReaction).filter_by(user_id=user.id, template_id=t.id, kind=kind).first()
    if on and existing is None:
        db.add(TemplateReaction(user_id=user.id, template_id=t.id, kind=kind, reason=reason[:200]))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            return False
        return True
    if not on and existing is not None:
        db.delete(existing)
        return True
    return False


@router.post("/community/templates/{template_id}/like")
def like(template_id: str, on: bool = Query(default=True), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    t = _public(db, template_id)
    if _react(db, user, t, "like", on):
        t.likes = max(0, (t.likes or 0) + (1 if on else -1))
    db.commit()
    return {"likes": t.likes, "liked": on}


@router.post("/community/templates/{template_id}/save")
def save(template_id: str, on: bool = Query(default=True), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """내 보관함에 담기·빼기"""
    t = _public(db, template_id)
    if _react(db, user, t, "save", on):
        t.saves = max(0, (t.saves or 0) + (1 if on else -1))
    db.commit()
    return {"saves": t.saves, "saved": on}


@router.get("/community/saved")
def saved(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    ids = [r.template_id for r in db.query(TemplateReaction).filter_by(user_id=user.id, kind="save").order_by(TemplateReaction.created_at.desc())]
    rows = {t.id: t for t in db.query(DesignTemplate).filter(DesignTemplate.id.in_(ids), DesignTemplate.is_public == 1, DesignTemplate.hidden == 0)} if ids else {}
    return {"data": _cards(db, user, [rows[i] for i in ids if i in rows])}


class ReportIn(BaseModel):
    reason: str = Field(default="", max_length=200)


@router.post("/community/templates/{template_id}/report")
def report(template_id: str, body: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """신고 (한 사람당 한 번). 여러 명이 신고하면 자동으로 숨김."""
    t = _public(db, template_id)
    if t.user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "내 템플릿은 신고할 수 없습니다.")
    if _react(db, user, t, "report", True, body.reason):
        t.reports = (t.reports or 0) + 1
        if t.reports >= REPORT_HIDE:
            t.hidden = 1
    db.commit()
    return {"reported": True}


def _copy_blob(db: Session, account: Account, blob_id: str) -> str:
    src = db.get(MediaBlob, blob_id)
    if src is None:
        return ""
    dup = MediaBlob(id=secrets.token_urlsafe(18), account_id=account.id, kind="template", data=src.data, url="",
                    content_type=src.content_type, width=src.width, height=src.height)
    db.add(dup)
    return dup.id


@router.post("/community/templates/{template_id}/remix", status_code=status.HTTP_201_CREATED)
def remix(template_id: str, user: User = Depends(current_user), account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """가져와서 고치기: 내 템플릿으로 복사 (그림도 복사해, 원작자가 지워도 남음). 원본 표시는 다시 공개할 때."""
    t = _public(db, template_id)
    if db.query(DesignTemplate).filter(DesignTemplate.user_id == user.id).count() >= 40:
        raise HTTPException(status.HTTP_409_CONFLICT, "내 템플릿은 40개까지 저장할 수 있습니다. 안 쓰는 템플릿을 지워 주세요.")
    copy = DesignTemplate(
        id=secrets.token_urlsafe(12), user_id=user.id, name=t.name[:40], post_type=t.post_type, pages=list(t.pages or []),
        bg_ids=[_copy_blob(db, account, b) for b in (t.bg_ids or [])], thumb_id=_copy_blob(db, account, t.thumb_id) if t.thumb_id else "",
        category=t.category, tags=list(t.tags or []), remix_of=t.id,
    )
    db.add(copy)
    db.commit()
    return _template_item(copy)


# ── 내 템플릿 공개 ─────────────────────────────────────────
class PublishIn(BaseModel):
    category: str = Field(default="etc", max_length=20)
    tags: list[str] = Field(default_factory=list, max_length=8)
    description: str = Field(default="", max_length=200)
    author_name: str = Field(min_length=1, max_length=40)

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str) -> str:
        return v if v in CATEGORIES else "etc"

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for x in v:
            x = x.strip().lstrip("#")[:20]
            if x and x not in out:
                out.append(x)
        return out


@router.post("/studio/templates/{template_id}/publish")
def publish(template_id: str, body: PublishIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """내 템플릿을 모두에게 공개 (바로 올라감, 다시 부르면 정보만 고침)."""
    t = _own_template(db, user, template_id)
    if t.hidden:
        raise HTTPException(status.HTTP_409_CONFLICT, "신고가 쌓여 숨겨진 템플릿은 다시 공개할 수 없습니다.")
    t.is_public = 1
    t.published_at = t.published_at or dt.datetime.now(dt.timezone.utc)
    t.category, t.tags, t.description, t.author_name = body.category, body.tags, body.description.strip(), body.author_name.strip()
    db.commit()
    return _mine(t)


@router.post("/studio/templates/{template_id}/unpublish")
def unpublish(template_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    t = _own_template(db, user, template_id)
    t.is_public = 0
    db.commit()
    return _mine(t)

