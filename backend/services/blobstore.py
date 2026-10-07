"""동영상 저장소 (Vercel Blob).

사용자가 고른 동영상은 브라우저가 Blob 에 직접 올립니다 (Vercel 함수의 4.5MB 요청 제한을 피하려고).
서버는 편집한 영상을 만들어 올리고(put), 게시물·계정을 지울 때 함께 지웁니다(delete).
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


def enabled() -> bool:
    return bool(settings.blob_read_write_token and store_id())


def _headers() -> dict[str, str]:
    return {
        "authorization": f"Bearer {settings.blob_read_write_token}",
        "x-api-version": API_VERSION,
        "x-vercel-blob-store-id": store_id(),
    }


def put(pathname: str, data: bytes, content_type: str) -> str:
    """파일을 공개 주소로 올리고 그 주소를 돌려줍니다 (이름 뒤에 추측할 수 없는 글자가 붙음)."""
    resp = httpx.put(
        f"{API_URL}/",
        params={"pathname": pathname},
        headers={
            **_headers(),
            "x-vercel-blob-access": "public",
            "x-content-type": content_type,
            "x-add-random-suffix": "1",
        },
        content=data,
        timeout=60.0,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"blob upload failed ({resp.status_code}): {resp.text[:200]}")
    return resp.json()["url"]


def download(url: str, dest, *, max_bytes: int = 350 * 1024 * 1024) -> None:
    """우리 Blob 의 파일을 임시 파일로 내려받습니다 (영상 처리용)."""
    if not is_our_blob(url):
        raise ValueError("not our blob")
    size = 0
    with httpx.stream("GET", url, timeout=60.0, follow_redirects=True) as resp, open(dest, "wb") as fh:
        resp.raise_for_status()
        for chunk in resp.iter_bytes(1 << 20):
            size += len(chunk)
            if size > max_bytes:
                raise ValueError("file too large")
            fh.write(chunk)


def delete(urls: list[str]) -> None:
    """Blob 파일 삭제. 실패해도 게시물·계정 삭제는 계속합니다 (로그만 남김)."""
    urls = [u for u in urls if u and is_our_blob(u)]
    if not urls or not settings.blob_read_write_token:
        return
    try:
        resp = httpx.post(
            f"{API_URL}/delete",
            headers={**_headers(), "content-type": "application/json"},
            json={"urls": urls},
            timeout=20.0,
        )
        if resp.status_code >= 400:
            log.warning("blob delete failed (%s): %s", resp.status_code, resp.text[:200])
    except httpx.HTTPError as exc:
        log.warning("blob delete failed: %s", exc)
