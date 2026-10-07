"""캡션 다시 쓰기: 사용자의 요청(예: '더 짧게', '이모지 많이', '영어로')대로, 처음 정한 캡션 양식을 지켜 다시 씁니다."""
from __future__ import annotations

import json

from ...i18n import LANG_NAME
from . import gemini
from .captions import (
    FREE_RULES,
    INSTRUCTION_RULES,
    TEMPLATE_RULES,
    fill_template,
    placeholders,
)
from .gemini import GeminiError

_REWRITE_PROMPT = """너는 인스타그램 캡션 작가야. 아래 게시물의 캡션을 사용자의 요청대로 다시 써.

[게시물 주제] {topic}
[연출 방향] {style}
[지금 캡션]
{caption}

[사용자의 요청 — 가장 우선] {instruction}

규칙
- 요청에 언어 지정이 없으면 지금 캡션의 언어를 유지해.
- 지금 캡션에 있는 사실(장소·가격·코드·링크 등)은 바꾸거나 지어내지 마. 요청이 없으면 빼지도 마.
- 해시태그는 caption_parts 에 넣지 말고 hashtags 배열(# 없이 8~15개)로. 요청에 맞게 새로 골라.
{caption_rules}"""


def rewrite_caption(
    *, topic: str, style: str, caption: str, instruction: str, caption_format: str, language: str = "ko"
) -> dict:
    """{'caption', 'hashtags', 'hashtags_inline'} — 실패하면 GeminiError."""
    template = caption_format.strip()
    names = [p for p in placeholders(template) if "해시태그" not in p and "hashtag" not in p.lower()]
    if names:
        rules = TEMPLATE_RULES.format(k=len(names), names=", ".join(f"[{x}]" for x in names), template=template)
    elif template:
        rules = INSTRUCTION_RULES.format(request=template)
    else:
        rules = FREE_RULES
    text = _REWRITE_PROMPT.format(
        topic=topic[:500] or "없음",
        style=style[:800] or "없음",
        caption=caption[:2200] or "(비어 있음)",
        instruction=instruction.strip()[:500] or "더 자연스럽고 읽기 좋게",
        caption_rules=rules,
    ) + f"\n\n(사용자 화면 언어: {LANG_NAME.get(language, 'English')})"
    schema = {
        "type": "OBJECT",
        "properties": {
            "caption_parts": {"type": "ARRAY", "items": {"type": "STRING"}},
            "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["caption_parts", "hashtags"],
    }
    data = gemini.text_call(
        [{"text": text}], {"temperature": 0.8, "responseMimeType": "application/json", "responseSchema": schema}, budget=50.0
    )
    try:
        raw = json.loads(gemini.text_of(data))
    except ValueError as exc:
        raise GeminiError(f"Gemini 응답을 읽지 못했습니다: {exc}") from exc
    parts = [str(p) for p in raw.get("caption_parts") or []]
    hashtags = [str(h).lstrip("#").strip() for h in raw.get("hashtags") or [] if str(h).strip()][:30]
    if names:
        full, j = [], 0
        for name in placeholders(template):
            if "해시태그" in name or "hashtag" in name.lower():
                full.append("")
            else:
                full.append(parts[j] if j < len(parts) else "")
                j += 1
        new_caption, inline = fill_template(template, full, hashtags)
    else:
        new_caption, inline = "\n".join(parts).strip(), False
    return {"caption": new_caption[:2200], "hashtags": [] if inline else hashtags, "hashtags_inline": inline}
