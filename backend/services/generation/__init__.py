"""엔진 선택: Higgsfield 가 설정돼 있으면 그쪽, 실패하거나 없으면 mock."""
from __future__ import annotations

from .base import Asset, GenerationError, GenerationRequest
from .caption import compose_caption, generate_caption
from .higgsfield import HiggsfieldEngine
from .mock import MockEngine

__all__ = [
    "Asset",
    "GenerationError",
    "GenerationRequest",
    "compose_caption",
    "generate_caption",
    "generate_media",
    "active_engine_name",
]

_higgsfield = HiggsfieldEngine()
_mock = MockEngine()


def active_engine_name() -> str:
    return _higgsfield.name if _higgsfield.available() else _mock.name


def generate_media(req: GenerationRequest) -> tuple[list[Asset], str, str]:
    """(에셋, 사용된 엔진명, 경고메시지) 를 돌려줍니다."""
    if _higgsfield.available():
        try:
            return _higgsfield.generate(req), _higgsfield.name, ""
        except GenerationError as exc:
            # 키는 있는데 모델 경로/쿼터 문제인 경우 — 흐름을 막지 않고 목업으로 계속합니다.
            return _mock.generate(req), _mock.name, f"Higgsfield 실패로 목업 사용: {exc}"
    return _mock.generate(req), _mock.name, ""
