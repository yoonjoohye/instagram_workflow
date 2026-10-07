"""이미지 연출: Gemini 이미지 모델로 사진을 연출대로 다시 만들거나(여러 장이면 한 장으로 합침) 새로 만들고, 부분 수정합니다."""
from __future__ import annotations

import logging
from typing import Any

from . import gemini
from .fonts import FONTS, font_for_text
from .gemini import GeminiError
from .imaging import b64, basic_enhance, collage, placeholder_background, small
from .limits import SIZE, STORY_SIZE

log = logging.getLogger(__name__)


# panel 은 위쪽 62% 에 이미지가 들어가므로 가로형, 나머지는 세로 4:5.
ASPECT = {"designed": "4:5", "photo": "4:5", "overlay": "4:5", "panel": "4:3", "center": "4:5"}


def visual_prompt(
    slide: dict[str, Any],
    *,
    topic: str,
    style: str,
    instruction: str,
    has_photo: bool | int,
    art_style: str = "",
    post_format: str = "",
    font: str = "",
    story: bool = False,
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
    if story:
        lines.append(
            "This is a full-screen vertical 9:16 Instagram Story. Keep the top 13% and bottom 17% free of faces, "
            "important objects and any text (the app's profile bar and reply box cover those areas)."
        )
    lines.append("High quality, polished, Instagram-ready.")
    return "\n".join(lines)


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
    story: bool = False,
) -> tuple[bytes, str]:
    """(이미지, 엔진). story 면 세로 9:16 스토리로. 사진이 있으면 연출 편집(여러 장이면 한 이미지로 합침), 없으면 새로 생성.
    실패하면 기본 보정 / 콜라주 / 배경. references 는 양식 템플릿 이미지."""
    if photos is None:
        photos = []
    elif isinstance(photos, (bytes, bytearray)):
        photos = [bytes(photos)]
    photos = list(photos)[:4]
    references = references or []
    prompt = visual_prompt(
        slide,
        topic=topic,
        style=style,
        instruction=instruction,
        has_photo=len(photos),
        art_style=art_style,
        post_format=post_format,
        font=font,
        story=story,
    )
    size = STORY_SIZE if story else SIZE
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
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64(small(ref, 1024))}})
    side = 1280 if len(photos) <= 1 else 1024
    for photo in photos:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": b64(small(photo, side))}})
    try:
        return gemini.image_call(parts, "9:16" if story else ASPECT[slide["role"]]), "gemini"
    except (GeminiError, OSError, ValueError) as exc:
        log.warning("render_visual fallback: %s", exc)
        if len(photos) > 1:
            return collage(photos, size), f"basic ({exc})"
        return (basic_enhance(photos[0]) if photos else placeholder_background(size)), f"basic ({exc})"


def edit_visual(image: bytes, instruction: str, *, aspect: str = "4:5") -> tuple[bytes, str]:
    """지금 이미지에서 요청한 부분만 고칩니다 (나머지는 그대로). 실패하면 원래 이미지를 그대로 돌려줍니다."""
    prompt = (
        f"Edit the attached image. Apply ONLY this change (user's request, may be in any language; highest priority): {instruction}\n"
        "Keep everything else exactly the same: composition, people and faces, landmarks, colors, art style, "
        "and any existing text (keep its characters identical). Do not add watermarks or logos. "
        "Output one image in the same format."
    )
    parts = [{"text": prompt}, {"inlineData": {"mimeType": "image/jpeg", "data": b64(small(image, 1280))}}]
    try:
        return gemini.image_call(parts, aspect), "gemini"
    except (GeminiError, OSError, ValueError) as exc:
        log.warning("edit_visual fallback: %s", exc)
        return image, f"basic ({exc})"
