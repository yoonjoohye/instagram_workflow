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
    META_APP_ID="",
    META_APP_SECRET="",
    RESEND_API_KEY="",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.db import SessionLocal, init_db  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models import Account, User  # noqa: E402
from backend.security import SESSION_COOKIE, encrypt, hash_password, sign_session  # noqa: E402

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
def login(client, db):
    """client 를 그 계정의 회원으로 로그인시킵니다: login(account, linked=[...]).
    계정에 회원이 없으면 테스트용 회원을 만들어 계정들을 붙입니다 (테스트 끝나면 회원 삭제)."""
    import secrets

    made: list[int] = []

    def _login(acc, linked=None):
        acc = db.get(Account, acc.id)
        user = db.get(User, acc.user_id) if acc.user_id else None
        if user is None:
            user = User(email=f"t{secrets.token_hex(4)}@test.dev", password_hash=hash_password("pass1234"), name="T")
            db.add(user)
            db.commit()
            made.append(user.id)
        for account_id in [acc.id, *(linked or [])]:
            db.get(Account, account_id).user_id = user.id
        db.commit()
        client.cookies.set(SESSION_COOKIE, sign_session({"uid": user.id, "sv": user.session_version, "account_id": acc.id}))
        return client

    yield _login
    for user_id in made:
        user = db.get(User, user_id)
        if user is not None:
            db.delete(user)
    db.commit()
