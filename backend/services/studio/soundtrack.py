"""음악 넣기·동영상 편집 (ffmpeg).

- slideshow   사진 여러 장 + 음악 → 영상 하나 (피드는 릴스, 스토리는 장마다 영상)
- edit_video  올린 동영상 자르기·소리 끄기·음악 넣기
- frame_at    동영상의 한 장면을 대표 화면(JPEG)으로

ffmpeg 는 imageio-ffmpeg 패키지에 들어 있는 실행 파일을 씁니다 (Vercel 에서도 그대로 동작).
Vercel 함수는 60초 제한이 있어 인코딩은 빠른 설정(veryfast)으로 하고, 시간이 넘으면 다시 압축하지 않는 방식으로 대신합니다.
기본 음악(backend/assets/music)은 backend/scripts/make_music.py 로 직접 만든 곡이라 저작권 걱정이 없습니다.
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

MUSIC_DIR = Path(__file__).resolve().parents[2] / "assets" / "music"

# key → 제목 (화면에는 분위기 이름을 번역해 보여 줌: studio.track.<key>)
TRACKS: dict[str, str] = {
    "sunny-pop": "Sunny Pop",
    "lofi-chill": "Lo-fi Chill",
    "calm-piano": "Calm Keys",
    "dreamy-night": "Dreamy Night",
}

FPS = 30
FADE = 0.4  # 사진 사이 전환(겹쳐 바뀌는) 시간
ENCODE_TIMEOUT = 40  # 초 — Vercel 60초 안에서 업로드할 시간을 남김


class SoundtrackError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def ffmpeg() -> str:
    try:
        import imageio_ffmpeg
    except ImportError as exc:  # pragma: no cover - 설치 문제
        raise SoundtrackError("영상 처리 프로그램(ffmpeg)을 찾을 수 없습니다.") from exc
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
    raise SoundtrackError("영상 처리 프로그램(ffmpeg)을 찾을 수 없습니다.")


def track_path(key: str) -> Path:
    if key not in TRACKS:
        raise SoundtrackError("없는 음악입니다.")
    return MUSIC_DIR / f"{key}.m4a"


def _run(args: list[str], timeout: float = ENCODE_TIMEOUT) -> None:
    try:
        proc = subprocess.run([ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", *args], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("ffmpeg timeout") from exc
    if proc.returncode != 0:
        raise SoundtrackError("영상을 만들지 못했습니다: " + proc.stderr.decode(errors="ignore").strip()[-300:])


def probe(path: str | Path) -> dict:
    """길이(초)·소리 유무·가로세로. (ffprobe 가 없어 ffmpeg 출력에서 읽습니다)"""
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, timeout=20)
    text = proc.stderr.decode(errors="ignore")
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", text)
    duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0
    size = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", text)
    return {
        "duration": duration,
        "has_audio": "Audio:" in text,
        "width": int(size.group(1)) if size else 0,
        "height": int(size.group(2)) if size else 0,
    }


def fit_frame(photo: bytes, size: tuple[int, int]) -> bytes:
    """영상 화면 크기에 맞춤. 비율이 같으면 꽉 채우고, 다르면(4:5 사진을 9:16 영상에) 흐린 배경 위에 통째로 얹습니다."""
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


def _audio_args(audio: Path | None, offset: float, loop: bool) -> list[str]:
    if audio is None:
        return []
    return [*(["-stream_loop", "-1"] if loop else []), "-ss", f"{max(offset, 0):.2f}", "-i", str(audio)]


def _audio_filter(label: str, volume: float, total: float) -> str:
    """음량 + 끝에서 1초 동안 소리 줄이기"""
    fade = min(1.0, total / 3)
    return f"{label}volume={volume:.2f},afade=t=out:st={max(total - fade, 0):.2f}:d={fade:.2f}"


def slideshow(
    photos: list[bytes],
    *,
    seconds: float,
    size: tuple[int, int],
    audio: Path | None,
    offset: float = 0.0,
    volume: float = 1.0,
) -> bytes:
    """사진들을 차례로 보여 주는 MP4 (사진 사이는 부드럽게 겹쳐 바뀜). 음악은 영상 길이에 맞춰 자르고 끝을 줄입니다."""
    if not photos:
        raise SoundtrackError("영상으로 만들 사진이 없습니다.")
    n = len(photos)
    fade = FADE if n > 1 and seconds > FADE * 2 else 0.0
    total = n * seconds
    with tempfile.TemporaryDirectory(prefix="iaw-show-") as tmp:
        args: list[str] = []
        for i, photo in enumerate(photos):
            p = Path(tmp) / f"{i}.jpg"
            p.write_bytes(fit_frame(photo, size))
            length = seconds + (fade if i < n - 1 else 0)
            args += ["-loop", "1", "-framerate", str(FPS), "-t", f"{length:.2f}", "-i", str(p)]
        args += _audio_args(audio, offset, loop=True)
        chain = []
        last = "[0:v]"
        for i in range(1, n):
            out = f"[x{i}]"
            if fade:
                chain.append(f"{last}[{i}:v]xfade=transition=fade:duration={fade}:offset={i * seconds:.2f}{out}")
            else:
                chain.append(f"{last}[{i}:v]concat=n=2:v=1:a=0{out}")
            last = out
        chain.append(f"{last}format=yuv420p[v]")
        maps = ["-map", "[v]"]
        if audio is not None:
            chain.append(_audio_filter(f"[{n}:a]", volume, total) + "[a]")
            maps += ["-map", "[a]", "-c:a", "aac", "-b:a", "128k", "-ar", "44100"]
        dst = Path(tmp) / "out.mp4"
        _run([
            *args, "-filter_complex", ";".join(chain), *maps,
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "22", "-r", str(FPS),
            "-t", f"{total:.2f}", "-movflags", "+faststart", str(dst),
        ])
        return dst.read_bytes()


def edit_video(
    src: Path,
    *,
    start: float = 0.0,
    end: float | None = None,
    mute: bool = False,
    audio: Path | None = None,
    offset: float = 0.0,
    volume: float = 1.0,
    original_volume: float = 1.0,
) -> bytes:
    """자르기·소리 끄기·음악 넣기. 자를 때는 다시 압축해 정확한 위치에서 시작하고,
    시간 안에 끝나지 않으면 가까운 장면 위치에서 자르는 빠른 방식으로 대신합니다."""
    info = probe(src)
    duration = info["duration"] or 0.0
    start = max(0.0, min(start, max(duration - 0.5, 0.0)))
    end = duration if end is None or end <= start or (duration and end > duration) else end
    length = (end - start) if end else None
    keep_sound = info["has_audio"] and not mute and original_volume > 0
    trimmed = start > 0.05 or (duration and end < duration - 0.05)

    with tempfile.TemporaryDirectory(prefix="iaw-edit-") as tmp:
        dst = Path(tmp) / "out.mp4"

        def build(reencode: bool) -> list[str]:
            seek = ["-ss", f"{start:.2f}"] if start > 0.05 else []
            args = [*seek, "-i", str(src)]
            args += _audio_args(audio, offset, loop=True)
            span = length or duration
            chain, maps = [], ["-map", "0:v:0"]
            if audio is not None and keep_sound:
                chain.append(f"[0:a]volume={original_volume:.2f}[o]")
                chain.append(_audio_filter("[1:a]", volume, span) + "[m]")
                chain.append("[o][m]amix=inputs=2:duration=first:normalize=0[a]")
                maps += ["-map", "[a]"]
            elif audio is not None:
                chain.append(_audio_filter("[1:a]", volume, span) + "[a]")
                maps += ["-map", "[a]"]
            elif keep_sound:
                if original_volume != 1:
                    chain.append(f"[0:a]volume={original_volume:.2f}[a]")
                    maps += ["-map", "[a]"]
                else:
                    maps += ["-map", "0:a:0"]
            if reencode:
                # 인스타그램 권장: H.264, 긴 변 1920 이하, 30fps
                v = ["-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',fps=30,format=yuv420p",
                     "-c:v", "libx264", "-preset", "veryfast", "-crf", "21"]
            else:
                v = ["-c:v", "copy"]
            a = ["-c:a", "aac", "-b:a", "128k", "-ar", "44100"] if (audio is not None or keep_sound) else ["-an"]
            out = ["-t", f"{length:.2f}"] if length and trimmed else []
            return [*args, *(["-filter_complex", ";".join(chain)] if chain else []), *maps, *v, *a, *out,
                    "-movflags", "+faststart", str(dst)]

        try:
            _run(build(reencode=bool(trimmed)))
        except TimeoutError:
            if not trimmed:
                raise SoundtrackError("영상이 너무 길어 시간 안에 처리하지 못했습니다.") from None
            _run(build(reencode=False), timeout=15)
        return dst.read_bytes()


def frame_at(src: Path, at: float) -> bytes:
    """동영상의 한 장면을 JPEG 로 (대표 화면)."""
    with tempfile.TemporaryDirectory(prefix="iaw-frame-") as tmp:
        dst = Path(tmp) / "f.jpg"
        _run(["-ss", f"{max(at, 0):.2f}", "-i", str(src), "-frames:v", "1", "-q:v", "3", str(dst)], timeout=20)
        if not dst.exists():
            raise SoundtrackError("그 위치의 장면을 가져오지 못했습니다.")
        return dst.read_bytes()
