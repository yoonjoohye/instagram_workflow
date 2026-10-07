"""글자 합성: 레이아웃(overlay/panel/center)대로 제목·문장을 서버가 이미지에 얹습니다 (AI 이미지 모델은 한글을 자주 깨뜨림)."""
from __future__ import annotations

from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .fonts import DEFAULT_FONT, font_for_text, load_font
from .imaging import cover_fit, to_jpeg
from .limits import SIZE, STORY_SAFE_BOTTOM, STORY_SAFE_TOP, STORY_SIZE
from .textutil import no_emoji


def wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, width: int, max_lines: int) -> list[str]:
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


def gradient(size: tuple[int, int], start: float, alpha_top: int, alpha_bottom: int) -> Image.Image:
    w, h = size
    grad = Image.new("L", (1, h))
    for y in range(h):
        t = 0.0 if y < h * start else (y - h * start) / (h * (1 - start))
        grad.putpixel((0, y), int(alpha_top + (alpha_bottom - alpha_top) * min(1.0, t) ** 1.4))
    mask = grad.resize(size)
    overlay = Image.new("RGBA", size, (10, 10, 12, 0))
    overlay.putalpha(mask)
    return overlay


def draw_lines(draw, lines, font, x, y, fill, gap) -> int:
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        y += int(font.size * gap)
    return y


ACCENT = "#6c5ce7"  # 글 영역의 강조 막대·버튼 색


def compose(
    photo: bytes, slide: dict[str, Any], *, accent: str = ACCENT, font: str = DEFAULT_FONT, size: tuple[int, int] = SIZE
) -> bytes:
    """레이아웃별로 이미지 위에 이 장의 글만 얹습니다 (배지·번호·쪽수·계정명 같은 고정 요소 없음).
    size 가 스토리(9:16)면 위·아래 가려지는 영역을 피해 글을 둡니다."""
    W, H = size
    pad = 84
    story = size == STORY_SIZE
    top_inset = STORY_SAFE_TOP if story else 0
    bottom_inset = STORY_SAFE_BOTTOM if story else 0
    role = slide["role"]
    title, body, cta = (no_emoji(slide.get(k, "")) for k in ("title", "body", "cta"))
    font = font_for_text(font, f"{title}{body}{cta}")

    if role in ("designed", "photo") or not (title or body):
        return to_jpeg(cover_fit(photo, size), 92)  # designed 는 글자까지 이미지 모델이 그림

    if role == "panel":
        photo_h = int(H * (0.55 if story else 0.62))
        canvas = Image.new("RGB", size, (250, 250, 248))
        canvas.paste(cover_fit(photo, (W, photo_h)), (0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.rectangle((pad, photo_h + 64, pad + 56, photo_h + 70), fill=accent)
        y = photo_h + 100
        tf, bf = load_font("title", 58, font), load_font("body", 36, font)
        y = draw_lines(draw, wrap(draw, title, tf, W - pad * 2, 2), tf, pad, y, (17, 17, 17), 1.25) if title else y
        if body:
            draw_lines(draw, wrap(draw, body, bf, W - pad * 2, 4), bf, pad, y + 14, (80, 80, 84), 1.45)
        return to_jpeg(canvas, 92)

    base = cover_fit(photo, size).convert("RGBA")
    if role == "overlay":
        base = Image.alpha_composite(base, gradient(size, 0.45, 0, 220))
        draw = ImageDraw.Draw(base)
        tf, bf = load_font("title", 84, font), load_font("body", 40, font)
        tl = wrap(draw, title, tf, W - pad * 2, 3) if title else []
        bl = wrap(draw, body, bf, W - pad * 2, 3) if body else []
        cta_h = 84 + 32 if cta else 0
        block = len(tl) * int(tf.size * 1.18) + (24 if tl and bl else 0) + len(bl) * int(bf.size * 1.4) + cta_h
        y = H - pad - bottom_inset - block
        y = draw_lines(draw, tl, tf, pad, y, "white", 1.18)
        y = draw_lines(draw, bl, bf, pad, y + (24 if tl and bl else 0), (235, 235, 240), 1.4)
        if cta:
            cf = load_font("title", 32, font)
            cw = int(draw.textlength(cta, font=cf)) + 80
            draw.rounded_rectangle((pad, y + 32, pad + cw, y + 32 + 76), radius=38, fill=accent)
            draw.text((pad + cw // 2, y + 32 + 38), cta, font=cf, fill="white", anchor="mm")
        return to_jpeg(base, 92)

    # center: 이미지 위 어두운 막 + 가운데 큰 문장
    base = base.filter(ImageFilter.GaussianBlur(2))
    base = Image.alpha_composite(base, Image.new("RGBA", size, (8, 8, 12, 150)))
    draw = ImageDraw.Draw(base)
    tf, bf, cf = load_font("title", 76, font), load_font("body", 38, font), load_font("title", 32, font)
    tl = wrap(draw, title, tf, W - pad * 2, 3) if title else []
    bl = wrap(draw, body, bf, W - pad * 2, 4) if body else []
    block = len(tl) * int(tf.size * 1.2) + (36 if tl and bl else 0) + len(bl) * int(bf.size * 1.45) + (60 + 76 if cta else 0)
    y = top_inset + (H - top_inset - bottom_inset - block) // 2
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
