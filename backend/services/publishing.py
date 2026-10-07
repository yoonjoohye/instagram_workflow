"""콘텐츠 발행: 컨테이너 생성 → 처리 대기(status_code FINISHED) → media_publish.

문서: https://developers.facebook.com/docs/instagram-platform/content-publishing
사진도 인스타그램이 우리 주소에서 이미지를 가져가는 동안은 발행할 수 없어(오류 9007 "The media is not ready
for publishing"), 사진·동영상 모두 FINISHED 를 확인한 뒤 발행합니다.
"""
from __future__ import annotations

import time
from typing import Any, Literal

from .meta_graph import GraphClient, GraphError

MediaKind = Literal["IMAGE", "REELS", "STORIES", "CAROUSEL"]

# 영상 컨테이너는 트랜스코딩이 끝나야 발행할 수 있습니다.
POLL_INTERVAL_SEC = 3
POLL_MAX_ATTEMPTS = 15  # 최대 ~45초. Vercel maxDuration 60초 안쪽.


def create_container(
    client: GraphClient,
    ig_user_id: str,
    *,
    kind: MediaKind,
    media_url: str | None = None,
    caption: str | None = None,
    is_carousel_item: bool = False,
    children: list[str] | None = None,
    cover_url: str | None = None,
    thumb_offset: int | None = None,
    share_to_feed: bool | None = None,
) -> str:
    """미디어 컨테이너를 만들고 컨테이너 ID 를 돌려줍니다."""
    payload: dict[str, Any] = {}

    if kind == "CAROUSEL":
        if not children:
            raise ValueError("캐러셀은 자식 컨테이너가 최소 2개 필요합니다.")
        payload["media_type"] = "CAROUSEL"
        payload["children"] = ",".join(children)
    elif kind == "REELS" and is_carousel_item:
        # 캐러셀 안의 동영상은 REELS 가 아니라 VIDEO + is_carousel_item 입니다.
        payload["media_type"] = "VIDEO"
        payload["video_url"] = media_url
        payload["is_carousel_item"] = "true"
    elif kind == "REELS":
        payload["media_type"] = "REELS"
        payload["video_url"] = media_url
        if cover_url:
            payload["cover_url"] = cover_url
        if thumb_offset is not None:
            payload["thumb_offset"] = thumb_offset
        if share_to_feed is not None:
            payload["share_to_feed"] = "true" if share_to_feed else "false"
    elif kind == "STORIES":
        payload["media_type"] = "STORIES"
        # 스토리는 이미지/영상 모두 가능하므로 확장자로 판별합니다.
        if media_url and _looks_like_video(media_url):
            payload["video_url"] = media_url
        else:
            payload["image_url"] = media_url
    else:  # IMAGE
        payload["image_url"] = media_url
        if is_carousel_item:
            payload["is_carousel_item"] = "true"

    # 스토리와 캐러셀 자식에는 캡션을 붙이지 않습니다.
    if caption and kind != "STORIES" and not is_carousel_item:
        payload["caption"] = caption

    result = client.post(f"{ig_user_id}/media", payload)
    container_id = result.get("id")
    if not container_id:
        raise GraphError("컨테이너 ID 를 받지 못했습니다.", payload=result)
    return container_id


def _looks_like_video(url: str) -> bool:
    return any(ext in url.lower() for ext in (".mp4", ".mov", ".m4v", "video"))


def container_status(client: GraphClient, container_id: str) -> dict[str, Any]:
    return client.get(container_id, {"fields": "status_code,status"})


def wait_until_finished(
    client: GraphClient,
    container_id: str,
    *,
    attempts: int = POLL_MAX_ATTEMPTS,
    interval: float = POLL_INTERVAL_SEC,
) -> None:
    """status_code 가 FINISHED 가 될 때까지 폴링합니다.

    상태값: EXPIRED / ERROR / FINISHED / IN_PROGRESS / PUBLISHED
    """
    for attempt in range(attempts):
        status = container_status(client, container_id)
        code = status.get("status_code")
        if code == "FINISHED":
            return
        if code in {"ERROR", "EXPIRED"}:
            raise GraphError(
                f"미디어 처리 실패 ({code}): {status.get('status', '')}", payload=status
            )
        if attempt < attempts - 1:
            time.sleep(interval)
    raise GraphError(
        "미디어 처리 시간이 초과됐습니다. 잠시 후 '발행 재시도'를 눌러 주세요.",
        status=504,
    )


NOT_READY_CODE = 9007  # "The media is not ready for publishing, please wait for a moment"
PUBLISH_RETRIES = 4
PUBLISH_RETRY_SEC = 2


def _not_ready(exc: GraphError) -> bool:
    p = exc.payload if isinstance(exc.payload, dict) else {}
    return p.get("code") == NOT_READY_CODE or p.get("error_subcode") == 2207027


def publish(client: GraphClient, ig_user_id: str, container_id: str) -> dict[str, Any]:
    """컨테이너를 실제 게시물로 발행하고 permalink 까지 조회해 돌려줍니다.
    아직 준비 중이라고 하면(9007) 잠깐 기다렸다 다시 시도합니다."""
    for attempt in range(PUBLISH_RETRIES):
        try:
            result = client.post(f"{ig_user_id}/media_publish", {"creation_id": container_id})
            break
        except GraphError as exc:
            if not _not_ready(exc) or attempt == PUBLISH_RETRIES - 1:
                raise
            time.sleep(PUBLISH_RETRY_SEC)
    media_id = result.get("id")
    if not media_id:
        raise GraphError("발행 후 미디어 ID 를 받지 못했습니다.", payload=result)

    permalink = ""
    try:
        detail = client.get(media_id, {"fields": "permalink,media_type,timestamp"})
        permalink = detail.get("permalink", "")
    except GraphError:
        # permalink 조회 실패가 발행 성공을 뒤집지는 않습니다.
        detail = {}
    return {"media_id": media_id, "permalink": permalink, **detail}


def publishing_limit(client: GraphClient, ig_user_id: str) -> dict[str, Any]:
    """24시간 발행 쿼터(기본 50건) 사용량."""
    data = client.get(
        f"{ig_user_id}/content_publishing_limit",
        {"fields": "config,quota_usage"},
    )
    rows = data.get("data") or [{}]
    row = rows[0]
    quota = (row.get("config") or {}).get("quota_total", 50)
    used = row.get("quota_usage", 0)
    return {"used": used, "total": quota, "remaining": max(quota - used, 0)}
