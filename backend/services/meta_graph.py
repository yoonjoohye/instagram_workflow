"""Graph API 얇은 래퍼.

로그인 방식(settings.auth_mode)에 따라 호스트가 달라집니다.
  facebook : graph.facebook.com  — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
  instagram: graph.instagram.com — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
게시/인사이트/댓글 엔드포인트 모양은 두 방식이 같아서 나머지 코드는 공유합니다.
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
    "instagram_manage_messages",
    "pages_show_list",
    "pages_read_engagement",
    "business_management",
]

# Instagram API with Instagram Login 이 요구하는 권한.
IG_SCOPES = [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
    "instagram_business_manage_comments",
    # 댓글 작성자에게 DM, 팔로우 여부 확인(자동 응답)
    "instagram_business_manage_messages",
]

# 끝의 '/' 가 중요합니다: 인스타그램 앱의 유니버설 링크 설정은 '/oauth/authorize/*' 만 앱에서 열지 않도록
# 제외하고 있어, '/' 없이 보내면 휴대폰에서 앱이 열려 허용 화면 없이 멈춥니다.
IG_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize/"
IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token"


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
        # api.instagram.com 은 {"error_type", "code", "error_message"} 형태로 오류를 돌려줍니다.
        msg = data.get("error_message") if isinstance(data, dict) else None
        raise GraphError(msg or f"Graph API 오류 ({resp.status_code})", status=resp.status_code, payload=data)
    return data


class GraphClient:
    """동기 httpx 클라이언트. 서버리스 함수 수명에 맞춰 짧게 쓰고 닫습니다."""

    def __init__(self, access_token: str | None = None, *, provider: str | None = None, timeout: float = 30.0):
        """provider: 이 토큰을 받은 연결 방식 (instagram | facebook). 비우면 기본 로그인 방식."""
        self.access_token = access_token
        self.provider = provider or settings.auth_mode
        self._client = httpx.Client(base_url=settings.graph_base_for(self.provider), timeout=timeout)

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

    # ── Instagram 로그인 OAuth ─────────────────────────────────────────
    def ig_exchange_code(self, code: str) -> dict[str, Any]:
        """authorization code → 단기 Instagram 토큰(1시간). {access_token, user_id, permissions}"""
        resp = httpx.post(
            IG_TOKEN_URL,
            data={
                "client_id": settings.instagram_app_id,
                "client_secret": settings.instagram_app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": settings.redirect_uri,
                "code": code,
            },
            timeout=30.0,
        )
        data = _raise_for_graph(resp)
        # 응답이 {"data": [{...}]} 로 감싸져 오는 경우도 있습니다.
        if isinstance(data.get("data"), list) and data["data"]:
            data = data["data"][0]
        if "error_message" in data:
            raise GraphError(data["error_message"], status=400, payload=data)
        return data

    def ig_exchange_long_lived(self, short_token: str) -> dict[str, Any]:
        """단기 토큰 → 장기 토큰(60일). {access_token, expires_in}"""
        return self.get(
            "access_token",
            {
                "grant_type": "ig_exchange_token",
                "client_secret": settings.instagram_app_secret,
                "access_token": short_token,
            },
        )

    def ig_refresh(self) -> dict[str, Any]:
        """장기 토큰 연장(발급 24시간 이후, 만료 전에만 가능). {access_token, expires_in}"""
        return self.get("refresh_access_token", {"grant_type": "ig_refresh_token"})

    def ig_me(self) -> dict[str, Any]:
        """user_id 가 게시·인사이트 엔드포인트에 쓰는 IG 프로페셔널 계정 ID 입니다."""
        return self.get(
            "me",
            {
                "fields": "id,user_id,username,name,account_type,profile_picture_url,"
                "followers_count,follows_count,media_count"
            },
        )

    def ig_profile(self, ig_user_id: str) -> dict[str, Any]:
        # Instagram 로그인 토큰은 본인 계정만 조회하므로 /me 로 읽습니다.
        target = "me" if self.provider == "instagram" else ig_user_id
        return self.get(
            target,
            {
                "fields": "id,username,name,biography,website,profile_picture_url,"
                "followers_count,follows_count,media_count"
            },
        )

    # ── 댓글 자동 응답 / DM ─────────────────────────────────────────────
    def reply_to_comment(self, comment_id: str, message: str) -> dict[str, Any]:
        """댓글에 공개 답글."""
        return self.post(f"{comment_id}/replies", {"message": message})

    def send_private_reply(self, comment_id: str, text: str) -> dict[str, Any]:
        """댓글 작성자에게 비공개 DM. 댓글당 1통, 댓글 작성 후 7일 이내, 텍스트만."""
        return self._post_json("me/messages", {"recipient": {"comment_id": comment_id}, "message": {"text": text}})

    def send_message(self, igsid: str, text: str) -> dict[str, Any]:
        """상대가 먼저 보낸 메시지에 대한 답장 (24시간 이내)."""
        return self._post_json("me/messages", {"recipient": {"id": igsid}, "message": {"text": text}})

    def messaging_profile(self, igsid: str) -> dict[str, Any]:
        """DM 을 보낸 사용자의 프로필. 상대가 먼저 메시지를 보내야 조회 가능(Meta 정책)."""
        return self.get(igsid, {"fields": "username,name,is_user_follow_business"})

    def subscribe_webhooks(self, fields: str = "comments,messages") -> dict[str, Any]:
        """이 계정의 이벤트를 앱 Webhook 으로 받도록 구독 (Instagram 로그인 방식)."""
        return self.post("me/subscribed_apps", {"subscribed_fields": fields})

    def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = self._client.post(
            f"/{path.lstrip('/')}",
            params={"access_token": self.access_token} if self.access_token else None,
            json=body,
        )
        return _raise_for_graph(resp)
