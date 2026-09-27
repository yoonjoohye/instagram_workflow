"""댓글 감정 분석 (긍정 / 보통 / 부정).

Instagram Graph API 는 댓글 감정 값을 제공하지 않으므로 직접 분류합니다.
  1) GEMINI_API_KEY 가 있으면 Gemini 로 문맥까지 보고 분류 (반어법·이모지·신조어)
  2) 없거나 호출이 실패하면 한국어 키워드·이모지 규칙으로 분류
결과는 comment_sentiments 에 저장해 같은 댓글을 다시 분류하지 않습니다.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Account, CommentSentiment
from .insights import recent_media
from .meta_graph import GraphClient, GraphError

log = logging.getLogger(__name__)

LABELS = ("positive", "neutral", "negative")
# 댓글이 이 개수 이상인 게시물만 감정 분석합니다 (적은 표본으로는 비율이 의미가 없고 비용만 듭니다).
MIN_COMMENTS = 30
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
BATCH_SIZE = 40

# 마지막 Gemini 호출 결과 — 설정 화면에 '왜 규칙으로 분류됐는지' 보여주기 위함.
last_error: str = ""


# ── 규칙 기반 (폴백) ────────────────────────────────────────────────────
_POSITIVE = [
    "좋아", "좋다", "좋네", "최고", "예쁘", "이쁘", "멋지", "멋있", "사랑", "감사", "고마", "대박", "짱",
    "귀엽", "귀여", "맛있", "행복", "추천", "굿", "완벽", "힐링", "부럽", "응원", "축하", "기대",
    "love", "great", "nice", "good", "amazing", "awesome", "beautiful", "cute", "wow", "best",
]
_NEGATIVE = [
    "별로", "싫", "최악", "실망", "짜증", "불편", "비싸", "환불", "사기", "구려", "구리", "노잼", "재미없",
    "후회", "화나", "짜증", "불친절", "늦", "안 와", "안와", "문제", "망했", "쓰레기", "광고",
    "bad", "worst", "hate", "terrible", "awful", "scam", "disappoint",
]
_POS_EMOJI = "😍🥰😘❤️💕💖💗💯👍👏🙌🔥✨😊☺️🤩💜💙🧡💛💚🤍😆😁"
_NEG_EMOJI = "😡🤬😠👎💢😤😒🙄😞😢😭🤮"
_NEGATION = re.compile(r"(안|못)\s?(좋|예쁘|이쁘|맛있|멋)")


def rule_classify(text: str) -> tuple[str, str]:
    t = (text or "").lower()
    pos = sum(k in t for k in _POSITIVE) + sum(e in text for e in _POS_EMOJI)
    neg = sum(k in t for k in _NEGATIVE) + sum(e in text for e in _NEG_EMOJI)
    if _NEGATION.search(t):  # "안 좋아요" 처럼 부정어가 붙은 긍정 표현
        pos, neg = max(pos - 1, 0), neg + 1
    if pos > neg:
        return "positive", "긍정 표현/이모지"
    if neg > pos:
        return "negative", "부정 표현/이모지"
    return "neutral", "뚜렷한 감정 표현 없음"


# ── Gemini ────────────────────────────────────────────────────────────
_PROMPT = """너는 인스타그램 댓글의 감정을 분류하는 도구야.
각 댓글을 게시물 작성자 입장에서 positive(칭찬·호감·응원·구매의사), neutral(질문·정보·태그·단순 반응),
negative(불만·비판·실망·악플·스팸) 중 하나로 분류해.
반어법, 이모지, 한국어 신조어(예: '미쳤다'가 칭찬인 경우)를 문맥으로 판단하고, reason 은 한국어 15자 이내로 써.
{context}
댓글 목록(JSON):
{comments}"""

_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "id": {"type": "STRING"},
            "sentiment": {"type": "STRING", "enum": list(LABELS)},
            "reason": {"type": "STRING"},
        },
        "required": ["id", "sentiment"],
    },
}


def gemini_classify(items: list[dict[str, str]], *, caption: str = "") -> dict[str, tuple[str, str]]:
    """{comment_id: (sentiment, reason)} — 실패하면 GraphError 대신 RuntimeError 를 던집니다."""
    global last_error
    context = f"게시물 캡션: {caption[:300]}" if caption else ""
    body = {
        "contents": [
            {
                "parts": [
                    {
                        "text": _PROMPT.format(
                            context=context,
                            comments=json.dumps(
                                [{"id": i["id"], "text": i["text"][:500]} for i in items], ensure_ascii=False
                            ),
                        )
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": _SCHEMA,
        },
    }
    try:
        resp = httpx.post(
            GEMINI_URL.format(model=settings.gemini_model),
            headers={"x-goog-api-key": settings.gemini_api_key},
            json=body,
            timeout=30.0,
        )
        data = resp.json()
        if resp.status_code >= 400:
            raise RuntimeError((data.get("error") or {}).get("message") or f"Gemini 오류 ({resp.status_code})")
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        rows = json.loads(text)
    except (httpx.HTTPError, KeyError, IndexError, ValueError, RuntimeError) as exc:
        last_error = str(exc)[:300]
        raise RuntimeError(last_error) from exc

    last_error = ""
    out: dict[str, tuple[str, str]] = {}
    for row in rows:
        if row.get("sentiment") in LABELS and row.get("id"):
            out[str(row["id"])] = (row["sentiment"], (row.get("reason") or "")[:100])
    return out


def classify(items: list[dict[str, str]], *, caption: str = "") -> dict[str, tuple[str, str, str]]:
    """{comment_id: (sentiment, reason, classified_by)}. Gemini 가 빠뜨린 항목은 규칙으로 채웁니다."""
    result: dict[str, tuple[str, str, str]] = {}
    if settings.gemini_api_key and items:
        for start in range(0, len(items), BATCH_SIZE):
            chunk = items[start : start + BATCH_SIZE]
            try:
                for cid, (label, reason) in gemini_classify(chunk, caption=caption).items():
                    result[cid] = (label, reason, "gemini")
            except RuntimeError as exc:
                log.warning("gemini classify failed, falling back to rules: %s", exc)
                break
    for item in items:
        if item["id"] not in result:
            label, reason = rule_classify(item["text"])
            result[item["id"]] = (label, reason, "rules")
    return result


# ── 수집 + 저장 ─────────────────────────────────────────────────────────
def _parse_ts(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("+0000", "+00:00"))
    except ValueError:
        return None


def store(
    db: Session, account: Account, media_id: str, comments: list[dict[str, Any]], *, caption: str = ""
) -> int:
    """아직 분류 안 된 댓글만 분류해서 저장합니다. 새로 저장한 개수를 돌려줍니다."""
    own = {account.username}
    fresh = [
        c
        for c in comments
        if c.get("id") and c.get("text") and c.get("username") not in own
    ]
    if not fresh:
        return 0
    known = set(
        db.scalars(
            select(CommentSentiment.comment_id).where(
                CommentSentiment.comment_id.in_([str(c["id"]) for c in fresh])
            )
        ).all()
    )
    fresh = [c for c in fresh if str(c["id"]) not in known]
    if not fresh:
        return 0

    labels = classify([{"id": str(c["id"]), "text": c["text"]} for c in fresh], caption=caption)
    for c in fresh:
        label, reason, by = labels[str(c["id"])]
        db.add(
            CommentSentiment(
                account_id=account.id,
                comment_id=str(c["id"]),
                ig_media_id=media_id,
                username=c.get("username") or "",
                text=c["text"][:2000],
                commented_at=_parse_ts(c.get("timestamp")),
                sentiment=label,
                reason=reason,
                classified_by=by,
            )
        )
    db.commit()
    return len(fresh)


def sync(db: Session, account: Account, client: GraphClient, *, media_limit: int = 12) -> dict[str, int]:
    """최근 게시물들의 댓글을 모아 새 댓글만 분류합니다."""
    medias = [
        m for m in recent_media(client, account.ig_user_id, limit=media_limit)
        if int(m.get("comments_count") or 0) >= MIN_COMMENTS
    ]

    def fetch(media: dict[str, Any]) -> list[dict[str, Any]]:
        try:
            return client.get(
                f"{media['id']}/comments",
                {"fields": "id,username,text,timestamp", "limit": 100},
            ).get("data", [])
        except GraphError:
            return []

    with ThreadPoolExecutor(max_workers=6) as pool:
        fetched = list(pool.map(fetch, medias))

    added = 0
    seen = 0
    for media, comments in zip(medias, fetched):
        seen += len(comments)
        added += store(db, account, media["id"], comments, caption=media.get("caption") or "")
    return {"posts": len(medias), "comments_seen": seen, "classified": added}


def sync_media(db: Session, account: Account, client: GraphClient, media_id: str) -> dict[str, int]:
    """게시물 하나의 댓글만 모아 새 댓글을 분류합니다."""
    media = client.get(media_id, {"fields": "id,caption,comments_count"})
    count = int(media.get("comments_count") or 0)
    if count < MIN_COMMENTS:
        return {"comments_seen": 0, "comments_count": count, "classified": 0, "skipped": True}
    comments = client.get(
        f"{media_id}/comments", {"fields": "id,username,text,timestamp", "limit": 100}
    ).get("data", [])
    added = store(db, account, media_id, comments, caption=media.get("caption") or "")
    return {"comments_seen": len(comments), "comments_count": count, "classified": added, "skipped": False}


def counts_for(db: Session, account: Account, media_id: str) -> dict[str, int]:
    return counts_by_media(db, account).get(media_id) or {k: 0 for k in LABELS}


def counts_by_media(db: Session, account: Account) -> dict[str, dict[str, int]]:
    rows = db.execute(
        select(CommentSentiment.ig_media_id, CommentSentiment.sentiment, func.count())
        .where(CommentSentiment.account_id == account.id)
        .group_by(CommentSentiment.ig_media_id, CommentSentiment.sentiment)
    ).all()
    out: dict[str, dict[str, int]] = {}
    for media_id, label, n in rows:
        out.setdefault(media_id, {k: 0 for k in LABELS})[label] = n
    return out
