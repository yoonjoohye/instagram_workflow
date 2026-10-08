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
    monkeypatch.setattr(workflow.publishing, "wait_until_finished", lambda c, cid, **k: None)

    def fake_publish(c, u, cid, **k):
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
    waited = []
    monkeypatch.setattr(workflow.publishing, "wait_until_finished", lambda c, cid, **k: waited.append(cid))
    monkeypatch.setattr(workflow.publishing, "publish", lambda c, u, cid, **k: {"media_id": "s1", "permalink": ""})

    assert client.post("/workflow/publish", json={"job_id": job["id"]}).json()["status"] == "published"
    assert waited == ["c1"]  # 사진 스토리도 처리가 끝난 뒤 발행 (안 기다리면 400 "media is not ready")
    fitted_id = urls[0].rsplit("/media/", 1)[1][:-4]
    assert fitted_id != up
    fitted = db.get(MediaBlob, fitted_id)
    assert (fitted.width, fitted.height) == (1080, 1920)
    assert Image.open(io.BytesIO(fitted.data)).size == (1080, 1920)


def test_publish_retries_when_media_not_ready(monkeypatch):
    """인스타가 아직 이미지를 가져가는 중이면(9007) 잠깐 기다렸다 다시 발행합니다."""
    from backend.services import publishing
    from backend.services.meta_graph import GraphError

    calls = []

    class Graph:
        def post(self, path, data):
            calls.append(path)
            if len(calls) < 3:
                raise GraphError("The media is not ready for publishing, please wait for a moment", status=400,
                                 payload={"code": 9007, "error_subcode": 2207027})
            return {"id": "m1"}

        def get(self, path, params):
            return {"permalink": "https://instagram.com/p/x"}

    monkeypatch.setattr(publishing.time, "sleep", lambda s: None)
    assert publishing.publish(Graph(), "ig", "c1")["media_id"] == "m1"
    assert len(calls) == 3

    class Broken(Graph):
        def post(self, path, data):
            raise GraphError("Invalid parameter", status=400, payload={"code": 100})

    import pytest
    with pytest.raises(GraphError):
        publishing.publish(Broken(), "ig", "c1")


def test_publish_recovers_when_error_but_actually_published(monkeypatch):
    """Meta 가 일시 오류(code 2)를 돌려줬지만 실제로는 올라간 경우: 컨테이너 상태로 확인해 성공 처리 (다시 올리지 않음)."""
    from backend.services import publishing
    from backend.services.meta_graph import GraphError

    posts = []

    class Graph:
        def post(self, path, data):
            posts.append(path)
            raise GraphError("An unexpected error has occurred. Please retry your request later.", status=500,
                             payload={"code": 2, "is_transient": True})

        def get(self, path, params):
            if path == "c1":
                return {"status_code": "PUBLISHED"}
            if path == "ig/stories":
                return {"data": [{"id": "story-9"}]}
            return {"permalink": ""}

    monkeypatch.setattr(publishing.time, "sleep", lambda s: None)
    assert publishing.publish(Graph(), "ig", "c1", kind="STORIES")["media_id"] == "story-9"
    assert len(posts) == 1  # 이미 올라갔으니 다시 게시하지 않음


def test_publish_retries_transient_then_succeeds(monkeypatch):
    from backend.services import publishing
    from backend.services.meta_graph import GraphError

    posts = []

    class Graph:
        def post(self, path, data):
            posts.append(path)
            if len(posts) == 1:
                raise GraphError("An unexpected error has occurred.", status=500, payload={"code": 2})
            return {"id": "m2"}

        def get(self, path, params):
            return {"status_code": "FINISHED"} if path == "c1" else {"permalink": "https://instagram.com/p/y"}

    monkeypatch.setattr(publishing.time, "sleep", lambda s: None)
    assert publishing.publish(Graph(), "ig", "c1", kind="STORIES")["media_id"] == "m2"
    assert len(posts) == 2


def test_publish_transient_then_consumed_means_published(monkeypatch):
    """1차: 일시 오류(실제로는 게시됨), 상태 확인은 아직 FINISHED → 2차: '찾을 수 없음'(이미 게시돼 사라짐)
    → 방금 올라간 스토리를 찾아 성공 처리."""
    import datetime as dt

    from backend.services import publishing
    from backend.services.meta_graph import GraphError

    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+0000")
    posts = []

    class Graph:
        def post(self, path, data):
            posts.append(path)
            if len(posts) == 1:
                raise GraphError("An unexpected error has occurred.", status=500, payload={"code": 2})
            raise GraphError("The media with 1 cannot be found.", status=400, payload={"code": 24, "error_subcode": 2207006})

        def get(self, path, params):
            if path == "c1":
                return {"status_code": "FINISHED"}  # Meta 반영이 늦음
            if path == "ig/stories":
                return {"data": [{"id": "story-new", "timestamp": now}]}
            return {"permalink": ""}

    monkeypatch.setattr(publishing.time, "sleep", lambda s: None)
    assert publishing.publish(Graph(), "ig", "c1", kind="STORIES")["media_id"] == "story-new"
    assert len(posts) == 2


def test_consumed_without_recent_story_still_fails(monkeypatch):
    from backend.services import publishing
    from backend.services.meta_graph import GraphError

    class Graph:
        calls = 0

        def post(self, path, data):
            Graph.calls += 1
            if Graph.calls == 1:
                raise GraphError("unexpected", status=500, payload={"code": 2})
            raise GraphError("cannot be found", status=400, payload={"code": 24, "error_subcode": 2207006})

        def get(self, path, params):
            if path == "c1":
                return {"status_code": "FINISHED"}
            return {"data": [{"id": "old", "timestamp": "2020-01-01T00:00:00+0000"}]}  # 예전 스토리만

    monkeypatch.setattr(publishing.time, "sleep", lambda s: None)
    import pytest
    with pytest.raises(GraphError):
        publishing.publish(Graph(), "ig", "c1", kind="STORIES")


def test_republish_deleted_story_uploads_again(monkeypatch, client, login, account, db):
    """인스타에서 지웠거나 끝난 스토리를 다시 게시하면 지난 기록 없이 처음부터 올림."""
    from backend.models import GenerationJob

    login(account)
    b = io.BytesIO()
    Image.new("RGB", (1080, 1920), "green").save(b, "JPEG")
    up = client.post("/media/uploads", files={"file": ("a.jpg", b.getvalue(), "image/jpeg")}).json()["id"]
    job = client.post("/studio/manual", json={"upload_ids": [up], "post_type": "story"}).json()
    row = db.get(GenerationJob, job["id"])
    row.status = "deleted"
    row.plan = {**row.plan, "story_media_ids": ["old-story"]}
    db.commit()

    made = []
    monkeypatch.setattr(workflow, "graph_for", lambda acc: FakeGraph())
    monkeypatch.setattr(workflow.publishing, "publishing_limit", lambda c, u: {"remaining": 25, "used": 0, "total": 25})
    monkeypatch.setattr(workflow.publishing, "create_container", lambda c, u, **k: made.append(1) or "c-new")
    monkeypatch.setattr(workflow.publishing, "wait_until_finished", lambda c, cid, **k: None)
    monkeypatch.setattr(workflow.publishing, "publish", lambda c, u, cid, **k: {"media_id": "new-story", "permalink": ""})
    r = client.post("/workflow/publish", json={"job_id": job["id"]}).json()
    assert r["status"] == "published" and made == [1]
    db.expire_all()
    assert db.get(GenerationJob, job["id"]).plan["story_media_ids"] == ["new-story"]
