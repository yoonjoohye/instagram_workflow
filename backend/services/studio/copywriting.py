"""캡션 다시 쓰기(사용자의 요청대로, 처음 정한 캡션 양식을 지켜)와 해시태그 추천(사진·캡션을 보고)."""
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

_REWRITE_PROMPT = """너는 인스타그램 캡션 작가야. 첨부한 사진과 아래 내용을 보고 이 게시물의 캡션을 사용자의 요청대로 써.
지금 캡션이 비어 있으면 사진에 보이는 것과 주제로 새로 쓰고, 있으면 그 내용을 살려 다시 써.

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
    *, topic: str, style: str, caption: str, instruction: str, caption_format: str, language: str = "ko",
    images: list[bytes] | None = None,
) -> dict:
    """{'caption', 'hashtags', 'hashtags_inline'} — 실패하면 GeminiError. images: 참고할 사진 (최대 4장)."""
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
        instruction=instruction.strip()[:500] or ("사진과 주제에 어울리게" if not caption.strip() else "더 자연스럽고 읽기 좋게"),
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
        [*_image_parts(images or []), {"text": text}], {"temperature": 0.8, "responseMimeType": "application/json", "responseSchema": schema}, budget=50.0
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


_HASHTAG_PROMPT = """너는 인스타그램 해시태그 전문가야. 첨부한 사진과 아래 내용을 보고 이 게시물에 어울리는 해시태그를 골라.

[게시물 주제] {topic}
[캡션]
{caption}
[원하는 방향] {hint}

규칙
- 사진에 실제로 보이는 것(장소·음식·분위기·물건)과 캡션 내용에 맞는 태그만. 지어낸 장소 이름 금지.
- 넓은 태그(많이 쓰는 것) 몇 개 + 구체적인 태그(장소·주제) 위주로 {n}개 안팎.
- 캡션의 언어에 맞추고, 캡션이 비어 있으면 화면 언어({lang})로. 필요하면 영어 태그를 조금 섞어도 돼.
- # 없이, 띄어쓰기 없이, 중복 없이."""


def suggest_hashtags(
    images: list[bytes], *, topic: str, caption: str, hint: str = "", language: str = "ko", count: int = 12
) -> list[str]:
    """사진(최대 4장)과 캡션을 보고 해시태그를 추천합니다. 실패하면 GeminiError."""
    parts = _image_parts(images)
    parts.append({"text": _HASHTAG_PROMPT.format(
        topic=topic[:500] or "없음", caption=caption[:2200] or "(비어 있음)", hint=hint.strip()[:300] or "없음",
        n=count, lang=LANG_NAME.get(language, "English"),
    )})
    schema = {"type": "OBJECT", "properties": {"hashtags": {"type": "ARRAY", "items": {"type": "STRING"}}}, "required": ["hashtags"]}
    data = gemini.text_call(parts, {"temperature": 0.7, "responseMimeType": "application/json", "responseSchema": schema}, budget=40.0)
    try:
        raw = json.loads(gemini.text_of(data))
    except ValueError as exc:
        raise GeminiError(f"Gemini 응답을 읽지 못했습니다: {exc}") from exc
    out: list[str] = []
    for h in raw.get("hashtags") or []:
        tag = "".join(str(h).lstrip("#").split())
        if tag and tag.lower() not in {t.lower() for t in out}:
            out.append(tag[:60])
    return out[:30]


def _image_parts(images: list[bytes]) -> list[dict]:
    """Gemini 에 함께 보낼 사진 (최대 4장, 작게 줄여 토큰 아끼기)."""
    from .imaging import b64, normalize

    parts = []
    for data in images[:4]:
        small, _, _ = normalize(data, max_side=512)
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64(small)}})
    return parts
