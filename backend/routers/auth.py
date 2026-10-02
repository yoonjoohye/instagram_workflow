"""로그인 → Instagram 프로페셔널 계정 연결.

settings.auth_mode 에 따라 두 가지 흐름을 지원합니다.
  instagram: Instagram 로그인 → 장기 Instagram 토큰 (Facebook 페이지 불필요)
  facebook : Facebook 로그인 → 페이지 선택 → 페이지에 연결된 IG 비즈니스 계정
"""
from __future__ import annotations

import datetime as dt
import os
import secrets
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from urllib.parse import urlencode

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, DataDeletionRequest
from ..services import account_data
from ..i18n import lang_of, tr
from ..security import SESSION_COOKIE, SESSION_MAX_AGE, encrypt, load_session, sign_session
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


MAX_LINKED = 10  # 한 브라우저에서 바꿔 가며 쓸 수 있는 연결 계정 수


def _session(request: Request) -> tuple[int | None, list[int]]:
    """(현재 계정, 이 브라우저에서 연결한 계정들). 세션 쿠키는 서명돼 있어 목록을 위조할 수 없습니다."""
    payload = load_session(request.cookies.get(SESSION_COOKIE) or "") or {}
    current = payload.get("account_id")
    linked = [i for i in payload.get("linked", []) if isinstance(i, int)]
    if isinstance(current, int) and current not in linked:
        linked.insert(0, current)
    return (current if isinstance(current, int) else None), linked[:MAX_LINKED]


def _set_session(resp: Response, current: int, linked: list[int]) -> None:
    linked = list(dict.fromkeys([current, *linked]))[:MAX_LINKED]
    resp.set_cookie(
        SESSION_COOKIE,
        sign_session({"account_id": current, "linked": linked}),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_secure(),
        path="/",
    )


@router.get("/login")
def login(switch: bool = Query(default=False)) -> RedirectResponse:
    """선택된 로그인 방식의 OAuth 다이얼로그로 보냅니다.
    switch=1 이면 브라우저에 로그인된 계정으로 바로 넘어가지 않고 로그인 화면을 띄워 다른 계정을 고르게 합니다."""
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
                **({"force_authentication": "1"} if switch else {}),
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
                **({"auth_type": "reauthenticate"} if switch else {}),
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
        # 앱 범위 사용자 ID — Meta 데이터 삭제·승인 취소 콜백이 이 ID 로 올 수 있어 보관합니다.
        fb_user_id=str(me.get("id") or ""),
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
            return RedirectResponse(_admin_url(error=tr("권한 허용을 취소했습니다. 다시 연결해 주세요.", lang_of(request))))
        return RedirectResponse(_admin_url(error=error_description or error))

    expected = request.cookies.get(OAUTH_STATE_COOKIE)
    if not code or not state or state != expected:
        return RedirectResponse(_admin_url(error=tr("OAuth state 검증에 실패했습니다. 다시 시도해 주세요.", lang_of(request))))

    try:
        linked = _link_instagram(code) if settings.auth_mode == "instagram" else _link_facebook(code)
    except _NoPages:
        return RedirectResponse(
            _admin_url(
                error=tr(
                    "Instagram 프로페셔널 계정이 연결된 Facebook 페이지를 찾지 못했습니다. "
                    "Instagram 앱에서 비즈니스/크리에이터 계정으로 전환하고 페이지에 연결해 주세요.",
                    lang_of(request),
                )
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
    # 이미 연결해 둔 다른 계정은 목록에 남겨 두고, 방금 연결한 계정으로 전환합니다.
    _set_session(resp, account.id, _session(request)[1])
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


def dev_login_enabled(request: Request) -> bool:
    """로컬 개발 전용 로그인 허용 조건: DEV_LOGIN=1, Vercel 아님, 이 컴퓨터에서 온 localhost 요청."""
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(":")[0]
    client = request.client.host if request.client else ""
    return (
        settings.dev_login
        and not os.environ.get("VERCEL")
        and host in {"localhost", "127.0.0.1"}
        and client in {"127.0.0.1", "::1"}
    )


@router.get("/dev-login")
def dev_login(request: Request, account_id: int | None = None, db: Session = Depends(get_db)) -> Response:
    """로컬에서 인스타 로그인 없이 화면을 확인하기 위한 로그인 (DB 에 이미 연결된 계정만)."""
    if not dev_login_enabled(request):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    accounts = db.scalars(select(Account).order_by(Account.id)).all()
    if account_id is None:
        if not accounts:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "계정을 찾을 수 없습니다.")
        account_id = accounts[0].id
    if db.get(Account, account_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "계정을 찾을 수 없습니다.")
    resp = RedirectResponse("/admin", status_code=status.HTTP_303_SEE_OTHER)
    _set_session(resp, account_id, [a.id for a in accounts])
    return resp


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
def list_accounts(request: Request, account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    """이 브라우저에서 연결한 계정들 (다시 로그인하지 않고 전환할 수 있음)."""
    _, linked = _session(request)
    rows = [db.get(Account, i) for i in linked]
    return {
        "data": [
            {
                "id": a.id,
                "username": a.username,
                "name": a.name,
                "profile_picture_url": a.profile_picture_url,
                "current": a.id == account.id,
            }
            for a in rows
            if a is not None
        ]
    }


class SwitchIn(BaseModel):
    account_id: int


@router.post("/switch")
def switch_account(body: SwitchIn, request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """이 브라우저에서 이미 연결한 계정으로 바꿉니다 (연결한 적 없는 계정은 거부)."""
    _, linked = _session(request)
    if body.account_id not in linked or db.get(Account, body.account_id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "이 브라우저에서 연결한 계정만 전환할 수 있습니다.")
    resp = JSONResponse({"ok": True})
    _set_session(resp, body.account_id, linked)
    return resp


@router.delete("/account")
def delete_my_account(
    request: Request, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> JSONResponse:
    """연결 해제 및 데이터 삭제 — 토큰, 생성물, 인사이트 기록, 댓글·자동 응답 기록을 모두 지웁니다."""
    _, linked = _session(request)
    deleted_id = account.id
    account_data.delete_account(db, account)
    record = account_data.record_in_app(db)
    db.commit()
    resp = JSONResponse({"ok": True, "confirmation_code": record.code})
    # 이 계정만 목록에서 빼고, 연결해 둔 다른 계정이 있으면 그 계정으로 전환합니다.
    remaining = [i for i in linked if i != deleted_id and db.get(Account, i) is not None]
    if remaining:
        _set_session(resp, remaining[0], remaining)
    else:
        resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@router.post("/data-deletion")
async def meta_data_deletion(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """Meta '데이터 삭제 요청 URL' 콜백. 확인 URL 과 코드를 돌려줘야 합니다."""
    form = await request.form()
    payload = account_data.parse_signed_request(str(form.get("signed_request") or ""))
    if payload is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signed_request 검증 실패")
    record = account_data.delete_by_platform_user(db, str(payload.get("user_id") or ""), source="meta_deletion")
    return JSONResponse(
        {
            "url": f"{settings.public_base_url.rstrip('/')}/data-deletion?code={record.code}",
            "confirmation_code": record.code,
        }
    )


@router.post("/deauthorize")
async def meta_deauthorize(request: Request, db: Session = Depends(get_db)) -> dict:
    """Meta '승인 취소 콜백 URL' — 사용자가 앱 연결을 끊으면 데이터를 삭제합니다."""
    form = await request.form()
    payload = account_data.parse_signed_request(str(form.get("signed_request") or ""))
    if payload is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "signed_request 검증 실패")
    account_data.delete_by_platform_user(db, str(payload.get("user_id") or ""), source="meta_deauthorize")
    return {"ok": True}


@router.get("/data-deletion/status")
def data_deletion_status(code: str = Query(min_length=4, max_length=64), db: Session = Depends(get_db)) -> dict:
    record = db.scalar(select(DataDeletionRequest).where(DataDeletionRequest.code == code))
    if record is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "해당 확인 코드를 찾을 수 없습니다.")
    return {"code": record.code, "status": record.status, "requested_at": record.created_at.isoformat()}


@router.post("/logout")
def logout() -> JSONResponse:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp
