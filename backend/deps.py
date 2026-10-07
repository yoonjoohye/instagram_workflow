from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Account, User
from .security import SESSION_COOKIE, decrypt, load_session
from .services.meta_graph import GraphClient

# 회원은 로그인했지만 Instagram 계정을 아직 연동하지 않음 → 화면이 '계정 연동' 안내를 띄웁니다.
NO_ACCOUNT = "인스타그램 계정을 먼저 연동해 주세요."


def session_payload(iaw_session: str | None) -> dict:
    return (load_session(iaw_session) if iaw_session else None) or {}


def current_user(
    db: Session = Depends(get_db),
    iaw_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    """세션: {"uid": 회원, "sv": 세션 버전, "account_id": 지금 고른 Instagram 계정}.
    비밀번호를 바꾸거나 탈퇴하면 세션 버전이 달라져 다른 기기의 로그인도 끊깁니다."""
    payload = session_payload(iaw_session)
    if not iaw_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.")
    user = db.get(User, payload["uid"]) if isinstance(payload.get("uid"), int) else None
    if user is None or payload.get("sv") != user.session_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 만료됐습니다. 다시 로그인하세요.")
    return user


def user_accounts(db: Session, user: User) -> list[Account]:
    return list(db.scalars(select(Account).where(Account.user_id == user.id).order_by(Account.id)))


def pick_account(db: Session, user: User, account_id: object) -> Account | None:
    """세션에 고른 계정이 이 회원 것이면 그 계정, 아니면 회원의 첫 계정."""
    account = db.get(Account, account_id) if isinstance(account_id, int) else None
    if account is not None and account.user_id == user.id:
        return account
    return db.scalar(select(Account).where(Account.user_id == user.id).order_by(Account.id).limit(1))


def current_account(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    iaw_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> Account:
    account = pick_account(db, user, session_payload(iaw_session).get("account_id"))
    if account is None:
        raise HTTPException(status.HTTP_409_CONFLICT, NO_ACCOUNT)
    return account


def graph_for(account: Account) -> GraphClient:
    try:
        token = decrypt(account.access_token_enc)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    return GraphClient(token, provider=account.provider or "instagram")
