from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

MediaKind = Literal["IMAGE", "CAROUSEL", "REELS", "STORIES"]


class GenerateIn(BaseModel):
    prompt: str = Field(min_length=2, max_length=2000)
    media_kind: MediaKind = "IMAGE"
    count: int = Field(default=1, ge=1, le=10)
    aspect_ratio: Literal["1:1", "4:5", "9:16", "16:9"] = "4:5"
    tone: str = Field(default="친근한", max_length=64)
    language: str = Field(default="ko", max_length=16)
    with_music: bool = False
    style: str = Field(default="", max_length=200)


class JobPatch(BaseModel):
    caption: str | None = None
    hashtags: list[str] | None = None
    assets: list[dict] | None = None


class PublishIn(BaseModel):
    job_id: int
    share_to_feed: bool = True
