from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .db import get_db
from .models import Account
from .security import SESSION_COOKIE, decrypt, load_session
from .services.meta_graph import GraphClient


def current_account(
    db: Session = Depends(get_db),
    iaw_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> Account:
    if not iaw_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다.")
    payload = load_session(iaw_session)
    if not payload or "account_id" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 만료됐습니다. 다시 로그인하세요.")
    account = db.get(Account, payload["account_id"])
    if not account:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "계정을 찾을 수 없습니다.")
    return account


def graph_for(account: Account) -> GraphClient:
    try:
        token = decrypt(account.access_token_enc)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    return GraphClient(token)
