"""이미지 기본 처리: 크기 맞추기·JPEG 변환·보정·콜라주 (AI 없이 서버에서)."""
from __future__ import annotations

import base64
import io

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from .limits import SIZE


def normalize(data: bytes, *, max_side: int = 1600) -> tuple[bytes, int, int]:
    """회전(EXIF) 보정 → RGB → 긴 변 max_side 로 축소 → JPEG.
    이미 알맞은 JPEG(크기 이내, 회전·위치 등 EXIF 정보 없음 — 예: 편집기에서 내보낸 이미지)는 다시 압축하지 않고 그대로
    (JPEG 를 여러 번 압축할수록 화질이 조금씩 떨어지므로)."""
    src = Image.open(io.BytesIO(data))
    if src.format == "JPEG" and src.mode == "RGB" and max(src.size) <= max_side and not src.info.get("exif"):
        return data, src.width, src.height
    img = ImageOps.exif_transpose(src).convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    return to_jpeg(img), img.width, img.height


def to_jpeg(img: Image.Image, quality: int = 92) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def small(data: bytes, side: int = 768) -> bytes:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((side, side))
    return to_jpeg(img, 80)


def cover_fit(photo: bytes, size: tuple[int, int]) -> Image.Image:
    img = Image.open(io.BytesIO(photo)).convert("RGB")
    return ImageOps.fit(img, size, Image.LANCZOS, centering=(0.5, 0.45))


def image_size(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


def collage(photos: list[bytes], size: tuple[int, int] = SIZE) -> bytes:
    """이미지 생성이 안 될 때 여러 사진을 한 장에 담는 필름 사진 콜라주 (크림색 배경 + 흰 테두리 + 살짝 기울임)."""
    w, h = size
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
        img = cover_fit(photo, inner)
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


def placeholder_background(size: tuple[int, int] = SIZE) -> bytes:
    """이미지 생성에 실패했고 원본 사진도 없을 때 쓰는 은은한 배경."""
    w, h = size
    img = Image.linear_gradient("L").resize((w, h)).convert("RGB")
    img = ImageOps.colorize(img.convert("L"), black=(38, 38, 52), white=(120, 110, 170))
    return to_jpeg(img.filter(ImageFilter.GaussianBlur(40)))


def basic_enhance(photo: bytes) -> bytes:
    img = ImageOps.autocontrast(Image.open(io.BytesIO(photo)).convert("RGB"), cutoff=1)
    img = ImageEnhance.Color(img).enhance(1.12)
    img = ImageEnhance.Sharpness(img).enhance(1.15)
    return to_jpeg(img)


def crop_to_ratio(data: bytes, lo: float, hi: float) -> bytes | None:
    """가로/세로 비율이 lo~hi 를 벗어나면 가운데를 잘라 맞춘 JPEG (안이면 None)."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    w, h = img.size
    ratio = w / h
    if lo - 0.005 <= ratio <= hi + 0.005:
        return None
    if ratio < lo:  # 너무 길쭉 → 위아래를 자름
        nh = round(w / lo)
        top = (h - nh) // 2
        img = img.crop((0, top, w, top + nh))
    else:  # 너무 넓음 → 양옆을 자름
        nw = round(h * hi)
        left = (w - nw) // 2
        img = img.crop((left, 0, left + nw, h))
    return to_jpeg(img)
