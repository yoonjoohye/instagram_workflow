"""관리자 대시보드용 데이터: 방문/도달 지표, 팔로워 인구통계, 상호작용 계정."""
from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import current_account, graph_for
from ..models import Account, InsightSnapshot, KnownVisitor
from ..security import encrypt
from ..services import insights as svc
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
        "집계 수치만 제공되며, 식별 가능한 계정은 /visitors 의 댓글·멘션 작성자입니다. "
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


@router.get("/visitors")
def visitors(
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
    refresh: bool = Query(default=True),
) -> dict:
    """식별 가능한 방문자 = 댓글/멘션을 남긴 계정."""
    if refresh:
        with graph_for(account) as client:
            try:
                rows = svc.interacting_accounts(client, account.ig_user_id)
            except GraphError as exc:
                raise HTTPException(exc.status, str(exc)) from exc
        _persist_visitors(db, account, rows)

    stored = db.scalars(
        select(KnownVisitor)
        .where(KnownVisitor.account_id == account.id)
        .order_by(desc(KnownVisitor.interactions), desc(KnownVisitor.last_seen_at))
        .limit(200)
    ).all()

    return {
        "data": [
            {
                "username": v.ig_username,
                "source": v.source,
                "interactions": v.interactions,
                "last_text": v.last_text,
                "last_media_id": v.last_media_id,
                "last_seen_at": v.last_seen_at.isoformat() if v.last_seen_at else None,
                "profile_url": f"https://www.instagram.com/{v.ig_username}/",
            }
            for v in stored
        ],
        "note": "Meta 개인정보 정책상 '프로필을 본 계정'은 API 로 제공되지 않습니다. "
        "여기 목록은 댓글·멘션으로 흔적을 남긴 계정입니다.",
    }


def _persist_visitors(db: Session, account: Account, rows: list[dict]) -> None:
    for row in rows:
        visitor = db.scalar(
            select(KnownVisitor).where(
                KnownVisitor.account_id == account.id,
                KnownVisitor.ig_username == row["username"],
            )
        )
        if visitor is None:
            visitor = KnownVisitor(account_id=account.id, ig_username=row["username"])
            db.add(visitor)
        visitor.source = row["source"]
        visitor.interactions = row["interactions"]
        visitor.last_text = (row.get("last_text") or "")[:500]
        visitor.last_media_id = row.get("last_media_id", "")
        seen = row.get("last_seen_at")
        if seen:
            try:
                visitor.last_seen_at = dt.datetime.fromisoformat(seen.replace("+0000", "+00:00"))
            except ValueError:
                pass
    db.commit()


@router.get("/posts")
def posts(
    limit: int = Query(default=12, ge=1, le=50),
    account: Account = Depends(current_account),
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
    return {"data": [{**m, "insights": i} for m, i in zip(media, insights)]}


@router.get("/cron/sync-insights")
def cron_sync(request: Request, db: Session = Depends(get_db)) -> dict:
    """Vercel Cron 이 하루 한 번 호출해 모든 계정의 스냅샷을 적재합니다."""
    if settings.cron_secret:
        header = request.headers.get("authorization", "")
        if header != f"Bearer {settings.cron_secret}":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "인증 실패")

    synced, failed = 0, []
    for account in db.scalars(select(Account)).all():
        if settings.auth_mode == "instagram":
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
                _persist_visitors(db, account, svc.interacting_accounts(client, account.ig_user_id))
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
