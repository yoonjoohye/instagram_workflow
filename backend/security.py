"""토큰 암호화 + 쿠키 세션.

액세스 토큰은 장기 토큰(60일)이라 DB 에 평문으로 두지 않고 Fernet 으로 암호화해
저장합니다. 키는 APP_SECRET 에서 유도하므로 별도 키 관리가 필요 없습니다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
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


# ── 비밀번호 (scrypt, 표준 라이브러리) ─────────────────────────────────────
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        got = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), dklen=32, n=int(n), r=int(r), p=int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


def hash_code(email: str, purpose: str, code: str) -> str:
    """이메일 인증번호 해시 (APP_SECRET 으로 HMAC — DB 가 새어도 번호를 알 수 없게)."""
    msg = f"{purpose}:{email}:{code}".encode("utf-8")
    return hmac.new(settings.app_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
