"""환경변수 기반 설정. Vercel/로컬 어디서든 같은 코드로 동작합니다."""
from __future__ import annotations

import os
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_secret: str = "dev-only-insecure-secret-change-me"
    public_base_url: str = "http://localhost:3000"

    database_url: str = "sqlite:///./local.db"

    meta_app_id: str = ""
    meta_app_secret: str = ""
    meta_api_version: str = "v23.0"

    # Instagram 로그인(Instagram API with Instagram Login) 용 자격증명.
    # Meta 앱 대시보드 → Instagram → "Instagram 로그인을 통한 API 설정" 상단의
    # Instagram 앱 ID / 시크릿 코드 (앱 설정 > 기본의 Meta 앱 ID 와 다른 값입니다).
    # 둘 다 있으면 Instagram 로그인, 없으면 Facebook 로그인으로 동작합니다.
    instagram_app_id: str = ""
    instagram_app_secret: str = ""

    higgsfield_api_key_id: str = ""
    higgsfield_api_key_secret: str = ""
    higgsfield_base_url: str = "https://api.higgsfield.ai"
    higgsfield_image_path: str = "/v1/higgsfield-ai/soul/v2/standard"
    higgsfield_video_path: str = "/v1/higgsfield-ai/dop/v2/turbo"
    higgsfield_audio_path: str = "/v1/higgsfield-ai/audio/v1/music"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    cron_secret: str = ""

    # 댓글 감정 분석(긍정/보통/부정). 비워두면 한국어 키워드·이모지 규칙으로 분류합니다.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-lite-latest"
    # 카드뉴스: 사진 분석·구성은 gemini_text_model, 사진 AI 편집은 gemini_image_model
    gemini_text_model: str = "gemini-flash-latest"
    gemini_image_model: str = "gemini-2.5-flash-image"

    # Meta Webhooks 구독 시 '인증 토큰' 칸에 넣는 값과 같아야 합니다 (아무 임의 문자열).
    webhook_verify_token: str = ""

    @model_validator(mode="after")
    def _vercel_defaults(self) -> "Settings":
        # PUBLIC_BASE_URL 을 따로 안 넣었다면 Vercel 이 주입하는 프로덕션 도메인을 씁니다.
        # (OAuth redirect_uri 가 이 값으로 만들어지므로 Meta 앱 설정과 정확히 같아야 합니다.)
        prod = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL")
        if prod and "localhost" in self.public_base_url:
            self.public_base_url = f"https://{prod}"
        return self

    @property
    def auth_mode(self) -> str:
        """instagram: Instagram 계정으로 바로 로그인 (Facebook 페이지 불필요)
        facebook : Facebook 로그인 → 페이지에 연결된 IG 계정"""
        return "instagram" if self.instagram_app_id and self.instagram_app_secret else "facebook"

    @property
    def graph_base(self) -> str:
        host = "graph.instagram.com" if self.auth_mode == "instagram" else "graph.facebook.com"
        return f"https://{host}/{self.meta_api_version}"

    @property
    def oauth_dialog(self) -> str:
        return f"https://www.facebook.com/{self.meta_api_version}/dialog/oauth"

    @property
    def webhook_secret(self) -> str:
        """현재 로그인 방식의 앱 시크릿 — Webhook 서명(X-Hub-Signature-256) 검증에 씁니다.
        (APP_SECRET 은 토큰 암호화용 마스터 시크릿으로 별개입니다.)"""
        return self.instagram_app_secret if self.auth_mode == "instagram" else self.meta_app_secret

    @property
    def webhook_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/api/py/webhooks/instagram"

    @property
    def redirect_uri(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/api/py/auth/callback"

    @property
    def meta_configured(self) -> bool:
        """현재 로그인 방식에 필요한 앱 자격증명이 갖춰졌는지."""
        return self.auth_mode == "instagram" or bool(self.meta_app_id and self.meta_app_secret)

    @property
    def higgsfield_configured(self) -> bool:
        return bool(self.higgsfield_api_key_id and self.higgsfield_api_key_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
