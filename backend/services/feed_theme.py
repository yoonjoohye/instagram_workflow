"""내 피드 색으로 테마 만들기: 최근 게시물 사진들의 대표 색을 뽑아 디자인 테마(색 6가지)로 바꿉니다.

- 피드가 전체적으로 어두우면 어두운 바탕, 아니면 대표 색을 아주 옅게 한 밝은 바탕
- 메인 색 = 많이 쓰였으면서 채도가 높은 색 (바탕 위에서 잘 보이게 밝기를 맞춤)
- 포인트 색 = 메인 색과 색상(hue)이 충분히 다른 두 번째 색
"""
from __future__ import annotations

import colorsys
import io
from dataclasses import dataclass

from PIL import Image

SAMPLE = 64  # 사진마다 이 크기로 줄여서 색을 셈


@dataclass
class Swatch:
    rgb: tuple[int, int, int]
    share: float  # 전체 픽셀 중 비율

    @property
    def hls(self) -> tuple[float, float, float]:
        return colorsys.rgb_to_hls(*(c / 255 for c in self.rgb))


def _hex(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02x}" for c in rgb)


def _from_hls(h: float, l: float, s: float) -> str:
    return _hex(colorsys.hls_to_rgb(h % 1.0, max(0.0, min(1.0, l)), max(0.0, min(1.0, s))))


def _lum(hex_: str) -> float:
    """상대 휘도 (WCAG)"""
    def ch(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def palette(images: list[bytes], colors: int = 10) -> list[Swatch]:
    """여러 사진을 한 장에 이어 붙여 대표 색 colors 개 (많이 쓰인 순)"""
    tiles = []
    for data in images:
        try:
            im = Image.open(io.BytesIO(data)).convert("RGB")
        except OSError:
            continue
        im.thumbnail((SAMPLE, SAMPLE))
        tiles.append(im)
    if not tiles:
        return []
    sheet = Image.new("RGB", (SAMPLE * len(tiles), SAMPLE))
    for i, im in enumerate(tiles):
        sheet.paste(im.resize((SAMPLE, SAMPLE)), (i * SAMPLE, 0))
    q = sheet.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette() or []
    counts = sorted(q.getcolors() or [], reverse=True)
    total = sum(n for n, _ in counts) or 1
    return [Swatch(tuple(pal[i * 3 : i * 3 + 3]), n / total) for n, i in counts]  # type: ignore[arg-type]


def _hue_gap(a: float, b: float) -> float:
    d = abs(a - b) % 1.0
    return min(d, 1 - d)


def theme_from(swatches: list[Swatch]) -> dict[str, str]:
    """대표 색들 → 테마 색 6가지 (bg, surface, text, primary, on_primary, accent)"""
    if not swatches:
        return {"bg": "#ffffff", "surface": "#f4f4f5", "text": "#111111", "primary": "#111111", "on_primary": "#ffffff", "accent": "#d4d4d8"}
    avg_l = sum(s.hls[1] * s.share for s in swatches)
    dark = avg_l < 0.36
    # 많이 쓰였고 채도가 높은 색이 메인 (회색·거의 흰색/검정은 뒤로)
    def vivid(s: Swatch) -> float:
        h, l, sat = s.hls
        edge = 1 - abs(l - 0.5) * 1.6  # 너무 밝거나 어두우면 감점
        return (s.share ** 0.5) * sat * max(edge, 0.05)

    ranked = sorted(swatches, key=vivid, reverse=True)
    main = ranked[0]
    mh, _, ms = main.hls
    ms = max(ms, 0.35)  # 회색 피드라도 조금은 색이 있게
    accent = next((s for s in ranked[1:] if _hue_gap(s.hls[0], mh) > 0.1 and s.hls[2] > 0.15), None)
    ah, _, asat = accent.hls if accent else (mh + 0.08, 0, ms * 0.6)
    # 가장 많이 쓰인 색의 색조를 바탕에 살짝
    base_h, _, base_s = swatches[0].hls
    if dark:
        bg = _from_hls(base_h, 0.09, min(base_s, 0.35))
        surface = _from_hls(base_h, 0.15, min(base_s, 0.3))
        text = _from_hls(base_h, 0.95, min(base_s, 0.2))
        primary = _from_hls(mh, 0.62, min(ms, 0.85))
        accent_c = _from_hls(ah, 0.7, min(max(asat, 0.3), 0.8))
    else:
        bg = _from_hls(base_h, 0.96, min(base_s, 0.45))
        surface = "#ffffff"
        text = _from_hls(mh, 0.14, min(ms, 0.4))
        primary = _from_hls(mh, 0.46, min(ms, 0.8))
        accent_c = _from_hls(ah, 0.8, min(max(asat, 0.3), 0.75))
    # 메인 색이 바탕과 너무 비슷하면 밝기를 더 벌림
    l = colorsys.rgb_to_hls(*(int(primary[i : i + 2], 16) / 255 for i in (1, 3, 5)))[1]
    step = 0.05 if dark else -0.05
    while contrast(primary, bg) < 3 and 0.1 < l < 0.9:
        l += step
        primary = _from_hls(mh, l, min(ms, 0.8))
    on_primary = "#ffffff" if contrast("#ffffff", primary) >= contrast("#111111", primary) else "#111111"
    return {"bg": bg, "surface": surface, "text": text, "primary": primary, "on_primary": on_primary, "accent": accent_c}
