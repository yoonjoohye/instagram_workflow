"""인스타그램 음악 추천 (게시물 구성 때 함께, 또는 분위기를 적어 다시 추천)."""
from __future__ import annotations

import json
from typing import Any

from ...i18n import LANG_NAME
from . import gemini
from .gemini import GeminiError
from .textutil import clip

MUSIC_RULES = """

음악 추천 (music)
- 이 게시물에 어울리는 곡을 5개 추천해. 인스타그램 음악 보관함에서 찾을 수 있는, 실제로 존재하는 잘 알려진 곡만.
  제목·가수를 정확히 모르면 넣지 마 (지어내면 안 돼). 게시물의 언어권·분위기·[연출 방향]에 맞춰 다양하게.
- title·artist 는 공식 표기 그대로. reason 은 왜 어울리는지 한 줄, section 은 쓰기 좋은 구간(예: '후렴 0:45~1:00').
  reason·section 은 {ui_lang} 로."""


def clean_music(raw: Any) -> list[dict[str, str]]:
    out = []
    for m in raw or []:
        if isinstance(m, dict) and str(m.get("title") or "").strip() and str(m.get("artist") or "").strip():
            out.append({k: clip(m.get(k), 120) for k in ("title", "artist", "reason", "section")})
    return out[:6]


_MUSIC_SUGGEST_PROMPT = """너는 인스타그램 음악 큐레이터야. 아래 게시물에 어울리는 곡 5개를 추천해.
Google 검색으로 실제로 존재하고 인스타그램 음악 보관함에서 흔히 쓰이는 곡인지 확인하고, 확인되지 않은 곡은 빼.

게시물 주제: {topic}
캡션: {caption}
사용자 요청(분위기·장르·언어 등, 최우선): {hint}
이미 추천한 곡(겹치지 않게): {exclude}

JSON 배열만 출력해 (설명·코드블록 없이):
[{{"title": "공식 곡 제목", "artist": "가수", "reason": "{ui_lang} 로 한 줄", "section": "{ui_lang} 로 쓰기 좋은 구간"}}]"""


def suggest_music(topic: str, caption: str, hint: str = "", exclude: list[str] | None = None, *, language: str = "ko") -> list[dict[str, str]]:
    """음악 다시 추천 (사용자 요청 반영). Gemini 실패 시 GeminiError."""
    text = _MUSIC_SUGGEST_PROMPT.format(
        topic=topic[:500], caption=caption[:800], hint=hint.strip()[:300] or "없음",
        exclude=", ".join(exclude or [])[:600] or "없음", ui_lang=LANG_NAME.get(language, "English"),
    )
    data = gemini.text_call([{"text": text}], {"temperature": 0.8}, tools=[{"googleSearch": {}}])
    raw = gemini.text_of(data)
    start, end = raw.find("["), raw.rfind("]")
    try:
        items = json.loads(raw[start : end + 1]) if start >= 0 and end > start else []
    except ValueError as exc:
        raise GeminiError(f"Gemini 응답을 읽지 못했습니다: {exc}") from exc
    return clean_music(items)[:5]
