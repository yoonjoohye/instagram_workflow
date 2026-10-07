"""캡션 양식 채우기: [칸]만 채우고 칸 밖 글자·줄바꿈은 그대로."""
from backend.services import cardnews as svc


def test_placeholders_in_order():
    assert svc.placeholders("[후킹 2줄]\n고정 문구\n[마무리]") == ["후킹 2줄", "마무리"]


def test_fill_template_keeps_fixed_text_and_limits_lines():
    caption, inline = svc.fill_template("[후킹 2줄]\n👉 링크는 프로필\n[마무리]", ["a\nb\nc", "끝"], ["tag"])
    assert caption == "a\nb\n👉 링크는 프로필\n끝"  # '2줄' 이라 세 번째 줄은 잘림
    assert inline is False


def test_fill_template_hashtag_slot_and_missing_part():
    caption, inline = svc.fill_template("[본문]\n[해시태그]\n[추가]", ["본문입니다", ""], ["파리", "#여행"])
    assert "#파리 #여행" in caption
    assert inline is True
    assert "⚠️ [추가] 직접 입력" in caption


def test_no_emoji_for_server_drawn_text():
    assert svc._no_emoji("PARIS\n꿈같던 밤 ✨") == "PARIS\n꿈같던 밤"
