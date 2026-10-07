"""게시물 구성: Gemini 응답 정리, 기본 구성, 캡션 모드, 모델 재시도."""
import io
import json

import pytest
from PIL import Image

from backend.services.studio import gemini, planning


def jpeg(color="red") -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(b, "JPEG")
    return b.getvalue()


def gemini_json(payload):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(payload)}]}}]}


PLAN = {
    "requirements": [{"requirement": "한 장", "how": "1장"}],
    "concept": "파리",
    "format": "콜라주",
    "art_style": "film",
    "font": "pretendard",
    "slides": [{"photos": [0, 1, 1, 9], "layout": "photo", "title": "", "body": "", "cta": "", "image_text": "", "visual": "v"}],
    "caption_parts": ["파리 다녀옴"],
    "hashtags": ["#파리", "여행"],
    "music": [{"title": "La Vie en rose", "artist": "Édith Piaf", "reason": "r", "section": "s"}, {"title": "", "artist": "x"}],
}


def test_sanitize_plan_dedupes_and_bounds_photos():
    design = planning.sanitize_plan(PLAN, n=2)
    slide = design["slides"][0]
    assert slide["photos"] == [0, 1]  # 중복·범위 밖(9) 제거
    assert design["hashtags"] == ["파리", "여행"]
    assert [m["title"] for m in design["music"]] == ["La Vie en rose"]  # 제목 없는 곡 제거


def test_sanitize_plan_reads_legacy_single_photo():
    raw = {**PLAN, "slides": [{"photo": 1, "layout": "overlay", "title": "제목"}]}
    assert planning.sanitize_plan(raw, n=2)["slides"][0]["photos"] == [1]


def test_text_only_layout_without_text_becomes_photo():
    raw = {**PLAN, "slides": [{"photos": [0], "layout": "overlay", "title": "", "body": ""}]}
    assert planning.sanitize_plan(raw, n=1)["slides"][0]["layout"] == "photo"


def test_fallback_plan_merges_photos_when_one_slide_requested():
    plan = planning.fallback_plan(3, "파리", "사진 3개를 한 장 짜리로")
    assert len(plan["slides"]) == 1 and plan["slides"][0]["photos"] == [0, 1, 2]


@pytest.mark.parametrize(
    ("caption_format", "expect_in_prompt", "expect_caption"),
    [
        ("너가 알아서 작성해줘", "지시 문장 자체를 캡션에 넣지 마", "파리 다녀옴"),  # [ ] 없음 → 지시
        ("", "캡션 양식이 따로 없어", "파리 다녀옴"),  # 비움 → 자유
        ("[본문]\n고정", "칸이 1개", "파리 다녀옴\n고정"),  # [ ] 있음 → 양식
    ],
)
def test_caption_modes(monkeypatch, caption_format, expect_in_prompt, expect_caption):
    seen = {}

    def fake(model, parts, cfg=None, **_):
        seen["prompt"] = parts[0]["text"]
        return gemini_json(PLAN)

    monkeypatch.setattr(gemini, "call", fake)
    design, engine, _ = planning.plan_post([jpeg(), jpeg("blue")], prompt="파리", style="", caption_format=caption_format)
    assert engine == "gemini"
    assert expect_in_prompt in seen["prompt"]
    assert design["caption"] == expect_caption
    assert design["music"][0]["title"] == "La Vie en rose"


def test_text_call_falls_back_and_cools_down(monkeypatch):
    calls = []

    def fake(model, parts, cfg=None, *, tools=None, timeout=50):
        calls.append((model, timeout))
        if len(calls) == 1:
            raise gemini.GeminiError("Gemini 연결 실패: The read operation timed out")
        return gemini_json({"ok": True})

    monkeypatch.setattr(gemini, "call", fake)
    gemini._cooldown.clear()
    gemini.text_call([{"text": "x"}], {})
    first, second = calls[0][0], calls[1][0]
    assert first != second
    assert calls[0][1] <= gemini.ATTEMPT_CAP_SEC  # 첫 시도는 오래 묶이지 않음
    calls.clear()
    gemini.text_call([{"text": "x"}], {})
    assert calls[0][0] == second  # 실패한 모델은 잠시 건너뜀
    gemini._cooldown.clear()


def test_text_call_stops_on_non_transient_error(monkeypatch):
    def fake(*_, **__):
        raise gemini.GeminiError("API key not valid")

    monkeypatch.setattr(gemini, "call", fake)
    gemini._cooldown.clear()
    with pytest.raises(gemini.GeminiError, match="API key not valid"):
        gemini.text_call([{"text": "x"}], {})
