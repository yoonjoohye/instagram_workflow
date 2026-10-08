"""캡션 양식 채우기: [칸]만 채우고 칸 밖 글자·줄바꿈은 그대로."""
from backend.services.studio import captions, textutil


def test_placeholders_in_order():
    assert captions.placeholders("[후킹 2줄]\n고정 문구\n[마무리]") == ["후킹 2줄", "마무리"]


def test_fill_template_keeps_fixed_text_and_limits_lines():
    caption, inline = captions.fill_template("[후킹 2줄]\n👉 링크는 프로필\n[마무리]", ["a\nb\nc", "끝"], ["tag"])
    assert caption == "a\nb\n👉 링크는 프로필\n끝"  # '2줄' 이라 세 번째 줄은 잘림
    assert inline is False


def test_fill_template_hashtag_slot_and_missing_part():
    caption, inline = captions.fill_template("[본문]\n[해시태그]\n[추가]", ["본문입니다", ""], ["파리", "#여행"])
    assert "#파리 #여행" in caption
    assert inline is True
    assert "⚠️ [추가] 직접 입력" in caption


def test_no_emoji_for_server_drawn_text():
    assert textutil.no_emoji("PARIS\n꿈같던 밤 ✨") == "PARIS\n꿈같던 밤"


def test_fill_template_drops_repeated_line_head():
    caption, _ = captions.fill_template("[첫 줄]\n📍 [가게 위치]", ["맛있다", "📍 성수 소바집"], [])
    assert caption == "맛있다\n📍 성수 소바집"


def test_normalize_keeps_ready_jpeg_and_crops_feed_ratio():
    """화질: 이미 알맞은 JPEG 는 다시 압축하지 않음. 피드 비율(4:5~1.91:1)을 벗어나면 가운데를 잘라 맞춤."""
    import io

    from PIL import Image

    from backend.services.studio import imaging

    buf = io.BytesIO()
    Image.new("RGB", (1080, 1350), "red").save(buf, "JPEG", quality=95)
    raw = buf.getvalue()
    assert imaging.normalize(raw, max_side=1920)[0] == raw  # 그대로
    assert imaging.normalize(raw, max_side=1000)[0] != raw  # 크면 줄임

    tall = io.BytesIO()
    Image.new("RGB", (1080, 1920), "blue").save(tall, "JPEG")
    out = imaging.crop_to_ratio(tall.getvalue(), 0.8, 1.91)
    assert Image.open(io.BytesIO(out)).size == (1080, 1350)
    wide = io.BytesIO()
    Image.new("RGB", (2000, 800), "blue").save(wide, "JPEG")
    w, h = Image.open(io.BytesIO(imaging.crop_to_ratio(wide.getvalue(), 0.8, 1.91))).size
    assert h == 800 and abs(w / h - 1.91) < 0.01
    assert imaging.crop_to_ratio(raw, 0.8, 1.91) is None  # 4:5 는 그대로
