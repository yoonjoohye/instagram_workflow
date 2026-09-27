"""토큰 암호화 + 쿠키 세션.

액세스 토큰은 장기 토큰(60일)이라 DB 에 평문으로 두지 않고 Fernet 으로 암호화해
저장합니다. 키는 APP_SECRET 에서 유도하므로 별도 키 관리가 필요 없습니다.
"""
from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .config import settings

SESSION_COOKIE = "iaw_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 14  # 14일


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.app_secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:  # APP_SECRET 이 바뀌면 기존 토큰은 복호화 불가
        raise ValueError("저장된 토큰을 복호화할 수 없습니다. 다시 로그인하세요.") from exc


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.app_secret, salt="iaw-session")


def sign_session(payload: dict[str, Any]) -> str:
    return _serializer().dumps(payload)


def load_session(token: str) -> dict[str, Any] | None:
    try:
        return _serializer().loads(token, max_age=SESSION_MAX_AGE)
    except BadSignature:
        return None
