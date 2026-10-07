"""여러 단계에서 같이 쓰는 짧은 글 처리."""
from __future__ import annotations

import re
from typing import Any


def clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


# 한글 글씨체에는 이모지 글리프가 없어 네모로 보이므로 서버가 얹는 글에서는 뺍니다 (캡션의 이모지는 그대로).
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\U000E0000-\U000E007F]")


def no_emoji(text: str) -> str:
    return "\n".join(re.sub(r"[ \t]{2,}", " ", _EMOJI.sub("", line)).strip() for line in (text or "").splitlines()).strip()
