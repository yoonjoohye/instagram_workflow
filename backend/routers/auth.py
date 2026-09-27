"""Facebook 로그인 → 페이지 선택 → Instagram 비즈니스 계정 연결."""
from __future__ import annotations

import datetime as dt
import secrets

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
from ..services.meta_graph import SCOPES, GraphClient, GraphError

router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_STATE_COOKIE = "iaw_oauth_state"


def _admin_url(path: str = "", **params: str) -> str:
    base = f"{settings.public_base_url.rstrip('/')}/admin{path}"
    return f"{base}?{urlencode(params)}" if params else base


@router.get("/login")
def login() -> RedirectResponse:
    """Facebook OAuth 다이얼로그로 보냅니다."""
    if not settings.meta_configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "META_APP_ID / META_APP_SECRET 이 설정되지 않았습니다. .env 를 확인하세요.",
        )
    state = secrets.token_urlsafe(24)
    url = (
        f"{settings.oauth_dialog}?"
        + urlencode(
            {
                "client_id": settings.meta_app_id,
                "redirect_uri": settings.redirect_uri,
                "state": state,
                "scope": ",".join(SCOPES),
                "response_type": "code",
            }
        )
    )
    resp = RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    resp.set_cookie(
        OAUTH_STATE_COOKIE, state, max_age=600, httponly=True, samesite="lax", secure=_secure()
    )
    return resp


def _secure() -> bool:
    return settings.public_base_url.startswith("https://")


@router.get("/callback")
def callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if error:
        return RedirectResponse(_admin_url(error=error_description or error))

    expected = request.cookies.get(OAUTH_STATE_COOKIE)
    if not code or not state or state != expected:
        return RedirectResponse(_admin_url(error="OAuth state 검증에 실패했습니다. 다시 시도해 주세요."))

    try:
        with GraphClient() as anon:
            short = anon.exchange_code(code)
            long_lived = anon.exchange_long_lived(short["access_token"])

        user_token = long_lived["access_token"]
        expires_in = long_lived.get("expires_in")
        expires_at = (
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(expires_in))
            if expires_in
            else None
        )

        with GraphClient(user_token) as client:
            me = client.me()
            pages = client.my_pages()
            granted = ",".join(
                s["permission"]
                for s in client.get("me/permissions").get("data", [])
                if s.get("status") == "granted"
            )
    except GraphError as exc:
        return RedirectResponse(_admin_url(error=str(exc)))

    if not pages:
        return RedirectResponse(
            _admin_url(
                error="Instagram 프로페셔널 계정이 연결된 Facebook 페이지를 찾지 못했습니다. "
                "Instagram 앱에서 비즈니스/크리에이터 계정으로 전환하고 페이지에 연결해 주세요."
            )
        )

    # 페이지가 여러 개면 첫 번째를 기본 연결하고, 나머지는 /auth/accounts 에서 전환합니다.
    page = pages[0]
    account = _upsert_account(db, page, me, expires_at, granted)

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


def _upsert_account(
    db: Session,
    page: dict,
    me: dict,
    expires_at: dt.datetime | None,
    granted: str,
) -> Account:
    ig = page["instagram_business_account"]
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
    account.fb_user_id = me.get("id", "")
    account.fb_page_id = page.get("id", "")
    account.fb_page_name = page.get("name", "")
    # 페이지 액세스 토큰은 만료가 없어 발행/인사이트에 더 안정적입니다.
    account.access_token_enc = encrypt(page["access_token"])
    account.token_expires_at = expires_at
    account.granted_scopes = granted

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
    """같은 Facebook 사용자에 연결된 다른 IG 계정 목록."""
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
