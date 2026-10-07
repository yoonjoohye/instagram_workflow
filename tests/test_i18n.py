"""서버 문구 번역: 한국어 메시지를 요청 언어로."""
from backend.i18n import tr, translate_payload


def test_translates_with_placeholders_and_nested_messages():
    msg = "이미지를 수정하지 못했습니다. 원인: timeout"
    assert tr(msg, "en") == "Couldn't edit the image. Cause: timeout"
    assert tr("24시간 발행 한도를 모두 썼습니다 (25/25).", "ja") == "24時間の投稿上限に達しました(25/25)。"


def test_joined_messages_and_unknown_text():
    assert tr("로그인이 필요합니다. / unknown", "en") == "Please log in. / unknown"
    assert tr("Some error from Meta", "ja") == "Some error from Meta"
    assert tr("로그인이 필요합니다.", "ko") == "로그인이 필요합니다."


def test_translate_payload_only_touches_message_fields():
    data = {"detail": "로그인이 필요합니다.", "caption": "로그인이 필요합니다.", "items": [{"error": "인증 실패"}]}
    out = translate_payload(data, "en")
    assert out["detail"] == "Please log in." and out["caption"] == "로그인이 필요합니다."
    assert out["items"][0]["error"] == "Authentication failed"


def test_api_errors_follow_language_cookie(client):
    client.cookies.set("lang", "ja")
    assert client.get("/auth/me").json()["detail"] == "ログインが必要です。"
