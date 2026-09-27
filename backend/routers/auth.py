"""로그인 → Instagram 프로페셔널 계정 연결.

settings.auth_mode 에 따라 두 가지 흐름을 지원합니다.
  instagram: Instagram 로그인 → 장기 Instagram 토큰 (Facebook 페이지 불필요)
  facebook : Facebook 로그인 → 페이지 선택 → 페이지에 연결된 IG 비즈니스 계정
"""
from __future__ import annotations

import datetime as dt
import secrets
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from urllib.parse import urlencode

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account
from ..security import SESSION_COOKIE, SESSION_MAX_AGE, encrypt, sign_session
from ..services.meta_graph import IG_AUTHORIZE_URL, IG_SCOPES, SCOPES, GraphClient, GraphError

router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_STATE_COOKIE = "iaw_oauth_state"


def _admin_url(path: str = "", **params: str) -> str:
    base = f"{settings.public_base_url.rstrip('/')}/admin{path}"
    return f"{base}?{urlencode(params)}" if params else base


def _secure() -> bool:
    return settings.public_base_url.startswith("https://")


def _expires_at(expires_in: object) -> dt.datetime | None:
    if not expires_in:
        return None
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(expires_in))


@router.get("/login")
def login() -> RedirectResponse:
    """선택된 로그인 방식의 OAuth 다이얼로그로 보냅니다."""
    if not settings.meta_configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET (또는 META_APP_ID / META_APP_SECRET) 이 "
            "설정되지 않았습니다. 환경변수를 확인하세요.",
        )
    state = secrets.token_urlsafe(24)
    if settings.auth_mode == "instagram":
        url = f"{IG_AUTHORIZE_URL}?" + urlencode(
            {
                "client_id": settings.instagram_app_id,
                "redirect_uri": settings.redirect_uri,
                "response_type": "code",
                "scope": ",".join(IG_SCOPES),
                "state": state,
            }
        )
    else:
        url = f"{settings.oauth_dialog}?" + urlencode(
            {
                "client_id": settings.meta_app_id,
                "redirect_uri": settings.redirect_uri,
                "state": state,
                "scope": ",".join(SCOPES),
                "response_type": "code",
            }
        )
    resp = RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    resp.set_cookie(
        OAUTH_STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax", secure=_secure()
    )
    return resp


@dataclass
class _Linked:
    """두 로그인 방식의 결과를 같은 모양으로 맞춘 것."""

    ig: dict  # id, username, name, profile_picture_url, followers_count, ...
    token: str
    expires_at: dt.datetime | None
    granted: str
    fb_user_id: str = ""
    fb_page_id: str = ""
    fb_page_name: str = ""


def _link_instagram(code: str) -> _Linked:
    with GraphClient() as anon:
        # Instagram 이 붙여 보내는 '#_' 꼬리는 code 의 일부가 아닙니다.
        short = anon.ig_exchange_code(code.split("#")[0])
        long_lived = anon.ig_exchange_long_lived(short["access_token"])
    token = long_lived["access_token"]
    with GraphClient(token) as client:
        me = client.ig_me()

    permissions = short.get("permissions", "")
    granted = ",".join(permissions) if isinstance(permissions, list) else str(permissions)
    # user_id 가 게시·인사이트 엔드포인트용 IG 프로페셔널 계정 ID 입니다.
    ig_id = str(me.get("user_id") or short.get("user_id") or me.get("id"))
    return _Linked(
        ig={**me, "id": ig_id},
        token=token,
        expires_at=_expires_at(long_lived.get("expires_in")),
        granted=granted,
    )


class _NoPages(Exception):
    pass


def _link_facebook(code: str) -> _Linked:
    with GraphClient() as anon:
        short = anon.exchange_code(code)
        long_lived = anon.exchange_long_lived(short["access_token"])

    user_token = long_lived["access_token"]
    with GraphClient(user_token) as client:
        me = client.me()
        pages = client.my_pages()
        granted = ",".join(
            s["permission"]
            for s in client.get("me/permissions").get("data", [])
            if s.get("status") == "granted"
        )
    if not pages:
        raise _NoPages()

    # 페이지가 여러 개면 첫 번째를 기본 연결하고, 나머지는 /auth/accounts 에서 확인합니다.
    page = pages[0]
    return _Linked(
        ig=page["instagram_business_account"],
        # 페이지 액세스 토큰은 만료가 없어 발행/인사이트에 더 안정적입니다.
        token=page["access_token"],
        expires_at=_expires_at(long_lived.get("expires_in")),
        granted=granted,
        fb_user_id=me.get("id", ""),
        fb_page_id=page.get("id", ""),
        fb_page_name=page.get("name", ""),
    )


@router.get("/callback")
def callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    error_reason: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if error:
        if error_reason == "user_denied":
            return RedirectResponse(_admin_url(error="권한 허용을 취소했습니다. 다시 연결해 주세요."))
        return RedirectResponse(_admin_url(error=error_description or error))

    expected = request.cookies.get(OAUTH_STATE_COOKIE)
    if not code or not state or state != expected:
        return RedirectResponse(_admin_url(error="OAuth state 검증에 실패했습니다. 다시 시도해 주세요."))

    try:
        linked = _link_instagram(code) if settings.auth_mode == "instagram" else _link_facebook(code)
    except _NoPages:
        return RedirectResponse(
            _admin_url(
                error="Instagram 프로페셔널 계정이 연결된 Facebook 페이지를 찾지 못했습니다. "
                "Instagram 앱에서 비즈니스/크리에이터 계정으로 전환하고 페이지에 연결해 주세요."
            )
        )
    except GraphError as exc:
        return RedirectResponse(_admin_url(error=str(exc)))

    account = _upsert_account(db, linked)

    if settings.auth_mode == "instagram":
        # 댓글·DM 자동 응답용 Webhook 구독. 실패해도(권한·앱 모드) 로그인은 계속합니다.
        try:
            with GraphClient(linked.token) as client:
                client.subscribe_webhooks()
        except GraphError:
            pass

    resp = RedirectResponse(_admin_url(connected="1"))
    resp.delete_cookie(OAUTH_STATE_COOKIE)
    resp.set_cookie(
        SESSION_COOKIE,
        sign_session({"account_id": account.id}),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_secure(),
        path="/",
    )
    return resp


def _upsert_account(db: Session, linked: _Linked) -> Account:
    ig = linked.ig
    account = db.scalar(select(Account).where(Account.ig_user_id == ig["id"]))
    if account is None:
        account = Account(ig_user_id=ig["id"], access_token_enc="")
        db.add(account)

    account.username = ig.get("username", "")
    account.name = ig.get("name", "")
    account.profile_picture_url = ig.get("profile_picture_url", "")
    account.followers_count = ig.get("followers_count", 0) or 0
    account.follows_count = ig.get("follows_count", 0) or 0
    account.media_count = ig.get("media_count", 0) or 0
    account.fb_user_id = linked.fb_user_id
    account.fb_page_id = linked.fb_page_id
    account.fb_page_name = linked.fb_page_name
    account.access_token_enc = encrypt(linked.token)
    account.token_expires_at = linked.expires_at
    account.granted_scopes = linked.granted

    db.commit()
    db.refresh(account)
    return account


@router.get("/me")
def me(account: Account = Depends(current_account)) -> dict:
    return {
        "id": account.id,
        "ig_user_id": account.ig_user_id,
        "username": account.username,
        "name": account.name,
        "profile_picture_url": account.profile_picture_url,
        "followers_count": account.followers_count,
        "follows_count": account.follows_count,
        "media_count": account.media_count,
        "fb_page_name": account.fb_page_name,
        "granted_scopes": account.granted_scopes.split(",") if account.granted_scopes else [],
        "token_expires_at": account.token_expires_at.isoformat()
        if account.token_expires_at
        else None,
    }


@router.get("/accounts")
def list_accounts(account: Account = Depends(current_account)) -> dict:
    """같은 Facebook 사용자에 연결된 다른 IG 계정 목록 (Instagram 로그인은 본인 계정 하나)."""
    if settings.auth_mode == "instagram":
        return {
            "data": [
                {
                    "page_id": "",
                    "page_name": "",
                    "ig_user_id": account.ig_user_id,
                    "username": account.username,
                    "current": True,
                }
            ]
        }
    with graph_for(account) as client:
        try:
            pages = client.my_pages()
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
    return {
        "data": [
            {
                "page_id": p["id"],
                "page_name": p.get("name", ""),
                "ig_user_id": p["instagram_business_account"]["id"],
                "username": p["instagram_business_account"].get("username", ""),
                "current": p["instagram_business_account"]["id"] == account.ig_user_id,
            }
            for p in pages
        ]
    }


@router.post("/logout")
def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp
