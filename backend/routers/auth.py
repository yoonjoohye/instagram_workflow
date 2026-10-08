"""회원에 Instagram·Facebook 계정 연동 (OAuth), 계정 전환·연동 해제, Meta 콜백.

  instagram: Instagram 로그인 → 장기 Instagram 토큰 (Facebook 페이지 불필요). 여러 계정 연동 가능.
  facebook : Facebook 로그인 → 페이지들 → 페이지에 연결된 Instagram 프로페셔널 계정 (회원당 Facebook 하나)

회원 로그인(이메일)은 routers/members.py. 여기 OAuth 는 '로그인'이 아니라 로그인한 회원에 계정을 붙이는 것입니다.
휴대폰 앱은 로그인 창을 시스템 브라우저로 여는데 그 브라우저엔 회원 세션이 없으므로, 화면이 먼저 받은
일회용 연동 티켓(link-ticket)을 주소에 붙여 보냅니다.
"""
from __future__ import annotations

import datetime as dt
import os
import secrets
from dataclasses import dataclass, field
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, RedirectResponse, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, current_user, session_payload, user_accounts
from ..i18n import lang_of, tr
from ..models import Account, DataDeletionRequest, FacebookLink, User
from ..security import SESSION_COOKIE, encrypt
from ..services import account_data
from ..services.meta_graph import IG_AUTHORIZE_URL, IG_SCOPES, SCOPES, GraphClient, GraphError
from .members import account_dict, set_session

router = APIRouter(prefix="/auth", tags=["auth"])

OAUTH_STATE_COOKIE = "iaw_oauth_state"
APP_REDIRECT_COOKIE = "iaw_app_redirect"
APP_SCHEME = "instaautostudio"
PROFILE_PATH = "/admin/profile"


def _admin_url(path: str = "", **params: str) -> str:
    base = f"{settings.public_base_url.rstrip('/')}/admin{path}"
    return f"{base}?{urlencode(params)}" if params else base


def _profile_url(**params: str) -> str:
    return _admin_url("/profile", **params)


def _secure() -> bool:
    return settings.public_base_url.startswith("https://")


def _expires_at(expires_in: object) -> dt.datetime | None:
    if not expires_in:
        return None
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(expires_in))


def _signer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.app_secret, salt=salt)


def _app_signer() -> URLSafeTimedSerializer:
    return _signer("iaw-app-code")


def _allowed_app_redirect(url: str) -> bool:
    """로그인 후 코드를 돌려줄 앱 주소. 우리 앱 스킴, 또는 개발용 Expo Go(같은 와이파이의 사설 IP)만."""
    import ipaddress
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    if parts.scheme == APP_SCHEME:
        return True
    if parts.scheme == "exp" and parts.hostname:
        try:
            return ipaddress.ip_address(parts.hostname).is_private
        except ValueError:
            return False
    return False


def _user_from(db: Session, payload: dict) -> User | None:
    user = db.get(User, payload.get("uid")) if isinstance(payload.get("uid"), int) else None
    return user if user is not None and payload.get("sv") == user.session_version else None


# ── 연동 시작 ──────────────────────────────────────────────────────────────


@router.post("/link-ticket")
def link_ticket(user: User = Depends(current_user)) -> dict:
    """연동 창을 열기 직전에 받는 5분짜리 티켓 (휴대폰 앱의 시스템 브라우저에는 회원 세션이 없어서)."""
    return {"ticket": _signer("iaw-link").dumps({"uid": user.id, "sv": user.session_version})}


@router.get("/login")
def start_link(
    request: Request,
    provider: str = Query(default="instagram", pattern="^(instagram|facebook)$"),
    switch: bool = Query(default=False),
    ticket: str | None = Query(default=None, max_length=500),
    app: str | None = Query(default=None, max_length=300),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Instagram 또는 Facebook 로그인 창으로 보냅니다 (로그인한 회원만).
    switch=1: 브라우저에 로그인된 인스타 계정으로 바로 넘어가지 않고 다른 계정을 고르게 합니다."""
    # 예전 주소(vercel.app 등)에서 시작하면 대표 주소로 먼저 옮김 — 로그인 확인용 쿠키와 돌아오는 주소(redirect_uri)가
    # 같은 주소여야 하므로. 회원은 티켓으로 확인하니 쿠키가 없어도 됨.
    public = urlsplit(settings.public_base_url)
    if ticket and request.url.hostname and public.hostname and request.url.hostname != public.hostname:
        path = request.headers.get("x-forwarded-uri") or "/api/py/auth/login"
        target = f"{settings.public_base_url.rstrip('/')}{path.split('?')[0]}?{request.url.query}"
        return RedirectResponse(target, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    user = None
    if ticket:
        try:
            user = _user_from(db, _signer("iaw-link").loads(ticket, max_age=300))
        except BadSignature:
            user = None
    if user is None:
        user = _user_from(db, session_payload(request.cookies.get(SESSION_COOKIE)))
    if user is None:
        return RedirectResponse(f"{settings.public_base_url.rstrip('/')}/login?next={PROFILE_PATH}", status_code=status.HTTP_307_TEMPORARY_REDIRECT)

    if provider == "instagram" and not settings.instagram_configured or provider == "facebook" and not settings.facebook_configured:
        return RedirectResponse(_profile_url(error=tr("이 연동은 아직 준비 중입니다 (앱 설정 필요).", lang_of(request))))

    state = secrets.token_urlsafe(24)
    if provider == "instagram":
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
    # 콜백에서 누가 무엇을 연동하는지 알 수 있게 (서명된 쿠키, 10분)
    cookie = _signer("iaw-oauth").dumps({"state": state, "uid": user.id, "sv": user.session_version, "provider": provider})
    resp.set_cookie(OAUTH_STATE_COOKIE, cookie, max_age=600, httponly=True, samesite="lax", secure=_secure())
    # 휴대폰 앱: 연동은 시스템 브라우저에서 하고, 끝나면 일회용 코드로 앱에 돌려줍니다.
    if app and _allowed_app_redirect(app):
        resp.set_cookie(APP_REDIRECT_COOKIE, app, max_age=600, httponly=True, samesite="lax", secure=_secure())
    else:
        resp.delete_cookie(APP_REDIRECT_COOKIE)
    return resp


# ── 콜백 ───────────────────────────────────────────────────────────────────


@dataclass
class _IgLinked:
    ig: dict  # id, username, name, profile_picture_url, followers_count, ...
    token: str
    expires_at: dt.datetime | None
    granted: str
    app_user_id: str = ""  # 앱 범위 사용자 ID (Meta 데이터 삭제 콜백이 이 ID 로 옴)


@dataclass
class _FbLinked:
    fb_user_id: str
    name: str
    token: str
    expires_at: dt.datetime | None
    granted: str
    pages: list[dict] = field(default_factory=list)  # me/accounts (IG 계정이 연결된 페이지만)


def _link_instagram(code: str) -> _IgLinked:
    with GraphClient(provider="instagram") as anon:
        # Instagram 이 붙여 보내는 '#_' 꼬리는 code 의 일부가 아닙니다.
        short = anon.ig_exchange_code(code.split("#")[0])
        long_lived = anon.ig_exchange_long_lived(short["access_token"])
    token = long_lived["access_token"]
    with GraphClient(token, provider="instagram") as client:
        me = client.ig_me()
    permissions = short.get("permissions", "")
    granted = ",".join(permissions) if isinstance(permissions, list) else str(permissions)
    # user_id 가 게시·인사이트 엔드포인트용 IG 프로페셔널 계정 ID 입니다.
    ig_id = str(me.get("user_id") or short.get("user_id") or me.get("id"))
    return _IgLinked(
        ig={**me, "id": ig_id},
        token=token,
        expires_at=_expires_at(long_lived.get("expires_in")),
        granted=granted,
        app_user_id=str(me.get("id") or ""),
    )


def _link_facebook(code: str) -> _FbLinked:
    with GraphClient(provider="facebook") as anon:
        short = anon.exchange_code(code)
        long_lived = anon.exchange_long_lived(short["access_token"])
    token = long_lived["access_token"]
    with GraphClient(token, provider="facebook") as client:
        me = client.me()
        pages = client.my_pages()
        granted = ",".join(
            s["permission"] for s in client.get("me/permissions").get("data", []) if s.get("status") == "granted"
        )
    return _FbLinked(
        fb_user_id=str(me.get("id", "")),
        name=me.get("name", ""),
        token=token,
        expires_at=_expires_at(long_lived.get("expires_in")),
        granted=granted,
        pages=pages,
    )


class _Taken(Exception):
    """다른 회원이 이미 연동한 Instagram 계정."""


def _fill_profile(account: Account, ig: dict) -> None:
    account.username = ig.get("username", "") or account.username
    account.name = ig.get("name", "") or ""
    account.profile_picture_url = ig.get("profile_picture_url", "") or ""
    account.followers_count = ig.get("followers_count", 0) or 0
    account.follows_count = ig.get("follows_count", 0) or 0
    account.media_count = ig.get("media_count", 0) or 0


def _owned_or_new(db: Session, user: User, ig_user_id: str) -> Account:
    account = db.scalar(select(Account).where(Account.ig_user_id == ig_user_id))
    if account is not None and account.user_id not in (None, user.id):
        raise _Taken()
    if account is None:
        account = Account(ig_user_id=ig_user_id, access_token_enc="", provider="instagram")
        db.add(account)
    account.user_id = user.id
    return account


def save_instagram(db: Session, user: User, linked: _IgLinked) -> Account:
    account = _owned_or_new(db, user, linked.ig["id"])
    if account.provider == "facebook" and account.access_token_enc:
        # Facebook 페이지로 연결돼 있던 계정: 그 페이지 토큰은 Facebook 전용 기능용으로 남겨 둠
        account.fb_page_token_enc = account.access_token_enc
    _fill_profile(account, linked.ig)
    account.provider = "instagram"
    account.fb_user_id = linked.app_user_id or account.fb_user_id
    account.access_token_enc = encrypt(linked.token)
    account.token_expires_at = linked.expires_at
    account.granted_scopes = linked.granted
    db.commit()
    db.refresh(account)
    return account


def save_facebook(db: Session, user: User, linked: _FbLinked) -> tuple[list[Account], list[str]]:
    """Facebook 연동: 페이지마다 연결된 Instagram 계정을 회원에 붙입니다.
    Instagram 로그인으로 이미 연동한 계정은 그대로 두고 Facebook 페이지 정보·토큰만 더합니다.
    (연동한 계정들, 다른 회원 계정이라 건너뛴 @이름들)"""
    link = db.scalar(select(FacebookLink).where(FacebookLink.user_id == user.id))
    if link is None:
        link = FacebookLink(user_id=user.id, fb_user_id=linked.fb_user_id, access_token_enc="")
        db.add(link)
    link.fb_user_id = linked.fb_user_id
    link.name = linked.name
    link.access_token_enc = encrypt(linked.token)
    link.token_expires_at = linked.expires_at
    link.granted_scopes = linked.granted
    link.pages = [
        {"id": p.get("id", ""), "name": p.get("name", ""), "ig_username": (p.get("instagram_business_account") or {}).get("username", "")}
        for p in linked.pages
    ]

    accounts, skipped = [], []
    for page in linked.pages:
        ig = page["instagram_business_account"]
        try:
            account = _owned_or_new(db, user, str(ig["id"]))
        except _Taken:
            skipped.append(ig.get("username", ""))
            continue
        page_token = encrypt(page["access_token"])
        if account.provider == "instagram" and account.access_token_enc:
            account.fb_page_token_enc = page_token
        else:
            account.provider = "facebook"
            account.access_token_enc = page_token
            account.token_expires_at = None  # 페이지 토큰은 만료 없음
            account.granted_scopes = linked.granted
        _fill_profile(account, ig)
        account.fb_user_id = linked.fb_user_id
        account.fb_page_id = page.get("id", "")
        account.fb_page_name = page.get("name", "")
        accounts.append(account)
    db.commit()
    return accounts, skipped


@router.get("/callback")
def callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
    error_reason: str | None = Query(default=None),
    error_code: str | None = Query(default=None),
    error_message: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    lang = lang_of(request)
    # Facebook 로그인은 앱 설정 문제(도메인·리디렉션 URI 미등록 등)를 error 대신 error_code·error_message 로 돌려줍니다.
    if error_code or error_message:
        return RedirectResponse(_profile_url(error=error_message or f"Facebook error {error_code}"))
    if error:
        if error_reason == "user_denied":
            return RedirectResponse(_profile_url(error=tr("권한 허용을 취소했습니다. 다시 연결해 주세요.", lang)))
        return RedirectResponse(_profile_url(error=error_description or error))

    try:
        saved = _signer("iaw-oauth").loads(request.cookies.get(OAUTH_STATE_COOKIE) or "", max_age=600)
    except BadSignature:
        saved = {}
    if not code or not state or state != saved.get("state"):
        return RedirectResponse(_profile_url(error=tr("OAuth state 검증에 실패했습니다. 다시 시도해 주세요.", lang)))
    user = _user_from(db, saved)
    if user is None:
        return RedirectResponse(f"{settings.public_base_url.rstrip('/')}/login?next={PROFILE_PATH}")

    provider = saved.get("provider", "instagram")
    params: dict[str, str] = {"connected": provider}
    try:
        if provider == "instagram":
            account = save_instagram(db, user, _link_instagram(code))
            # 댓글·DM 자동 응답용 Webhook 구독. 실패해도(권한·앱 모드) 연동은 계속합니다.
            try:
                with GraphClient(_link_token(account), provider="instagram") as client:
                    client.subscribe_webhooks()
            except GraphError:
                pass
        else:
            accounts, skipped = save_facebook(db, user, _link_facebook(code))
            account = accounts[0] if accounts else None
            if skipped:
                params["skipped"] = ",".join(skipped)
            if not accounts and not skipped:
                params["warning"] = tr(
                    "Facebook 은 연동했지만 Instagram 프로페셔널 계정이 연결된 페이지를 찾지 못했습니다. "
                    "Instagram 앱에서 비즈니스/크리에이터 계정으로 전환하고 페이지에 연결해 주세요.",
                    lang,
                )
    except _Taken:
        return RedirectResponse(_profile_url(error=tr("이미 다른 회원에게 연동된 Instagram 계정입니다. 그 회원에서 연동을 해제한 뒤 다시 시도해 주세요.", lang)))
    except GraphError as exc:
        return RedirectResponse(_profile_url(error=str(exc)))

    current = account.id if account else session_payload(request.cookies.get(SESSION_COOKIE)).get("account_id")
    app_redirect = request.cookies.get(APP_REDIRECT_COOKIE) or ""
    if app_redirect and _allowed_app_redirect(app_redirect):
        # 앱이 연 연동 창: 2분짜리 일회용 코드를 앱으로 넘기고, 앱이 자기 화면에서 세션으로 바꿉니다.
        one_time = _app_signer().dumps({"uid": user.id, "sv": user.session_version, "account_id": current, **params})
        sep = "&" if "?" in app_redirect else "?"
        resp = RedirectResponse(f"{app_redirect}{sep}{urlencode({'code': one_time})}")
    else:
        resp = RedirectResponse(_profile_url(**params))
        set_session(resp, user, current if isinstance(current, int) else None)
    resp.delete_cookie(OAUTH_STATE_COOKIE)
    resp.delete_cookie(APP_REDIRECT_COOKIE)
    return resp


def _link_token(account: Account) -> str:
    from ..security import decrypt

    return decrypt(account.access_token_enc)


@router.get("/app-session")
def app_session(request: Request, code: str = Query(max_length=1000), db: Session = Depends(get_db)) -> Response:
    """앱 화면(WebView)에서 일회용 코드를 세션 쿠키로 바꿉니다."""
    try:
        payload = _app_signer().loads(code, max_age=120)
    except BadSignature:
        return RedirectResponse("/admin/profile?" + urlencode({"error": tr("연동 코드가 만료됐습니다. 다시 시도해 주세요.", lang_of(request))}))
    user = _user_from(db, payload)
    if user is None:
        return RedirectResponse("/login")
    params = {k: payload[k] for k in ("connected", "skipped", "warning") if payload.get(k)}
    resp = RedirectResponse("/admin/profile" + (f"?{urlencode(params)}" if params else ""), status_code=status.HTTP_303_SEE_OTHER)
    account_id = payload.get("account_id")
    set_session(resp, user, account_id if isinstance(account_id, int) else None)
    return resp


# ── 연동한 계정 ────────────────────────────────────────────────────────────


@router.get("/me")
def me(account: Account = Depends(current_account)) -> dict:
    return account_dict(account)


@router.get("/accounts")
def list_accounts(account: Account = Depends(current_account), user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """회원이 연동한 Instagram 계정들 (다시 로그인하지 않고 전환)."""
    return {"data": [{**account_dict(a), "current": a.id == account.id} for a in user_accounts(db, user)]}


class SwitchIn(BaseModel):
    account_id: int


@router.post("/switch")
def switch_account(body: SwitchIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JSONResponse:
    """회원이 연동한 다른 Instagram 계정으로 바꿉니다."""
    account = db.get(Account, body.account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "연동한 계정만 전환할 수 있습니다.")
    resp = JSONResponse({"ok": True})
    set_session(resp, user, account.id)
    return resp


@router.delete("/accounts/{account_id}")
def unlink_account(account_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JSONResponse:
    """Instagram 계정 연동 해제 — 그 계정의 토큰·게시물 작업·인사이트·댓글·자동 응답 기록을 모두 지웁니다."""
    account = db.get(Account, account_id)
    if account is None or account.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "계정을 찾을 수 없습니다.")
    account_data.delete_account(db, account)
    record = account_data.record_in_app(db)
    db.commit()
    resp = JSONResponse({"ok": True, "confirmation_code": record.code})
    current = session_payload(request.cookies.get(SESSION_COOKIE)).get("account_id")
    set_session(resp, user, None if current == account_id else current)
    return resp


@router.delete("/facebook")
def unlink_facebook(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """Facebook 연동 해제. Facebook 페이지로만 연결했던 Instagram 계정은 데이터와 함께 지우고,
    Instagram 로그인으로도 연동한 계정은 남기고 Facebook 페이지 정보만 뺍니다."""
    link = db.scalar(select(FacebookLink).where(FacebookLink.user_id == user.id))
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "연동된 Facebook 계정이 없습니다.")
    removed = []
    for account in user_accounts(db, user):
        if not account.fb_page_id:
            continue
        if account.provider == "facebook":
            removed.append(account.username)
            account_data.delete_account(db, account)
        else:
            account.fb_page_id = account.fb_page_name = account.fb_page_token_enc = ""
    db.delete(link)
    db.commit()
    return {"ok": True, "removed": removed}


# ── 로컬 개발 · Meta 콜백 · 로그아웃 ──────────────────────────────────────


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


DEV_EMAIL = "dev@localhost.test"


@router.get("/dev-login")
def dev_login(request: Request, db: Session = Depends(get_db)) -> Response:
    """로컬에서 메일·인스타 로그인 없이 화면을 확인하는 개발용 회원 (회원이 없는 계정을 모두 붙임)."""
    if not dev_login_enabled(request):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    from ..security import hash_password

    user = db.scalar(select(User).where(User.email == DEV_EMAIL))
    if user is None:
        user = User(email=DEV_EMAIL, password_hash=hash_password(secrets.token_hex(16)), name="개발용")
        db.add(user)
        db.commit()
    for account in db.scalars(select(Account).where(Account.user_id.is_(None))):
        account.user_id = user.id
    db.commit()
    resp = RedirectResponse("/admin", status_code=status.HTTP_303_SEE_OTHER)
    first = user_accounts(db, user)
    set_session(resp, user, first[0].id if first else None)
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
