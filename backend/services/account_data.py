"""계정 데이터 삭제 + Meta signed_request 검증.

Meta 앱 설정의 '데이터 삭제 요청 URL' / '승인 취소 콜백 URL' 이 호출되면
signed_request(HMAC-SHA256, 앱 시크릿)를 검증한 뒤 해당 사용자의 데이터를 모두 지웁니다.
문서: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from ..config import settings
from . import blobstore
from ..models import (
    Account,
    AutoReplyRule,
    CommentReply,
    CommentSentiment,
    DataDeletionRequest,
    GenerationJob,
    InsightSnapshot,
    MediaBlob,
)

# 자식 테이블부터 지웁니다 (SQLite 는 FK CASCADE 를 강제하지 않으므로 명시적으로).
_CHILD_TABLES = [CommentReply, AutoReplyRule, CommentSentiment, InsightSnapshot, MediaBlob, GenerationJob]


def _b64url(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def parse_signed_request(signed_request: str) -> dict[str, Any] | None:
    """'<서명>.<페이로드>' — 서명이 맞으면 페이로드(dict), 아니면 None."""
    try:
        sig_b64, payload_b64 = signed_request.split(".", 1)
        expected = hmac.new(settings.webhook_secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
        if not settings.webhook_secret or not hmac.compare_digest(_b64url(sig_b64), expected):
            return None
        payload = json.loads(_b64url(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if str(payload.get("algorithm", "")).upper() != "HMAC-SHA256":
        return None
    return payload


def delete_account(db: Session, account: Account) -> None:
    """이 계정과 연결된 모든 데이터(토큰·생성물·인사이트·댓글 기록·자동 응답)를 삭제합니다."""
    # 동영상 파일은 DB 가 아니라 Blob 저장소에 있으므로 먼저 지웁니다.
    blobstore.delete(
        list(db.scalars(select(MediaBlob.url).where(MediaBlob.account_id == account.id, MediaBlob.kind == "video")))
    )
    for table in _CHILD_TABLES:
        db.execute(delete(table).where(table.account_id == account.id))
    db.delete(account)


def delete_by_platform_user(db: Session, user_id: str, *, source: str) -> DataDeletionRequest:
    """Meta 가 알려준 사용자 ID 로 계정을 찾아 삭제하고, 확인 코드를 남깁니다."""
    accounts = db.scalars(
        select(Account).where(or_(Account.ig_user_id == user_id, Account.fb_user_id == user_id))
    ).all() if user_id else []
    for account in accounts:
        delete_account(db, account)
    record = DataDeletionRequest(
        code=secrets.token_hex(8), source=source, status="completed" if accounts else "not_found"
    )
    db.add(record)
    db.commit()
    return record


def record_in_app(db: Session) -> DataDeletionRequest:
    record = DataDeletionRequest(code=secrets.token_hex(8), source="in_app", status="completed")
    db.add(record)
    return record
