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
    assert edit["overlay_id"] and edit["overlay_layers"] == '{"v":1}' and edit["overlay_url"].endswith(".png")

    def center_and_corner(asset):
        frame = Image.open(io.BytesIO(client.get(asset["thumbnail_url"].replace("https://testserver/api/py", "")).content)).convert("RGB")
        return frame.getpixel((frame.width // 2, frame.height // 2)), frame.getpixel((3, 3))

    (cr, cg, cb), (kr, kg, kb) = center_and_corner(r.json()["asset"])
    assert cr > 200 and cg > 180 and cb < 90  # 가운데는 꾸민 노란 네모
    assert kr > 150 and kg < 90  # 가장자리는 원래 영상(빨강)

    # 자르기를 바꿔도 꾸미기는 그대로 (파란 구간에서도 노란 네모)
    trimmed = client.post(f"/studio/{job.id}/videos/0/edit", json={"start": 3.5}).json()["asset"]
    assert trimmed["meta"]["video_edit"]["overlay_id"] == edit["overlay_id"]
    (cr, cg, cb), (kr, kg, kb) = center_and_corner(trimmed)
    assert cr > 200 and cg > 180 and kb > 150

    # 빈 그림을 보내면 꾸미기 지우기 (그림 파일도 정리)
    empty = io.BytesIO()
    Image.new("RGBA", (216, 384), (0, 0, 0, 0)).save(empty, "PNG")
    cleared = client.post(f"/studio/{job.id}/videos/0/overlay", files={"file": ("e.png", empty.getvalue(), "image/png")}).json()["asset"]
    assert cleared["meta"]["video_edit"]["overlay_id"] == ""
    db.expire_all()
    assert db.get(MediaBlob, edit["overlay_id"]) is None


def test_fit_frame_keeps_whole_photo_on_other_ratio():
    buf = io.BytesIO()
    Image.new("RGB", (200, 100), "red").save(buf, "JPEG")
    out = Image.open(io.BytesIO(vid.fit_frame(buf.getvalue(), (90, 160))))
    assert out.size == (90, 160) and out.getpixel((45, 80))[0] > 200
