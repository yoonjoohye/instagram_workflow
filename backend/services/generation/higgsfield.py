"""Higgsfield 생성 엔진 어댑터.

Higgsfield 는 모델마다 엔드포인트 경로가 다르고 콘솔에서 카탈로그가 바뀌기 때문에,
경로를 .env 로 빼두고 공통 규약(작업 생성 → 폴링)만 여기에 구현했습니다.

공통 규약
  인증   : Authorization: Key <KEY_ID>:<KEY_SECRET>
  요청   : POST {base}{path}  body = {"params": {...}}
  응답   : {"id": "...", "status_url": "...", ...}
  폴링   : GET status_url  →  {"status": "queued|in_progress|completed|failed", "results": [...]}

경로가 맞지 않으면 워크플로우는 자동으로 mock 엔진으로 내려갑니다(폴백).
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from ...config import settings
from .base import Asset, GenerationError, GenerationRequest

POLL_INTERVAL_SEC = 2.0
POLL_MAX_ATTEMPTS = 20  # 최대 ~40초


class HiggsfieldEngine:
    name = "higgsfield"

    def available(self) -> bool:
        return settings.higgsfield_configured

    # ── 내부 ────────────────────────────────────────────────────────────
    def _headers(self) -> dict[str, str]:
        key = f"{settings.higgsfield_api_key_id}:{settings.higgsfield_api_key_secret}"
        return {"Authorization": f"Key {key}", "Content-Type": "application/json"}

    def _submit(self, client: httpx.Client, path: str, params: dict[str, Any]) -> dict[str, Any]:
        resp = client.post(path, json={"params": params}, headers=self._headers())
        if resp.status_code >= 400:
            raise GenerationError(f"Higgsfield 요청 실패 ({resp.status_code}): {resp.text[:300]}")
        return resp.json()

    def _poll(self, client: httpx.Client, submitted: dict[str, Any]) -> dict[str, Any]:
        status_url = submitted.get("status_url")
        job_id = submitted.get("id")
        if not status_url and job_id:
            status_url = f"{settings.higgsfield_base_url}/v1/jobs/{job_id}"
        if not status_url:
            raise GenerationError("Higgsfield 응답에 status_url 이 없습니다.")

        for attempt in range(POLL_MAX_ATTEMPTS):
            resp = client.get(status_url, headers=self._headers())
            if resp.status_code >= 400:
                raise GenerationError(f"Higgsfield 상태 조회 실패 ({resp.status_code})")
            data = resp.json()
            status = (data.get("status") or "").lower()
            if status in {"completed", "succeeded", "success", "done"}:
                return data
            if status in {"failed", "error", "canceled", "cancelled"}:
                raise GenerationError(f"Higgsfield 작업 실패: {data.get('error') or status}")
            if attempt < POLL_MAX_ATTEMPTS - 1:
                time.sleep(POLL_INTERVAL_SEC)
        raise GenerationError("Higgsfield 작업이 제한 시간 안에 끝나지 않았습니다.")

    @staticmethod
    def _extract_urls(payload: dict[str, Any]) -> list[str]:
        """응답 스키마가 모델마다 달라 재귀적으로 url 필드를 긁어옵니다."""
        urls: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key in {"url", "raw_url", "min_url", "output_url"} and isinstance(value, str):
                        urls.append(value)
                    else:
                        walk(value)
            elif isinstance(node, list):
                for item in node:
                    walk(item)

        walk(payload.get("results", payload))
        # 순서 유지 중복 제거
        return list(dict.fromkeys(urls))

    # ── 공개 API ────────────────────────────────────────────────────────
    def generate(self, req: GenerationRequest) -> list[Asset]:
        if not self.available():
            raise GenerationError("Higgsfield API 키가 설정되지 않았습니다.")

        assets: list[Asset] = []
        with httpx.Client(base_url=settings.higgsfield_base_url, timeout=60.0) as client:
            wants_video = req.media_kind == "REELS"

            image_urls = self._extract_urls(
                self._poll(
                    client,
                    self._submit(
                        client,
                        settings.higgsfield_image_path,
                        {
                            "prompt": req.prompt,
                            "quality": "1080p",
                            "aspect_ratio": req.aspect_ratio,
                            "batch_size": 1 if wants_video else req.count,
                            "style_id": req.style or None,
                        },
                    ),
                )
            )
            if not image_urls:
                raise GenerationError("Higgsfield 가 이미지 URL 을 반환하지 않았습니다.")

            if wants_video:
                # 이미지 → 영상 (첫 프레임을 입력으로)
                video_urls = self._extract_urls(
                    self._poll(
                        client,
                        self._submit(
                            client,
                            settings.higgsfield_video_path,
                            {
                                "prompt": req.prompt,
                                "input_images": [{"type": "image_url", "image_url": image_urls[0]}],
                                "aspect_ratio": req.aspect_ratio,
                                "duration": 5,
                            },
                        ),
                    )
                )
                if not video_urls:
                    raise GenerationError("Higgsfield 가 영상 URL 을 반환하지 않았습니다.")
                assets.append(
                    Asset(
                        type="video",
                        url=video_urls[0],
                        thumbnail_url=image_urls[0],
                        meta={"engine": self.name, "prompt": req.prompt},
                    )
                )
            else:
                for url in image_urls[: req.count]:
                    assets.append(
                        Asset(
                            type="image",
                            url=url,
                            thumbnail_url=url,
                            meta={"engine": self.name, "prompt": req.prompt},
                        )
                    )

            if req.with_music:
                try:
                    audio_urls = self._extract_urls(
                        self._poll(
                            client,
                            self._submit(
                                client,
                                settings.higgsfield_audio_path,
                                {"prompt": f"{req.prompt} 분위기의 짧은 배경음악", "duration": 15},
                            ),
                        )
                    )
                    if audio_urls:
                        assets.append(
                            Asset(
                                type="audio",
                                url=audio_urls[0],
                                meta={"engine": self.name, "prompt": req.prompt},
                            )
                        )
                except GenerationError:
                    # 음악 실패는 게시물 전체를 막지 않습니다.
                    pass

        return assets
