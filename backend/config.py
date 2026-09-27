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

    higgsfield_api_key_id: str = ""
    higgsfield_api_key_secret: str = ""
    higgsfield_base_url: str = "https://api.higgsfield.ai"
    higgsfield_image_path: str = "/v1/higgsfield-ai/soul/v2/standard"
    higgsfield_video_path: str = "/v1/higgsfield-ai/dop/v2/turbo"
    higgsfield_audio_path: str = "/v1/higgsfield-ai/audio/v1/music"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    cron_secret: str = ""

    @model_validator(mode="after")
    def _vercel_defaults(self) -> "Settings":
        # PUBLIC_BASE_URL 을 따로 안 넣었다면 Vercel 이 주입하는 프로덕션 도메인을 씁니다.
        # (OAuth redirect_uri 가 이 값으로 만들어지므로 Meta 앱 설정과 정확히 같아야 합니다.)
        prod = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL")
        if prod and "localhost" in self.public_base_url:
            self.public_base_url = f"https://{prod}"
        return self

    @property
    def graph_base(self) -> str:
        return f"https://graph.facebook.com/{self.meta_api_version}"

    @property
    def oauth_dialog(self) -> str:
        return f"https://www.facebook.com/{self.meta_api_version}/dialog/oauth"

    @property
    def redirect_uri(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/api/py/auth/callback"

    @property
    def meta_configured(self) -> bool:
        return bool(self.meta_app_id and self.meta_app_secret)

    @property
    def higgsfield_configured(self) -> bool:
        return bool(self.higgsfield_api_key_id and self.higgsfield_api_key_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
