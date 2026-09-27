from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.requests import Request

from .config import settings
from .db import init_db
from .routers import auth, autoreply, cardnews, insights, sentiment, webhooks, workflow
from .services.meta_graph import GraphError


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


@app.exception_handler(GraphError)
async def graph_error_handler(request: Request, exc: GraphError) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "meta_error": exc.payload}, status_code=exc.status)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "meta_configured": settings.meta_configured,
        "auth_mode": settings.auth_mode,
        # 카드뉴스 구성·사진 편집과 댓글 감정 분석에 쓰는 엔진
        "ai_engine": "gemini" if settings.gemini_api_key else "basic",
        "public_base_url": settings.public_base_url,
        "redirect_uri": settings.redirect_uri,
    }


app.include_router(auth.router)
app.include_router(workflow.router)
app.include_router(insights.router)
app.include_router(autoreply.router)
app.include_router(webhooks.router)
app.include_router(sentiment.router)
app.include_router(cardnews.router)
