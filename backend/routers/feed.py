"""내 피드: 게시 전에 프로필 격자에 넣어 보기(최근 게시물) · 내 피드 색으로 테마 만들기"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import current_account, graph_for
from ..models import Account
from ..services import feed_theme
from ..services import insights as svc
from ..services.meta_graph import GraphError

router = APIRouter(tags=["feed"])


def _thumb(m: dict) -> str:
    return m.get("thumbnail_url") or m.get("media_url") or ""


def _recent(account: Account, limit: int) -> list[dict]:
    try:
        with graph_for(account) as client:
            rows = svc.recent_media(client, account.ig_user_id, limit=limit)
    except GraphError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return [r for r in rows if _thumb(r)]


@router.get("/studio/feed")
def recent_feed(limit: int = Query(default=12, ge=3, le=24), account: Account = Depends(current_account)) -> dict:
    """프로필 격자 미리보기용 최근 게시물 (최신순)"""
    return {"data": [{"id": r["id"], "thumb": _thumb(r), "permalink": r.get("permalink", ""), "media_type": r.get("media_type", "")} for r in _recent(account, limit)]}


def _fetch(url: str) -> bytes:
    try:
        r = httpx.get(url, timeout=8.0, follow_redirects=True)
        return r.content if r.status_code == 200 else b""
    except httpx.HTTPError:
        return b""


@router.post("/studio/themes/from-feed")
def theme_from_feed(account: Account = Depends(current_account)) -> dict:
    """최근 게시물 사진들의 대표 색으로 테마 색 6가지를 만들어 돌려줌 (저장은 화면에서 이름을 정한 뒤)"""
    rows = _recent(account, 12)
    with ThreadPoolExecutor(max_workers=6) as pool:
        images = [b for b in pool.map(_fetch, [_thumb(r) for r in rows]) if b]
    if len(images) < 3:
        raise HTTPException(status.HTTP_409_CONFLICT, "피드 색을 읽으려면 게시물이 3개 이상 필요합니다.")
    swatches = feed_theme.palette(images)
    return {
        "colors": feed_theme.theme_from(swatches),
        "palette": [{"color": "#{:02x}{:02x}{:02x}".format(*s.rgb), "share": round(s.share, 3)} for s in swatches[:8]],
        "posts": len(images),
    }
