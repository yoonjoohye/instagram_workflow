"""스토리: 세로 9:16 으로 만들고, 여러 개를 이어서 올림 (Instagram·Gemini 는 가짜)."""
import base64
import io
import json

from PIL import Image

from backend.models import GenerationJob, MediaBlob
from backend.routers import workflow
from backend.services.studio import gemini

PLAN = {
    "requirements": [], "concept": "c", "format": "story", "art_style": "a", "font": "pretendard",
    "slides": [
        {"photos": [], "layout": "center", "title": f"장 {i}", "body": "", "cta": "", "image_text": "", "visual": "v"} for i in range(7)
    ],
    "caption_parts": ["무시됨"], "hashtags": ["무시됨"],
}


def fake_gemini(model, parts, cfg=None, **_):
    if cfg and "responseSchema" in cfg:
        assert "스토리로 올림" in parts[0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": json.dumps(PLAN)}]}}]}
    assert cfg["imageConfig"]["aspectRatio"] == "9:16"
    b = io.BytesIO()
    Image.new("RGB", (540, 960), "purple").save(b, "PNG")
    return {"candidates": [{"content": {"parts": [{"inlineData": {"data": base64.b64encode(b.getvalue()).decode()}}]}}]}


class FakeGraph:
    published: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_story_plan_render_and_publish_in_parts(monkeypatch, client, login, account, db):
    monkeypatch.setattr(gemini, "call", fake_gemini)
    login(account)
    r = client.post("/studio/plan", json={"prompt": "가을 카페 신메뉴", "post_type": "story"})
    assert r.status_code == 201, r.text
    job = r.json()["job"]
    assert job["media_kind"] == "STORIES"
    assert len(r.json()["slides"]) == 5  # 최대 5개
    assert job["caption"] == "" and job["hashtags"] == []

    for i in range(5):
        asset = client.post(f"/studio/{job['id']}/slides/{i}").json()["asset"]
        blob = db.get(MediaBlob, asset["url"].rsplit("/media/", 1)[1][:-4])
        assert (blob.width, blob.height) == (1080, 1920)
    client.post(f"/studio/{job['id']}/finalize")

    # 가짜 Instagram: 한 번에 2개만 올릴 시간이 있다고 가정
    calls = {"n": 0}
    monkeypatch.setattr(workflow, "graph_for", lambda acc: FakeGraph())
    monkeypatch.setattr(workflow.publishing, "publishing_limit", lambda c, u: {"remaining": 25, "used": 0, "total": 25})
    monkeypatch.setattr(workflow.publishing, "create_container", lambda c, u, **k: f"container-{k['media_url'][-12:]}")
    monkeypatch.setattr(workflow.publishing, "wait_until_finished", lambda c, cid: None)

    def fake_publish(c, u, cid):
        calls["n"] += 1
        return {"media_id": f"story-{calls['n']}", "permalink": ""}

    monkeypatch.setattr(workflow.publishing, "publish", fake_publish)
    clock = iter([0, 0, 1, 100] + [200, 200, 201, 202, 203, 204, 205, 206])  # 첫 요청은 2개 올린 뒤 시간 초과
    monkeypatch.setattr(workflow, "_now", lambda: next(clock))

    first = client.post("/workflow/publish", json={"job_id": job["id"]}).json()
    assert first["status"] == "publishing" and first["story_progress"] == {"done": 2, "total": 5}
    second = client.post("/workflow/publish", json={"job_id": job["id"]}).json()
    assert second["status"] == "published" and second["story_progress"] == {"done": 5, "total": 5}
    assert calls["n"] == 5  # 이미 올린 것은 다시 올리지 않음
    db.expire_all()
    assert db.get(GenerationJob, job["id"]).ig_media_id == "story-1"


def test_story_photo_not_9_16_is_fitted_before_publish(monkeypatch, client, login, account, db):
    """원본 그대로 올린 4:5 사진 스토리는 1080×1920(흐린 배경)으로 맞춘 사본을 올림 — 다시 시도해도 사본은 하나."""
    login(account)
    b = io.BytesIO()
    Image.new("RGB", (800, 1000), "orange").save(b, "JPEG")
    up = client.post("/media/uploads", files={"file": ("a.jpg", b.getvalue(), "image/jpeg")}).json()["id"]
    job = client.post("/studio/manual", json={"upload_ids": [up], "post_type": "story"}).json()

    urls = []
    monkeypatch.setattr(workflow, "graph_for", lambda acc: FakeGraph())
    monkeypatch.setattr(workflow.publishing, "publishing_limit", lambda c, u: {"remaining": 25, "used": 0, "total": 25})
    monkeypatch.setattr(workflow.publishing, "create_container", lambda c, u, **k: urls.append(k["media_url"]) or "c1")
    monkeypatch.setattr(workflow.publishing, "wait_until_finished", lambda c, cid: None)
    monkeypatch.setattr(workflow.publishing, "publish", lambda c, u, cid: {"media_id": "s1", "permalink": ""})

    assert client.post("/workflow/publish", json={"job_id": job["id"]}).json()["status"] == "published"
    fitted_id = urls[0].rsplit("/media/", 1)[1][:-4]
    assert fitted_id != up
    fitted = db.get(MediaBlob, fitted_id)
    assert (fitted.width, fitted.height) == (1080, 1920)
    assert Image.open(io.BytesIO(fitted.data)).size == (1080, 1920)
