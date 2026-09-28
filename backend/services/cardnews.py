"""사진과 주제로 만드는 Instagram 게시물 (고정 틀 없이 사용자 컨셉을 따름).

1) research      : Gemini + Google 검색으로 주제를 조사 (정보가 필요한 경우, 출처 보관)
2) plan          : 컨셉·사진·조사 내용으로 장수(1~10)와 장별 레이아웃(photo/overlay/panel/center), 글, 연출 지시를 설계.
                   컨셉에 맞지 않는 사진은 쓰지 않고, 필요한 장면은 새 이미지 생성(-1). 캡션은 양식의 [칸]별로 받아 서버가 조립
3) render_visual : Gemini 이미지 모델이 연출 지시대로 사진을 재구성하거나 새로 생성
4) compose       : 레이아웃대로 한글 글자를 서버에서 합성 (AI 이미지 모델은 한글을 자주 깨뜨림). 고정 문구·배지 없음
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from ..config import settings
from ..i18n import LANG_NAME

log = logging.getLogger(__name__)

SIZE = (1080, 1350)  # Instagram 세로 4:5
MAX_PHOTOS = 8  # 업로드 최대 장수
MAX_SLIDES = 10  # Instagram 캐러셀 최대 장수
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

DEFAULT_CAPTION_FORMAT = """[후킹 2줄]

[핵심 정보 3~5줄, 줄마다 이모지로 시작]

[저장·공유를 유도하는 마무리 한 줄]"""


# ── 이미지 유틸 ────────────────────────────────────────────────────────
def normalize(data: bytes, *, max_side: int = 1600) -> tuple[bytes, int, int]:
    """회전(EXIF) 보정 → RGB → 긴 변 max_side 로 축소 → JPEG."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    return to_jpeg(img), img.width, img.height


def to_jpeg(img: Image.Image, quality: int = 88) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _small(data: bytes, side: int = 768) -> bytes:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((side, side))
    return to_jpeg(img, 80)


# ── Gemini 호출 ────────────────────────────────────────────────────────
class GeminiError(RuntimeError):
    pass


LEGACY_IMAGE_MODEL = "gemini-2.5-flash-image"  # 설정한 이미지 모델을 쓸 수 없을 때 한 번 더 시도


def _gemini(
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
        raise GeminiError((data.get("error") or {}).get("message") or f"Gemini 오류 ({resp.status_code})")
    return data


TEXT_FALLBACK_MODELS = ("gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-lite-latest")
_TRANSIENT = ("high demand", "overloaded", "unavailable", "try again", "quota", "exhausted", "rate", "deadline", "timed out", "연결 실패", "not found", "no longer available", "not supported")


def _text_call(parts: list[dict[str, Any]], generation_config: dict[str, Any], *, tools=None, budget: float = 55.0) -> dict:
    """구성·조사용 텍스트 호출. 혼잡·한도 오류면 다른 텍스트 모델로 다시 시도합니다 (Vercel 60초 안에서)."""
    models = list(dict.fromkeys((settings.gemini_text_model, *TEXT_FALLBACK_MODELS)))
    deadline = time.monotonic() + budget
    last: Exception | None = None
    for model in models:
        remaining = deadline - time.monotonic()
        if remaining < 8:
            break
        try:
            return _gemini(model, parts, generation_config, tools=tools, timeout=remaining)
        except GeminiError as exc:
            last = exc
            log.warning("gemini text %s failed: %s", model, exc)
            if not any(k in str(exc).lower() for k in _TRANSIENT):
                break
    raise GeminiError(str(last or "Gemini 시간 초과"))


def is_busy(exc: Exception) -> bool:
    return any(k in str(exc).lower() for k in ("high demand", "overloaded", "unavailable", "try again", "rate limit", "quota", "exhausted"))


def _parts_of(data: dict) -> list[dict[str, Any]]:
    try:
        return data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as exc:
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "응답이 비어 있습니다"
        raise GeminiError(f"Gemini 응답 없음: {reason}") from exc


def _text_of(data: dict) -> str:
    return "".join(p.get("text", "") for p in _parts_of(data)).strip()


# ── 1) 주제 조사 (Google 검색) ────────────────────────────────────────
_RESEARCH_PROMPT = """너는 인스타그램 게시물 리서처야. Google 검색으로 아래 주제를 조사해, 사용자가 원하는 게시물을 뒷받침할 자료를 정리해.
게시물의 컨셉과 형식은 사용자가 정한 [주제]와 [연출 방향]이 절대 기준이고, 너의 조사는 그 내용을 사실로 뒷받침하는 보조 역할이야.

[주제] {prompt}
[연출 방향] {style}
사용자가 준 확정 정보(그대로 신뢰): {notes}

연출 방향이 요구하는 형식에 필요한 자료(예: 이벤트면 기간·조건, 비교형이면 비교 항목)를 우선 찾아.
주제가 정보·방법·제품·서비스처럼 사실이 중요한 내용이면:
1) 한 줄 요약  2) 핵심 사실 6~10개 (정의, 특징, 절차·방법, 조건·비용·주의사항, 최신 변경)  3) 독자가 궁금해할 질문 3개
주제가 감성·일상·여행 기록처럼 분위기가 중요한 내용이면: 관련 배경 지식과 표현에 쓸 만한 사실 몇 줄만.
확인된 사실만 쓰고 추측하지 마. 날짜가 중요한 정보에는 기준 시점을 적어."""


def research(prompt: str, notes: str, style: str = "", *, language: str = "ko") -> tuple[dict[str, Any], str]:
    """(조사 결과 {notes, sources}, 경고). 검색이 안 되면 빈 결과로 계속 진행합니다."""
    text = _RESEARCH_PROMPT.format(prompt=prompt, notes=notes.strip() or "없음", style=style.strip() or "없음")
    text += f"\n\n조사 결과는 {LANG_NAME.get(language, 'English')} 로 써. (게시물 글의 언어는 나중에 [주제]의 언어를 따라 정해.)"
    parts = [{"text": text}]
    try:
        data = _text_call(parts, {"temperature": 0.2}, tools=[{"googleSearch": {}}])
        text = _text_of(data)
        chunks = ((data.get("candidates") or [{}])[0].get("groundingMetadata") or {}).get("groundingChunks") or []
        sources, seen = [], set()
        for ch in chunks:
            web = ch.get("web") or {}
            uri = web.get("uri")
            if uri and uri not in seen:
                seen.add(uri)
                sources.append({"title": (web.get("title") or uri)[:120], "uri": uri})
        return {"notes": text[:6000], "sources": sources[:12]}, ""
    except (GeminiError, KeyError, IndexError, TypeError) as exc:
        log.warning("cardnews research skipped: %s", exc)
        return {"notes": "", "sources": []}, f"주제 조사(검색) 실패로 사진·입력 정보만 사용: {exc}"


# ── 2) 구성 설계 + 캡션 양식 채우기 ──────────────────────────────────────
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
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        want = _LINES.search(name)
        if want and lines:
            lines = lines[: int(want.group(1))]
        return "\n".join(lines)

    return PLACEHOLDER.sub(repl, template).strip(), used_hashtags


_PLAN_PROMPT = """너는 인스타그램 게시물 크리에이티브 디렉터야. 사용자의 주제와 연출 방향을 그대로 실현하는 게시물을 설계해.
정해진 구성이나 장수는 없어.

━━ 1순위 · 절대 기준 (이미지, 이미지 속 글, 캡션 모두 여기에 맞춰. 어떤 것도 이걸 바꾸거나 무시하면 안 돼) ━━
[주제] {prompt}
[연출 방향] {style}{ref_rule}

━━ 2순위 · 사용자 확정 정보 (그대로 사용, 바꾸지 마) ━━
{notes}
※ 아래 캡션 양식 안에 적힌 사실(칸 밖 문장, '[추천인 정보: 코드 ABC123]'처럼 칸 이름 속 정보)도 확정 정보야.

━━ 3순위 · 조사 자료 (Google 검색 요약 — 1순위를 뒷받침하는 사실로만 써. 컨셉·연출·형식을 바꾸는 근거로 쓰지 마. 여기 없는 사실은 지어내지 마) ━━
{research}

━━ 4순위 · 첨부 사진 {n}장 (번호는 0부터 첨부 순서) — 연출에 맞을 때만 써 ━━{refs}

0) requirements: 먼저 [주제]와 [연출 방향]에서 사용자의 요구를 빠짐없이 하나씩 뽑아
  (형식, 장별 지시, 그림체, 글자 표현, 말투, 강조할 내용 등. 예: '첫 장은 배경을 어둡게 하고 후킹 제목', '두 번째 장부터 손글씨 동그라미·화살표로 설명').
  각 요구마다 how 에 어느 장(몇 번째)에 어떻게 반영했는지 구체적으로 적어. 반영하지 못한 요구가 없게 설계해.

1) 형식(format) 정하기 — 주제·컨셉·연출 방향에 나온 형식을 그대로 따르고, 언급이 없으면 가장 잘 맞는 것을 골라:
  인스타툰/웹툰(캐릭터·말풍선 컷), 손글씨 메모(사진이나 종이 위 손글씨·동그라미·화살표 낙서), 인터뷰/Q&A, 이벤트·프로모션 포스터,
  정보 정리형(체크리스트·단계별 안내·비교), 감성 사진/무드보드, 비포·애프터, 인용 한 줄 등. 특정 형식을 기본값처럼 쓰지 마.
2) art_style: 모든 이미지에 똑같이 적용할 그림체를 영어로 구체적으로 (예: 'Instagram webtoon, clean black line art, flat pastel colors, rounded chibi character' /
  'real photo with white hand-drawn iPad marker doodles and handwriting' / 'natural film photography, warm grain').
  참고 이미지가 있으면 그 양식의 그림체·색·레이아웃을 그대로 적고, 없으면 연출 방향을 가장 크게 반영해. 요청이 그림체면 실사로 바꾸지 마.

3) font: 서버가 글자를 얹는 장(overlay/panel/center)에 쓸 글씨체를 골라. 연출 방향에 글씨체 언급이 있으면 그대로 따르고, 없으면 형식에 맞게:
  {fonts}
  게시물 글이 일본어면 반드시 noto_sans_jp (다른 글씨체는 일본어 글자가 없음). 한국어·영어면:
  손글씨 메모면 nanum_pen/gaegu, 날림체면 east_sea_dokdo, 붓글씨·전통·궁서 느낌이면 nanum_brush/song_myung, 우아하면 nanum_myeongjo,
  강한 제목은 black_han_sans/do_hyeon, 귀여우면 jua, 깔끔한 정보형은 pretendard. designed 장의 글자 느낌도 이 글씨체와 맞춰 art_style 에 적어.

슬라이드 규칙
- slides 는 1~{max_slides}장. 형식과 컨셉에 필요한 만큼만. 1장이면 단일 게시물이 돼.
- 장 수: 사용자가 장 수를 정했으면(예: '한 장 짜리', '1장', '3장') 반드시 그 수로 만들어. 사진이 더 많으면 한 장에 합쳐서 맞춰.
- photos: 이 장에 쓸 첨부 사진 번호 목록. 한 장에 여러 사진을 합쳐 쓰려면(필름 콜라주·스크랩북·필름 스트립·비교·그리드 등) 여러 번호를 넣고,
  visual 에 어떻게 한 이미지로 합치는지 적어. 맞는 사진이 없어 새로 만들면 빈 목록 []. 컨셉에 맞지 않는 사진은 안 써도 돼
  (웹툰처럼 그림체면 사진을 그 그림체로 다시 그리는 참고로 써).
- layout 은 슬라이드마다 골라:
  designed = 글자까지 이미지 안에 그려 넣는 완성형 디자인. 말풍선 대사, 손글씨 메모, 포스터 제목처럼 글자가 그림의 일부인 형식은 반드시 이것.
             그릴 글자는 image_text 에 정확히 (짧게, 한 장에 1~4줄). title/body 는 비워.
  photo    = 이미지만 (글자 없음)
  overlay  = 서버가 이미지 아래쪽에 깔끔한 제목·문장을 얹음
  panel    = 위 이미지 + 아래 글 영역 (설명이 긴 정보형)
  center   = 이미지 위 가운데 큰 문장 (인용·강조)
  웹툰·손글씨 메모·포스터·인터뷰 형식이면 designed 를, 깔끔한 정보 정리형이면 overlay/panel/center 를 주로 써.
- 글의 말투는 주제·컨셉과 연출 방향에서 드러나는 느낌을 따라.
- title 20자, body 80자, image_text 는 줄당 16자 이내로 짧게. cta 는 꼭 필요할 때만(12자), 아니면 빈 문자열.
- visual: 이미지 AI 에게 줄 영어 지시 2~4문장. 이 장의 장면·등장인물·소품·구도·연출을 art_style 로 구체적으로.
  designed 면 글자가 어디에 어떤 모양으로 들어가는지(말풍선 위치, 손글씨 위치, 화살표가 가리키는 대상 등)도 적어.
  그 외 레이아웃이면 글자를 넣지 말라고 적고, overlay 는 아래쪽·center 는 가운데를 단순하게 비워 두라고 적어.

언어 규칙 (매우 중요)
- 게시물에 들어가는 모든 글(캡션, 해시태그, title/body/cta, image_text)은 사용자가 [주제]와 [연출 방향]을 쓴 언어로 써.
  사용자가 언어를 따로 지정했으면(예: '영어로', 'in Japanese', '日本語で') 그 언어로. 두 언어가 섞여 애매하면 {ui_lang}.
- requirements 의 requirement·how 와 concept 는 사용자가 검수 화면에서 읽는 설명이므로 {ui_lang} 로 써.
- visual, art_style 은 이미지 AI 용이라 항상 영어로.
- 해시태그도 게시물 언어로 쓰고, 필요하면 영어 해시태그를 몇 개 섞어도 돼.

캡션 규칙 (매우 중요)
- 캡션의 말투·표현·강조점도 [주제]와 [연출 방향]을 따라. 조사 자료는 사실을 뒷받침할 때만 써.
- 개인 일상·여행 기록처럼 사적인 게시물이면 친구에게 말하듯 자연스럽고 짧게 써. 요청하지 않았으면 홍보·저장·공유 유도 문구는 쓰지 마.
- 해시태그는 caption_parts 에 넣지 말고 hashtags 배열(# 없이 8~15개, 주제·장소·분위기에 맞게)로. 항상 만들어.
{caption_rules}"""

_TEMPLATE_RULES = """- 아래 캡션 양식에는 채워야 할 칸이 {k}개 있어: {names}
- caption_parts 배열에 정확히 {k}개의 문자열을 칸 순서대로 넣어. 칸 밖의 글자·이모지·줄바꿈은 서버가 그대로 유지하니 다시 쓰지 마.
- 칸 이름의 지시를 그대로 지켜: 'N줄'이면 정확히 N줄(줄바꿈으로 구분), 'N~M줄'이면 그 범위, '이모지로 시작'이면 줄마다 이모지로 시작.
- 칸 이름에 정보가 들어 있으면(예: '[추천인 정보: 코드 ABC123]') 그 정보를 빠짐없이 자연스러운 문장으로 써.
- 채울 사실이 없어 지어내야 하는 칸이면 '⚠️ 직접 입력: (무엇이 필요한지)' 라고만 써.

캡션 양식:
{template}"""

_INSTRUCTION_RULES = """- 사용자가 캡션에 대해 이렇게 적었어: «{request}»
  이게 요청·지시(예: '너가 알아서 작성해줘', '짧고 감성적으로', '장소 이름 넣어줘')면 그 지시에 맞게 캡션을 새로 써. 지시 문장 자체를 캡션에 넣지 마.
  그대로 올릴 완성된 문장이면 그 문장을 그대로 캡션으로 써 (맞춤법만 다듬어).
- caption_parts 에는 완성된 캡션 전체를 문자열 1개로 넣어 (줄바꿈 포함 가능)."""

_FREE_RULES = """- 캡션 양식이 따로 없어. [주제]와 [연출 방향]에 가장 어울리는 캡션을 네가 써.
  정보형이면 후킹 문장 + 핵심 내용, 일상·여행 기록이면 그 순간의 느낌을 담은 짧은 글 몇 줄 (이모지 조금).
- caption_parts 에는 완성된 캡션 전체를 문자열 1개로 넣어 (줄바꿈 포함 가능)."""

LAYOUTS = ("designed", "photo", "overlay", "panel", "center")


def _plan_schema(k: int) -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {
            "requirements": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {"requirement": {"type": "STRING"}, "how": {"type": "STRING"}},
                    "required": ["requirement", "how"],
                },
            },
            "concept": {"type": "STRING"},
            "format": {"type": "STRING"},
            "art_style": {"type": "STRING"},
            "font": {"type": "STRING", "enum": list(FONTS)},
            "slides": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "photos": {"type": "ARRAY", "items": {"type": "INTEGER"}},
                        "layout": {"type": "STRING", "enum": list(LAYOUTS)},
                        "title": {"type": "STRING"},
                        "body": {"type": "STRING"},
                        "cta": {"type": "STRING"},
                        "image_text": {"type": "STRING"},
                        "visual": {"type": "STRING"},
                    },
                    "required": ["photos", "layout", "title", "body", "cta", "image_text", "visual"],
                },
            },
            "caption_parts": {"type": "ARRAY", "items": {"type": "STRING"}, "minItems": k, "maxItems": k},
            "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["requirements", "concept", "format", "art_style", "font", "slides", "caption_parts", "hashtags"],
    }


def plan_cardnews(
    photos: list[bytes],
    *,
    prompt: str,
    tone: str = "",  # (사용 안 함) 말투는 주제·연출 방향을 따름
    style: str,
    caption_format: str,
    notes: str = "",
    research_notes: str = "",
    references: list[bytes] | None = None,
    language: str = "ko",
) -> tuple[dict[str, Any], str, str]:
    """(설계안, 사용 엔진, 경고) — Gemini 실패 시 기본 설계안. references 는 연출 참고 이미지.
    language 는 사용자 화면 언어: 검수용 설명(requirements·concept)을 이 언어로, 게시물 글은 [주제]의 언어로."""
    n = len(photos)
    references = references or []
    template = caption_format.strip()
    names = [p for p in placeholders(template) if "해시태그" not in p and "hashtag" not in p.lower()]
    if names:
        caption_rules = _TEMPLATE_RULES.format(k=len(names), names=", ".join(f"[{x}]" for x in names), template=template)
    elif template:
        caption_rules = _INSTRUCTION_RULES.format(request=template)
    else:
        caption_rules = _FREE_RULES
    text = _PLAN_PROMPT.format(
        n=n,
        prompt=prompt,
        notes=notes.strip() or "없음",
        style=style.strip() or "(없음 — 컨셉에 맞게 네가 판단)",
        research=research_notes.strip() or "(조사 자료 없음)",
        max_slides=MAX_SLIDES,
        caption_rules=caption_rules,
        ui_lang=LANG_NAME.get(language, "English"),
        fonts=" / ".join(f"{k}({v['label']})" for k, v in FONTS.items()),
        refs=(
            f"\n(사진 뒤에 첨부한 마지막 {len(references)}장은 사진이 아니라 1순위의 [참고 이미지] 양식 템플릿이야. 사진 번호로 쓰지 마.)"
            if references
            else ""
        ),
        ref_rule=(
            f"\n[참고 이미지 · 양식 템플릿] 첨부 마지막 {len(references)}장 — 이미지를 만들 때 가장 우선하는 기준이야. "
            "모든 장을 이 양식과 똑같이 만들어: 레이아웃·구도, 제목/글자/말풍선/라벨이 놓이는 위치와 방식, 그림체·사진 톤, 색 구성, "
            "글씨 느낌, 장식·테두리·여백. 내용만 이 게시물 주제에 맞게 바꿔 적절히 배치해. "
            "참고 이미지 안에 글자가 들어간 디자인이면 해당 장은 layout 을 designed 로 하고, visual 에 참고 이미지의 어느 위치에 어떤 글이 들어가는지 그대로 적어."
            if references
            else ""
        ),
    )
    parts: list[dict[str, Any]] = [{"text": text}]
    for photo in photos:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(photo))}})
    for ref in references:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(ref, 512))}})
    if not settings.gemini_api_key:
        # Gemini 를 쓰지 않는 환경에서만 기본 구성. 키가 있는데 실패하면 엉뚱한 결과 대신 오류를 냅니다.
        design, engine, warning = fallback_plan(n, prompt, style), "template", "GEMINI_API_KEY 가 없어 기본 구성을 사용했습니다."
        raw = {"caption_parts": []}
    else:
        schema = _plan_schema(max(1, len(names)))
        cfg = {"temperature": 0.7, "responseMimeType": "application/json", "responseSchema": schema}
        try:
            raw = json.loads(_text_of(_text_call(parts, cfg)))
            design = _sanitize_plan(raw, n)
        except (ValueError, KeyError, TypeError) as exc:
            raise GeminiError(f"Gemini 응답을 읽지 못했습니다: {exc}") from exc
        engine, warning = "gemini", ""

    # 캡션은 서버가 양식에 맞춰 조립합니다 (섹션 순서·빈 줄·고정 문구를 모델에 맡기지 않음).
    if placeholders(template):
        body_parts = [str(p) for p in (raw.get("caption_parts") or [])]
        full_parts, j = [], 0
        for name in placeholders(template):
            if "해시태그" in name or "hashtag" in name.lower():
                full_parts.append("")
            else:
                full_parts.append(body_parts[j] if j < len(body_parts) else "")
                j += 1
        caption, tags_inline = fill_template(template, full_parts, design["hashtags"])
    else:
        # 지시·자유 모드: Gemini 가 쓴 캡션 그대로 (지시문 자체를 캡션으로 쓰지 않음)
        caption, tags_inline = "\n".join(str(p) for p in raw.get("caption_parts") or []).strip(), False
    design["caption"] = caption[:2200]
    design["hashtags_inline"] = tags_inline
    design["caption_format"] = template
    return design, engine, warning


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _sanitize_plan(raw: dict[str, Any], n: int) -> dict[str, Any]:
    """사진 번호·레이아웃·길이를 보정합니다. 컨셉에 맞지 않는 사진은 쓰지 않아도 됩니다 (-1 = 새 이미지 생성)."""

    def slide(s: dict[str, Any]) -> dict[str, Any]:
        raw_photos = s.get("photos")
        if raw_photos is None and isinstance(s.get("photo"), int):  # 예전 형식
            raw_photos = [s["photo"]]
        photos = []
        for x in raw_photos or []:
            if isinstance(x, int) and 0 <= x < n and x not in photos:
                photos.append(x)
        photos = photos[:4]
        layout = s.get("layout") if s.get("layout") in LAYOUTS else "overlay"
        title, body = _clip(s.get("title"), 26), _clip(s.get("body"), 100)
        image_text = _clip(s.get("image_text"), 160)
        if layout in ("overlay", "panel", "center") and not (title or body):
            layout = "photo"  # 서버가 얹을 글이 없으면 이미지만
        server_text = layout in ("overlay", "panel", "center")
        return {
            "photos": photos,
            "photo": photos[0] if photos else -1,  # 예전 코드 호환
            "layout": layout,
            "title": title if server_text else "",
            "body": body if server_text else "",
            "cta": _clip(s.get("cta"), 16) if layout in ("overlay", "center") else "",
            "image_text": image_text if layout == "designed" else "",
            "visual": _clip(s.get("visual"), 700),
        }

    slides = [slide(s) for s in (raw.get("slides") or []) if isinstance(s, dict)][:MAX_SLIDES]
    if not slides:
        slides = fallback_plan(n, "")["slides"]
    return {
        "requirements": [
            {"requirement": _clip(r.get("requirement"), 200), "how": _clip(r.get("how"), 300)}
            for r in (raw.get("requirements") or [])
            if isinstance(r, dict) and r.get("requirement")
        ][:20],
        "concept": _clip(raw.get("concept"), 200),
        "format": _clip(raw.get("format"), 60),
        "art_style": _clip(raw.get("art_style"), 400),
        "font": font_key(raw.get("font")),
        "slides": slides,
        "hashtags": [str(t).lstrip("#").strip() for t in (raw.get("hashtags") or []) if str(t).strip()][:20],
    }


_ONE_SLIDE = re.compile(r"(한|1)\s*장\s*(짜리|으로|만|에)|하나로\s*합|한\s*장의|단일\s*(이미지|게시물)")


def fallback_plan(n: int, prompt: str, style: str = "") -> dict[str, Any]:
    """Gemini 없이: 올린 사진을 순서대로 쓰고, 첫 장에만 주제를 얹습니다 (고정 문구 없음).
    '한 장 짜리'처럼 한 장을 원하면 사진을 모두 한 장에 합칩니다."""
    topic = _clip(prompt.splitlines()[0] if prompt else "", 26)
    blank = {"layout": "photo", "title": "", "body": "", "cta": "", "image_text": "", "visual": ""}
    if n == 0:
        return {"concept": topic, "slides": [{**blank, "photos": [], "photo": -1, "layout": "center" if topic else "photo", "title": topic}], "hashtags": []}
    if n > 1 and _ONE_SLIDE.search(f"{prompt}\n{style}"):
        ids = list(range(min(n, 4)))
        return {"concept": topic, "slides": [{**blank, "photos": ids, "photo": 0}], "hashtags": []}
    slides = [{**blank, "photos": [i], "photo": i} for i in range(min(n, MAX_SLIDES))]
    if topic:
        slides[0].update(layout="overlay", title=topic)
    return {"concept": topic, "slides": slides, "hashtags": []}


def slide_list(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """렌더링 순서. role 은 레이아웃 (예전 작업의 cover/content/conclusion 구조도 읽습니다)."""
    if "cover" in plan:  # 이전 형식 호환
        legacy = (
            [{"role": "overlay", **plan["cover"], "body": plan["cover"].get("subtitle", "")}]
            + [{"role": "panel", **s, "title": s.get("heading", "")} for s in plan.get("slides", [])]
            + [{"role": "center", **plan["conclusion"]}]
        )
        return legacy
    return [{"role": s["layout"], **s} for s in plan["slides"]]


# ── 3) 이미지 연출 (편집 · 생성) ─────────────────────────────────────────
# panel 은 위쪽 62% 에 이미지가 들어가므로 가로형, 나머지는 세로 4:5.
ASPECT = {"designed": "4:5", "photo": "4:5", "overlay": "4:5", "panel": "4:3", "center": "4:5"}


def _visual_prompt(
    slide: dict[str, Any],
    *,
    topic: str,
    style: str,
    instruction: str,
    has_photo: bool | int,
    art_style: str = "",
    post_format: str = "",
    font: str = "",
) -> str:
    """이미지 모델 지시문. 사용자 연출 방향을 맨 앞(최우선)에, 게시물 전체 그림체를 모든 장에 공통으로."""
    role = slide["role"]
    lines: list[str] = []
    if style.strip():
        lines.append(f"USER'S ART DIRECTION (highest priority, follow it exactly): {style.strip()}")
    if instruction.strip():
        lines.append(f"Revision request for this image (also highest priority): {instruction.strip()}")
    lines.append(
        f"POST TOPIC (must be clearly conveyed, together with the art direction above): {topic}."
        + (f" Post format: {post_format}." if post_format else "")
    )
    if art_style:
        lines.append(f"Art style for every image in this post (keep it identical across images): {art_style}")
    if slide.get("visual"):
        lines.append(f"This image: {slide['visual']}")
    message = " — ".join(p for p in (slide.get("title"), slide.get("body")) if p)
    if message and role != "designed":
        lines.append(f"It illustrates this message: {message}")
    count = int(has_photo)
    if count > 1:
        lines.append(
            f"COMBINE ALL {count} attached photos into ONE single image (one Instagram post), laid out as described above "
            "(e.g. film-photo collage, scrapbook, film strip, split frame or grid). Every one of the photos must appear, "
            "with its people, faces and landmarks kept real and recognizable; do not invent new places or people. "
            "Output exactly one image, not separate images."
        )
    elif count == 1:
        lines.append(
            "Use the attached photo as the base/reference: keep its key subject recognizable but transform it into the art style "
            "and scene described above (re-draw, re-compose, change background or add elements as needed)."
        )
    else:
        lines.append("Create this image from scratch in the art style described above.")
    if role == "designed":
        text = (slide.get("image_text") or "").strip()
        if text:
            lines.append(
                "The image must include this text as part of the design (speech bubbles, handwriting, doodle labels or "
                f"a headline, as fitting the style), written exactly as given, character by character: «{text}». "
                + (f"Lettering style: {FONTS[font_for_text(font, text)]['desc']}. " if font in FONTS else "")
                + ""
                "Keep every character (Korean/Japanese/Latin) correct and legible. Do not add any other text, watermark or logo."
            )
        else:
            lines.append("Do not add any text, watermark or logo.")
    else:
        lines.append(
            {
                "photo": "Use the full frame.",
                "overlay": "Keep the lower third simple and slightly darker so text can be placed there later.",
                "panel": "Wide framing with the key subject centered.",
                "center": "Keep the middle calm and uncluttered so a sentence can be placed on top later.",
            }[role]
            + " Do not draw any readable text, letters, numbers, logos or watermarks (text is added separately)."
        )
    lines.append("High quality, polished, Instagram-ready.")
    return "\n".join(lines)


def _image_call(parts: list[dict[str, Any]], aspect: str) -> bytes:
    cfg = {"responseModalities": ["IMAGE", "TEXT"], "imageConfig": {"aspectRatio": aspect}}
    models = [settings.gemini_image_model]
    if settings.gemini_image_model != LEGACY_IMAGE_MODEL:
        models.append(LEGACY_IMAGE_MODEL)
    last: Exception | None = None
    for model in models:
        try:
            data = _gemini(model, parts, cfg, timeout=55.0)
            for part in _parts_of(data):
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


def render_visual(
    photos: list[bytes] | bytes | None,
    slide: dict[str, Any],
    *,
    topic: str,
    style: str = "",
    instruction: str = "",
    references: list[bytes] | None = None,
    art_style: str = "",
    post_format: str = "",
    font: str = "",
) -> tuple[bytes, str]:
    """(이미지, 엔진). 사진이 있으면 연출 편집(여러 장이면 한 이미지로 합침), 없으면 새로 생성.
    실패하면 기본 보정 / 콜라주 / 배경. references 는 양식 템플릿 이미지."""
    if photos is None:
        photos = []
    elif isinstance(photos, (bytes, bytearray)):
        photos = [bytes(photos)]
    photos = list(photos)[:4]
    references = references or []
    prompt = _visual_prompt(
        slide,
        topic=topic,
        style=style,
        instruction=instruction,
        has_photo=len(photos),
        art_style=art_style,
        post_format=post_format,
        font=font,
    )
    refs = references[:3]
    if refs:
        k = len(refs)
        order = (
            f"The first {k} attached image(s) are the TEMPLATE; the remaining {len(photos)} attached image(s) are the photos to use as content."
            if photos
            else f"All {k} attached image(s) are the TEMPLATE."
        )
        template_rule = (
            "TEMPLATE REFERENCE (TOP PRIORITY, above everything below): "
            f"{order} Make this image in exactly the same format as the template: reproduce its layout and composition, "
            "where and how text areas / headlines / speech bubbles / labels are placed, its illustration or photo style, "
            "color palette, typography feel, decorative elements, borders and spacing. Keep that design system identical, "
            "and arrange this slide's own content and message into it appropriately. Do not copy the template's specific "
            "subjects or words — only its format."
        )
        prompt = template_rule + "\n" + prompt
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for ref in refs:  # 템플릿을 먼저 첨부
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(ref, 1024))}})
    side = 1280 if len(photos) <= 1 else 1024
    for photo in photos:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(photo, side))}})
    try:
        return _image_call(parts, ASPECT[slide["role"]]), "gemini"
    except (GeminiError, OSError, ValueError) as exc:
        log.warning("render_visual fallback: %s", exc)
        if len(photos) > 1:
            return collage(photos), f"basic ({exc})"
        return (basic_enhance(photos[0]) if photos else placeholder_background()), f"basic ({exc})"


def edit_visual(image: bytes, instruction: str, *, aspect: str = "4:5") -> tuple[bytes, str]:
    """지금 이미지에서 요청한 부분만 고칩니다 (나머지는 그대로). 실패하면 원래 이미지를 그대로 돌려줍니다."""
    prompt = (
        f"Edit the attached image. Apply ONLY this change (user's request, may be in any language; highest priority): {instruction}\n"
        "Keep everything else exactly the same: composition, people and faces, landmarks, colors, art style, "
        "and any existing text (keep its characters identical). Do not add watermarks or logos. "
        "Output one image in the same format."
    )
    parts = [{"text": prompt}, {"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(image, 1280))}}]
    try:
        return _image_call(parts, aspect), "gemini"
    except (GeminiError, OSError, ValueError) as exc:
        log.warning("edit_visual fallback: %s", exc)
        return image, f"basic ({exc})"


def image_size(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


def collage(photos: list[bytes]) -> bytes:
    """이미지 생성이 안 될 때 여러 사진을 한 장에 담는 필름 사진 콜라주 (크림색 배경 + 흰 테두리 + 살짝 기울임)."""
    w, h = SIZE
    k = len(photos)
    canvas = Image.new("RGB", (w, h), (243, 238, 228))
    if k == 2:
        cells = [(0, 0, w, h // 2), (0, h // 2, w, h)]
    elif k == 3:
        cells = [(0, 0, w, h // 2), (0, h // 2, w // 2, h), (w // 2, h // 2, w, h)]
    else:
        cells = [(x, y, x + w // 2, y + h // 2) for y in (0, h // 2) for x in (0, w // 2)][:k]
    angles = (-2.5, 2.0, 1.5, -1.8)
    for i, (photo, (x0, y0, x1, y1)) in enumerate(zip(photos, cells)):
        cw, ch = x1 - x0, y1 - y0
        pad, border = 34, 16
        inner = (cw - 2 * pad - 2 * border, ch - 2 * pad - 2 * border)
        img = _cover_fit(photo, inner)
        frame = Image.new("RGB", (inner[0] + 2 * border, inner[1] + 2 * border), (255, 255, 255))
        frame.paste(img, (border, border))
        rot = frame.convert("RGBA").rotate(angles[i % 4], expand=True, resample=Image.BICUBIC)
        shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
        shadow.putalpha(rot.getchannel("A").point(lambda a: 60 if a else 0))
        shadow = shadow.filter(ImageFilter.GaussianBlur(10))
        px, py = x0 + (cw - rot.width) // 2, y0 + (ch - rot.height) // 2
        canvas.paste(shadow, (px + 6, py + 10), shadow)
        canvas.paste(rot, (px, py), rot)
    return to_jpeg(canvas, 92)


def placeholder_background() -> bytes:
    """이미지 생성에 실패했고 원본 사진도 없을 때 쓰는 은은한 배경."""
    w, h = SIZE
    img = Image.linear_gradient("L").resize((w, h)).convert("RGB")
    img = ImageOps.colorize(img.convert("L"), black=(38, 38, 52), white=(120, 110, 170))
    return to_jpeg(img.filter(ImageFilter.GaussianBlur(40)))


def basic_enhance(photo: bytes) -> bytes:
    img = ImageOps.autocontrast(Image.open(io.BytesIO(photo)).convert("RGB"), cutoff=1)
    img = ImageEnhance.Color(img).enhance(1.12)
    img = ImageEnhance.Sharpness(img).enhance(1.15)
    return to_jpeg(img)


# ── 4) 카드 합성 ───────────────────────────────────────────────────────
# 글자를 서버가 얹는 장에 쓰는 글씨체 (모두 SIL OFL — 상업적 사용 가능).
# scale: 손글씨체는 같은 크기에서 작아 보여 키웁니다. desc: 이미지 모델이 글자를 그릴 때 참고할 설명.
FONTS: dict[str, dict[str, Any]] = {
    "pretendard": {"label": "프리텐다드 · 기본 고딕", "title": "Pretendard-ExtraBold.otf", "body": "Pretendard-Medium.otf", "scale": 1.0, "desc": "clean modern Korean sans-serif"},
    "black_han_sans": {"label": "블랙한산스 · 굵은 제목", "title": "BlackHanSans-Regular.ttf", "body": "Pretendard-Medium.otf", "scale": 1.0, "desc": "very heavy bold Korean display type"},
    "do_hyeon": {"label": "도현 · 각진 제목", "title": "DoHyeon-Regular.ttf", "body": "DoHyeon-Regular.ttf", "scale": 1.05, "desc": "blocky condensed Korean display type"},
    "jua": {"label": "주아 · 둥글고 귀여운", "title": "Jua-Regular.ttf", "body": "Jua-Regular.ttf", "scale": 1.0, "desc": "rounded cute Korean type"},
    "nanum_pen": {"label": "나눔펜 · 손글씨", "title": "NanumPenScript-Regular.ttf", "body": "NanumPenScript-Regular.ttf", "scale": 1.4, "desc": "casual Korean pen handwriting"},
    "gaegu": {"label": "개구 · 귀여운 손글씨", "title": "Gaegu-Bold.ttf", "body": "Gaegu-Bold.ttf", "scale": 1.2, "desc": "cute rounded Korean handwriting"},
    "nanum_brush": {"label": "나눔붓 · 붓 손글씨", "title": "NanumBrushScript-Regular.ttf", "body": "NanumBrushScript-Regular.ttf", "scale": 1.35, "desc": "Korean brush-pen handwriting"},
    "east_sea_dokdo": {"label": "동해독도 · 날림체", "title": "EastSeaDokdo-Regular.ttf", "body": "EastSeaDokdo-Regular.ttf", "scale": 1.45, "desc": "rough, quick scribbled Korean handwriting"},
    "song_myung": {"label": "송명 · 궁서 느낌 붓 명조", "title": "SongMyung-Regular.ttf", "body": "SongMyung-Regular.ttf", "scale": 1.05, "desc": "traditional Korean brush serif (Gungseo-like)"},
    "nanum_myeongjo": {"label": "나눔명조 · 명조", "title": "NanumMyeongjo-ExtraBold.ttf", "body": "NanumMyeongjo-Regular.ttf", "scale": 1.0, "desc": "elegant Korean serif (Myeongjo)"},
    # 일본어(가나·한자)용. 가변 글꼴이라 굵기를 wght 로 고릅니다.
    "noto_sans_jp": {"label": "Noto Sans JP · 日本語", "title": "NotoSansJP-VF.ttf", "body": "NotoSansJP-VF.ttf", "scale": 1.0, "desc": "clean Japanese sans-serif (Noto Sans JP)", "wght": {"title": 800, "body": 500}},
}
# 글씨체 이름 (화면 언어별). 없는 언어는 label 을 씁니다.
FONT_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "pretendard": "Pretendard · Clean sans", "black_han_sans": "Black Han Sans · Heavy title", "do_hyeon": "Do Hyeon · Blocky title",
        "jua": "Jua · Round & cute", "nanum_pen": "Nanum Pen · Handwriting", "gaegu": "Gaegu · Cute handwriting",
        "nanum_brush": "Nanum Brush · Brush pen", "east_sea_dokdo": "East Sea Dokdo · Scribble", "song_myung": "Song Myung · Brush serif",
        "nanum_myeongjo": "Nanum Myeongjo · Serif", "noto_sans_jp": "Noto Sans JP · Japanese",
    },
    "ja": {
        "pretendard": "Pretendard · ゴシック", "black_han_sans": "Black Han Sans · 極太見出し", "do_hyeon": "Do Hyeon · 角ばった見出し",
        "jua": "Jua · 丸くてかわいい", "nanum_pen": "Nanum Pen · 手書き", "gaegu": "Gaegu · かわいい手書き",
        "nanum_brush": "Nanum Brush · 筆ペン", "east_sea_dokdo": "East Sea Dokdo · 殴り書き", "song_myung": "Song Myung · 筆の明朝",
        "nanum_myeongjo": "Nanum Myeongjo · 明朝", "noto_sans_jp": "Noto Sans JP · 日本語",
    },
}
JP_FONT = "noto_sans_jp"
# 한글 글씨체에 없는 일본어 가나·한자 (한글이 섞여 있으면 한글 글씨체를 유지)
_JAPANESE = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]")
_CJK = re.compile(r"[\u4e00-\u9fff]")
_HANGUL = re.compile(r"[\uac00-\ud7a3]")


def font_for_text(key: str, text: str) -> str:
    """글에 일본어가 있으면 일본어 글씨체로 (한글 글씨체로는 네모로 보임)."""
    if key == JP_FONT:
        return key
    if _JAPANESE.search(text) or (_CJK.search(text) and not _HANGUL.search(text)):
        return JP_FONT
    return key


def font_label(key: str, lang: str = "ko") -> str:
    return FONT_LABELS.get(lang, {}).get(key) or FONTS[key]["label"]
DEFAULT_FONT = "pretendard"


def font_key(key: str | None) -> str:
    return key if key in FONTS else DEFAULT_FONT


def _font(kind: str, size: int, key: str = DEFAULT_FONT) -> ImageFont.FreeTypeFont:
    """kind: 'title' | 'body' (예전 호출의 'ExtraBold'/'Medium' 도 받음)."""
    spec = FONTS[font_key(key)]
    kind = "title" if kind in ("title", "ExtraBold") else "body"
    font = ImageFont.truetype(str(FONT_DIR / spec[kind]), int(size * spec["scale"]))
    if "wght" in spec:  # 가변 글꼴
        font.set_variation_by_axes([spec["wght"][kind]])
    return font


# 글씨체 미리보기 문구 (한글 글씨체는 일본어 글자가 없어 ja 에서도 로마자로 보여 줍니다)
_PREVIEW_TEXT = {"ko": "가나다 손글씨 Aa 123", "en": "Hello Aa Bb 123", "ja": "Hello Aa 123"}


def font_preview(key: str, text: str = "", *, lang: str = "ko") -> bytes:
    text = text or ("あいう 日本語 Aa 123" if key == JP_FONT else _PREVIEW_TEXT.get(lang, _PREVIEW_TEXT["en"]))
    """폼에서 고를 때 보여줄 미리보기 (실제 합성과 같은 렌더링)."""
    img = Image.new("RGB", (560, 96), (252, 252, 251))
    draw = ImageDraw.Draw(img)
    draw.text((20, 48), text, font=_font("title", 44, key), fill=(17, 17, 17), anchor="lm")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int, max_lines: int) -> list[str]:
    """단어 단위로 줄바꿈하고, 한 단어가 너무 길면 글자 단위로 자릅니다."""
    lines: list[str] = []
    for para in (text or "").split("\n"):
        line = ""
        for word in para.split(" "):
            candidate = f"{line} {word}".strip()
            if draw.textlength(candidate, font=font) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
            line = ""
            for ch in word:
                if draw.textlength(line + ch, font=font) > width:
                    lines.append(line)
                    line = ch
                else:
                    line += ch
        lines.append(line)
    lines = [l for l in lines if l.strip()] or [""]
    # 마지막 줄에 한두 글자만 떨어지면(예: "BEST / 3") 앞 줄의 마지막 단어를 함께 내립니다.
    if len(lines) >= 2 and len(lines[-1].strip()) <= 3 and " " in lines[-2].strip():
        head, last_word = lines[-2].rstrip().rsplit(" ", 1)
        merged = f"{last_word} {lines[-1].strip()}"
        if draw.textlength(merged, font=font) <= width:
            lines[-2], lines[-1] = head, merged
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip()[:-1] + "…"
    return lines


def _cover_fit(photo: bytes, size: tuple[int, int]) -> Image.Image:
    img = Image.open(io.BytesIO(photo)).convert("RGB")
    return ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.45))


def cover_fit(photo: bytes, size: tuple[int, int]) -> Image.Image:
    return _cover_fit(photo, size)


def _gradient(size: tuple[int, int], start: float, alpha_top: int, alpha_bottom: int) -> Image.Image:
    w, h = size
    grad = Image.new("L", (1, h))
    for y in range(h):
        t = 0.0 if y < h * start else (y - h * start) / (h * (1 - start))
        grad.putpixel((0, y), int(alpha_top + (alpha_bottom - alpha_top) * min(1.0, t) ** 1.4))
    mask = grad.resize(size)
    overlay = Image.new("RGBA", size, (10, 10, 12, 0))
    overlay.putalpha(mask)
    return overlay


def _draw_lines(draw, lines, font, x, y, fill, gap) -> int:
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += int(font.size * gap)
    return y


# 한글 글씨체에는 이모지 글리프가 없어 네모로 보이므로 서버가 얹는 글에서는 뺍니다 (캡션의 이모지는 그대로).
_EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u200D\U000E0000-\U000E007F]")


def _no_emoji(text: str) -> str:
    return "\n".join(re.sub(r"[ \t]{2,}", " ", _EMOJI.sub("", line)).strip() for line in (text or "").splitlines()).strip()


def compose(photo: bytes, slide: dict[str, Any], *, accent: str = "#6c5ce7", font: str = DEFAULT_FONT, **_: Any) -> bytes:
    """레이아웃별로 이미지 위에 이 장의 글만 얹습니다 (배지·번호·쪽수·계정명 같은 고정 요소 없음)."""
    W, H = SIZE
    pad = 84
    role = slide["role"]
    title, body, cta = (_no_emoji(slide.get(k, "")) for k in ("title", "body", "cta"))
    font = font_for_text(font, f"{title}{body}{cta}")

    if role in ("designed", "photo") or not (title or body):
        return to_jpeg(_cover_fit(photo, SIZE), 92)  # designed 는 글자까지 이미지 모델이 그림

    if role == "panel":
        photo_h = int(H * 0.62)
        canvas = Image.new("RGB", SIZE, (250, 250, 248))
        canvas.paste(_cover_fit(photo, (W, photo_h)), (0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.rectangle((pad, photo_h + 64, pad + 56, photo_h + 70), fill=accent)
        y = photo_h + 100
        tf, bf = _font("title", 58, font), _font("body", 36, font)
        y = _draw_lines(draw, _wrap(draw, title, tf, W - pad * 2, 2), tf, pad, y, (17, 17, 17), 1.25) if title else y
        if body:
            _draw_lines(draw, _wrap(draw, body, bf, W - pad * 2, 4), bf, pad, y + 14, (80, 80, 84), 1.45)
        return to_jpeg(canvas, 92)

    base = _cover_fit(photo, SIZE).convert("RGBA")
    if role == "overlay":
        base = Image.alpha_composite(base, _gradient(SIZE, 0.45, 0, 220))
        draw = ImageDraw.Draw(base)
        tf, bf = _font("title", 84, font), _font("body", 40, font)
        tl = _wrap(draw, title, tf, W - pad * 2, 3) if title else []
        bl = _wrap(draw, body, bf, W - pad * 2, 3) if body else []
        cta_h = 84 + 32 if cta else 0
        block = len(tl) * int(tf.size * 1.18) + (24 if tl and bl else 0) + len(bl) * int(bf.size * 1.4) + cta_h
        y = H - pad - block
        y = _draw_lines(draw, tl, tf, pad, y, "white", 1.18)
        y = _draw_lines(draw, bl, bf, pad, y + (24 if tl and bl else 0), (235, 235, 240), 1.4)
        if cta:
            cf = _font("title", 32, font)
            cw = int(draw.textlength(cta, font=cf)) + 80
            draw.rounded_rectangle((pad, y + 32, pad + cw, y + 32 + 76), radius=38, fill=accent)
            draw.text((pad + cw // 2, y + 32 + 38), cta, font=cf, fill="white", anchor="mm")
        return to_jpeg(base, 92)

    # center: 이미지 위 어두운 막 + 가운데 큰 문장
    base = base.filter(ImageFilter.GaussianBlur(2))
    base = Image.alpha_composite(base, Image.new("RGBA", SIZE, (8, 8, 12, 150)))
    draw = ImageDraw.Draw(base)
    tf, bf, cf = _font("title", 76, font), _font("body", 38, font), _font("title", 32, font)
    tl = _wrap(draw, title, tf, W - pad * 2, 3) if title else []
    bl = _wrap(draw, body, bf, W - pad * 2, 4) if body else []
    block = len(tl) * int(tf.size * 1.2) + (36 if tl and bl else 0) + len(bl) * int(bf.size * 1.45) + (60 + 76 if cta else 0)
    y = (H - block) // 2
    for line in tl:
        draw.text((W // 2, y), line, font=tf, fill="white", anchor="ma")
        y += int(tf.size * 1.2)
    y += 36 if tl and bl else 0
    for line in bl:
        draw.text((W // 2, y), line, font=bf, fill=(230, 230, 236), anchor="ma")
        y += int(bf.size * 1.45)
    if cta:
        cw = int(draw.textlength(cta, font=cf)) + 80
        y += 60
        draw.rounded_rectangle(((W - cw) // 2, y, (W + cw) // 2, y + 76), radius=38, fill=accent)
        draw.text((W // 2, y + 38), cta, font=cf, fill="white", anchor="mm")
    return to_jpeg(base, 92)
