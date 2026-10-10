"""게시까지 이어지는 기능: 템플릿별 성과, 피드 색 테마, 글 → 카드뉴스, 예약·매주 반복 (Instagram·Gemini 는 가짜)."""
import datetime as dt
import io
import json

from PIL import Image

from backend.models import DesignTemplate, GenerationJob, MediaBlob
from backend.routers import feed as feed_router
from backend.routers import schedule
from backend.services import feed_theme, perf
from backend.services.studio import gemini, outline

from test_designs import _jpg, _page

NOW = dt.datetime.now(dt.timezone.utc)


def _design(client, kind="builtin", tid="cn-minimal", **extra):
    files = [("bgs", ("b.jpg", _jpg("white"), "image/jpeg")), ("imgs", ("i.jpg", _jpg("red"), "image/jpeg"))]
    data = {"pages": json.dumps([_page("표지")]), "name": "미니멀", "template_kind": kind, "template_id": tid, **extra}
    r = client.post("/studio/designs", data=data, files=files)
    assert r.status_code == 201, r.text
    return r.json()


def _published(db, job_id, **perf_values):
    job = db.get(GenerationJob, job_id)
    job.status, job.ig_media_id, job.published_at = "published", f"m{job_id}", NOW
    if perf_values:
        job.perf, job.perf_synced_at = perf_values, NOW
    db.commit()
    return job


# ── 템플릿별 성과 ─────────────────────────────────────────
def test_design_job_remembers_template_and_caption(client, login, account, db):
    login(account)
    job = _design(client, caption="캡션", hashtags=json.dumps(["#카페", "신메뉴"]))
    assert job["template"] == {"kind": "builtin", "id": "cn-minimal"}
    assert job["caption"] == "캡션" and job["hashtags"] == ["카페", "신메뉴"]
    # 없는 회원 템플릿·이상한 id 는 기록하지 않음
    assert _design(client, kind="design", tid="nope")["template"] is None
    assert _design(client, tid="../x")["template"] is None


def test_perf_sync_and_summary(monkeypatch, client, login, account, db):
    login(account)
    ids = [_design(client)["id"] for _ in range(3)] + [_design(client, tid="ph-polaroid")["id"]]
    for i in ids:
        _published(db, i)
    old = _published(db, ids[3])
    old.published_at = NOW - dt.timedelta(days=40)  # 30일 지난 글은 갱신 안 함
    db.commit()
    monkeypatch.setattr(perf, "media_insights", lambda c, m: {"reach": 100, "likes": 8, "comments": 1, "saved": 4, "shares": 2})
    assert perf.sync(db, account, client=None) == 3
    assert perf.sync(db, account, client=None) == 0  # 20시간 안에는 다시 안 함
    s = perf.summary(db, "builtin", ["cn-minimal", "ph-polaroid"])
    assert s["cn-minimal"]["posts"] == 3 and s["cn-minimal"]["saved"] == 4 and s["cn-minimal"]["rate"] == 15.0
    assert "ph-polaroid" not in s
    # 내 평균과 비교 (3개 이상)
    j = db.get(GenerationJob, ids[3])
    j.perf, j.perf_synced_at = {"reach": 300, "likes": 30, "comments": 3, "saved": 12, "shares": 0}, NOW
    db.commit()
    mine = client.get("/studio/templates/performance").json()
    assert mine["mine"]["builtin:ph-polaroid"]["saved_x"] > 1 > mine["mine"]["builtin:cn-minimal"]["saved_x"]
    assert mine["builtin"]["cn-minimal"]["posts"] == 3


def test_community_sorted_by_performance(client, login, account, db):
    login(account)
    good = DesignTemplate(id="tplgood", user_id=db.get(type(account), account.id).user_id, name="잘됨", post_type="feed", pages=[], bg_ids=[],
                          is_public=1, published_at=NOW - dt.timedelta(days=3), author_name="a")
    new = DesignTemplate(id="tplnew", user_id=good.user_id, name="새것", post_type="feed", pages=[], bg_ids=[],
                         is_public=1, published_at=NOW, author_name="a")
    db.add_all([good, new])
    db.commit()
    for rate in (20, 30):
        j = _published(db, _design(client, kind="design", tid="tplgood")["id"], reach=100, likes=rate, comments=0, saved=0, shares=0)
        assert j.template_id == "tplgood"
    rows = client.get("/community/templates?sort=perf").json()["data"]
    assert [r["id"] for r in rows][:2] == ["tplgood", "tplnew"]
    assert rows[0]["perf"]["posts"] == 2 and rows[0]["perf"]["rate"] == 25.0 and rows[1]["perf"] is None
    assert client.get("/community/templates?sort=new").json()["data"][0]["id"] == "tplnew"
    mine = {t["id"]: t for t in client.get("/studio/templates").json()["data"]}
    assert mine["tplgood"]["perf"]["posts"] == 2


# ── 피드 색 테마 ──────────────────────────────────────────
def _photo(colors) -> bytes:
    im = Image.new("RGB", (60, 60), colors[0])
    for i, c in enumerate(colors[1:]):
        im.paste(Image.new("RGB", (60, 15), c), (0, 15 * (i + 1)))
    b = io.BytesIO()
    im.save(b, "JPEG")
    return b.getvalue()


def test_theme_from_light_and_dark_feeds():
    light = feed_theme.theme_from(feed_theme.palette([_photo(["#f6efe6", "#e8743b", "#f6efe6"]) for _ in range(4)]))
    assert feed_theme._lum(light["bg"]) > 0.7  # 밝은 피드 → 밝은 바탕
    assert feed_theme.contrast(light["text"], light["bg"]) >= 7
    assert feed_theme.contrast(light["primary"], light["bg"]) >= 3
    assert feed_theme.contrast(light["on_primary"], light["primary"]) >= 3
    dark = feed_theme.theme_from(feed_theme.palette([_photo(["#101418", "#38bdf8", "#101418"]) for _ in range(4)]))
    assert feed_theme._lum(dark["bg"]) < 0.05 and feed_theme.contrast(dark["text"], dark["bg"]) >= 7
    assert feed_theme.contrast(dark["primary"], dark["bg"]) >= 3


def test_theme_from_feed_endpoint(monkeypatch, client, login, account):
    login(account)
    rows = [{"id": str(i), "media_url": f"https://cdn/{i}.jpg", "permalink": ""} for i in range(4)]

    class G:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(feed_router, "graph_for", lambda a: G())
    monkeypatch.setattr(feed_router.svc, "recent_media", lambda c, u, limit=12: rows)
    monkeypatch.setattr(feed_router, "_fetch", lambda url: _photo(["#fff1f5", "#ff5c8a"]))
    assert len(client.get("/studio/feed").json()["data"]) == 4
    r = client.post("/studio/themes/from-feed").json()
    assert set(r["colors"]) == {"bg", "surface", "text", "primary", "on_primary", "accent"} and r["posts"] == 4
    monkeypatch.setattr(feed_router.svc, "recent_media", lambda c, u, limit=12: rows[:2])
    assert client.post("/studio/themes/from-feed").status_code == 409  # 게시물이 너무 적음


# ── 글 → 카드뉴스 ─────────────────────────────────────────
TEXT = "가을 카페 신메뉴 3가지\n\n첫째는 밤라떼예요. 고소하고 달아요.\n\n둘째는 고구마 케이크. 촉촉해요.\n\n셋째는 단호박 수프예요. 따뜻해요."


def test_outline_without_ai_splits_paragraphs(monkeypatch, client, login, account):
    def busy(*a, **k):
        raise gemini.GeminiError("high demand")

    monkeypatch.setattr(gemini, "call", busy)
    login(account)
    r = client.post("/studio/cardnews/outline", json={"text": TEXT, "pages": 3}).json()
    assert r["ai"] is False and r["cover"]["title"] == "가을 카페 신메뉴 3가지"
    assert [p["title"] for p in r["pages"]] == ["첫째는 밤라떼예요.", "둘째는 고구마 케이크.", "셋째는 단호박 수프예요."]
    assert r["pages"][0]["body"] == "고소하고 달아요."


def test_outline_with_ai(monkeypatch):
    raw = {"cover": {"title": "가을 신메뉴", "sub": "3가지"}, "pages": [{"title": f"t{i}", "body": "b" * 300} for i in range(5)],
           "end": {"title": "저장!"}, "caption": "캡션", "hashtags": ["#카페", "카페", "가을 메뉴"]}
    monkeypatch.setattr(gemini, "call", lambda *a, **k: {"candidates": [{"content": {"parts": [{"text": json.dumps(raw)}]}}]})
    r = outline.outline(TEXT, 3)
    assert r["ai"] and len(r["pages"]) == 3 and len(r["pages"][0]["body"]) <= outline.BODY_MAX
    assert r["hashtags"] == ["카페", "가을메뉴"]


# ── 예약 · 매주 반복 ──────────────────────────────────────
def _fake_publish(result="published"):
    calls = []

    def fake(body, account, db):
        calls.append(body.job_id)
        job = db.get(GenerationJob, body.job_id)
        if result == "429":
            from fastapi import HTTPException

            job.status = "ready"
            db.commit()
            raise HTTPException(429, "한도")
        job.status, job.ig_media_id, job.published_at = result, "m1", NOW
        db.commit()
        return {}

    return fake, calls


def test_schedule_and_run(monkeypatch, client, login, account, db):
    login(account)
    job = _design(client)
    assert client.post(f"/workflow/jobs/{job['id']}/schedule", json={"at": (NOW - dt.timedelta(minutes=5)).isoformat()}).status_code == 400
    assert client.post(f"/workflow/jobs/{job['id']}/schedule", json={"at": (NOW + dt.timedelta(days=90)).isoformat()}).status_code == 400
    at = NOW + dt.timedelta(hours=2)
    r = client.post(f"/workflow/jobs/{job['id']}/schedule", json={"at": at.isoformat(), "repeat_weekly": True}).json()
    assert r["status"] == "scheduled" and r["repeat_weekly"] and r["scheduled_at"].startswith(at.isoformat()[:16])

    fake, calls = _fake_publish()
    monkeypatch.setattr(schedule, "publish_job", fake)
    assert schedule.run_due(db) == {"due": 0}  # 아직 시각이 안 됨
    row = db.get(GenerationJob, job["id"])
    row.scheduled_at = NOW - dt.timedelta(minutes=1)
    db.commit()
    assert client.post("/workflow/scheduled/run").json() == {"due": 1, "published": 1}
    assert calls == [job["id"]]
    assert schedule.run_due(db) == {"due": 0}  # 다시 올리지 않음

    # 매주 반복 → 다음 주 초안 (그림은 따로 복사, 저절로 올라가지 않음)
    draft = db.query(GenerationJob).filter(GenerationJob.account_id == account.id, GenerationJob.id != job["id"], GenerationJob.prompt == "미니멀").order_by(GenerationJob.id.desc()).first()
    assert draft.status == "ready" and draft.plan["repeat"]["of"] == job["id"]
    assert dt.datetime.fromisoformat(draft.plan["repeat"]["suggest_at"]) - row.scheduled_at.replace(tzinfo=dt.timezone.utc) == dt.timedelta(days=7)
    old_id = job["assets"][0]["url"].rsplit("/", 1)[1][:-4]
    new_id = draft.assets[0]["url"].rsplit("/", 1)[1][:-4]
    assert old_id != new_id and db.get(MediaBlob, new_id).kind == "slide"
    # 초안을 예약하면 repeat 표시는 사라짐
    r = client.post(f"/workflow/jobs/{draft.id}/schedule", json={"at": (NOW + dt.timedelta(days=7)).isoformat(), "repeat_weekly": True}).json()
    assert r["repeat"] is None and r["status"] == "scheduled"
    # 예약 취소
    assert client.delete(f"/workflow/jobs/{draft.id}/schedule").json()["status"] == "ready"


def test_schedule_retries_on_limit(monkeypatch, client, login, account, db):
    login(account)
    job = _design(client)
    client.post(f"/workflow/jobs/{job['id']}/schedule", json={"at": (NOW + dt.timedelta(hours=1)).isoformat()})
    row = db.get(GenerationJob, job["id"])
    fake, calls = _fake_publish("429")
    monkeypatch.setattr(schedule, "publish_job", fake)
    for i in range(schedule.MAX_TRIES):
        row.scheduled_at = NOW - dt.timedelta(minutes=1)
        db.commit()
        schedule.run_due(db)
        db.refresh(row)
        assert row.status == ("failed" if i == schedule.MAX_TRIES - 1 else "scheduled")
    assert "예약 게시 실패" in row.error and len(calls) == schedule.MAX_TRIES


def test_cron_publish_due_needs_secret(monkeypatch, client):
    monkeypatch.setattr(schedule.settings, "scheduler_secret", "s3cret")
    assert client.get("/cron/publish-due").status_code == 401
    assert client.get("/cron/publish-due", headers={"authorization": "Bearer s3cret"}).status_code == 200
