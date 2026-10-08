"""동영상 편집: 자르기·소리 끄기·대표 화면·원래대로. 실제 ffmpeg 로 작은 영상을 만들어 확인합니다."""
import io
import secrets
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

from backend.models import GenerationJob, MediaBlob
from backend.services.studio import video as vid


def clip() -> bytes:
    """빨강 3초 → 파랑 3초, 소리 있는 108×192 영상"""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "c.mp4"
        subprocess.run([
            vid.ffmpeg(), "-y", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=red:s=108x192:d=3", "-f", "lavfi", "-i", "color=c=blue:s=108x192:d=3",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-map", "2:a",
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", str(out),
        ], check=True)
        return out.read_bytes()


def blob(db, account, data: bytes, kind: str, content_type: str) -> MediaBlob:
    b = MediaBlob(id=secrets.token_urlsafe(9), account_id=account.id, kind=kind, data=data, content_type=content_type)
    db.add(b)
    db.commit()
    return b


def url(b: MediaBlob) -> str:
    return f"https://testserver/api/py/media/{b.id}.jpg"


def info(client, video_url: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(client.get(video_url.replace("https://testserver/api/py", "")).content)
        f.flush()
        return vid.probe(f.name)


def test_video_edit_trim_mute_cover_and_reset(client, login, account, db):
    login(account)
    src = blob(db, account, clip(), "video", "video/mp4")
    cover_buf = io.BytesIO()
    Image.new("RGB", (108, 192), "red").save(cover_buf, "JPEG")
    cover = blob(db, account, cover_buf.getvalue(), "upload", "image/jpeg")
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind="REELS", status="ready", provider="studio", caption="", hashtags=[],
        assets=[{"type": "video", "url": url(src), "thumbnail_url": url(cover), "meta": {}}], plan={"slides": [{}]},
    )
    db.add(job)
    db.commit()

    r = client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 1, "end": 4.5, "cover_at": 2.5})
    assert r.status_code == 200, r.text
    asset = r.json()["asset"]
    assert asset["url"] != url(src) and abs(asset["meta"]["video_edit"]["duration"] - 3.5) < 0.3
    got = info(client, asset["url"])
    assert abs(got["duration"] - 3.5) < 0.3 and got["has_audio"]
    # 대표 화면: 잘린 영상의 2.5초 = 원본 3.5초 → 파란 부분
    frame = Image.open(io.BytesIO(client.get(asset["thumbnail_url"].replace("https://testserver/api/py", "")).content)).convert("RGB")
    r_, _, b_ = frame.getpixel((frame.width // 2, frame.height // 2))
    assert b_ > 150 and r_ < 100

    # 다시 고쳐도 원본에서 만들고 이전 결과는 정리
    first_render = asset["url"].rsplit("/media/", 1)[1][:-4]
    again = client.post(f"/studio/{job.id}/videos/0/edit", json={"mute": True}).json()["asset"]
    db.expire_all()
    assert db.get(MediaBlob, first_render) is None
    assert not info(client, again["url"])["has_audio"]

    reset = client.post(f"/studio/{job.id}/videos/0/edit", json={"reset": True}).json()["asset"]
    assert reset["url"] == url(src) and reset["thumbnail_url"] == url(cover) and "video_edit" not in reset["meta"]
    assert db.get(MediaBlob, src.id) is not None  # 올린 원본은 그대로


def test_video_overlay_drawn_on_whole_video_and_kept_on_trim(client, login, account, db):
    """꾸미기: 투명 PNG(가운데 노란 네모)를 영상 전체에 겹치고, 자르기를 바꿔도 꾸미기는 남음, 빈 그림이면 꾸미기 지우기."""
    login(account)
    src = blob(db, account, clip(), "video", "video/mp4")
    cover = blob(db, account, b"x", "upload", "image/jpeg")
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind="REELS", status="ready", provider="studio", caption="", hashtags=[],
        assets=[{"type": "video", "url": url(src), "thumbnail_url": url(cover), "meta": {}}], plan={"slides": [{}]},
    )
    db.add(job)
    db.commit()

    ov = Image.new("RGBA", (216, 384), (0, 0, 0, 0))  # 영상의 2배 크기 → 영상 크기에 맞춰 줄여 겹침
    ov.paste((255, 230, 0, 255), (68, 152, 148, 232))
    buf = io.BytesIO()
    ov.save(buf, "PNG")
    r = client.post(f"/studio/{job.id}/videos/0/overlay", files={"file": ("o.png", buf.getvalue(), "image/png")}, data={"layers": '{"v":1}'})
    assert r.status_code == 200, r.text
    edit = r.json()["asset"]["meta"]["video_edit"]
    assert len(edit["overlays"]) == 1 and edit["overlay_layers"] == '{"v":1}' and edit["overlays"][0]["url"].endswith(".png")
    overlay_id = edit["overlays"][0]["id"]

    def center_and_corner(asset):
        frame = Image.open(io.BytesIO(client.get(asset["thumbnail_url"].replace("https://testserver/api/py", "")).content)).convert("RGB")
        return frame.getpixel((frame.width // 2, frame.height // 2)), frame.getpixel((3, 3))

    (cr, cg, cb), (kr, kg, kb) = center_and_corner(r.json()["asset"])
    assert cr > 200 and cg > 180 and cb < 90  # 가운데는 꾸민 노란 네모
    assert kr > 150 and kg < 90  # 가장자리는 원래 영상(빨강)

    # 자르기를 바꿔도 꾸미기는 그대로 (파란 구간에서도 노란 네모)
    trimmed = client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 3.5}).json()["asset"]
    assert trimmed["meta"]["video_edit"]["overlays"][0]["id"] == overlay_id
    (cr, cg, cb), (kr, kg, kb) = center_and_corner(trimmed)
    assert cr > 200 and cg > 180 and kb > 150

    # 빈 그림을 보내면 꾸미기 지우기 (그림 파일도 정리)
    empty = io.BytesIO()
    Image.new("RGBA", (216, 384), (0, 0, 0, 0)).save(empty, "PNG")
    cleared = client.post(f"/studio/{job.id}/videos/0/overlay", files={"file": ("e.png", empty.getvalue(), "image/png")}).json()["asset"]
    assert cleared["meta"]["video_edit"]["overlays"] == []
    db.expire_all()
    assert db.get(MediaBlob, overlay_id) is None


def _frame_at(client, asset_url: str, at: float) -> tuple[int, int, int]:
    with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
        f.write(client.get(asset_url.replace("https://testserver/api/py", "")).content)
        f.flush()
        im = Image.open(io.BytesIO(vid.frame_at(Path(f.name), at))).convert("RGB")
        return im.getpixel((im.width // 2, im.height // 2))


def _png(color) -> bytes:
    ov = Image.new("RGBA", (108, 192), (0, 0, 0, 0))
    ov.paste(color, (34, 76, 74, 116))
    buf = io.BytesIO()
    ov.save(buf, "PNG")
    return buf.getvalue()


def test_video_timed_overlays_and_music(client, login, account, db):
    """꾸미기마다 보이는 시간 (원본 기준 초 → 자른 영상 기준), 음악 덧붙이기·빼기, 지우면 파일도 정리."""
    login(account)
    src = blob(db, account, clip(), "video", "video/mp4")
    cover = blob(db, account, b"x", "upload", "image/jpeg")
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind="REELS", status="ready", provider="studio", caption="", hashtags=[],
        assets=[{"type": "video", "url": url(src), "thumbnail_url": url(cover), "meta": {}}], plan={"slides": [{}]},
    )
    db.add(job)
    db.commit()
    # 1초에서 시작하도록 자름 → 원본 1~2초 노랑, 원본 4초~끝 초록
    client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 1})
    r = client.post(
        f"/studio/{job.id}/videos/0/overlay",
        files=[("files", ("a.png", _png((255, 230, 0, 255)), "image/png")), ("files", ("b.png", _png((0, 220, 0, 255)), "image/png"))],
        data={"timings": "[[1, 2], [4, null]]", "layers": "{}"},
    )
    assert r.status_code == 200, r.text
    edit = r.json()["asset"]["meta"]["video_edit"]
    assert [(o["start"], o["end"]) for o in edit["overlays"]] == [(1, 2), (4, None)]
    assert edit["start"] == 1  # 자르기를 보내지 않으면 그대로
    out = r.json()["asset"]["url"]
    y = _frame_at(client, out, 0.5)  # 원본 1.5초 → 노랑
    assert y[0] > 200 and y[1] > 180 and y[2] < 90
    red = _frame_at(client, out, 1.6)  # 원본 2.6초 → 아무것도 없음 (빨강)
    assert red[0] > 150 and red[1] < 90
    g = _frame_at(client, out, 4.0)  # 원본 5초 → 초록 (파란 영상 위)
    assert g[1] > 150 and g[0] < 90

    # 꾸미기 화면에서 자르기도 함께 바꿈 (end 없으면 끝까지)
    cut = client.post(f"/studio/{job.id}/videos/0/overlay", files=[("files", ("a.png", _png((255, 230, 0, 255)), "image/png"))],
                      data={"timings": "[[1, 2]]", "start": "0.5", "end": "5"}).json()["asset"]["meta"]["video_edit"]
    assert cut["start"] == 0.5 and cut["end"] == 5 and abs(cut["duration"] - 4.5) < 0.3
    r = client.post(f"/studio/{job.id}/videos/0/overlay",
                    files=[("files", ("a.png", _png((255, 230, 0, 255)), "image/png")), ("files", ("b.png", _png((0, 220, 0, 255)), "image/png"))],
                    data={"timings": "[[1, 2], [4, null]]", "start": "1"})
    assert r.json()["asset"]["meta"]["video_edit"]["end"] is None

    # 음악: 소리 없는 영상으로 만들고(mute) 음악만 넣어도 소리가 생김
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = Path(tmp) / "m.mp3"
        subprocess.run([vid.ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=20", str(mp3)], check=True)
        up = client.post(f"/studio/{job.id}/videos/0/audio", files={"file": ("song.mp3", mp3.read_bytes(), "audio/mpeg")}, data={"name": "song.mp3"})
    assert up.status_code == 201, up.text
    audio = up.json()
    assert audio["name"] == "song.mp3" and abs(audio["duration"] - 20) < 0.5
    bad = client.post(f"/studio/{job.id}/videos/0/audio", files={"file": ("x.mp3", b"nope", "audio/mpeg")})
    assert bad.status_code == 400

    r = client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 1, "mute": True, "audios": [{"id": audio["id"], "at": 2, "offset": 3, "volume": 0.8}]})
    assert r.status_code == 200, r.text
    edit = r.json()["asset"]["meta"]["video_edit"]
    assert edit["audios"][0]["id"] == audio["id"] and edit["audios"][0]["name"] == "song.mp3" and len(edit["overlays"]) == 2
    got = info(client, r.json()["asset"]["url"])
    assert got["has_audio"] and abs(got["duration"] - 5) < 0.3  # 음악이 길어도 영상 길이에서 끝남

    # 자르기만 바꾸면(audios 를 보내지 않으면) 음악은 그대로, 빈 목록이면 빼고 파일도 정리
    kept = client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 0, "mute": True}).json()["asset"]
    assert kept["meta"]["video_edit"]["audios"][0]["id"] == audio["id"]
    removed = client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 0, "mute": True, "audios": []}).json()["asset"]
    assert removed["meta"]["video_edit"]["audios"] == [] and not info(client, removed["url"])["has_audio"]
    db.expire_all()
    assert db.get(MediaBlob, audio["id"]) is None


def _song(client, job_id: int, name: str, seconds: int) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        mp3 = Path(tmp) / "m.mp3"
        subprocess.run([vid.ffmpeg(), "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"sine=frequency=660:duration={seconds}", str(mp3)], check=True)
        r = client.post(f"/studio/{job_id}/videos/0/audio", files={"file": (name, mp3.read_bytes(), "audio/mpeg")}, data={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def test_video_apply_everything_at_once(client, login, account, db):
    """적용하기: 자르기·원본 소리·음악 여러 개(구간 자르기 포함)·꾸미기를 한 번에 받아 한 번만 만듦.
    꾸미기를 고치지 않았으면(overlays_changed=false) 지금 꾸미기를 그대로 씀."""
    import json as _json
    login(account)
    src = blob(db, account, clip(), "video", "video/mp4")
    cover = blob(db, account, b"x", "upload", "image/jpeg")
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind="REELS", status="ready", provider="studio", caption="", hashtags=[],
        assets=[{"type": "video", "url": url(src), "thumbnail_url": url(cover), "meta": {}}], plan={"slides": [{}]},
    )
    db.add(job)
    db.commit()
    a1, a2 = _song(client, job.id, "a.mp3", 10), _song(client, job.id, "b.mp3", 10)
    state = {"start": 1, "volume": 0, "cover_at": 1,
             "audios": [{"id": a1["id"], "at": 1, "offset": 4, "length": 1.5}, {"id": a2["id"], "at": 3, "volume": 0.5}],
             "overlays_changed": True}
    r = client.post(f"/studio/{job.id}/videos/0/apply", data={"state": _json.dumps(state), "timings": "[[1, 2]]", "layers": "{}"},
                    files=[("files", ("a.png", _png((255, 230, 0, 255)), "image/png"))])
    assert r.status_code == 200, r.text
    edit = r.json()["asset"]["meta"]["video_edit"]
    assert edit["start"] == 1 and edit["mute"] and [a["id"] for a in edit["audios"]] == [a1["id"], a2["id"]]
    assert edit["audios"][0]["length"] == 1.5 and len(edit["overlays"]) == 1
    got = info(client, r.json()["asset"]["url"])
    assert got["has_audio"] and abs(got["duration"] - 5) < 0.3

    # 꾸미기는 그대로, 음악 하나 빼기 → 빠진 파일은 정리
    state.update(audios=[{"id": a2["id"], "at": 3}], overlays_changed=False)
    r = client.post(f"/studio/{job.id}/videos/0/apply", data={"state": _json.dumps(state)})
    edit = r.json()["asset"]["meta"]["video_edit"]
    assert len(edit["overlays"]) == 1 and [a["id"] for a in edit["audios"]] == [a2["id"]]
    db.expire_all()
    assert db.get(MediaBlob, a1["id"]) is None
    bad = client.post(f"/studio/{job.id}/videos/0/apply", data={"state": "{nope"})
    assert bad.status_code == 422


def test_fit_frame_keeps_whole_photo_on_other_ratio():
    buf = io.BytesIO()
    Image.new("RGB", (200, 100), "red").save(buf, "JPEG")
    out = Image.open(io.BytesIO(vid.fit_frame(buf.getvalue(), (90, 160))))
    assert out.size == (90, 160) and out.getpixel((45, 80))[0] > 200
