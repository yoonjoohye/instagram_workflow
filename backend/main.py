from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from starlette.requests import Request

from .config import settings
from .db import init_db
from .i18n import lang_of, translate_payload
from .routers import auth, autoreply, community, designs, filters, members, stickers, insights, sentiment, video, studio, webhooks, workflow
from .services.meta_graph import GraphError


# httpx 는 요청 주소 전체(쿼리의 access_token 포함)를 INFO 로그로 남깁니다. 토큰이 Vercel 로그에
# 찍히지 않도록 경고 이상만 남깁니다.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Instagram Auto Studio API",
    version="1.0.0",
    lifespan=lifespan,
    # Vercel 에서 /api/py/* 로 rewrite 되므로 문서 경로도 맞춰줍니다.
    docs_url="/docs",
    openapi_url="/openapi.json",
)


@app.middleware("http")
async def localize_json(request: Request, call_next):
    """오류·안내 문구(detail, note, warning, error …)를 요청 언어(lang 쿠키 → Accept-Language)로 바꿉니다."""
    response = await call_next(request)
    lang = lang_of(request)
    if lang == "ko" or not response.headers.get("content-type", "").startswith("application/json"):
        return response
    body = b"".join([chunk async for chunk in response.body_iterator])
    try:
        data = json.loads(body)
    except ValueError:
        return Response(body, status_code=response.status_code, headers=dict(response.headers))
    headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
    return JSONResponse(translate_payload(data, lang), status_code=response.status_code, headers=headers)


@app.exception_handler(GraphError)
async def graph_error_handler(request: Request, exc: GraphError) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "meta_error": exc.payload}, status_code=exc.status)


@app.get("/health")
def health(request: Request, warm: bool = False) -> dict:
    if warm:
        # 화면을 열자마자 불러 서버와 DB(Neon 은 쉬면 잠듦)를 미리 깨워 둠 — 사진·영상을 고를 때 기다리지 않게
        from sqlalchemy import text

        from .db import engine

        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    return {
        "ok": True,
        "meta_configured": settings.meta_configured,
        "auth_mode": settings.auth_mode,
        # 회원에 연동할 수 있는 방식
        "can_link": {"instagram": settings.instagram_configured, "facebook": settings.facebook_configured},
        # 회원가입 때 이메일 인증번호를 받는지 (끄면 중복 확인만)
        "signup_email_verify": settings.signup_email_verify,
        # 게시물 구성·이미지 연출과 댓글 감정 분석에 쓰는 엔진
        "ai_engine": "gemini" if settings.gemini_api_key else "basic",
        "public_base_url": settings.public_base_url,
        "redirect_uri": settings.redirect_uri,
        "dev_login": auth.dev_login_enabled(request),
    }


app.include_router(members.router)
app.include_router(auth.router)
app.include_router(workflow.router)
app.include_router(insights.router)
app.include_router(autoreply.router)
app.include_router(webhooks.router)
app.include_router(sentiment.router)
app.include_router(studio.router)
app.include_router(video.router)
app.include_router(stickers.router)
app.include_router(filters.router)
app.include_router(designs.router)
app.include_router(community.router)
