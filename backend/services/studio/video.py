"""동영상 편집 (ffmpeg).

- edit_video  올린 동영상 자르기·소리 끄기·꾸미기(글자·스티커·그림을 그린 투명 PNG 를 영상 전체에 겹침)
- frame_at    동영상의 한 장면을 대표 화면(JPEG)으로
- fit_frame   사진을 다른 비율의 화면에 흐린 배경으로 맞추기 (스토리 9:16)

ffmpeg 는 imageio-ffmpeg 패키지에 들어 있는 실행 파일을 씁니다 (Vercel 에서도 그대로 동작).
Vercel 함수는 60초 제한이 있어 빠른 압축 설정(veryfast)을 쓰고, 시간이 넘으면 다시 압축하지 않는 방식으로 대신합니다.
"""
from __future__ import annotations

import io
import re
import shutil
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ENCODE_TIMEOUT = 40  # 초 — Vercel 60초 안에서 업로드할 시간을 남김


class VideoError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def ffmpeg() -> str:
    try:
        import imageio_ffmpeg
    except ImportError as exc:  # pragma: no cover - 설치 문제
        raise VideoError("영상 처리 프로그램(ffmpeg)을 찾을 수 없습니다.") from exc
    try:
        return imageio_ffmpeg.get_ffmpeg_exe()
    except RuntimeError:
        pass
    # 배포 과정에서 실행 권한이 빠진 경우: 쓰기 가능한 /tmp 에 복사해 권한을 줍니다.
    for src in (Path(imageio_ffmpeg.__file__).parent / "binaries").glob("ffmpeg-*"):
        dst = Path(tempfile.gettempdir()) / src.name
        if not dst.exists():
            shutil.copyfile(src, dst)
            dst.chmod(0o755)
        return str(dst)
    raise VideoError("영상 처리 프로그램(ffmpeg)을 찾을 수 없습니다.")


def _run(args: list[str], timeout: float = ENCODE_TIMEOUT) -> None:
    try:
        proc = subprocess.run([ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", *args], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("ffmpeg timeout") from exc
    if proc.returncode != 0:
        raise VideoError("영상을 만들지 못했습니다: " + proc.stderr.decode(errors="ignore").strip()[-300:])


def probe(path: str | Path) -> dict:
    """길이(초)·소리 유무·가로세로. (ffprobe 가 없어 ffmpeg 출력에서 읽습니다)"""
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, timeout=20)
    text = proc.stderr.decode(errors="ignore")
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    size = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", text)
    w, h = (int(size.group(1)), int(size.group(2))) if size else (0, 0)
    # 휴대폰 세로 영상은 가로로 저장하고 '회전' 표시만 붙이는 경우가 많음 — ffmpeg 는 화면을 세워서 다루므로 크기도 맞춰 바꿈
    rot = re.search(r"rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)", text)
    if rot and round(abs(float(rot.group(1) or rot.group(2)))) % 180 == 90:
        w, h = h, w
    return {"duration": duration, "has_audio": "Audio:" in text, "width": w, "height": h}


def fit_frame(photo: bytes, size: tuple[int, int]) -> bytes:
    """화면 크기에 맞춤. 비율이 같으면 꽉 채우고, 다르면(4:5 사진을 9:16 에) 흐린 배경 위에 통째로 얹습니다."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(photo))).convert("RGB")
    w, h = size
    if abs(img.width / img.height - w / h) < 0.03:
        out = ImageOps.fit(img, size, Image.LANCZOS)
    else:
        out = ImageOps.fit(img, size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(40))
        out = Image.blend(out, Image.new("RGB", size, (0, 0, 0)), 0.25)
        fg = ImageOps.contain(img, size, Image.LANCZOS)
        out.paste(fg, ((w - fg.width) // 2, (h - fg.height) // 2))
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=92)
    return buf.getvalue()


def edit_video(src: Path, *, start: float = 0.0, end: float | None = None, mute: bool = False, overlay: Path | None = None) -> bytes:
    """자르기·소리 끄기·꾸미기. 자르거나 꾸밀 때는 다시 압축해 정확한 위치에서 시작하고,
    (꾸미기 없이) 자르기만 시간 안에 끝나지 않으면 가까운 장면 위치에서 자르는 빠른 방식으로 대신합니다.
    overlay: 영상과 같은 비율의 투명 PNG — 영상 크기에 맞춰 늘려 처음부터 끝까지 겹칩니다."""
    info = probe(src)
    duration = info["duration"] or 0.0
    start = max(0.0, min(start, max(duration - 0.5, 0.0)))
    end = duration if end is None or end <= start or (duration and end > duration) else end
    length = (end - start) if end else None
    keep_sound = info["has_audio"] and not mute
    trimmed = start > 0.05 or (duration and end < duration - 0.05)

    with tempfile.TemporaryDirectory(prefix="iaw-edit-") as tmp:
        dst = Path(tmp) / "out.mp4"

        # 인스타그램 권장: H.264, 긴 변 1920 이하, 30fps
        fit = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',fps=30,format=yuv420p"
        x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"]

        def build(reencode: bool) -> list[str]:
            seek = ["-ss", f"{start:.2f}"] if start > 0.05 else []
            inputs = [*seek, "-i", str(src)]
            sound = ["-map", "0:a:0"] if keep_sound else []
            if overlay is not None:
                # 꾸민 그림을 영상 크기에 맞춰 늘린 뒤 겹치고, 그다음 크기·fps 맞춤
                inputs += ["-i", str(overlay)]
                # (그림은 한 장이라 overlay 의 기본 동작대로 끝까지 마지막 장면이 유지됨)
                vw, vh = info["width"] or 1080, info["height"] or 1920
                v = ["-filter_complex", f"[1:v]scale={vw}:{vh}[ov];[0:v][ov]overlay=0:0:format=auto,{fit}[v]",
                     "-map", "[v]", *sound, *x264]
            elif reencode:
                v = ["-map", "0:v:0", *sound, "-vf", fit, *x264]
            else:
                v = ["-map", "0:v:0", *sound, "-c:v", "copy"]
            a = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"] if keep_sound else ["-an"]
            out = ["-t", f"{length:.2f}"] if length and trimmed else []
            return [*inputs, *v, *a, *out, "-movflags", "+faststart", str(dst)]

        try:
            _run(build(reencode=bool(trimmed)))
        except TimeoutError:
            if not trimmed or overlay is not None:
                raise VideoError("영상이 너무 길어 시간 안에 처리하지 못했습니다.") from None
            _run(build(reencode=False), timeout=15)
        return dst.read_bytes()


def frame_at(src: Path, at: float) -> bytes:
    """동영상의 한 장면을 JPEG 로 (대표 화면)."""
    with tempfile.TemporaryDirectory(prefix="iaw-frame-") as tmp:
        dst = Path(tmp) / "f.jpg"
        _run(["-ss", f"{max(at, 0):.2f}", "-i", str(src), "-frames:v", "1", "-q:v", "3", str(dst)], timeout=20)
        if not dst.exists():
            raise VideoError("그 위치의 장면을 가져오지 못했습니다.")
        return dst.read_bytes()
