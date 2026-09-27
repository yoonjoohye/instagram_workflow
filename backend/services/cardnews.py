"""내 사진으로 만드는 콘텐츠 마케팅 카드뉴스 (표지 → 내용 → 결론).

1) research      : Gemini + Google 검색으로 주제를 조사 (사실·절차·주의사항, 출처)
2) plan          : 조사 결과·사진·주제로 슬라이드 구성·문구·슬라이드별 연출 지시를 설계하고,
                   캡션은 양식의 [칸]별로 받아 서버가 양식 그대로 조립
3) render_visual : Gemini 이미지 모델이 연출 지시대로 사진을 재구성하거나(사진 있음), 새로 생성(-1)
4) compose       : 이미지 위에 한글 제목·본문을 서버에서 합성 (AI 이미지 모델은 한글을 자주 깨뜨림)

Gemini 키가 없거나 호출이 실패하면 기본 구성과 기본 보정(Pillow)으로 대신 만듭니다.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from ..config import settings

log = logging.getLogger(__name__)

SIZE = (1080, 1350)  # Instagram 세로 4:5
MAX_PHOTOS = 8  # 업로드 최대 장수
MAX_CONTENT = 8  # 표지 + 내용 8장 + 결론 = 캐러셀 최대 10장
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


def _parts_of(data: dict) -> list[dict[str, Any]]:
    try:
        return data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as exc:
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "응답이 비어 있습니다"
        raise GeminiError(f"Gemini 응답 없음: {reason}") from exc


def _text_of(data: dict) -> str:
    return "".join(p.get("text", "") for p in _parts_of(data)).strip()


# ── 1) 주제 조사 (Google 검색) ────────────────────────────────────────
_RESEARCH_PROMPT = """너는 인스타그램 콘텐츠 마케팅 카드뉴스의 리서처야. Google 검색으로 아래 주제를 조사해 카드뉴스에 쓸 사실을 정리해.

주제/목적: {prompt}
사용자가 준 확정 정보(그대로 신뢰): {notes}

정리 형식 (한국어, 사실만, 추측 금지):
1) 한 줄 요약
2) 핵심 사실 6~10개 — 정의, 특징·장점, 절차/방법(단계별), 조건·수수료·주의사항, 최신 변경 사항 등 주제에 필요한 것
3) 독자가 가장 궁금해할 질문 3개
확인되지 않는 내용은 쓰지 말고, 날짜가 중요한 정보에는 기준 시점을 적어."""


def research(prompt: str, notes: str) -> tuple[dict[str, Any], str]:
    """(조사 결과 {notes, sources}, 경고). 검색이 안 되면 빈 결과로 계속 진행합니다."""
    parts = [{"text": _RESEARCH_PROMPT.format(prompt=prompt, notes=notes.strip() or "없음")}]
    try:
        data = _gemini(settings.gemini_text_model, parts, {"temperature": 0.2}, tools=[{"googleSearch": {}}], timeout=55.0)
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
PLACEHOLDER = re.compile(r"\[([^\[\]\n]{1,60})\]")
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


_PLAN_PROMPT = """너는 인스타그램 콘텐츠 마케팅 카드뉴스 기획자이자 아트 디렉터야.
주제와 조사 자료, 첨부한 사진 {n}장(번호는 0부터 첨부 순서)을 보고 저장·공유하고 싶어지는 정보성 캐러셀을 설계해.
{refs}

주제/목적: {prompt}
톤: {tone}
사용자 확정 정보(그대로 사용, 바꾸지 마): {notes}
연출 방향(사용자 요청, 없으면 네가 판단): {style}

조사 자료 (Google 검색 결과 요약 — 여기에 없는 사실은 지어내지 마):
{research}

슬라이드 규칙
- 흐름: cover(후킹) → slides(핵심 정보 3~{max_slides}장, 한 장에 한 메시지) → conclusion(요약·행동 유도).
- 텍스트: cover.title 18자 이내, subtitle 30자 이내 / slides.heading 16자 이내, body 2~3문장 70자 이내 / conclusion.title 18자, body 60자, cta 12자 이내.
- 사진 배정: photo 에 사용할 사진 번호. 첨부한 모든 사진을 slides 에 최소 한 번씩 써. 설명에 꼭 필요한데 맞는 사진이 없으면 photo 를 -1 로 두고 새 이미지를 만들게 해.
- visual: 이미지 생성 AI 에게 줄 영어 연출 지시 2~4문장. 이 슬라이드의 메시지를 한눈에 보여주는 구체적인 장면·소품·구도·조명·색감을 적어.
  사진이 있으면(photo ≥ 0) 그 사진을 바탕으로 무엇을 어떻게 바꿔 메시지를 살릴지(배경 교체, 관련 소품 추가, 재구성 등), 없으면(-1) 처음부터 그릴 장면을 적어.
  읽을 수 있는 글자·숫자·로고는 절대 넣지 말라고 적고, cover 는 아래쪽 40% 가 단순하고 어둡게, conclusion 은 전체가 차분하게 해서 글자를 얹을 공간을 남겨.

캡션 규칙 (매우 중요)
- 아래 캡션 양식에는 채워야 할 칸이 {k}개 있어: {names}
- caption_parts 배열에 정확히 {k}개의 문자열을 칸 순서대로 넣어. 각 문자열은 해당 칸의 내용만 (칸 이름·대괄호·다른 칸 내용 금지).
- 칸 이름의 지시를 그대로 지켜: 'N줄'이면 정확히 N줄(줄바꿈으로 구분), '설명'이면 설명, '방법'이면 단계별로 줄바꿈해서.
- 사용자 확정 정보와 조사 자료에 없는 사실(예: 추천인 코드·링크·가격)이 필요하면 지어내지 말고 '⚠️ 직접 입력: (무엇이 필요한지)' 라고만 써.
- 해시태그는 caption_parts 에 넣지 말고 hashtags 배열(# 없이 10~15개)로.

캡션 양식:
{template}"""


def _plan_schema(k: int) -> dict[str, Any]:
    visual = {"type": "STRING"}
    return {
        "type": "OBJECT",
        "properties": {
            "cover": {
                "type": "OBJECT",
                "properties": {"photo": {"type": "INTEGER"}, "title": {"type": "STRING"}, "subtitle": {"type": "STRING"}, "visual": visual},
                "required": ["photo", "title", "subtitle", "visual"],
            },
            "slides": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {"photo": {"type": "INTEGER"}, "heading": {"type": "STRING"}, "body": {"type": "STRING"}, "visual": visual},
                    "required": ["photo", "heading", "body", "visual"],
                },
            },
            "conclusion": {
                "type": "OBJECT",
                "properties": {
                    "photo": {"type": "INTEGER"},
                    "title": {"type": "STRING"},
                    "body": {"type": "STRING"},
                    "cta": {"type": "STRING"},
                    "visual": visual,
                },
                "required": ["photo", "title", "body", "cta", "visual"],
            },
            "caption_parts": {"type": "ARRAY", "items": {"type": "STRING"}, "minItems": k, "maxItems": k},
            "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["cover", "slides", "conclusion", "caption_parts", "hashtags"],
    }


def plan_cardnews(
    photos: list[bytes],
    *,
    prompt: str,
    tone: str,
    style: str,
    caption_format: str,
    notes: str = "",
    research_notes: str = "",
    references: list[bytes] | None = None,
) -> tuple[dict[str, Any], str, str]:
    """(설계안, 사용 엔진, 경고) — Gemini 실패 시 기본 설계안. references 는 연출 참고 이미지."""
    n = len(photos)
    references = references or []
    template = caption_format.strip() or DEFAULT_CAPTION_FORMAT
    names = [p for p in placeholders(template) if "해시태그" not in p and "hashtag" not in p.lower()]
    text = _PLAN_PROMPT.format(
        n=n,
        prompt=prompt,
        tone=tone or "친근한",
        notes=notes.strip() or "없음",
        style=style.strip() or "없음",
        research=research_notes.strip() or "(조사 자료 없음 — 사진과 사용자 정보만 사용)",
        max_slides=MAX_CONTENT,
        k=len(names),
        names=", ".join(f"[{x}]" for x in names) or "(없음 — caption_parts 에 캡션 전체를 1개로)",
        template=template,
        refs=(
            f"그 뒤에 첨부한 {len(references)}장은 연출 '참고 이미지'야. 슬라이드 사진으로 배정하지 말고(사진 번호 아님), "
            "모든 visual 을 쓸 때 참고 이미지의 색감·조명·구도·분위기·스타일을 따라가도록 구체적으로 반영해."
            if references
            else ""
        ),
    )
    parts: list[dict[str, Any]] = [{"text": text}]
    for photo in photos:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(photo))}})
    for ref in references:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(ref, 512))}})
    try:
        data = _gemini(
            settings.gemini_text_model,
            parts,
            {"temperature": 0.6, "responseMimeType": "application/json", "responseSchema": _plan_schema(max(1, len(names)))},
            timeout=55.0,
        )
        raw = json.loads(_text_of(data))
        design = _sanitize_plan(raw, n)
    except (GeminiError, ValueError, KeyError, TypeError) as exc:
        log.warning("cardnews plan fallback: %s", exc)
        design, engine, warning = fallback_plan(n, prompt), "template", f"Gemini 구성 실패로 기본 구성 사용: {exc}"
        raw = {"caption_parts": []}
    else:
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
        caption, tags_inline = "\n".join(str(p) for p in raw.get("caption_parts") or []).strip() or template, False
    design["caption"] = caption[:2200]
    design["hashtags_inline"] = tags_inline
    design["caption_format"] = template
    return design, engine, warning


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _sanitize_plan(raw: dict[str, Any], n: int) -> dict[str, Any]:
    """사진 번호·길이를 보정하고, 모든 사진이 내용 슬라이드에 최소 한 번 쓰이게 합니다. (-1 = 새 이미지 생성)"""

    def idx(v: Any, default: int) -> int:
        if v == -1:
            return -1
        return v if isinstance(v, int) and 0 <= v < n else default

    def slide(s: dict[str, Any]) -> dict[str, Any]:
        return {
            "photo": idx(s.get("photo"), -1),
            "heading": _clip(s.get("heading"), 20),
            "body": _clip(s.get("body"), 90),
            "visual": _clip(s.get("visual") or s.get("edit"), 600),
        }

    slides = [slide(s) for s in (raw.get("slides") or []) if isinstance(s, dict)]
    used = {s["photo"] for s in slides if s["photo"] >= 0}
    for p in range(n):  # 빠진 사진은 뒤에 붙입니다
        if p not in used:
            slides.append({"photo": p, "heading": f"포인트 {len(slides) + 1}", "body": "", "visual": ""})
    cover, concl = raw.get("cover") or {}, raw.get("conclusion") or {}
    return {
        "cover": {
            "photo": idx(cover.get("photo"), 0 if n else -1),
            "title": _clip(cover.get("title"), 24),
            "subtitle": _clip(cover.get("subtitle"), 40),
            "visual": _clip(cover.get("visual") or cover.get("edit"), 600),
        },
        "slides": slides[:MAX_CONTENT],
        "conclusion": {
            "photo": idx(concl.get("photo"), n - 1 if n else -1),
            "title": _clip(concl.get("title"), 24),
            "body": _clip(concl.get("body"), 80),
            "cta": _clip(concl.get("cta"), 16),
            "visual": _clip(concl.get("visual") or concl.get("edit"), 600),
        },
        "hashtags": [str(t).lstrip("#").strip() for t in (raw.get("hashtags") or []) if str(t).strip()][:20],
    }


def fallback_plan(n: int, prompt: str) -> dict[str, Any]:
    topic = _clip(prompt.splitlines()[0] if prompt else "오늘의 기록", 22)
    return {
        "cover": {"photo": 0, "title": topic, "subtitle": "끝까지 넘겨 보세요 👉", "visual": ""},
        "slides": [{"photo": i, "heading": f"포인트 {i + 1}", "body": "", "visual": ""} for i in range(n)],
        "conclusion": {"photo": n - 1, "title": "오늘의 정리", "body": topic, "cta": "저장하고 다시 보기", "visual": ""},
        "hashtags": [],
    }


def slide_list(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """렌더링 순서: 표지 → 내용 → 결론."""
    return (
        [{"role": "cover", **plan["cover"]}]
        + [{"role": "content", **s} for s in plan["slides"]]
        + [{"role": "conclusion", **plan["conclusion"]}]
    )


# ── 3) 이미지 연출 (편집 · 생성) ─────────────────────────────────────────
# 내용 슬라이드는 위쪽 62% 에 이미지가 들어가므로 가로형, 표지·결론은 세로 4:5.
ASPECT = {"cover": "4:5", "content": "4:3", "conclusion": "4:5"}


def _visual_prompt(slide: dict[str, Any], *, topic: str, style: str, instruction: str, has_photo: bool) -> str:
    message = " — ".join(
        p for p in (slide.get("title") or slide.get("heading"), slide.get("subtitle") or slide.get("body")) if p
    )
    direction = instruction.strip() or slide.get("visual", "").strip() or "Show the subject clearly with natural, appealing light."
    base = (
        "Use the provided photo as the base. Keep its main subject recognizable, but you may re-compose the scene, "
        "replace or clean up the background, adjust lighting and color, and add relevant objects so the image clearly "
        "conveys the message."
        if has_photo
        else "Create a new photorealistic image from scratch."
    )
    layout = {
        "cover": "Keep the lower 40% of the frame simple and darker so a title can be placed there.",
        "content": "Wide framing with the key subject centered.",
        "conclusion": "Calm, uncluttered composition with soft contrast so text can sit on top.",
    }[slide["role"]]
    return (
        f"You are the art director of an Instagram content-marketing card-news post about: {topic}. "
        f"This slide says (Korean): {message}. "
        f"{base} Creative direction: {direction} "
        + (f"Overall style requested by the user: {style}. " if style.strip() else "")
        + f"{layout} "
        "Absolutely no readable text, letters, numbers, logos, watermarks, UI labels or borders anywhere in the image. "
        "High quality, realistic, Instagram-worthy."
    )


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
            # 모델을 찾을 수 없을 때만 구형 모델로 다시 시도합니다.
            if "not found" not in str(exc).lower() and "not supported" not in str(exc).lower():
                break
    raise GeminiError(str(last))


def render_visual(
    photo: bytes | None,
    slide: dict[str, Any],
    *,
    topic: str,
    style: str = "",
    instruction: str = "",
    references: list[bytes] | None = None,
) -> tuple[bytes, str]:
    """(이미지, 엔진). 사진이 있으면 연출 편집, 없으면(-1) 새로 생성. 실패하면 기본 보정/배경.
    references 는 색감·분위기만 참고할 스타일 이미지 (첫 이미지 = 편집할 사진)."""
    references = references or []
    prompt = _visual_prompt(slide, topic=topic, style=style, instruction=instruction, has_photo=photo is not None)
    if references:
        which = f"The last {len(references)} attached image(s)" if photo is not None else f"The {len(references)} attached image(s)"
        prompt += (
            f" {which} are STYLE REFERENCES only: match their color grading, lighting, mood and composition style, "
            "but do not copy their subjects."
        )
    parts: list[dict[str, Any]] = [{"text": prompt}]
    if photo is not None:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(photo, 1280))}})
    for ref in references[:3]:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(ref, 640))}})
    try:
        return _image_call(parts, ASPECT[slide["role"]]), "gemini"
    except (GeminiError, OSError, ValueError) as exc:
        log.warning("render_visual fallback: %s", exc)
        return (basic_enhance(photo) if photo is not None else placeholder_background()), f"basic ({exc})"


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
def _font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / f"Pretendard-{weight}.otf"), size)


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


def compose(photo: bytes, slide: dict[str, Any], *, index: int, total: int, handle: str, accent: str = "#6c5ce7") -> bytes:
    W, H = SIZE
    pad = 84
    if slide["role"] == "content":
        # 위 62% 사진 + 아래 밝은 패널
        photo_h = int(H * 0.62)
        canvas = Image.new("RGB", SIZE, (250, 250, 248))
        canvas.paste(_cover_fit(photo, (W, photo_h)), (0, 0))
        draw = ImageDraw.Draw(canvas)
        badge_font = _font("ExtraBold", 34)
        num = f"{index:02d}"
        draw.rounded_rectangle((pad, photo_h + 56, pad + 92, photo_h + 56 + 56), radius=28, fill=accent)
        draw.text((pad + 46, photo_h + 84), num, font=badge_font, fill="white", anchor="mm")
        y = photo_h + 140
        y = _draw_lines(draw, _wrap(draw, slide.get("heading", ""), _font("ExtraBold", 58), W - pad * 2, 2), _font("ExtraBold", 58), pad, y, (17, 17, 17), 1.25)
        _draw_lines(draw, _wrap(draw, slide.get("body", ""), _font("Medium", 36), W - pad * 2, 3), _font("Medium", 36), pad, y + 14, (80, 80, 84), 1.45)
        foot = _font("Medium", 26)
        draw.text((pad, H - 64), f"@{handle}", font=foot, fill=(140, 140, 146))
        draw.text((W - pad, H - 64), f"{index + 1} / {total}", font=foot, fill=(140, 140, 146), anchor="ra")
        return to_jpeg(canvas, 92)

    base = _cover_fit(photo, SIZE).convert("RGBA")
    if slide["role"] == "cover":
        base = Image.alpha_composite(base, _gradient(SIZE, 0.38, 0, 225))
        draw = ImageDraw.Draw(base)
        title_font, sub_font = _font("ExtraBold", 92), _font("Medium", 40)
        title = _wrap(draw, slide.get("title", ""), title_font, W - pad * 2, 3)
        sub = _wrap(draw, slide.get("subtitle", ""), sub_font, W - pad * 2, 2)
        block = len(title) * int(title_font.size * 1.18) + 24 + len(sub) * int(sub_font.size * 1.4)
        y = H - pad - 40 - block
        draw.rounded_rectangle((pad, y - 76, pad + 150, y - 30), radius=23, fill=accent)
        draw.text((pad + 75, y - 53), "CARD NEWS", font=_font("ExtraBold", 22), fill="white", anchor="mm")
        y = _draw_lines(draw, title, title_font, pad, y, "white", 1.18)
        _draw_lines(draw, sub, sub_font, pad, y + 24, (235, 235, 240), 1.4)
        draw.text((pad, pad - 20), f"@{handle}", font=_font("Medium", 28), fill=(255, 255, 255, 230))
        return to_jpeg(base, 92)

    # conclusion: 사진 위 어두운 막 + 가운데 정렬
    base = base.filter(ImageFilter.GaussianBlur(2))
    base = Image.alpha_composite(base, Image.new("RGBA", SIZE, (8, 8, 12, 168)))
    draw = ImageDraw.Draw(base)
    title_font, body_font, cta_font = _font("ExtraBold", 76), _font("Medium", 38), _font("ExtraBold", 34)
    title = _wrap(draw, slide.get("title", ""), title_font, W - pad * 2, 2)
    body = _wrap(draw, slide.get("body", ""), body_font, W - pad * 2, 3)
    block = len(title) * int(title_font.size * 1.2) + 36 + len(body) * int(body_font.size * 1.45) + 60 + 84
    y = (H - block) // 2
    for line in title:
        draw.text((W // 2, y), line, font=title_font, fill="white", anchor="ma")
        y += int(title_font.size * 1.2)
    y += 36
    for line in body:
        draw.text((W // 2, y), line, font=body_font, fill=(230, 230, 236), anchor="ma")
        y += int(body_font.size * 1.45)
    cta = slide.get("cta") or "저장하고 다시 보기"
    cw = int(draw.textlength(cta, font=cta_font)) + 96
    y += 60
    draw.rounded_rectangle(((W - cw) // 2, y, (W + cw) // 2, y + 84), radius=42, fill=accent)
    draw.text((W // 2, y + 42), cta, font=cta_font, fill="white", anchor="mm")
    draw.text((W // 2, H - 72), f"@{handle}", font=_font("Medium", 28), fill=(210, 210, 216), anchor="ma")
    return to_jpeg(base, 92)
