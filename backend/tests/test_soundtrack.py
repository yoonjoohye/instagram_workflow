"""음악 넣기(사진 → 릴스·동영상 스토리)와 동영상 편집. 실제 ffmpeg 로 작은 영상을 만들어 확인합니다 (Instagram 은 가짜)."""
import io
import tempfile
from pathlib import Path

from PIL import Image

from backend.models import GenerationJob, MediaBlob
from backend.routers import workflow
from backend.services.studio import soundtrack as st


def jpeg(color: str, size=(108, 135)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", size, color).save(b, "JPEG")
    return b.getvalue()


def blob(db, account, data: bytes, kind="slide", content_type="image/jpeg") -> MediaBlob:
    import secrets

    b = MediaBlob(id=secrets.token_urlsafe(9), account_id=account.id, kind=kind, data=data, content_type=content_type)
    db.add(b)
    db.commit()
    return b


def url(b: MediaBlob) -> str:
    return f"https://testserver/api/py/media/{b.id}.jpg"


def photo_job(db, account, colors, kind="CAROUSEL", post_type="feed") -> GenerationJob:
    assets = []
    for c in colors:
        b = blob(db, account, jpeg(c))
        assets.append({"type": "image", "url": url(b), "thumbnail_url": url(b), "meta": {"status": "done"}})
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind=kind, status="ready", provider="studio", caption="c", hashtags=[],
        assets=assets, plan={"slides": [{}] * len(colors), "post_type": post_type},
    )
    db.add(job)
    db.commit()
    return job


def video_seconds(client, video_url: str) -> float:
    data = client.get(video_url.replace("https://testserver/api/py", "")).content
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(data)
        f.flush()
        info = st.probe(f.name)
    assert info["has_audio"]
    return info["duration"]


class FakeGraph:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_instagram(monkeypatch) -> list[dict]:
    created: list[dict] = []
    monkeypatch.setattr(workflow, "graph_for", lambda acc: FakeGraph())
    monkeypatch.setattr(workflow.publishing, "publishing_limit", lambda c, u: {"remaining": 25, "used": 0, "total": 25})
    monkeypatch.setattr(workflow.publishing, "create_container", lambda c, u, **k: created.append(k) or f"c{len(created)}")
    monkeypatch.setattr(workflow.publishing, "wait_until_finished", lambda c, cid: None)
    monkeypatch.setattr(workflow.publishing, "publish", lambda c, u, cid: {"media_id": f"m-{cid}", "permalink": ""})
    return created


def test_feed_photos_become_reel_with_music(monkeypatch, client, login, account, db):
    login(account)
    job = photo_job(db, account, ["red", "blue"])
    assert client.get("/studio/tracks").json()["data"][0]["key"] == "sunny-pop"

    r = client.put(f"/studio/{job.id}/soundtrack", json={"track": "lofi-chill", "seconds": 2, "offset": 3})
    assert r.status_code == 200, r.text
    track = r.json()["soundtrack"]
    assert track["name"] == "Lo-fi Chill" and not track["stale"] and len(track["outputs"]) == 1
    assert abs(video_seconds(client, track["outputs"][0]["url"]) - 4) < 0.3  # 2장 × 2초

    # 게시하면 캐러셀이 아니라 음악 있는 릴스 하나로 올라감
    created = fake_instagram(monkeypatch)
    published = client.post("/workflow/publish", json={"job_id": job.id}).json()
    assert published["status"] == "published" and published["media_kind"] == "REELS"
    assert [c["kind"] for c in created] == ["REELS"] and created[0]["media_url"] == track["outputs"][0]["url"]


def test_changed_photos_need_rebuild_and_music_can_be_removed(monkeypatch, client, login, account, db):
    login(account)
    job = photo_job(db, account, ["red"], kind="IMAGE")
    first = client.put(f"/studio/{job.id}/soundtrack", json={"track": "calm-piano", "seconds": 2}).json()
    render_id = first["soundtrack"]["outputs"][0]["url"].rsplit("/media/", 1)[1][:-4]
    assert first["soundtrack"]["outputs"][0]  # 사진 1장이어도 릴스는 3초 이상
    assert video_seconds(client, first["soundtrack"]["outputs"][0]["url"]) >= 2.9

    # 사진을 바꾸면 영상을 다시 만들어야 하고, 그 전에는 게시하지 않음
    other = blob(db, account, jpeg("green"))
    client.patch(f"/workflow/jobs/{job.id}", json={"assets": [{**job.assets[0], "url": url(other)}]})
    assert client.get(f"/workflow/jobs/{job.id}").json()["soundtrack"]["stale"] is True
    fake_instagram(monkeypatch)
    assert client.post("/workflow/publish", json={"job_id": job.id}).status_code == 409

    # 음악 빼기 → 만든 영상도 지워지고 다시 사진으로 게시
    r = client.delete(f"/studio/{job.id}/soundtrack")
    assert r.json()["soundtrack"] is None
    db.expire_all()
    assert db.get(MediaBlob, render_id) is None


def test_story_photos_become_video_stories(monkeypatch, client, login, account, db):
    login(account)
    job = photo_job(db, account, ["red", "blue"], kind="STORIES", post_type="story")
    r = client.put(f"/studio/{job.id}/soundtrack", json={"track": "sunny-pop", "seconds": 3})
    outputs = r.json()["soundtrack"]["outputs"]
    assert [o["index"] for o in outputs] == [0, 1]

    created = fake_instagram(monkeypatch)
    assert client.post("/workflow/publish", json={"job_id": job.id}).json()["status"] == "published"
    assert [c["media_url"] for c in created] == [o["url"] for o in outputs]


def test_video_edit_trim_music_cover_and_reset(client, login, account, db):
    login(account)
    clip = st.slideshow([jpeg("red"), jpeg("blue")], seconds=3, size=(108, 192), audio=st.track_path("sunny-pop"))
    src = blob(db, account, clip, kind="video", content_type="video/mp4")
    cover = blob(db, account, jpeg("red"), kind="upload")
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind="REELS", status="ready", provider="studio", caption="", hashtags=[],
        assets=[{"type": "video", "url": url(src), "thumbnail_url": url(cover), "meta": {}}], plan={"slides": [{}]},
    )
    db.add(job)
    db.commit()

    r = client.post(f"/studio/{job.id}/videos/0/edit", json={
        "start": 1, "end": 4.5, "cover_at": 2.5, "music": {"track": "dreamy-night", "volume": 0.8}, "original_volume": 0.2,
    })
    assert r.status_code == 200, r.text
    asset = r.json()["asset"]
    assert asset["url"] != url(src) and asset["thumbnail_url"] != url(cover)
    assert abs(asset["meta"]["video_edit"]["duration"] - 3.5) < 0.3
    assert abs(video_seconds(client, asset["url"]) - 3.5) < 0.3
    # 대표 화면: 잘린 영상의 2.5초 = 원본 3.5초 → 파란 사진
    frame = Image.open(io.BytesIO(client.get(asset["thumbnail_url"].replace("https://testserver/api/py", "")).content))
    r_, g_, b_ = frame.convert("RGB").getpixel((frame.width // 2, frame.height // 2))
    assert b_ > 150 and r_ < 100

    # 한 번 더 고쳐도 원본에서 다시 만들고, 이전 결과는 정리
    first_render = asset["url"].rsplit("/media/", 1)[1][:-4]
    again = client.post(f"/studio/{job.id}/videos/0/edit", json={"mute": True}).json()["asset"]
    db.expire_all()
    assert db.get(MediaBlob, first_render) is None
    assert abs(again["meta"]["video_edit"]["duration"] - 6) < 0.3

    # 원래대로
    reset = client.post(f"/studio/{job.id}/videos/0/edit", json={"reset": True}).json()["asset"]
    assert reset["url"] == url(src) and reset["thumbnail_url"] == url(cover) and "video_edit" not in reset["meta"]
    assert db.get(MediaBlob, src.id) is not None  # 올린 원본은 그대로


def test_frame_fit_keeps_whole_photo_on_other_ratio():
    out = Image.open(io.BytesIO(st.fit_frame(jpeg("red", (200, 100)), (90, 160))))
    assert out.size == (90, 160)
    assert out.getpixel((45, 80))[0] > 200  # 가운데는 사진 그대로
    assert Path(st.track_path("calm-piano")).exists()


def test_manual_post_without_ai(monkeypatch, client, login, account, db):
    """AI 없이 고른 사진 그대로 작업 공간 열기 → 음악 넣기까지 (Gemini 를 부르지 않음)."""
    from backend.services.studio import gemini

    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(AssertionError("Gemini 호출 안 됨")))
    login(account)
    ids = [client.post("/media/uploads", files={"file": (f"{c}.jpg", jpeg(c), "image/jpeg")}).json()["id"] for c in ("red", "blue")]
    r = client.post("/studio/manual", json={"upload_ids": ids})
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["media_kind"] == "CAROUSEL" and job["status"] == "ready" and len(job["assets"]) == 2
    assert client.put(f"/studio/{job['id']}/soundtrack", json={"track": "sunny-pop"}).status_code == 200
    story = client.post("/studio/manual", json={"upload_ids": ids, "post_type": "story"}).json()
    assert story["media_kind"] == "STORIES"
