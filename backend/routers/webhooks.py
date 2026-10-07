"""Meta Webhooks 수신: 댓글(comments)과 DM(messages) 이벤트 → 자동 응답.

Meta 앱 대시보드의 Webhooks 설정
  콜백 URL : {PUBLIC_BASE_URL}/api/py/webhooks/instagram
  인증 토큰: WEBHOOK_VERIFY_TOKEN 환경변수와 같은 값
  구독 필드: comments, messages
Webhook 은 앱이 라이브(공개) 상태일 때만 실제로 전달됩니다.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import graph_for
from ..models import Account
from ..services import autoreply, sentiment

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
log = logging.getLogger(__name__)


@router.get("/instagram", response_class=PlainTextResponse)
def verify(
    mode: str = Query(default="", alias="hub.mode"),
    token: str = Query(default="", alias="hub.verify_token"),
    challenge: str = Query(default="", alias="hub.challenge"),
) -> str:
    """Webhooks 설정의 '확인 및 저장' 때 Meta 가 보내는 구독 확인 요청."""
    if (
        mode == "subscribe"
        and settings.webhook_verify_token
        and hmac.compare_digest(token, settings.webhook_verify_token)
    ):
        return challenge
    raise HTTPException(status.HTTP_403_FORBIDDEN, "인증 토큰이 일치하지 않습니다.")


def valid_signature(body: bytes, header: str | None) -> bool:
    # Instagram 로그인·Facebook 로그인 앱 시크릿 중 하나로 서명돼 있으면 통과
    if not settings.webhook_secrets or not header or not header.startswith("sha256="):
        return False
    got = header.removeprefix("sha256=")
    return any(
        hmac.compare_digest(got, hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()) for secret in settings.webhook_secrets
    )


@router.post("/instagram")
async def receive(request: Request, db: Session = Depends(get_db)) -> dict:
    body = await request.body()
    if not valid_signature(body, request.headers.get("x-hub-signature-256")):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "서명이 올바르지 않습니다.")

    payload = json.loads(body or b"{}")
    results: list[str] = []
    for entry in payload.get("entry", []):
        account = db.scalar(select(Account).where(Account.ig_user_id == str(entry.get("id", ""))))
        if account is None:
            results.append("unknown_account")
            continue
        # 한 이벤트의 실패가 나머지 처리나 200 응답을 막지 않게 합니다.
        # (200 이 아니면 Meta 가 재전송하고, 계속 실패하면 구독이 비활성화됩니다.)
        with graph_for(account) as client:
            for change in entry.get("changes", []):
                if change.get("field") != "comments":
                    continue
                value = change.get("value") or {}
                try:
                    results.append(
                        autoreply.handle_comment(db, account, client, value, event_time=entry.get("time"))
                    )
                except Exception:  # noqa: BLE001
                    log.exception("comment webhook failed")
                    db.rollback()
                    results.append("error")
                try:  # 댓글 30개 이상인 게시물의 새 댓글만 들어오는 즉시 감정을 분류합니다.
                    media_id = str((value.get("media") or {}).get("id") or "")
                    count = int(client.get(media_id, {"fields": "comments_count"}).get("comments_count") or 0) if media_id else 0
                    if count >= sentiment.MIN_COMMENTS:
                        sentiment.store(
                            db,
                            account,
                            media_id,
                            [{**value, "username": (value.get("from") or {}).get("username", "")}],
                        )
                except Exception:  # noqa: BLE001
                    log.exception("sentiment on webhook failed")
                    db.rollback()
            for event in entry.get("messaging", []):
                try:
                    results.append(autoreply.handle_message(db, account, client, event))
                except Exception:  # noqa: BLE001
                    log.exception("message webhook failed")
                    db.rollback()
                    results.append("error")
    return {"ok": True, "results": results}
