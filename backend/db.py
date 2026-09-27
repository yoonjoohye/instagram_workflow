"""SQLAlchemy 엔진/세션.

로컬은 SQLite, Vercel 배포는 Postgres(Neon) — DATABASE_URL 만 바꾸면 됩니다.
서버리스에서는 커넥션을 재사용하면 안 되므로 Postgres 일 때 NullPool 을 씁니다.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
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


def init_db() -> None:
    """마이그레이션 도구 없이 쓸 수 있도록 기동 시 테이블을 보장합니다."""
    Base.metadata.create_all(engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
