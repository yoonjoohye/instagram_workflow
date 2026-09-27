"""내 사진으로 만드는 콘텐츠 마케팅 카드뉴스 (표지 → 내용 → 결론).

1) plan    : Gemini 가 사진들과 주제를 보고 슬라이드 구성·문구·편집 지시·캡션·해시태그를 설계
2) ai_edit : Gemini 이미지 모델이 각 사진을 편집 지시에 맞게 AI 보정
3) compose : 편집된 사진 위에 한글 제목·본문을 서버에서 합성 (AI 이미지 모델은 한글을 자주 깨뜨림)

Gemini 키가 없거나 호출이 실패하면 기본 구성과 기본 보정(Pillow)으로 대신 만듭니다.
"""
from __future__ import annotations

import base64
import io
import json
import logging
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from ..config import settings

log = logging.getLogger(__name__)

SIZE = (1080, 1350)  # Instagram 세로 4:5
MAX_PHOTOS = 8  # 표지 + 사진 8장 + 결론 = 캐러셀 최대 10장
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

DEFAULT_CAPTION_FORMAT = """[후킹 한 줄]

[핵심 내용 3~5줄, 줄마다 이모지로 시작]

[마무리 한 줄 + 저장/공유 유도]

[해시태그 10~15개]"""


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


def _gemini(model: str, parts: list[dict[str, Any]], generation_config: dict[str, Any], *, timeout: float = 50.0) -> dict:
    if not settings.gemini_api_key:
        raise GeminiError("GEMINI_API_KEY 가 설정되지 않았습니다.")
    try:
        resp = httpx.post(
            GEMINI_URL.format(model=model),
            headers={"x-goog-api-key": settings.gemini_api_key},
            json={"contents": [{"role": "user", "parts": parts}], "generationConfig": generation_config},
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


# ── 1) 구성 설계 ───────────────────────────────────────────────────────
_PLAN_PROMPT = """너는 인스타그램 콘텐츠 마케팅 카드뉴스 기획자야.
첨부한 사진 {n}장(사진 번호는 0부터 첨부 순서)과 아래 주제로 캐러셀 카드뉴스를 설계해.

주제/목적: {prompt}
톤: {tone}
사진 편집 방향: {style}

구성 규칙
- cover: 스크롤을 멈추게 하는 표지. title 은 18자 이내, subtitle 은 30자 이내.
- slides: 사진마다 정확히 1장씩, 사진 순서를 이야기 흐름에 맞게 정해. heading 16자 이내, body 는 2~3문장 70자 이내.
- conclusion: 핵심 요약과 행동 유도. title 18자 이내, body 60자 이내, cta 12자 이내(예: 저장하고 다시 보기).
- 각 사진의 edit 에는 AI 이미지 편집 지시를 영어 한 문장으로 써 (사진의 내용과 구도는 유지하고, 편집 방향에 맞게 색감·조명·배경 정리 등). 글자를 넣으라는 지시는 절대 쓰지 마.
- caption 은 아래 형식을 그대로 따르되 [ ] 안내문은 실제 내용으로 바꿔. 해시태그는 caption 에 넣지 말고 hashtags 배열로 따로 줘(# 없이 10~15개, 한국어 위주).
- 사진에 없는 사실을 지어내지 마.

캡션 형식:
{caption_format}"""

_PLAN_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "cover": {
            "type": "OBJECT",
            "properties": {
                "photo": {"type": "INTEGER"},
                "title": {"type": "STRING"},
                "subtitle": {"type": "STRING"},
                "edit": {"type": "STRING"},
            },
            "required": ["photo", "title", "subtitle", "edit"],
        },
        "slides": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "photo": {"type": "INTEGER"},
                    "heading": {"type": "STRING"},
                    "body": {"type": "STRING"},
                    "edit": {"type": "STRING"},
                },
                "required": ["photo", "heading", "body", "edit"],
            },
        },
        "conclusion": {
            "type": "OBJECT",
            "properties": {
                "photo": {"type": "INTEGER"},
                "title": {"type": "STRING"},
                "body": {"type": "STRING"},
                "cta": {"type": "STRING"},
                "edit": {"type": "STRING"},
            },
            "required": ["photo", "title", "body", "cta", "edit"],
        },
        "caption": {"type": "STRING"},
        "hashtags": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["cover", "slides", "conclusion", "caption", "hashtags"],
}


def plan_cardnews(
    photos: list[bytes], *, prompt: str, tone: str, style: str, caption_format: str
) -> tuple[dict[str, Any], str, str]:
    """(설계안, 사용 엔진, 경고) — Gemini 실패 시 기본 설계안."""
    n = len(photos)
    parts: list[dict[str, Any]] = [
        {
            "text": _PLAN_PROMPT.format(
                n=n,
                prompt=prompt,
                tone=tone or "친근한",
                style=style or "자연스럽고 선명하게, 원본 분위기 유지",
                caption_format=caption_format.strip() or DEFAULT_CAPTION_FORMAT,
            )
        }
    ]
    for photo in photos:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(photo))}})
    try:
        data = _gemini(
            settings.gemini_text_model,
            parts,
            {"temperature": 0.7, "responseMimeType": "application/json", "responseSchema": _PLAN_SCHEMA},
        )
        text = next(p["text"] for p in _parts_of(data) if "text" in p)
        return _sanitize_plan(json.loads(text), n), "gemini", ""
    except (GeminiError, StopIteration, ValueError, KeyError, TypeError) as exc:
        log.warning("cardnews plan fallback: %s", exc)
        return fallback_plan(n, prompt), "template", f"Gemini 구성 실패로 기본 구성 사용: {exc}"


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _sanitize_plan(raw: dict[str, Any], n: int) -> dict[str, Any]:
    """모델 출력의 사진 번호·길이를 보정하고, 모든 사진이 내용 슬라이드에 한 번씩 쓰이게 합니다."""
    idx = lambda v, default=0: v if isinstance(v, int) and 0 <= v < n else default  # noqa: E731
    slides, used = [], set()
    for s in raw.get("slides") or []:
        p = idx(s.get("photo"), -1)
        if p < 0 or p in used:
            continue
        used.add(p)
        slides.append(
            {"photo": p, "heading": _clip(s.get("heading"), 20), "body": _clip(s.get("body"), 90), "edit": _clip(s.get("edit"), 300)}
        )
    for p in range(n):  # 빠진 사진은 뒤에 붙입니다
        if p not in used:
            slides.append({"photo": p, "heading": f"포인트 {len(slides) + 1}", "body": "", "edit": ""})
    cover, concl = raw.get("cover") or {}, raw.get("conclusion") or {}
    return {
        "cover": {
            "photo": idx(cover.get("photo")),
            "title": _clip(cover.get("title"), 24),
            "subtitle": _clip(cover.get("subtitle"), 40),
            "edit": _clip(cover.get("edit"), 300),
        },
        "slides": slides[:MAX_PHOTOS],
        "conclusion": {
            "photo": idx(concl.get("photo"), n - 1),
            "title": _clip(concl.get("title"), 24),
            "body": _clip(concl.get("body"), 80),
            "cta": _clip(concl.get("cta"), 16),
            "edit": _clip(concl.get("edit"), 300),
        },
        "caption": str(raw.get("caption") or "").strip()[:2000],
        "hashtags": [str(t).lstrip("#").strip() for t in (raw.get("hashtags") or []) if str(t).strip()][:20],
    }


def fallback_plan(n: int, prompt: str) -> dict[str, Any]:
    topic = _clip(prompt.splitlines()[0] if prompt else "오늘의 기록", 22)
    return {
        "cover": {"photo": 0, "title": topic, "subtitle": "끝까지 넘겨 보세요 👉", "edit": ""},
        "slides": [{"photo": i, "heading": f"포인트 {i + 1}", "body": "", "edit": ""} for i in range(n)],
        "conclusion": {"photo": n - 1, "title": "오늘의 정리", "body": topic, "cta": "저장하고 다시 보기", "edit": ""},
        "caption": f"{topic}\n\n사진으로 정리해 봤어요. 도움이 됐다면 저장해 두세요!",
        "hashtags": [],
    }


def slide_list(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """렌더링 순서: 표지 → 내용 → 결론."""
    return (
        [{"role": "cover", **plan["cover"]}]
        + [{"role": "content", **s} for s in plan["slides"]]
        + [{"role": "conclusion", **plan["conclusion"]}]
    )


# ── 2) AI 편집 ─────────────────────────────────────────────────────────
def ai_edit(photo: bytes, instruction: str, *, style: str = "") -> tuple[bytes, str]:
    """(편집된 이미지, 엔진). Gemini 이미지 편집 실패 시 기본 보정."""
    direction = " ".join(p for p in (instruction.strip(), style.strip()) if p) or "Enhance lighting and colors naturally."
    prompt = (
        "Edit this photo for an Instagram content-marketing card. "
        f"{direction} "
        "Keep the original subject, composition and perspective recognizable. "
        "Do not add any text, letters, logos, watermarks or borders. Photorealistic result."
    )
    try:
        data = _gemini(
            settings.gemini_image_model,
            [{"text": prompt}, {"inlineData": {"mimeType": "image/jpeg", "data": _b64(_small(photo, 1280))}}],
            {"responseModalities": ["IMAGE", "TEXT"]},
            timeout=55.0,
        )
        for part in _parts_of(data):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                img = Image.open(io.BytesIO(base64.b64decode(inline["data"]))).convert("RGB")
                return to_jpeg(img), "gemini"
        raise GeminiError("편집 이미지가 응답에 없습니다.")
    except (GeminiError, OSError, ValueError) as exc:
        log.warning("ai_edit fallback: %s", exc)
        return basic_enhance(photo), f"basic ({exc})"


def basic_enhance(photo: bytes) -> bytes:
    img = ImageOps.autocontrast(Image.open(io.BytesIO(photo)).convert("RGB"), cutoff=1)
    img = ImageEnhance.Color(img).enhance(1.12)
    img = ImageEnhance.Sharpness(img).enhance(1.15)
    return to_jpeg(img)


# ── 3) 카드 합성 ───────────────────────────────────────────────────────
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
