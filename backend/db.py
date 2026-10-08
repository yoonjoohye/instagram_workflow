"""SQLAlchemy 엔진/세션.

로컬은 SQLite, Vercel 배포는 Postgres(Neon) — DATABASE_URL 만 바꾸면 됩니다.
서버리스에서는 커넥션을 재사용하면 안 되므로 Postgres 일 때 NullPool 을 씁니다.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings
from .models import Base


def _normalize(url: str) -> str:
    # Neon/Vercel 이 주는 postgres:// 형식을 psycopg3 드라이버로 맞춰줍니다.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


_url = _normalize(settings.database_url)
_is_sqlite = _url.startswith("sqlite")

engine = create_engine(
    _url,
    future=True,
    pool_pre_ping=not _is_sqlite,
    poolclass=None if _is_sqlite else NullPool,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# create_all 은 기존 테이블에 컬럼을 추가하지 않으므로, 나중에 생긴 컬럼은 여기서 보강합니다.
_ADDED_COLUMNS = {
    "insight_snapshots": {"totals_synced": "INTEGER DEFAULT 0"},
    "generation_jobs": {"plan": "JSON"},
    "users": {"birth_date": "DATE", "phone": "VARCHAR(20) DEFAULT ''", "filter_presets": "JSON"},
    "accounts": {
        "user_id": "INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "provider": "VARCHAR(16) DEFAULT 'instagram'",
        "fb_page_token_enc": "TEXT DEFAULT ''",
    },
    "media_blobs": {"url": "TEXT DEFAULT ''", "cover_id": "VARCHAR(40) DEFAULT ''"},
    "auto_reply_rules": {
        "public_reply_enabled": "INTEGER DEFAULT 1",
        "dm_enabled": "INTEGER DEFAULT 0",
        "enabled_at": "TIMESTAMP WITH TIME ZONE",
        "post_caption": "TEXT DEFAULT ''",
        "post_thumbnail": "TEXT DEFAULT ''",
        "post_permalink": "TEXT DEFAULT ''",
    },
}


# 컬럼이 새로 생길 때 한 번만 실행하는 값 채우기 (기존 규칙의 동작을 유지)
_BACKFILL = {
    ("auto_reply_rules", "public_reply_enabled"): (
        "UPDATE auto_reply_rules SET public_reply_enabled = "
        "CASE WHEN public_reply <> '' THEN 1 ELSE 0 END"
    ),
    # 기존 규칙은 마이그레이션 시점부터 새 댓글로 간주
    ("auto_reply_rules", "enabled_at"): "UPDATE auto_reply_rules SET enabled_at = CURRENT_TIMESTAMP WHERE enabled = 1",
    # 회원 기능 이전에 연결된 계정: 그때의 로그인 방식(Facebook 페이지가 있으면 facebook)
    ("accounts", "provider"): "UPDATE accounts SET provider = CASE WHEN fb_page_id <> '' THEN 'facebook' ELSE 'instagram' END",
    ("auto_reply_rules", "dm_enabled"): (
        "UPDATE auto_reply_rules SET dm_enabled = "
        "CASE WHEN link_url <> '' OR link_message <> '' THEN 1 ELSE 0 END"
    ),
}


def init_db() -> None:
    """마이그레이션 도구 없이 쓸 수 있도록 기동 시 테이블을 보장합니다."""
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                    if (table, name) in _BACKFILL:
                        conn.execute(text(_BACKFILL[(table, name)]))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
