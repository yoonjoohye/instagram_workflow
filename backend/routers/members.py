"""회원: 이메일 인증 회원가입 · 로그인 · 비밀번호 재설정 · 프로필 · 탈퇴.

Instagram·Facebook 계정 연동은 routers/auth.py (OAuth) 에서 합니다.
"""
from __future__ import annotations

import datetime as dt
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_user, pick_account, session_payload, user_accounts
from ..i18n import lang_of
from ..models import Account, EmailCode, FacebookLink, User, utcnow
from ..security import SESSION_COOKIE, SESSION_MAX_AGE, hash_code, hash_password, sign_session, verify_password
from ..services import account_data, mailer

router = APIRouter(prefix="/auth", tags=["members"])

CODE_TTL = dt.timedelta(minutes=10)
CODE_COOLDOWN = dt.timedelta(seconds=60)  # 같은 메일로 다시 보내기까지
CODE_PER_HOUR = 5
CODE_MAX_ATTEMPTS = 5
LOCK_AFTER = 10  # 비밀번호를 이만큼 틀리면
LOCK_FOR = dt.timedelta(minutes=15)

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
# 없는 이메일로 로그인할 때도 비슷한 시간이 걸리게 (가입 여부를 시간으로 알 수 없게)
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def _aware(t: dt.datetime | None) -> dt.datetime | None:
    """SQLite 는 시간대 없이 돌려주므로 UTC 로 맞춥니다."""
    return t.replace(tzinfo=dt.timezone.utc) if t is not None and t.tzinfo is None else t


def _secure() -> bool:
    return settings.public_base_url.startswith("https://")


def norm_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not _EMAIL.match(email):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "이메일 주소를 확인해 주세요.")
    return email


def check_password(password: str) -> None:
    if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "비밀번호는 영문과 숫자를 섞어 8자 이상으로 정해 주세요.")


def set_session(resp: Response, user: User, account_id: int | None) -> None:
    resp.set_cookie(
        SESSION_COOKIE,
        sign_session({"uid": user.id, "sv": user.session_version, "account_id": account_id}),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=_secure(),
        path="/",
    )


def claim_legacy_accounts(db: Session, request: Request, user: User) -> list[Account]:
    """회원 기능 전에 인스타 로그인으로 쓰던 브라우저: 그 세션의 계정(아직 회원이 없는 것만)을 이 회원으로 옮깁니다.
    세션 쿠키는 서명돼 있어 목록을 위조할 수 없습니다."""
    payload = session_payload(request.cookies.get(SESSION_COOKIE))
    if "uid" in payload:
        return []
    ids = [i for i in [payload.get("account_id"), *payload.get("linked", [])] if isinstance(i, int)]
    claimed = []
    for account_id in dict.fromkeys(ids):
        account = db.get(Account, account_id)
        if account is not None and account.user_id is None:
            account.user_id = user.id
            claimed.append(account)
    db.commit()
    return claimed


# ── 인증번호 ───────────────────────────────────────────────────────────────


def _issue_code(db: Session, email: str, purpose: str, lang: str) -> dict:
    now = utcnow()
    recent = db.scalars(
        select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose).order_by(EmailCode.id.desc())
    ).all()
    if recent and now - _aware(recent[0].created_at) < CODE_COOLDOWN:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "인증번호를 방금 보냈습니다. 1분 뒤에 다시 요청해 주세요.")
    if sum(1 for c in recent if now - _aware(c.created_at) < dt.timedelta(hours=1)) >= CODE_PER_HOUR:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "인증번호 요청이 너무 많습니다. 1시간 뒤에 다시 시도해 주세요.")
    code = f"{secrets.randbelow(10**6):06d}"
    # 새 번호를 보내면 이전 번호는 쓸 수 없게 (보내기 횟수 제한을 위해 기록은 만료로만 남김)
    for c in recent:
        c.expires_at = now
    db.add(EmailCode(email=email, purpose=purpose, code_hash=hash_code(email, purpose, code), expires_at=now + CODE_TTL))
    db.commit()
    try:
        mailer.send_code(email, code, purpose, lang)
    except mailer.MailError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    out: dict = {"sent": True, "expires_in": int(CODE_TTL.total_seconds())}
    if mailer.can_show_code_locally():
        out["dev_code"] = code  # 로컬 개발 전용 (메일 설정이 없을 때)
    return out


def _use_code(db: Session, email: str, purpose: str, code: str) -> None:
    row = db.scalar(
        select(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose).order_by(EmailCode.id.desc()).limit(1)
    )
    if row is None or _aware(row.expires_at) <= utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "인증번호가 만료됐습니다. 다시 받아 주세요.")
    if row.attempts >= CODE_MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "인증번호를 너무 많이 틀렸습니다. 새 번호를 받아 주세요.")
    if not secrets.compare_digest(row.code_hash, hash_code(email, purpose, code.strip())):
        row.attempts += 1
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "인증번호가 맞지 않습니다.")
    db.execute(delete(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose))
    db.commit()


class EmailIn(BaseModel):
    email: str = Field(max_length=254)


class SignupIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(min_length=6, max_length=6)
    password: str = Field(max_length=128)
    name: str = Field(default="", max_length=80)


class SigninIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class ResetIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(min_length=6, max_length=6)
    password: str = Field(max_length=128)


@router.post("/signup/code")
def signup_code(body: EmailIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """회원가입 1단계: 이메일로 6자리 인증번호를 보냅니다."""
    email = norm_email(body.email)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다. 로그인해 주세요.")
    return _issue_code(db, email, "signup", lang_of(request))


@router.post("/signup")
def signup(body: SignupIn, request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """회원가입 2단계: 인증번호 확인 + 비밀번호 → 가입하고 바로 로그인."""
    email = norm_email(body.email)
    check_password(body.password)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입된 이메일입니다. 로그인해 주세요.")
    _use_code(db, email, "signup", body.code)
    user = User(email=email, password_hash=hash_password(body.password), name=body.name.strip(), email_verified_at=utcnow())
    db.add(user)
    db.commit()
    claimed = claim_legacy_accounts(db, request, user)
    resp = JSONResponse(session_dict(db, user, claimed[0] if claimed else None), status_code=status.HTTP_201_CREATED)
    set_session(resp, user, claimed[0].id if claimed else None)
    return resp


@router.post("/signin")
def signin(body: SigninIn, request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.locked_until and _aware(user.locked_until) > utcnow():
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "비밀번호를 여러 번 틀려 잠시 잠겼습니다. 15분 뒤에 다시 시도하거나 비밀번호를 재설정해 주세요.")
    if user is None:
        verify_password(body.password, _DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "이메일 또는 비밀번호가 맞지 않습니다.")
    if not verify_password(body.password, user.password_hash):
        user.failed_logins += 1
        if user.failed_logins >= LOCK_AFTER:
            user.failed_logins, user.locked_until = 0, utcnow() + LOCK_FOR
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "이메일 또는 비밀번호가 맞지 않습니다.")
    user.failed_logins, user.locked_until = 0, None
    db.commit()
    claimed = claim_legacy_accounts(db, request, user)
    account = claimed[0] if claimed else pick_account(db, user, None)
    resp = JSONResponse(session_dict(db, user, account))
    set_session(resp, user, account.id if account else None)
    return resp


@router.post("/password/code")
def password_code(body: EmailIn, request: Request, db: Session = Depends(get_db)) -> dict:
    """비밀번호 재설정 1단계. 가입 여부는 알려 주지 않습니다 (가입한 이메일이면 메일이 감)."""
    email = norm_email(body.email)
    if db.scalar(select(User.id).where(User.email == email)) is None:
        return {"sent": True, "expires_in": int(CODE_TTL.total_seconds())}
    return _issue_code(db, email, "reset", lang_of(request))


@router.post("/password/reset")
def password_reset(body: ResetIn, db: Session = Depends(get_db)) -> JSONResponse:
    """비밀번호 재설정 2단계: 인증번호 확인 → 새 비밀번호 → 다른 기기 로그아웃 → 이 브라우저는 로그인."""
    email = norm_email(body.email)
    check_password(body.password)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "인증번호가 만료됐습니다. 다시 받아 주세요.")
    _use_code(db, email, "reset", body.code)
    user.password_hash = hash_password(body.password)
    user.session_version += 1
    user.failed_logins, user.locked_until = 0, None
    db.commit()
    account = pick_account(db, user, None)
    resp = JSONResponse(session_dict(db, user, account))
    set_session(resp, user, account.id if account else None)
    return resp


# ── 로그인한 회원 ──────────────────────────────────────────────────────────


def account_dict(a: Account) -> dict:
    return {
        "id": a.id,
        "ig_user_id": a.ig_user_id,
        "username": a.username,
        "name": a.name,
        "profile_picture_url": a.profile_picture_url,
        "followers_count": a.followers_count,
        "follows_count": a.follows_count,
        "media_count": a.media_count,
        "fb_page_name": a.fb_page_name,
        "provider": a.provider or "instagram",
        "facebook_linked": bool(a.fb_page_id),
        "granted_scopes": a.granted_scopes.split(",") if a.granted_scopes else [],
        "token_expires_at": a.token_expires_at.isoformat() if a.token_expires_at else None,
    }


def session_dict(db: Session, user: User, account: Account | None) -> dict:
    fb = db.scalar(select(FacebookLink).where(FacebookLink.user_id == user.id))
    return {
        "user": {"id": user.id, "email": user.email, "name": user.name, "created_at": user.created_at.isoformat()},
        "account": account_dict(account) if account else None,
        "accounts": [{**account_dict(a), "current": account is not None and a.id == account.id} for a in user_accounts(db, user)],
        "facebook": {"name": fb.name, "pages": fb.pages or [], "linked_at": fb.created_at.isoformat()} if fb else None,
        "can_link": {"instagram": settings.instagram_configured, "facebook": settings.facebook_configured},
    }


@router.get("/session")
def get_session(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    """회원 정보 + 지금 고른 Instagram 계정(없으면 null) + 연동한 계정들 + Facebook 연동."""
    account = pick_account(db, user, session_payload(request.cookies.get(SESSION_COOKIE)).get("account_id"))
    return session_dict(db, user, account)


class ProfileIn(BaseModel):
    name: str = Field(max_length=80)


@router.patch("/profile")
def update_profile(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    user.name = body.name.strip()
    db.commit()
    return {"id": user.id, "email": user.email, "name": user.name}


class PasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


@router.post("/password")
def change_password(body: PasswordIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JSONResponse:
    """비밀번호 변경. 다른 기기는 로그아웃되고 이 브라우저는 로그인 유지."""
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "지금 비밀번호가 맞지 않습니다.")
    check_password(body.new_password)
    user.password_hash = hash_password(body.new_password)
    user.session_version += 1
    db.commit()
    resp = JSONResponse({"ok": True})
    set_session(resp, user, session_payload(request.cookies.get(SESSION_COOKIE)).get("account_id"))
    return resp


class WithdrawIn(BaseModel):
    password: str = Field(max_length=128)


@router.delete("/user")
def withdraw(body: WithdrawIn, user: User = Depends(current_user), db: Session = Depends(get_db)) -> JSONResponse:
    """회원 탈퇴: 연동한 Instagram 계정의 모든 데이터(토큰·게시물 작업·인사이트·댓글 기록·자동 응답), Facebook 연동,
    회원 정보를 모두 지웁니다. 되돌릴 수 없어 비밀번호를 한 번 더 확인합니다."""
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "비밀번호가 맞지 않습니다.")
    for account in user_accounts(db, user):
        account_data.delete_account(db, account)
    db.execute(delete(FacebookLink).where(FacebookLink.user_id == user.id))
    db.execute(delete(EmailCode).where(EmailCode.email == user.email))
    db.delete(user)
    record = account_data.record_in_app(db)
    db.commit()
    resp = JSONResponse({"ok": True, "confirmation_code": record.code})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp
