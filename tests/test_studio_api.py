"""게시물 만들기 API 흐름: 업로드 → 구성 → 이미지 → 마무리 → 음악 → 삭제 (Gemini 는 가짜)."""
import base64
import io
import json

from PIL import Image

from backend.models import MediaBlob
from backend.services import cardnews as svc

PREFIX = "/cardnews"


def jpeg(color="red") -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (120, 90), color).save(b, "JPEG")
    return b.getvalue()


PLAN = {
    "requirements": [], "concept": "c", "format": "f", "art_style": "a", "font": "pretendard",
    "slides": [{"photos": [0, 1], "layout": "overlay", "title": "PARIS ✨", "body": "", "cta": "", "image_text": "", "visual": "v"}],
    "caption_parts": ["파리"], "hashtags": ["파리"],
    "music": [{"title": "La Vie en rose", "artist": "Édith Piaf", "reason": "r", "section": "s"}],
}


def fake_gemini(model, parts, cfg=None, **_):
    if cfg and "responseSchema" in cfg:
        return {"candidates": [{"content": {"parts": [{"text": json.dumps(PLAN)}]}}]}
    if cfg and "responseModalities" in cfg:  # 이미지 생성
        b = io.BytesIO()
        Image.new("RGB", (400, 500), "green").save(b, "PNG")
        return {"candidates": [{"content": {"parts": [{"inlineData": {"data": base64.b64encode(b.getvalue()).decode()}}]}}]}
    raise svc.GeminiError("quota exceeded")


def test_full_flow(monkeypatch, client, login, account, db):
    monkeypatch.setattr(svc, "_gemini", fake_gemini)
    login(account)
    ids = [client.post("/media/uploads", files={"file": (f"{c}.jpg", jpeg(c), "image/jpeg")}).json()["id"] for c in ("red", "blue")]

    r = client.post(f"{PREFIX}/plan", json={"upload_ids": ids, "prompt": "파리 여행", "caption_format": ""})
    assert r.status_code == 201, r.text
    job, slides = r.json()["job"], r.json()["slides"]
    assert job["media_kind"] == "IMAGE" and len(slides) == 1
    assert job["music"]["selected"]["title"] == "La Vie en rose"

    r = client.post(f"{PREFIX}/{job['id']}/slides/0")
    assert r.status_code == 200 and r.json()["engine"] == "gemini"
    visual_id = r.json()["asset"]["meta"]["visual_id"]

    assert client.post(f"{PREFIX}/{job['id']}/finalize").json()["status"] == "ready"
    r = client.put(f"{PREFIX}/{job['id']}/music", json={"selected": {"title": "Paris", "artist": "X"}})
    assert r.json()["music"]["selected"]["title"] == "Paris"

    # 이미지 수정 실패(strict)면 원래 이미지를 바꾸지 않고 이유를 알림
    monkeypatch.setattr(svc, "_gemini", lambda *a, **k: (_ for _ in ()).throw(svc.GeminiError("quota exceeded")))
    r = client.post(f"{PREFIX}/{job['id']}/slides/0", json={"instruction": "밝게", "from_current": True, "strict": True})
    assert r.status_code == 502

    slide_id = client.get(f"/workflow/jobs/{job['id']}").json()["assets"][0]["url"].rsplit("/media/", 1)[1][:-4]
    assert client.delete(f"/workflow/jobs/{job['id']}").status_code == 204
    db.expire_all()
    assert db.get(MediaBlob, slide_id) is None and db.get(MediaBlob, visual_id) is None  # 만든 이미지는 삭제
    assert all(db.get(MediaBlob, i) is not None for i in ids)  # 올린 원본은 유지


def test_plan_busy_gemini_returns_503(monkeypatch, client, login, account):
    monkeypatch.setattr(svc, "_gemini", lambda *a, **k: (_ for _ in ()).throw(svc.GeminiError("model is experiencing high demand")))
    svc._cooldown.clear()
    login(account)
    r = client.post(f"{PREFIX}/plan", json={"upload_ids": [], "prompt": "파리 여행"})
    assert r.status_code == 503
    svc._cooldown.clear()
