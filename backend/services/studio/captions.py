"""캡션 양식: 사용자가 적은 양식의 [칸]만 Gemini 답으로 채우고, 칸 밖 글자·줄바꿈은 그대로 둡니다."""
from __future__ import annotations

import re

PLACEHOLDER = re.compile(r"\[([^\[\]\n]{1,160})\]")  # 칸 이름에 정보를 함께 적을 수 있어 넉넉하게


_LINES = re.compile(r"(\d+)\s*줄")


def placeholders(template: str) -> list[str]:
    return PLACEHOLDER.findall(template)


def fill_template(template: str, parts: list[str], hashtags: list[str]) -> tuple[str, bool]:
    """양식의 [칸]을 순서대로 채워 넣습니다. [ ] 밖의 글자·줄바꿈은 그대로 유지합니다.
    '[후킹 3줄]'처럼 줄 수가 적힌 칸은 그 줄 수에 맞춥니다.
    (최종 캡션, 해시태그를 양식 안에 넣었는지)"""
    names = placeholders(template)
    used_hashtags = False
    it = iter(range(len(names)))

    def repl(match: re.Match) -> str:
        nonlocal used_hashtags
        i = next(it)
        name = names[i]
        if "해시태그" in name or "hashtag" in name.lower():
            used_hashtags = True
            return " ".join(f"#{t.lstrip('#')}" for t in hashtags)
        text = (parts[i] if i < len(parts) else "").strip() or f"⚠️ [{name}] 직접 입력"
        # 양식에 이미 있는 줄 머리(예: '📍 ')를 답에서 또 쓰면 한 번만 ('📍 📍 가게' 방지)
        head = match.string[match.string.rfind("\n", 0, match.start()) + 1 : match.start()].strip()
        while head and text.startswith(head):
            text = text[len(head):].lstrip()
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        want = _LINES.search(name)
        if want and lines:
            lines = lines[: int(want.group(1))]
        return "\n".join(lines)

    return PLACEHOLDER.sub(repl, template).strip(), used_hashtags


TEMPLATE_RULES = """- 아래 캡션 양식에는 채워야 할 칸이 {k}개 있어: {names}
- caption_parts 배열에 정확히 {k}개의 문자열을 칸 순서대로 넣어. 칸 밖의 글자·이모지·줄바꿈은 서버가 그대로 유지하니 다시 쓰지 마.
- 칸 이름의 지시를 그대로 지켜: 'N줄'이면 정확히 N줄(줄바꿈으로 구분), 'N~M줄'이면 그 범위, '이모지로 시작'이면 줄마다 이모지로 시작.
- 칸 이름에 정보가 들어 있으면(예: '[추천인 정보: 코드 ABC123]') 그 정보를 빠짐없이 자연스러운 문장으로 써.
- 채울 사실이 없어 지어내야 하는 칸이면 '⚠️ 직접 입력: (무엇이 필요한지)' 라고만 써.

캡션 양식:
{template}"""


INSTRUCTION_RULES = """- 사용자가 캡션에 대해 이렇게 적었어: «{request}»
  이게 요청·지시(예: '너가 알아서 작성해줘', '짧고 감성적으로', '장소 이름 넣어줘')면 그 지시에 맞게 캡션을 새로 써. 지시 문장 자체를 캡션에 넣지 마.
  그대로 올릴 완성된 문장이면 그 문장을 그대로 캡션으로 써 (맞춤법만 다듬어).
- caption_parts 에는 완성된 캡션 전체를 문자열 1개로 넣어 (줄바꿈 포함 가능)."""


FREE_RULES = """- 캡션 양식이 따로 없어. [주제]와 [연출 방향]에 가장 어울리는 캡션을 네가 써.
  정보형이면 후킹 문장 + 핵심 내용, 일상·여행 기록이면 그 순간의 느낌을 담은 짧은 글 몇 줄 (이모지 조금).
- caption_parts 에는 완성된 캡션 전체를 문자열 1개로 넣어 (줄바꿈 포함 가능)."""
