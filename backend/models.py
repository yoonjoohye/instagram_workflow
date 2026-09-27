from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


class Account(Base):
    """Facebook 로그인으로 연결된 Instagram 프로페셔널 계정 하나."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    ig_user_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(128), default="")
    name: Mapped[str] = mapped_column(String(255), default="")
    profile_picture_url: Mapped[str] = mapped_column(Text, default="")
    followers_count: Mapped[int] = mapped_column(Integer, default=0)
    follows_count: Mapped[int] = mapped_column(Integer, default=0)
    media_count: Mapped[int] = mapped_column(Integer, default=0)

    fb_user_id: Mapped[str] = mapped_column(String(64), default="")
    fb_page_id: Mapped[str] = mapped_column(String(64), default="")
    fb_page_name: Mapped[str] = mapped_column(String(255), default="")

    # Fernet 으로 암호화된 페이지 액세스 토큰
    access_token_enc: Mapped[str] = mapped_column(Text)
    token_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    granted_scopes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    jobs: Mapped[list["GenerationJob"]] = relationship(back_populates="account")


class GenerationJob(Base):
    """프롬프트 → 미디어 + 캡션 생성 → 발행까지의 한 사이클."""

    __tablename__ = "generation_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)

    prompt: Mapped[str] = mapped_column(Text)
    media_kind: Mapped[str] = mapped_column(String(16))  # IMAGE | REELS | STORIES | CAROUSEL
    tone: Mapped[str] = mapped_column(String(64), default="친근한")
    language: Mapped[str] = mapped_column(String(16), default="ko")
    with_music: Mapped[int] = mapped_column(Integer, default=0)

    # draft → generating → ready → publishing → published | failed
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    provider: Mapped[str] = mapped_column(String(32), default="mock")
    error: Mapped[str] = mapped_column(Text, default="")

    caption: Mapped[str] = mapped_column(Text, default="")
    hashtags: Mapped[Any] = mapped_column(JSON, default=list)
    assets: Mapped[Any] = mapped_column(JSON, default=list)  # [{type,url,thumbnail_url,meta}]

    ig_container_id: Mapped[str] = mapped_column(String(64), default="")
    ig_media_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    permalink: Mapped[str] = mapped_column(Text, default="")
    published_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    account: Mapped[Account] = relationship(back_populates="jobs")


class InsightSnapshot(Base):
    """일자별 계정 인사이트. Meta 는 최근 2년치만 주므로 우리가 따로 쌓아둡니다."""

    __tablename__ = "insight_snapshots"
    __table_args__ = (
        UniqueConstraint("account_id", "date", name="uq_insight_account_date"),
        Index("ix_insight_account_date", "account_id", "date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    date: Mapped[dt.date] = mapped_column(Date)

    reach: Mapped[int] = mapped_column(Integer, default=0)
    profile_views: Mapped[int] = mapped_column(Integer, default=0)
    accounts_engaged: Mapped[int] = mapped_column(Integer, default=0)
    total_interactions: Mapped[int] = mapped_column(Integer, default=0)
    website_clicks: Mapped[int] = mapped_column(Integer, default=0)
    followers_count: Mapped[int] = mapped_column(Integer, default=0)
    # reach 외 지표는 API 가 일자별로 주지 않아 하루 단위 합계로 따로 채웁니다.
    # 1 이면 그 날의 profile_views 등이 실제 값(0 포함), 0 이면 아직 수집 전.
    totals_synced: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class KnownVisitor(Base):
    """프로필과 실제로 상호작용한 계정(댓글/멘션 작성자).

    Meta 는 '누가 내 프로필을 봤는지'를 제공하지 않습니다(개인정보 정책).
    확인 가능한 최대치는 이렇게 흔적을 남긴 계정입니다.
    """

    __tablename__ = "known_visitors"
    __table_args__ = (
        UniqueConstraint("account_id", "ig_username", name="uq_visitor_account_username"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)

    ig_username: Mapped[str] = mapped_column(String(128))
    source: Mapped[str] = mapped_column(String(32), default="comment")  # comment | mention
    interactions: Mapped[int] = mapped_column(Integer, default=1)
    last_text: Mapped[str] = mapped_column(Text, default="")
    last_media_id: Mapped[str] = mapped_column(String(64), default="")
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
