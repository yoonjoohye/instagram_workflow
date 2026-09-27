"""Graph API 얇은 래퍼.

문서: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
"""
from __future__ import annotations

from typing import Any

import httpx

from ..config import settings

# Instagram API with Facebook Login 이 요구하는 권한.
#   instagram_basic            프로필/미디어 읽기
#   instagram_content_publish  게시물 발행
#   instagram_manage_insights  인사이트 조회
#   instagram_manage_comments  댓글 읽기/응답
#   pages_show_list            연결된 페이지 목록
#   pages_read_engagement      페이지↔IG 연결 정보 및 페이지 토큰
SCOPES = [
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_insights",
    "instagram_manage_comments",
    "pages_show_list",
    "pages_read_engagement",
    "business_management",
]


class GraphError(RuntimeError):
    def __init__(self, message: str, *, status: int = 502, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


def _raise_for_graph(resp: httpx.Response) -> dict[str, Any]:
    try:
        data = resp.json()
    except ValueError:
        raise GraphError(f"Graph API 응답을 해석할 수 없습니다 ({resp.status_code})")
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        msg = err.get("error_user_msg") or err.get("message") or "알 수 없는 Graph API 오류"
        raise GraphError(msg, status=resp.status_code, payload=err)
    if resp.status_code >= 400:
        raise GraphError(f"Graph API 오류 ({resp.status_code})", status=resp.status_code, payload=data)
    return data


class GraphClient:
    """동기 httpx 클라이언트. 서버리스 함수 수명에 맞춰 짧게 쓰고 닫습니다."""

    def __init__(self, access_token: str | None = None, *, timeout: float = 30.0):
        self.access_token = access_token
        self._client = httpx.Client(base_url=settings.graph_base, timeout=timeout)

    def __enter__(self) -> "GraphClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self._client.close()

    def close(self) -> None:
        self._client.close()

    def _params(self, params: dict[str, Any] | None) -> dict[str, Any]:
        merged = {k: v for k, v in (params or {}).items() if v is not None}
        if self.access_token:
            merged.setdefault("access_token", self.access_token)
        return merged

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        resp = self._client.get(f"/{path.lstrip('/')}", params=self._params(params))
        return _raise_for_graph(resp)

    def post(self, path: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        resp = self._client.post(f"/{path.lstrip('/')}", data=self._params(data))
        return _raise_for_graph(resp)

    # ── OAuth ───────────────────────────────────────────────────────────
    def exchange_code(self, code: str) -> dict[str, Any]:
        """authorization code → 단기 사용자 토큰."""
        return self.get(
            "oauth/access_token",
            {
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "redirect_uri": settings.redirect_uri,
                "code": code,
            },
        )

    def exchange_long_lived(self, short_token: str) -> dict[str, Any]:
        """단기 토큰 → 장기 사용자 토큰(약 60일)."""
        return self.get(
            "oauth/access_token",
            {
                "grant_type": "fb_exchange_token",
                "client_id": settings.meta_app_id,
                "client_secret": settings.meta_app_secret,
                "fb_exchange_token": short_token,
            },
        )

    def debug_token(self, token: str) -> dict[str, Any]:
        app_token = f"{settings.meta_app_id}|{settings.meta_app_secret}"
        return self.get("debug_token", {"input_token": token, "access_token": app_token})

    # ── 계정 탐색 ───────────────────────────────────────────────────────
    def me(self) -> dict[str, Any]:
        return self.get("me", {"fields": "id,name"})

    def my_pages(self) -> list[dict[str, Any]]:
        """연결된 페이지와 각 페이지의 IG 비즈니스 계정.

        페이지 토큰은 만료가 없어(장기 사용자 토큰에서 파생) 발행에 유리합니다.
        """
        data = self.get(
            "me/accounts",
            {
                "fields": "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count,follows_count,media_count}",
                "limit": 100,
            },
        )
        return [p for p in data.get("data", []) if p.get("instagram_business_account")]

    def ig_profile(self, ig_user_id: str) -> dict[str, Any]:
        return self.get(
            ig_user_id,
            {
                "fields": "id,username,name,biography,website,profile_picture_url,"
                "followers_count,follows_count,media_count"
            },
        )
