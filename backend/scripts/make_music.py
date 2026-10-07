"""기본 제공 음악(저작권 걱정 없는 직접 만든 곡)을 만듭니다.

    .venv/bin/pip install numpy   # 이 스크립트에만 필요 (서버에는 필요 없음)
    .venv/bin/python backend/scripts/make_music.py

결과: backend/assets/music/<key>.m4a (40초, AAC 128k). 곡 목록은 backend/services/studio/soundtrack.py 의 TRACKS.
"""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg
import numpy as np

SR = 44100
SECONDS = 40
OUT = Path(__file__).resolve().parents[1] / "assets" / "music"
rng = np.random.default_rng(7)

NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def freq(name: str) -> float:
    """'A4' → 440Hz"""
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[pitch] + (octave - 4) * 12 - 9) / 12)


def chord(root: str, kind: str = "maj", octave: int = 3) -> list[float]:
    steps = {"maj": [0, 4, 7, 11], "min": [0, 3, 7, 10], "sus": [0, 5, 7, 14]}[kind]
    base = freq(f"{root}{octave}")
    return [base * 2 ** (s / 12) for s in steps]


def env(n: int, attack: float, decay: float) -> np.ndarray:
    t = np.arange(n) / SR
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):  # 단순 1차 필터 (느리지만 곡 몇 개라 충분)
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def tone(f: float, n: int, shape: str = "sine") -> np.ndarray:
    t = np.arange(n) / SR
    if shape == "saw":  # 배음 몇 개만 더한 부드러운 톱니파
        return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7)) * 0.6
    if shape == "tri":
        return 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * t))
    return np.sin(2 * np.pi * f * t)


def add(buf: np.ndarray, sig: np.ndarray, at: float, pan: float = 0.0) -> None:
    i = int(at * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i : i + len(sig), 0] += sig * (1 - max(pan, 0))
    buf[i : i + len(sig), 1] += sig * (1 + min(pan, 0))


def kick(n: int = int(0.35 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def snare(n: int = int(0.25 * SR)) -> np.ndarray:
    t = np.arange(n) / SR
    noise = np.convolve(rng.uniform(-1, 1, n), np.ones(6) / 6, "same")  # 거친 고음을 덜어냄
    return (noise * 0.7 + np.sin(2 * np.pi * 190 * t) * 0.4) * np.exp(-t * 18)


def hat(n: int = int(0.06 * SR)) -> np.ndarray:
    noise = rng.uniform(-1, 1, n)
    hp = noise - np.concatenate([[0], noise[:-1]])  # 고음만
    return hp * np.exp(-np.arange(n) / SR * 60) * 0.5


def reverb(buf: np.ndarray, mix: float) -> np.ndarray:
    wet = np.zeros_like(buf)
    for delay, gain in [(0.031, 0.5), (0.047, 0.42), (0.071, 0.35), (0.113, 0.28), (0.167, 0.2)]:
        d = int(delay * SR)
        wet[d:, 0] += buf[:-d, 0] * gain
        wet[d:, 1] += buf[:-d, 1] * gain * 0.95
    return buf + wet * mix


def song(bpm: float, progression: list[tuple[str, str]], *, drums: str, pad: str, lead_shape: str, scale: list[str], lead_density: float, swing: float = 0.0, bright: float = 2500) -> np.ndarray:
    beat = 60 / bpm
    bar = beat * 4
    buf = np.zeros((SR * SECONDS, 2))
    bars = int(SECONDS / bar) + 1
    for b in range(bars):
        root, kind = progression[b % len(progression)]
        start = b * bar
        notes = chord(root, kind)
        # 패드 (화음)
        n = int(bar * SR)
        for j, f in enumerate(notes):
            sig = tone(f, n, pad) * env(n, 0.3, bar * 1.2) * 0.07
            add(buf, sig, start, pan=(j - 1.5) * 0.3)
        # 베이스
        for k in range(4 if drums != "none" else 2):
            step = beat if drums != "none" else beat * 2
            nb = int(step * SR * 0.9)
            add(buf, tone(notes[0] / 2, nb, "tri") * env(nb, 0.01, step * 0.8) * 0.22, start + k * step)
        # 리듬
        if drums != "none":
            for k in range(4):
                t0 = start + k * beat
                if drums == "pop" or k in (0, 2):
                    add(buf, kick() * 0.55, t0)
                if k in (1, 3):
                    add(buf, snare() * (0.11 if drums == "pop" else 0.07), t0)
                for h in range(2):
                    off = h * beat / 2 + (swing * beat / 2 if h else 0)
                    add(buf, hat() * (0.06 if drums == "pop" else 0.04), t0 + off, pan=0.3)
        # 멜로디 (음계 안에서 이어지는 아르페지오)
        steps = 8
        for k in range(steps):
            if rng.random() > lead_density:
                continue
            note = scale[int(rng.integers(0, len(scale)))]
            dur = bar / steps
            nl = int(dur * SR * 1.6)
            sig = tone(freq(note), nl, lead_shape) * env(nl, 0.005, dur * 0.9) * 0.11
            add(buf, sig, start + k * dur + (swing * dur * 0.5 if k % 2 else 0), pan=0.25 * (1 if k % 2 else -1))
    for ch in range(2):
        buf[:, ch] = lowpass(buf[:, ch], bright)
    buf = reverb(buf, 0.35)
    # 앞뒤 페이드, 음량 맞추기
    fade = int(1.5 * SR)
    buf[:fade] *= np.linspace(0, 1, fade)[:, None]
    buf[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return buf / np.max(np.abs(buf)) * 0.89


TRACKS = {
    "sunny-pop": dict(
        bpm=112, progression=[("C", "maj"), ("G", "maj"), ("A", "min"), ("F", "maj")], drums="pop", pad="saw",
        lead_shape="tri", scale=["C5", "D5", "E5", "G5", "A5", "C6"], lead_density=0.75, bright=4200,
    ),
    "lofi-chill": dict(
        bpm=78, progression=[("D", "min"), ("G", "maj"), ("C", "maj"), ("A", "min")], drums="lofi", pad="tri",
        lead_shape="sine", scale=["D5", "F5", "G5", "A5", "C6"], lead_density=0.45, swing=0.35, bright=1800,
    ),
    "calm-piano": dict(
        bpm=66, progression=[("F", "maj"), ("C", "maj"), ("D", "min"), ("A#", "maj")], drums="none", pad="sine",
        lead_shape="tri", scale=["F4", "A4", "C5", "E5", "G5"], lead_density=0.55, bright=2600,
    ),
    "dreamy-night": dict(
        bpm=90, progression=[("A", "min"), ("F", "maj"), ("C", "maj"), ("G", "sus")], drums="lofi", pad="saw",
        lead_shape="sine", scale=["A4", "C5", "E5", "G5", "B5"], lead_density=0.5, swing=0.15, bright=1500,
    ),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for key, params in TRACKS.items():
        audio = song(**params)
        wav = OUT / f"{key}.wav"
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((audio * 32767).astype("<i2").tobytes())
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "aac", "-b:a", "128k", "-ar", "44100", str(OUT / f"{key}.m4a")],
            check=True,
        )
        wav.unlink()
        print(key, (OUT / f"{key}.m4a").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
