"""게시물 글(캡션) + 해시태그 생성.

ANTHROPIC_API_KEY 가 있으면 Claude 로, 없으면 템플릿으로 만듭니다.
"""
from __future__ import annotations

import json
import re

import httpx

from ...config import settings

_SYSTEM = """당신은 인스타그램 콘텐츠 카피라이터입니다.
주어진 아이디어로 실제 게시 가능한 캡션을 씁니다.

규칙:
- 첫 줄은 스크롤을 멈추게 하는 훅. 20자 내외.
- 본문은 2~4문장. 이모지는 과하지 않게 1~3개.
- 마지막에 참여를 유도하는 질문이나 CTA 한 줄.
- 해시태그는 캡션 본문에 섞지 말고 따로 8~15개.
- 해시태그는 # 없이 단어만, 한국어와 영어를 섞어서.

반드시 아래 JSON 만 출력하세요. 코드블록이나 설명은 붙이지 마세요.
{"caption": "...", "hashtags": ["...", "..."]}"""

_FALLBACK_TAGS = [
    "일상", "데일리", "오늘의기록", "감성", "instagood",
    "photooftheday", "일상스타그램", "소통", "daily", "vibes",
]


def _fallback(prompt: str, tone: str, media_kind: str) -> dict:
    kind_word = {"REELS": "릴스", "STORIES": "스토리", "CAROUSEL": "여러 장"}.get(media_kind, "한 장")
    caption = (
        f"{prompt.strip().rstrip('.')}\n\n"
        f"{tone} 분위기로 담아본 {kind_word}. ✨\n"
        f"오늘 이 장면이 마음에 남았어요.\n\n"
        f"여러분은 어떤가요? 댓글로 알려주세요 👇"
    )
    return {"caption": caption, "hashtags": _FALLBACK_TAGS.copy()}


def _parse(text: str) -> dict | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data.get("caption"), str):
        return None
    tags = [str(t).lstrip("#").strip() for t in data.get("hashtags", []) if str(t).strip()]
    return {"caption": data["caption"].strip(), "hashtags": tags[:15]}


def generate_caption(
    prompt: str, *, tone: str = "친근한", language: str = "ko", media_kind: str = "IMAGE"
) -> dict:
    if not settings.anthropic_api_key:
        return _fallback(prompt, tone, media_kind)

    user = (
        f"아이디어: {prompt}\n"
        f"톤앤매너: {tone}\n"
        f"게시물 형식: {media_kind}\n"
        f"작성 언어: {'한국어' if language == 'ko' else language}"
    )
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": settings.anthropic_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.anthropic_model,
                "max_tokens": 1024,
                "system": _SYSTEM,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=45.0,
        )
        resp.raise_for_status()
        blocks = resp.json().get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    except (httpx.HTTPError, ValueError):
        return _fallback(prompt, tone, media_kind)

    return _parse(text) or _fallback(prompt, tone, media_kind)


def compose_caption(caption: str, hashtags: list[str]) -> str:
    """Instagram 에 실제로 올라갈 최종 문자열 (본문 + 해시태그 블록)."""
    body = caption.strip()
    if not hashtags:
        return body
    tags = " ".join(f"#{t.lstrip('#')}" for t in hashtags)
    return f"{body}\n\n{tags}"
