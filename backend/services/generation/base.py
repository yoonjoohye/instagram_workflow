"""생성 엔진 공통 인터페이스.

엔진을 갈아끼워도 워크플로우 코드는 그대로 두기 위한 얇은 추상화입니다.
모든 엔진은 '공개적으로 접근 가능한 URL' 을 반환해야 합니다 —
Instagram 의 /media 엔드포인트가 image_url / video_url 로 직접 받아가기 때문입니다.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Protocol


@dataclass(slots=True)
class Asset:
    type: str  # image | video | audio
    url: str
    thumbnail_url: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class GenerationRequest:
    prompt: str
    media_kind: str = "IMAGE"  # IMAGE | REELS | STORIES | CAROUSEL
    count: int = 1
    aspect_ratio: str = "4:5"
    with_music: bool = False
    style: str = ""


class MediaEngine(Protocol):
    name: str

    def available(self) -> bool: ...

    def generate(self, req: GenerationRequest) -> list[Asset]: ...


class GenerationError(RuntimeError):
    pass
