"""Vercel Python 런타임 엔트리포인트.

vercel.json 의 rewrite 가 /api/py/* → /api/index 로 보내고,
Vercel 은 이 파일의 `app` (ASGI) 을 그대로 실행합니다.
로컬에서는 `uvicorn backend.main:app --reload --port 8000` 을 쓰세요.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# includeFiles 로 함께 배포된 backend/ 패키지를 import 할 수 있게 합니다.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import settings  # noqa: E402
from backend.db import init_db  # noqa: E402
from backend.main import app  # noqa: E402

# 서버리스 함수의 파일시스템은 읽기 전용·일회성이라 SQLite 로는 계정/세션이 유지되지 않습니다.
if os.environ.get("VERCEL") and settings.database_url.startswith("sqlite"):
    raise RuntimeError(
        "Vercel 에서는 Postgres DATABASE_URL 이 필요합니다 "
        "(Vercel Storage → Neon 연결 후 환경변수 DATABASE_URL 확인)."
    )

# Vercel Python 런타임은 ASGI lifespan 을 보장하지 않으므로 콜드 스타트 때 테이블을 직접 보장합니다.
init_db()

# Vercel 은 /api/py 프리픽스를 붙인 채로 요청을 전달합니다.
app.root_path = "/api/py"
