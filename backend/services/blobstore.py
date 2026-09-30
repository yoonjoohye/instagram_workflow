"""동영상 저장소 (Vercel Blob).

업로드는 브라우저가 Blob 에 직접 합니다 (Vercel 함수의 4.5MB 요청 제한을 피하려고).
서버는 게시물·계정을 지울 때 그 파일을 함께 지우기만 합니다.
"""
from __future__ import annotations

import logging
from urllib.parse import urlsplit

import httpx

from ..config import settings

log = logging.getLogger(__name__)

API_URL = "https://vercel.com/api/blob"
API_VERSION = "12"


def store_id() -> str:
    # 토큰 형식: vercel_blob_rw_<storeId>_<secret>
    parts = settings.blob_read_write_token.split("_")
    return parts[3] if len(parts) > 4 else ""


def is_our_blob(url: str) -> bool:
    """이 서비스의 Blob 스토어에 있는 공개 파일 주소인지 (다른 곳의 주소를 등록하지 못하게)."""
    host = urlsplit(url).hostname or ""
    sid = store_id().lower()
    return bool(sid) and urlsplit(url).scheme == "https" and host == f"{sid}.public.blob.vercel-storage.com"


def delete(urls: list[str]) -> None:
    """Blob 파일 삭제. 실패해도 게시물·계정 삭제는 계속합니다 (로그만 남김)."""
    urls = [u for u in urls if u and is_our_blob(u)]
    if not urls or not settings.blob_read_write_token:
        return
    try:
        resp = httpx.post(
            f"{API_URL}/delete",
            headers={
                "authorization": f"Bearer {settings.blob_read_write_token}",
                "x-api-version": API_VERSION,
                "x-vercel-blob-store-id": store_id(),
                "content-type": "application/json",
            },
            json={"urls": urls},
            timeout=20.0,
        )
        if resp.status_code >= 400:
            log.warning("blob delete failed (%s): %s", resp.status_code, resp.text[:200])
    except httpx.HTTPError as exc:
        log.warning("blob delete failed: %s", exc)
