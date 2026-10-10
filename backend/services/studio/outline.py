"""글 → 카드뉴스: 붙여 넣은 글(블로그 글·공지·메모)을 표지·본문 장·마무리로 나눕니다.

Gemini 가 되면 장마다 짧은 제목 + 두세 문장으로 다듬고 캡션·해시태그도 함께 쓰고,
안 되면(키 없음·혼잡) 문단·문장 단위로 그대로 나눕니다 — 어느 쪽이든 템플릿 글자 자리에 바로 들어갑니다.
"""
from __future__ import annotations

import json
import re

from . import gemini
from .gemini import GeminiError

TITLE_MAX = 28
BODY_MAX = 140
COVER_SUB_MAX = 40

_PROMPT = """너는 인스타그램 카드뉴스 편집자야. 아래 글을 카드뉴스로 나눠.

[글]
{text}

규칙
- 표지(cover): 눈길을 끄는 제목(줄바꿈 1번까지, {title_max}자 이내)과 부제목({sub_max}자 이내).
- 본문(pages): 정확히 {n}장. 장마다 핵심을 담은 짧은 제목({title_max}자 이내)과 쉬운 설명 2~3문장({body_max}자 이내).
  원문에 없는 사실·숫자는 지어내지 마. 원문 순서를 지켜.
- 마무리(end): 저장·공유를 권하는 한 줄 ({title_max}자 이내, 줄바꿈 1번까지).
- caption: 이 카드뉴스를 올릴 때 쓸 캡션 (후킹 1줄 + 요약 2~3줄, 이모지 조금).
- hashtags: 어울리는 해시태그 8~12개 (# 없이).
- 글의 언어를 그대로 써."""


def _clip(s: str, n: int) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?。])\s+|\n+", text)
    return [p.strip(" -•·\t") for p in parts if p.strip(" -•·\t")]


def fallback(text: str, n: int) -> dict:
    """AI 없이: 첫 줄은 표지, 나머지 문단(없으면 문장)을 n 장에 고르게"""
    lines = [l.strip() for l in text.strip().splitlines()]
    first = next((l for l in lines if l), "")
    rest = text.strip()[len(first):].strip() if first else ""
    paras = [p.strip() for p in re.split(r"\n\s*\n", rest) if p.strip()]
    units = paras if len(paras) >= n else _sentences(rest)
    n = max(1, min(n, len(units) or 1))
    pages = []
    for i in range(n):
        chunk = units[i * len(units) // n : (i + 1) * len(units) // n] if units else []
        sents = _sentences(" ".join(chunk))
        title = sents[0] if sents else f"{i + 1}"
        body = " ".join(sents[1:]) if len(sents) > 1 else ""
        pages.append({"title": _clip(title, TITLE_MAX), "body": _clip(body, BODY_MAX)})
    return {
        "cover": {"title": _clip(first, TITLE_MAX), "sub": ""},
        "pages": pages,
        "end": {"title": "도움이 됐다면\n저장해 두세요!"},
        "caption": "",
        "hashtags": [],
        "ai": False,
    }


def outline(text: str, n: int) -> dict:
    text = text.strip()[:6000]
    schema = {
        "type": "OBJECT",
        "properties": {
            "cover": {"type": "OBJECT", "properties": {"title": {"type": "STRING"}, "sub": {"type": "STRING"}}, "required": ["title", "sub"]},
            "pages": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {"title": {"type": "STRING"}, "body": {"type": "STRING"}}, "required": ["title", "body"]}},
            "end": {"type": "OBJECT", "properties": {"title": {"type": "STRING"}}, "required": ["title"]},
            "caption": {"type": "STRING"},
            "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["cover", "pages", "end", "caption", "hashtags"],
    }
    try:
        data = gemini.text_call(
            [{"text": _PROMPT.format(text=text, n=n, title_max=TITLE_MAX, sub_max=COVER_SUB_MAX, body_max=BODY_MAX)}],
            {"temperature": 0.5, "responseMimeType": "application/json", "responseSchema": schema},
            budget=40.0,
        )
        raw = json.loads(gemini.text_of(data))
    except (GeminiError, ValueError):
        return fallback(text, n)
    pages = [{"title": _clip(str(p.get("title", "")), TITLE_MAX), "body": _clip(str(p.get("body", "")), BODY_MAX)} for p in raw.get("pages") or []][:n]
    if not pages:
        return fallback(text, n)
    tags: list[str] = []
    for h in raw.get("hashtags") or []:
        tag = "".join(str(h).lstrip("#").split())[:60]
        if tag and tag not in tags:
            tags.append(tag)
    return {
        "cover": {"title": _clip(str(raw["cover"].get("title", "")), TITLE_MAX + 2), "sub": _clip(str(raw["cover"].get("sub", "")), COVER_SUB_MAX)},
        "pages": pages,
        "end": {"title": _clip(str(raw["end"].get("title", "")), TITLE_MAX + 2)},
        "caption": str(raw.get("caption", "")).strip()[:2200],
        "hashtags": tags[:30],
        "ai": True,
    }
