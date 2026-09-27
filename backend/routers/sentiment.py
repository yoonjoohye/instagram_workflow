"""댓글 감정(긍정/보통/부정) 조회·분석."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, CommentSentiment
from ..services import sentiment as svc
from ..services.meta_graph import GraphError

router = APIRouter(prefix="/sentiment", tags=["sentiment"])


@router.post("/sync")
def sync(
    media_limit: int = Query(default=12, ge=1, le=50),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """최근 게시물 댓글을 모아 새 댓글만 분류합니다."""
    with graph_for(account) as client:
        try:
            result = svc.sync(db, account, client, media_limit=media_limit)
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
    return {**result, **_engine()}


def _engine() -> dict:
    return {
        "engine": "gemini" if settings.gemini_api_key else "rules",
        "model": settings.gemini_model if settings.gemini_api_key else "",
        "last_error": svc.last_error if settings.gemini_api_key else "",
    }


@router.get("/overview")
def overview(account: Account = Depends(current_account), db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(CommentSentiment.sentiment, func.count())
        .where(CommentSentiment.account_id == account.id)
        .group_by(CommentSentiment.sentiment)
    ).all()
    totals = {k: 0 for k in svc.LABELS}
    for label, n in rows:
        totals[label] = n
    return {"totals": totals, **_engine()}


@router.get("/media/{media_id}")
def media_comments(
    media_id: str, account: Account = Depends(current_account), db: Session = Depends(get_db)
) -> dict:
    rows = db.scalars(
        select(CommentSentiment)
        .where(CommentSentiment.account_id == account.id, CommentSentiment.ig_media_id == media_id)
        .order_by(desc(CommentSentiment.commented_at))
    ).all()
    return {
        "data": [
            {
                "comment_id": r.comment_id,
                "username": r.username,
                "text": r.text,
                "sentiment": r.sentiment,
                "reason": r.reason,
                "classified_by": r.classified_by,
                "commented_at": r.commented_at.isoformat() if r.commented_at else None,
            }
            for r in rows
        ]
    }
