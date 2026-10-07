"""서버가 이미지에 글을 얹을 때 쓰는 글씨체 (모두 SIL OFL — 상업적 사용 가능)."""
from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"  # backend/assets/fonts


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


def load_font(kind: str, size: int, key: str = DEFAULT_FONT) -> ImageFont.FreeTypeFont:
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
    draw.text((20, 48), text, font=load_font("title", 44, key), fill=(17, 17, 17), anchor="lm")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()
