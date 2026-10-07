"""게시물 만들기 API 흐름: 업로드 → 구성 → 이미지 → 마무리 → 음악 → 삭제 (Gemini 는 가짜)."""
import base64
import io
import json

from PIL import Image

from backend.models import MediaBlob
from backend.services.studio import gemini

PREFIX = "/studio"


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
    raise gemini.GeminiError("quota exceeded")


def test_full_flow(monkeypatch, client, login, account, db):
    monkeypatch.setattr(gemini, "call", fake_gemini)
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
    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(gemini.GeminiError("quota exceeded")))
    r = client.post(f"{PREFIX}/{job['id']}/slides/0", json={"instruction": "밝게", "from_current": True, "strict": True})
    assert r.status_code == 502

    slide_id = client.get(f"/workflow/jobs/{job['id']}").json()["assets"][0]["url"].rsplit("/media/", 1)[1][:-4]
    assert client.delete(f"/workflow/jobs/{job['id']}").status_code == 204
    db.expire_all()
    assert db.get(MediaBlob, slide_id) is None and db.get(MediaBlob, visual_id) is None  # 만든 이미지는 삭제
    assert all(db.get(MediaBlob, i) is not None for i in ids)  # 올린 원본은 유지


def test_plan_busy_gemini_returns_503(monkeypatch, client, login, account):
    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(gemini.GeminiError("model is experiencing high demand")))
    gemini._cooldown.clear()
    login(account)
    r = client.post(f"{PREFIX}/plan", json={"upload_ids": [], "prompt": "파리 여행"})
    assert r.status_code == 503
    gemini._cooldown.clear()


def test_manual_edit_keeps_base_and_cleans_up(monkeypatch, client, login, account, db):
    monkeypatch.setattr(gemini, "call", fake_gemini)
    login(account)
    up = client.post("/media/uploads", files={"file": ("a.jpg", jpeg(), "image/jpeg")}).json()["id"]
    job = client.post(f"{PREFIX}/plan", json={"upload_ids": [up], "prompt": "편집 테스트"}).json()["job"]
    first = client.post(f"{PREFIX}/{job['id']}/slides/0").json()["asset"]
    base_id = first["url"].rsplit("/media/", 1)[1][:-4]

    def save(layers):
        r = client.post(
            f"{PREFIX}/{job['id']}/slides/0/edit",
            files={"file": ("e.jpg", jpeg("yellow"), "image/jpeg")},
            data={"layers": layers, "base_id": base_id},
        )
        assert r.status_code == 200, r.text
        return r.json()["asset"]

    a1 = save('{"objects":[1]}')
    a2 = save('{"objects":[1,2]}')
    db.expire_all()
    edited1, edited2 = (a["url"].rsplit("/media/", 1)[1][:-4] for a in (a1, a2))
    assert a2["meta"]["edit"] == {"base_id": base_id, "layers": '{"objects":[1,2]}'}
    assert a2["meta"]["text_baked"] is True
    assert db.get(MediaBlob, base_id) is not None  # 편집 전 원본은 남김
    assert db.get(MediaBlob, edited1) is None  # 이전 편집 결과는 정리
    assert client.get(f"{PREFIX}/fonts/pretendard.font").status_code == 200

    client.delete(f"/workflow/jobs/{job['id']}")
    db.expire_all()
    assert db.get(MediaBlob, base_id) is None and db.get(MediaBlob, edited2) is None
    assert db.get(MediaBlob, up) is not None  # 올린 사진은 유지


def test_caption_rewrite_keeps_template(monkeypatch, client, login, account):
    seen = {}

    def fake(model, parts, cfg=None, **_):
        if "캡션 작가" in parts[0]["text"]:
            seen["prompt"] = parts[0]["text"]
            return {"candidates": [{"content": {"parts": [{"text": json.dumps({"caption_parts": ["짧게 다시 씀"], "hashtags": ["#파리"]})}]}}]}
        return fake_gemini(model, parts, cfg)

    monkeypatch.setattr(gemini, "call", fake)
    login(account)
    job = client.post(f"{PREFIX}/plan", json={"prompt": "파리", "caption_format": "[본문]\n👉 링크는 프로필"}).json()["job"]
    r = client.post(f"{PREFIX}/{job['id']}/caption", json={"instruction": "더 짧게", "caption": "지금 캡션"})
    assert r.status_code == 200, r.text
    assert r.json() == {"caption": "짧게 다시 씀\n👉 링크는 프로필", "hashtags": ["파리"], "hashtags_inline": False}
    assert "더 짧게" in seen["prompt"] and "지금 캡션" in seen["prompt"]
    client.delete(f"/workflow/jobs/{job['id']}")
