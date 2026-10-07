"""Gemini API 호출: 텍스트(구성·조사)는 여러 모델을 돌아가며 재시도하고, 이미지는 예비 모델로 한 번 더 시도합니다."""
from __future__ import annotations

import base64
import io
import logging
import time
from typing import Any

import httpx
from PIL import Image

from ...config import settings
from .imaging import to_jpeg

log = logging.getLogger(__name__)


GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


CREDITS_DEPLETED = "Gemini 선불 크레딧이 모두 소진됐습니다. Google AI Studio(https://ai.studio/projects)에서 결제·충전을 확인해 주세요."


class GeminiError(RuntimeError):
    pass


LEGACY_IMAGE_MODEL = "gemini-2.5-flash-image"  # 설정한 이미지 모델을 쓸 수 없을 때 한 번 더 시도


def call(
    model: str,
    parts: list[dict[str, Any]],
    generation_config: dict[str, Any] | None = None,
    *,
    tools: list[dict[str, Any]] | None = None,
    timeout: float = 50.0,
) -> dict:
    if not settings.gemini_api_key:
        raise GeminiError("GEMINI_API_KEY 가 설정되지 않았습니다.")
    body: dict[str, Any] = {"contents": [{"role": "user", "parts": parts}]}
    if generation_config:
        body["generationConfig"] = generation_config
    if tools:
        body["tools"] = tools
    try:
        resp = httpx.post(
            GEMINI_URL.format(model=model),
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=body,
            timeout=timeout,
        )
        data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GeminiError(f"Gemini 연결 실패: {exc}") from exc
    if resp.status_code >= 400:
        message = (data.get("error") or {}).get("message") or f"Gemini 오류 ({resp.status_code})"
        if "credits are depleted" in message:  # 선불 결제를 썼는데 잔액이 없을 때 — 모든 모델이 같으므로 바로 알림
            raise GeminiError(CREDITS_DEPLETED)
        raise GeminiError(message)
    return data


TEXT_FALLBACK_MODELS = ("gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest")


_TRANSIENT = ("high demand", "overloaded", "unavailable", "try again", "quota", "exhausted", "rate", "deadline", "timed out", "연결 실패", "not found", "no longer available", "not supported")


# 최근에 응답하지 않거나 혼잡했던 모델은 잠시 건너뜁니다 (같은 서버 인스턴스 안에서).
_COOLDOWN_SEC = 300


_cooldown: dict[str, float] = {}


# 앞 모델이 멈춰 있어도 뒤 모델을 시도할 시간이 남도록, 마지막이 아닌 시도는 이 시간까지만 기다립니다.
ATTEMPT_CAP_SEC = 25.0


def text_call(
    parts: list[dict[str, Any]], generation_config: dict[str, Any], *, tools=None, budget: float = 55.0, attempt_cap: float = ATTEMPT_CAP_SEC
) -> dict:
    """구성·조사용 텍스트 호출. 혼잡·한도·무응답이면 다른 텍스트 모델로 다시 시도합니다 (Vercel 60초 안에서)."""
    models = list(dict.fromkeys((settings.gemini_text_model, *TEXT_FALLBACK_MODELS)))
    now = time.monotonic()
    fresh = [m for m in models if _cooldown.get(m, 0) <= now]
    # 모두 쉬는 중이면 원래 순서대로 다시 시도
    order = fresh or models
    deadline = now + budget
    last: Exception | None = None
    for i, model in enumerate(order):
        remaining = deadline - time.monotonic()
        if remaining < 8:
            break
        is_last = i == len(order) - 1
        timeout = remaining if is_last else min(remaining - 8, attempt_cap)
        try:
            data = call(model, parts, generation_config, tools=tools, timeout=timeout)
            _cooldown.pop(model, None)
            return data
        except GeminiError as exc:
            last = exc
            log.warning("gemini text %s failed: %s", model, exc)
            if not any(k in str(exc).lower() for k in _TRANSIENT):
                break
            _cooldown[model] = time.monotonic() + _COOLDOWN_SEC
    raise GeminiError(str(last or "Gemini 시간 초과"))


def is_busy(exc: Exception) -> bool:
    return any(k in str(exc).lower() for k in ("high demand", "overloaded", "unavailable", "try again", "rate limit", "quota", "exhausted"))


def parts_of(data: dict) -> list[dict[str, Any]]:
    try:
        return data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as exc:
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "응답이 비어 있습니다"
        raise GeminiError(f"Gemini 응답 없음: {reason}") from exc


def text_of(data: dict) -> str:
    return "".join(p.get("text", "") for p in parts_of(data)).strip()


def image_call(parts: list[dict[str, Any]], aspect: str) -> bytes:
    cfg = {"responseModalities": ["IMAGE", "TEXT"], "imageConfig": {"aspectRatio": aspect}}
    models = [settings.gemini_image_model]
    if settings.gemini_image_model != LEGACY_IMAGE_MODEL:
        models.append(LEGACY_IMAGE_MODEL)
    last: Exception | None = None
    for model in models:
        try:
            data = call(model, parts, cfg, timeout=55.0)
            for part in parts_of(data):
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    return to_jpeg(Image.open(io.BytesIO(base64.b64decode(inline["data"]))).convert("RGB"))
            raise GeminiError("이미지가 응답에 없습니다.")
        except GeminiError as exc:
            last = exc
            # 모델이 없거나 할당량이 없으면 다른 이미지 모델로 한 번 더 시도합니다.
            msg = str(exc).lower()
            if not any(k in msg for k in ("not found", "not supported", "quota", "exhausted")):
                break
    raise GeminiError(str(last))
