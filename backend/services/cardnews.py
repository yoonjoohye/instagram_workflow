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
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from ..config import settings

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


def _parts_of(data: dict) -> list[dict[str, Any]]:
    try:
        return data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as exc:
        reason = (data.get("promptFeedback") or {}).get("blockReason") or "응답이 비어 있습니다"
        raise GeminiError(f"Gemini 응답 없음: {reason}") from exc


def _text_of(data: dict) -> str:
    return "".join(p.get("text", "") for p in _parts_of(data)).strip()


# ── 1) 주제 조사 (Google 검색) ────────────────────────────────────────
_RESEARCH_PROMPT = """너는 인스타그램 게시물 리서처야. Google 검색으로 아래 주제를 조사해 게시물에 쓸 내용을 정리해.

주제/컨셉: {prompt}
사용자가 준 확정 정보(그대로 신뢰): {notes}

주제가 정보·방법·제품·서비스처럼 사실이 중요한 내용이면:
1) 한 줄 요약  2) 핵심 사실 6~10개 (정의, 특징, 절차·방법, 조건·비용·주의사항, 최신 변경)  3) 독자가 궁금해할 질문 3개
주제가 감성·일상·여행 기록처럼 분위기가 중요한 내용이면: 관련 배경 지식과 표현에 쓸 만한 사실 몇 줄만.
한국어로, 확인된 사실만 쓰고 추측하지 마. 날짜가 중요한 정보에는 기준 시점을 적어."""


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


_PLAN_PROMPT = """너는 인스타그램 게시물 크리에이티브 디렉터야. 사용자가 요청한 주제와 컨셉을 그대로 살려 게시물을 설계해.
정해진 구성이나 장수는 없어.

주제/컨셉: {prompt}
연출 방향 (최우선 — 반드시 지켜. 형식·그림체·구도·글자 표현을 이 요청대로 해): {style}
사용자 확정 정보(그대로 사용, 바꾸지 마): {notes}
※ 아래 캡션 양식 안에 적힌 사실(칸 밖 문장, '[추천인 정보: 코드 ABC123]'처럼 칸 이름 속 정보)도 모두 확정 정보야. 그대로 쓰고 바꾸지 마.

첨부 사진: {n}장 (번호는 0부터 첨부 순서){refs}

조사 자료 (Google 검색 요약 — 정보가 필요한 경우에만 쓰고, 여기에 없는 사실은 지어내지 마):
{research}

1) 형식(format) 정하기 — 주제·컨셉·연출 방향에 나온 형식을 그대로 따르고, 언급이 없으면 가장 잘 맞는 것을 골라:
  인스타툰/웹툰(캐릭터·말풍선 컷), 손글씨 메모(사진이나 종이 위 손글씨·동그라미·화살표 낙서), 인터뷰/Q&A, 이벤트·프로모션 포스터,
  정보 정리형(체크리스트·단계별 안내·비교), 감성 사진/무드보드, 비포·애프터, 인용 한 줄 등. 특정 형식을 기본값처럼 쓰지 마.
2) art_style: 모든 이미지에 똑같이 적용할 그림체를 영어로 구체적으로 (예: 'Korean Instagram webtoon, clean black line art, flat pastel colors, rounded chibi character' /
  'real photo with white hand-drawn iPad marker doodles and Korean handwriting' / 'natural film photography, warm grain').
  연출 방향과 참고 이미지를 가장 크게 반영하고, 요청이 그림체면 실사로 바꾸지 마.

슬라이드 규칙
- slides 는 1~{max_slides}장. 형식과 컨셉에 필요한 만큼만. 1장이면 단일 게시물이 돼.
- 첨부 사진은 컨셉에 맞는 것만 골라 써 (웹툰처럼 그림체면 사진을 그 그림체로 다시 그리는 참고로 써). 맞는 사진이 없으면 photo 를 -1 로 두고 새로 만들게 해.
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

캡션 규칙 (매우 중요)
- 아래 캡션 양식에는 채워야 할 칸이 {k}개 있어: {names}
- caption_parts 배열에 정확히 {k}개의 문자열을 칸 순서대로 넣어. 각 문자열은 해당 칸의 내용만 (칸 이름·대괄호·다른 칸 내용 금지).
- 칸 이름의 지시를 그대로 지켜: 'N줄'이면 정확히 N줄(줄바꿈으로 구분), '설명'이면 설명, '방법'이면 단계별로 줄바꿈해서.
- 칸 이름에 정보가 들어 있으면(예: '[추천인 정보: 코드 ABC123, 가입 시 £5]') 그 정보를 빠짐없이 자연스러운 문장으로 써.
- 사용자 확정 정보와 조사 자료에 없는 사실(예: 추천인 코드·링크·가격)이 필요하면 지어내지 말고 '⚠️ 직접 입력: (무엇이 필요한지)' 라고만 써.
- 해시태그는 caption_parts 에 넣지 말고 hashtags 배열(# 없이 10~15개)로.

캡션 양식:
{template}"""

LAYOUTS = ("designed", "photo", "overlay", "panel", "center")


def _plan_schema(k: int) -> dict[str, Any]:
    return {
        "type": "OBJECT",
        "properties": {
            "concept": {"type": "STRING"},
            "format": {"type": "STRING"},
            "art_style": {"type": "STRING"},
            "slides": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "photo": {"type": "INTEGER"},
                        "layout": {"type": "STRING", "enum": list(LAYOUTS)},
                        "title": {"type": "STRING"},
                        "body": {"type": "STRING"},
                        "cta": {"type": "STRING"},
                        "image_text": {"type": "STRING"},
                        "visual": {"type": "STRING"},
                    },
                    "required": ["photo", "layout", "title", "body", "cta", "image_text", "visual"],
                },
            },
            "caption_parts": {"type": "ARRAY", "items": {"type": "STRING"}, "minItems": k, "maxItems": k},
            "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
        },
        "required": ["concept", "format", "art_style", "slides", "caption_parts", "hashtags"],
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
) -> tuple[dict[str, Any], str, str]:
    """(설계안, 사용 엔진, 경고) — Gemini 실패 시 기본 설계안. references 는 연출 참고 이미지."""
    n = len(photos)
    references = references or []
    template = caption_format.strip() or DEFAULT_CAPTION_FORMAT
    names = [p for p in placeholders(template) if "해시태그" not in p and "hashtag" not in p.lower()]
    text = _PLAN_PROMPT.format(
        n=n,
        prompt=prompt,
        notes=notes.strip() or "없음",
        style=style.strip() or "(없음 — 컨셉에 맞게 네가 판단)",
        research=research_notes.strip() or "(조사 자료 없음)",
        max_slides=MAX_SLIDES,
        k=len(names),
        names=", ".join(f"[{x}]" for x in names) or "(없음 — caption_parts 에 캡션 전체를 1개로)",
        template=template,
        refs=(
            f"\n그 뒤에 첨부한 {len(references)}장은 연출 '참고 이미지'야. 슬라이드 사진으로 배정하지 말고(사진 번호 아님), "
            "모든 visual 에 참고 이미지의 색감·조명·구도·분위기·스타일을 구체적으로 반영해."
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
            {"temperature": 0.7, "responseMimeType": "application/json", "responseSchema": _plan_schema(max(1, len(names)))},
            timeout=55.0,
        )
        raw = json.loads(_text_of(data))
        design = _sanitize_plan(raw, n)
    except (GeminiError, ValueError, KeyError, TypeError) as exc:
        log.warning("post plan fallback: %s", exc)
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
    """사진 번호·레이아웃·길이를 보정합니다. 컨셉에 맞지 않는 사진은 쓰지 않아도 됩니다 (-1 = 새 이미지 생성)."""

    def slide(s: dict[str, Any]) -> dict[str, Any]:
        photo = s.get("photo")
        photo = photo if isinstance(photo, int) and 0 <= photo < n else -1
        layout = s.get("layout") if s.get("layout") in LAYOUTS else "overlay"
        title, body = _clip(s.get("title"), 26), _clip(s.get("body"), 100)
        image_text = _clip(s.get("image_text"), 160)
        if layout in ("overlay", "panel", "center") and not (title or body):
            layout = "photo"  # 서버가 얹을 글이 없으면 이미지만
        server_text = layout in ("overlay", "panel", "center")
        return {
            "photo": photo,
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
        "concept": _clip(raw.get("concept"), 200),
        "format": _clip(raw.get("format"), 60),
        "art_style": _clip(raw.get("art_style"), 400),
        "slides": slides,
        "hashtags": [str(t).lstrip("#").strip() for t in (raw.get("hashtags") or []) if str(t).strip()][:20],
    }


def fallback_plan(n: int, prompt: str) -> dict[str, Any]:
    """Gemini 없이: 올린 사진을 순서대로 쓰고, 첫 장에만 주제를 얹습니다 (고정 문구 없음)."""
    topic = _clip(prompt.splitlines()[0] if prompt else "", 26)
    if n == 0:
        return {"concept": topic, "slides": [{"photo": -1, "layout": "center" if topic else "photo", "title": topic, "body": "", "cta": "", "visual": ""}], "hashtags": []}
    slides = [{"photo": i, "layout": "photo", "title": "", "body": "", "cta": "", "visual": ""} for i in range(min(n, MAX_SLIDES))]
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
    has_photo: bool,
    art_style: str = "",
    post_format: str = "",
) -> str:
    """이미지 모델 지시문. 사용자 연출 방향을 맨 앞(최우선)에, 게시물 전체 그림체를 모든 장에 공통으로."""
    role = slide["role"]
    lines: list[str] = []
    if style.strip():
        lines.append(f"USER'S ART DIRECTION (highest priority, follow it exactly): {style.strip()}")
    if instruction.strip():
        lines.append(f"Revision request for this image (also highest priority): {instruction.strip()}")
    lines.append(f"Instagram post concept: {topic}." + (f" Post format: {post_format}." if post_format else ""))
    if art_style:
        lines.append(f"Art style for every image in this post (keep it identical across images): {art_style}")
    if slide.get("visual"):
        lines.append(f"This image: {slide['visual']}")
    message = " — ".join(p for p in (slide.get("title"), slide.get("body")) if p)
    if message and role != "designed":
        lines.append(f"It illustrates this message (Korean): {message}")
    lines.append(
        "Use the attached photo as the base/reference: keep its key subject recognizable but transform it into the art style "
        "and scene described above (re-draw, re-compose, change background or add elements as needed)."
        if has_photo
        else "Create this image from scratch in the art style described above."
    )
    if role == "designed":
        text = (slide.get("image_text") or "").strip()
        if text:
            lines.append(
                "The image must include this Korean text as part of the design (speech bubbles, handwriting, doodle labels or "
                f"a headline, as fitting the style), written exactly as given, character by character: «{text}». "
                "Keep every Korean character correct and legible. Do not add any other text, watermark or logo."
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
    photo: bytes | None,
    slide: dict[str, Any],
    *,
    topic: str,
    style: str = "",
    instruction: str = "",
    references: list[bytes] | None = None,
    art_style: str = "",
    post_format: str = "",
) -> tuple[bytes, str]:
    """(이미지, 엔진). 사진이 있으면 연출 편집, 없으면(-1) 새로 생성. 실패하면 기본 보정/배경.
    references 는 색감·분위기만 참고할 스타일 이미지 (첫 이미지 = 편집할 사진)."""
    references = references or []
    prompt = _visual_prompt(
        slide,
        topic=topic,
        style=style,
        instruction=instruction,
        has_photo=photo is not None,
        art_style=art_style,
        post_format=post_format,
    )
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


def compose(photo: bytes, slide: dict[str, Any], *, accent: str = "#6c5ce7", **_: Any) -> bytes:
    """레이아웃별로 이미지 위에 이 장의 글만 얹습니다 (배지·번호·쪽수·계정명 같은 고정 요소 없음)."""
    W, H = SIZE
    pad = 84
    role = slide["role"]
    title, body, cta = slide.get("title", ""), slide.get("body", ""), slide.get("cta", "")

    if role in ("designed", "photo") or not (title or body):
        return to_jpeg(_cover_fit(photo, SIZE), 92)  # designed 는 글자까지 이미지 모델이 그림

    if role == "panel":
        photo_h = int(H * 0.62)
        canvas = Image.new("RGB", SIZE, (250, 250, 248))
        canvas.paste(_cover_fit(photo, (W, photo_h)), (0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.rectangle((pad, photo_h + 64, pad + 56, photo_h + 70), fill=accent)
        y = photo_h + 100
        tf, bf = _font("ExtraBold", 58), _font("Medium", 36)
        y = _draw_lines(draw, _wrap(draw, title, tf, W - pad * 2, 2), tf, pad, y, (17, 17, 17), 1.25) if title else y
        if body:
            _draw_lines(draw, _wrap(draw, body, bf, W - pad * 2, 4), bf, pad, y + 14, (80, 80, 84), 1.45)
        return to_jpeg(canvas, 92)

    base = _cover_fit(photo, SIZE).convert("RGBA")
    if role == "overlay":
        base = Image.alpha_composite(base, _gradient(SIZE, 0.45, 0, 220))
        draw = ImageDraw.Draw(base)
        tf, bf = _font("ExtraBold", 84), _font("Medium", 40)
        tl = _wrap(draw, title, tf, W - pad * 2, 3) if title else []
        bl = _wrap(draw, body, bf, W - pad * 2, 3) if body else []
        cta_h = 84 + 32 if cta else 0
        block = len(tl) * int(tf.size * 1.18) + (24 if tl and bl else 0) + len(bl) * int(bf.size * 1.4) + cta_h
        y = H - pad - block
        y = _draw_lines(draw, tl, tf, pad, y, "white", 1.18)
        y = _draw_lines(draw, bl, bf, pad, y + (24 if tl and bl else 0), (235, 235, 240), 1.4)
        if cta:
            cf = _font("ExtraBold", 32)
            cw = int(draw.textlength(cta, font=cf)) + 80
            draw.rounded_rectangle((pad, y + 32, pad + cw, y + 32 + 76), radius=38, fill=accent)
            draw.text((pad + cw // 2, y + 32 + 38), cta, font=cf, fill="white", anchor="mm")
        return to_jpeg(base, 92)

    # center: 이미지 위 어두운 막 + 가운데 큰 문장
    base = base.filter(ImageFilter.GaussianBlur(2))
    base = Image.alpha_composite(base, Image.new("RGBA", SIZE, (8, 8, 12, 150)))
    draw = ImageDraw.Draw(base)
    tf, bf, cf = _font("ExtraBold", 76), _font("Medium", 38), _font("ExtraBold", 32)
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
