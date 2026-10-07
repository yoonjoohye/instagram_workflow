"""대시보드·게시물 성과용 데이터: 계정 지표 추이, 인구통계, 게시물별 성과, 댓글 허용 전환, 매일 cron 적재."""
from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, AutoReplyRule, InsightSnapshot
from ..schemas import CommentsToggle
from ..security import encrypt
from ..services import insights as svc
from ..services import media_sync
from ..services import sentiment as sentiment_svc
from ..services.meta_graph import GraphError

router = APIRouter(tags=["insights"])


# 대시보드 요청 한 번에 채울 수 있는 '하루 합계' 최대 일수 (나머지는 cron 이 매일 채움).
BACKFILL_PER_REQUEST = 5
# reach 외 지표 중 차트에 그릴 것.
SNAPSHOT_SERIES = ["profile_views", "accounts_engaged"]


@router.get("/insights/overview")
def overview(
    days: int = Query(default=30, ge=7, le=90),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """대시보드 상단 요약 + 일자별 시계열."""
    since, until = svc._day_range(days)
    prev_since, prev_until = svc._day_range(days, offset_days=days)
    with graph_for(account) as client:
        # 서로 독립적인 Graph 호출이라 동시에 보내 응답 시간을 줄입니다.
        with ThreadPoolExecutor(max_workers=4) as pool:
            f_profile = pool.submit(client.ig_profile, account.ig_user_id)
            f_series = pool.submit(svc.daily_timeseries, client, account.ig_user_id, days=days)
            f_totals = pool.submit(
                svc.range_totals, client, account.ig_user_id, since=since, until=until
            )
            f_previous = pool.submit(
                svc.range_totals, client, account.ig_user_id, since=prev_since, until=prev_until
            )
            try:
                profile = f_profile.result()
            except GraphError as exc:
                raise HTTPException(exc.status, str(exc)) from exc
            series, totals, previous = f_series.result(), f_totals.result(), f_previous.result()
        _persist_reach(db, account, series)
        _backfill_day_totals(db, account, client, days=days, limit=BACKFILL_PER_REQUEST)

    account.followers_count = profile.get("followers_count", account.followers_count) or 0
    account.follows_count = profile.get("follows_count", account.follows_count) or 0
    account.media_count = profile.get("media_count", account.media_count) or 0
    db.commit()

    # 같은 길이의 직전 기간과 비교한 증감률
    def trend(metric: str) -> float | None:
        cur, prev = totals.get(metric), previous.get(metric)
        if cur is None or not prev:
            return None
        return round((cur - prev) / prev * 100, 1)

    # reach 외 지표의 일자별 값은 우리가 쌓은 하루 합계로 채웁니다.
    for metric, points in _snapshot_series(db, account, days=days).items():
        series[metric] = points

    return {
        "range_days": days,
        "profile": {
            "username": profile.get("username", account.username),
            "followers_count": account.followers_count,
            "follows_count": account.follows_count,
            "media_count": account.media_count,
            "profile_picture_url": profile.get("profile_picture_url", account.profile_picture_url),
        },
        "totals": {m: totals.get(m) for m in svc.DAILY_METRICS},
        "trends": {m: trend(m) for m in svc.DAILY_METRICS},
        "series": series,
        "note": "Instagram Graph API 는 프로필을 조회한 '개별 계정'을 제공하지 않습니다. "
        "집계 수치만 제공됩니다. "
        "도달 계정 합계는 기간 내 고유 계정 수라 일자별 도달의 합보다 작을 수 있습니다.",
    }


def _snapshot(db: Session, account: Account, day: dt.date) -> InsightSnapshot:
    snap = db.scalar(
        select(InsightSnapshot).where(
            InsightSnapshot.account_id == account.id, InsightSnapshot.date == day
        )
    )
    if snap is None:
        snap = InsightSnapshot(account_id=account.id, date=day)
        db.add(snap)
    return snap


def _persist_reach(db: Session, account: Account, series: dict) -> None:
    """Meta 보존 기간(약 2년)을 넘겨서도 보려면 우리가 쌓아둬야 합니다."""
    for point in series.get("reach", []):
        try:
            day = dt.date.fromisoformat(point.get("date") or "")
        except ValueError:
            continue
        snap = _snapshot(db, account, day)
        snap.reach = int(point.get("value") or 0)
        snap.followers_count = account.followers_count
    db.commit()


def _backfill_day_totals(
    db: Session, account: Account, client, *, days: int, limit: int
) -> int:
    """아직 수집 안 된 최근 날짜부터 하루 합계를 채웁니다. 채운 일수를 돌려줍니다."""
    today = dt.datetime.now(dt.timezone.utc).date()
    window = [today - dt.timedelta(days=i) for i in range(1, days + 1)]
    synced = set(
        db.scalars(
            select(InsightSnapshot.date).where(
                InsightSnapshot.account_id == account.id,
                InsightSnapshot.date >= window[-1],
                InsightSnapshot.totals_synced == 1,
            )
        ).all()
    )
    missing = [day for day in window if day not in synced][:limit]
    if not missing:
        return 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        fetched = list(pool.map(lambda d: svc.day_totals(client, account.ig_user_id, d), missing))

    filled = 0
    for day, values in zip(missing, fetched):
        if all(v is None for v in values.values()):
            continue  # 권한/레이트리밋 문제 — 다음 기회에
        snap = _snapshot(db, account, day)
        snap.profile_views = values.get("profile_views") or 0
        snap.accounts_engaged = values.get("accounts_engaged") or 0
        snap.total_interactions = values.get("total_interactions") or 0
        snap.website_clicks = values.get("website_clicks") or 0
        snap.totals_synced = 1
        filled += 1
    db.commit()
    return filled


def _snapshot_series(db: Session, account: Account, *, days: int) -> dict[str, list[dict]]:
    since = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=days)
    rows = db.scalars(
        select(InsightSnapshot)
        .where(
            InsightSnapshot.account_id == account.id,
            InsightSnapshot.date >= since,
            InsightSnapshot.totals_synced == 1,
        )
        .order_by(InsightSnapshot.date)
    ).all()
    return {
        metric: [{"date": r.date.isoformat(), "value": getattr(r, metric)} for r in rows]
        for metric in SNAPSHOT_SERIES
    }


@router.get("/insights/audience")
def audience(account: Account = Depends(current_account)) -> dict:
    with graph_for(account) as client:
        try:
            demo = svc.follower_demographics(client, account.ig_user_id)
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
    empty = all(not rows for rows in demo.values())
    return {
        "demographics": demo,
        "empty": empty,
        "note": "팔로워가 100명 미만이면 Meta 가 인구통계를 제공하지 않습니다."
        if empty
        else "",
    }


@router.get("/insights/breakdowns")
def breakdowns(
    days: int = Query(default=30, ge=7, le=90),
    account: Account = Depends(current_account),
) -> dict:
    """팔로워/비팔로워, 콘텐츠 유형별, 반응 상세, 팔로우·언팔로우, 프로필 링크 탭."""
    with graph_for(account) as client:
        data = svc.account_breakdowns(client, account.ig_user_id, days=days)
    return {"range_days": days, **data}


@router.get("/insights/audience-detail")
def audience_detail(account: Account = Depends(current_account)) -> dict:
    """팔로워 · 도달한 사람 · 반응한 사람의 연령/성별/도시/국가 + 팔로워 접속 시간대."""
    with graph_for(account) as client:
        with ThreadPoolExecutor(max_workers=2) as pool:
            f_demo = pool.submit(svc.audience_all, client, account.ig_user_id)
            f_online = pool.submit(svc.online_followers, client, account.ig_user_id)
            demographics, online = f_demo.result(), f_online.result()
    empty = {who: all(not rows for rows in groups.values()) for who, groups in demographics.items()}
    return {
        "demographics": demographics,
        "empty": empty,
        "online_followers": online,
        "note": "팔로워 100명 미만이거나 해당 기간 도달·반응이 적으면 Meta 가 인구통계를 제공하지 않습니다.",
    }


@router.get("/posts/{media_id}/detail")
def post_detail(media_id: str, account: Account = Depends(current_account)) -> dict:
    """게시물 상세 지표: 프로필 방문·팔로우·프로필 활동, 릴스 시청, 스토리 탐색, 댓글(좋아요·답글 수)."""
    with graph_for(account) as client:
        try:
            return svc.media_detail(client, media_id)
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc


@router.get("/posts")
def posts(
    limit: int = Query(default=12, ge=1, le=50),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """최근 게시물 + 게시물별 성과."""
    with graph_for(account) as client:
        try:
            media = svc.recent_media(client, account.ig_user_id, limit=limit)
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        # 게시물별 인사이트 호출을 동시에 보냅니다 (순차로는 12개에 ~9초).
        with ThreadPoolExecutor(max_workers=6) as pool:
            insights = list(pool.map(lambda m: svc.media_insights(client, m), media))
        media_sync.sync_deleted(db, account, client)  # 지운 게시물의 자동 응답·댓글 분석 정리
    rules = {
        r.ig_media_id: r
        for r in db.scalars(
            select(AutoReplyRule).where(
                AutoReplyRule.account_id == account.id, AutoReplyRule.ig_media_id != ""
            )
        ).all()
    }
    sentiments = sentiment_svc.counts_by_media(db, account)
    return {
        "data": [
            {
                **m,
                "insights": i,
                "sentiment": sentiments.get(m["id"]),
                "auto_reply": (
                    {
                        "id": rules[m["id"]].id,
                        "enabled": bool(rules[m["id"]].enabled),
                        "public_reply_enabled": bool(rules[m["id"]].public_reply_enabled),
                        "dm_enabled": bool(rules[m["id"]].dm_enabled),
                    }
                    if m["id"] in rules
                    else None
                ),
            }
            for m, i in zip(media, insights)
        ]
    }


@router.post("/posts/{media_id}/comments")
def set_comments_enabled(
    media_id: str,
    body: CommentsToggle,
    account: Account = Depends(current_account),
) -> dict:
    """게시물 댓글 켜기/끄기 — Instagram API 가 기존 게시물에 허용하는 유일한 수정입니다.
    (캡션 수정은 API 에 없고, 삭제는 Facebook 로그인 방식에서만 지원됩니다.)"""
    with graph_for(account) as client:
        try:
            client.post(media_id, {"comment_enabled": "true" if body.enabled else "false"})
            current = client.get(media_id, {"fields": "is_comment_enabled"})
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
    return {"id": media_id, "is_comment_enabled": bool(current.get("is_comment_enabled", body.enabled))}


@router.get("/cron/sync-insights")
def cron_sync(request: Request, db: Session = Depends(get_db)) -> dict:
    """Vercel Cron 이 하루 한 번 호출해 모든 계정의 스냅샷을 적재합니다."""
    if settings.cron_secret:
        header = request.headers.get("authorization", "")
        if header != f"Bearer {settings.cron_secret}":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "인증 실패")

    synced, failed = 0, []
    for account in db.scalars(select(Account)).all():
        if account.provider == "instagram":
            try:
                _refresh_ig_token(db, account)
            except GraphError as exc:  # 갱신 실패해도 현재 토큰이 살아 있으면 동기화는 계속합니다.
                failed.append({"account": account.username, "error": f"토큰 갱신 실패: {exc}"})
        try:
            with graph_for(account) as client:
                series = svc.daily_timeseries(client, account.ig_user_id, days=7)
                profile = client.ig_profile(account.ig_user_id)
                account.followers_count = profile.get("followers_count", 0) or 0
                _persist_reach(db, account, series)
                _backfill_day_totals(db, account, client, days=30, limit=10)
                sentiment_svc.sync(db, account, client, media_limit=12)
            synced += 1
        except Exception as exc:  # 한 계정 실패가 전체를 막지 않도록
            failed.append({"account": account.username, "error": str(exc)})
    return {"synced": synced, "failed": failed}


IG_TOKEN_REFRESH_WINDOW = dt.timedelta(days=20)


def _refresh_ig_token(db: Session, account: Account) -> None:
    """Instagram 로그인 토큰은 60일 뒤 만료되므로 만료 20일 전부터 매일 연장합니다."""
    now = dt.datetime.now(dt.timezone.utc)
    expires = account.token_expires_at
    if expires is not None and expires.tzinfo is None:  # SQLite 는 tz 정보를 잃습니다.
        expires = expires.replace(tzinfo=dt.timezone.utc)
    if expires is not None and expires - now > IG_TOKEN_REFRESH_WINDOW:
        return
    with graph_for(account) as client:
        refreshed = client.ig_refresh()
    account.access_token_enc = encrypt(refreshed["access_token"])
    if refreshed.get("expires_in"):
        account.token_expires_at = now + dt.timedelta(seconds=int(refreshed["expires_in"]))
    db.commit()


@router.get("/insights/history")
def history(
    days: int = Query(default=90, ge=7, le=730),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """우리 DB 에 쌓인 장기 스냅샷 (Meta 보존 기간과 무관)."""
    since = dt.date.today() - dt.timedelta(days=days)
    rows = db.scalars(
        select(InsightSnapshot)
        .where(InsightSnapshot.account_id == account.id, InsightSnapshot.date >= since)
        .order_by(InsightSnapshot.date)
    ).all()
    return {
        "data": [
            {
                "date": r.date.isoformat(),
                "reach": r.reach,
                "profile_views": r.profile_views,
                "accounts_engaged": r.accounts_engaged,
                "total_interactions": r.total_interactions,
                "followers_count": r.followers_count,
            }
            for r in rows
        ]
    }
