"""테스트 공통 설정: 실제 DB·외부 API 를 건드리지 않도록 임시 SQLite 와 가짜 키를 씁니다.

환경변수는 앱을 import 하기 전에 정해야 하므로 이 파일 맨 위에서 설정합니다 (.env 보다 우선).
"""
from __future__ import annotations

import os
import tempfile

_DB = os.path.join(tempfile.mkdtemp(prefix="iaw-test-"), "test.db")
os.environ.update(
    DATABASE_URL=f"sqlite:///{_DB}",
    APP_SECRET="test-secret-" + "x" * 32,
    GEMINI_API_KEY="test-gemini-key",  # 네트워크 호출은 모든 테스트에서 가짜로 바꿉니다
    INSTAGRAM_APP_ID="1",
    INSTAGRAM_APP_SECRET="test-ig-secret",
    PUBLIC_BASE_URL="https://testserver",
    DEV_LOGIN="0",
    BLOB_READ_WRITE_TOKEN="",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.db import SessionLocal, init_db  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models import Account  # noqa: E402
from backend.security import SESSION_COOKIE, encrypt, sign_session  # noqa: E402

init_db()


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def account(db):
    """테스트용 연결 계정 (테스트가 끝나면 삭제)."""
    import secrets

    acc = Account(
        ig_user_id=str(secrets.randbelow(10**15)),
        username="tester_" + secrets.token_hex(3),
        name="Tester",
        access_token_enc=encrypt("fake-token"),
        profile_picture_url="",
    )
    db.add(acc)
    db.commit()
    yield acc
    from backend.services import account_data

    if db.get(Account, acc.id) is not None:
        account_data.delete_account(db, acc)
        db.commit()


@pytest.fixture
def client():
    return TestClient(app, base_url="https://testserver")


@pytest.fixture
def login(client):
    """client 를 그 계정으로 로그인시킵니다: login(account, linked=[...])"""

    def _login(acc, linked=None):
        client.cookies.set(SESSION_COOKIE, sign_session({"account_id": acc.id, "linked": linked or [acc.id]}))
        return client

    return _login
