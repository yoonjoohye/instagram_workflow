"""API 키 없이도 전체 흐름을 끝까지 돌려보기 위한 목업 엔진.

여기서 반환하는 URL 은 전부 공개 CDN 이라 실제로 Instagram 에 발행까지 됩니다.
"""
from __future__ import annotations

import hashlib

from .base import Asset, GenerationRequest

# 공개 샘플 영상 (Google 호스팅, mp4/H.264 — Reels 규격 통과)
_SAMPLE_VIDEOS = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
]
_SAMPLE_AUDIO = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"

_RATIOS = {
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
    "9:16": (1080, 1920),
    "16:9": (1920, 1080),
}


def _seed(prompt: str, index: int) -> str:
    return hashlib.sha1(f"{prompt}:{index}".encode()).hexdigest()[:12]


class MockEngine:
    name = "mock"

    def available(self) -> bool:
        return True

    def generate(self, req: GenerationRequest) -> list[Asset]:
        w, h = _RATIOS.get(req.aspect_ratio, _RATIOS["4:5"])
        assets: list[Asset] = []

        if req.media_kind in {"REELS"} or (req.media_kind == "STORIES" and req.with_music):
            for i in range(req.count):
                video = _SAMPLE_VIDEOS[i % len(_SAMPLE_VIDEOS)]
                assets.append(
                    Asset(
                        type="video",
                        url=video,
                        thumbnail_url=f"https://picsum.photos/seed/{_seed(req.prompt, i)}/{w}/{h}",
                        meta={"mock": True, "prompt": req.prompt, "aspect_ratio": req.aspect_ratio},
                    )
                )
        else:
            for i in range(req.count):
                url = f"https://picsum.photos/seed/{_seed(req.prompt, i)}/{w}/{h}"
                assets.append(
                    Asset(
                        type="image",
                        url=url,
                        thumbnail_url=url,
                        meta={"mock": True, "prompt": req.prompt, "aspect_ratio": req.aspect_ratio},
                    )
                )

        if req.with_music:
            assets.append(
                Asset(
                    type="audio",
                    url=_SAMPLE_AUDIO,
                    meta={
                        "mock": True,
                        "prompt": f"{req.prompt} 분위기의 배경음악",
                        "note": "Instagram API 는 오디오 트랙을 따로 붙일 수 없습니다. "
                        "음악은 영상에 믹싱된 상태로 업로드되어야 합니다.",
                    },
                )
            )
        return assets
