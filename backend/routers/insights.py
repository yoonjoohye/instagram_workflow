"""관리자 대시보드용 데이터: 방문/도달 지표, 팔로워 인구통계, 상호작용 계정."""
from __future__ import annotations

import datetime as dt

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


@router.get("/insights/overview")
def overview(
    days: int = Query(default=30, ge=7, le=90),
    account: Account = Depends(current_account),
    db: Session = Depends(get_db),
) -> dict:
    """대시보드 상단 요약 + 일자별 시계열."""
    with graph_for(account) as client:
        try:
            profile = client.ig_profile(account.ig_user_id)
            series = svc.daily_timeseries(client, account.ig_user_id, days=days)
        except GraphError as exc:
            raise HTTPException(exc.status, str(exc)) from exc

    account.followers_count = profile.get("followers_count", account.followers_count) or 0
    account.follows_count = profile.get("follows_count", account.follows_count) or 0
    account.media_count = profile.get("media_count", account.media_count) or 0
    db.commit()

    def total(metric: str) -> int:
        return sum(int(p["value"] or 0) for p in series.get(metric, []))

    # 앞뒤 절반을 비교해 증감률을 냅니다.
    def trend(metric: str) -> float | None:
        points = [int(p["value"] or 0) for p in series.get(metric, [])]
        if len(points) < 4:
            return None
        half = len(points) // 2
        prev, cur = sum(points[:half]), sum(points[half:])
        if prev == 0:
            return None
        return round((cur - prev) / prev * 100, 1)

    _persist_snapshots(db, account, series)

    return {
        "range_days": days,
        "profile": {
            "username": profile.get("username", account.username),
            "followers_count": account.followers_count,
            "follows_count": account.follows_count,
            "media_count": account.media_count,
            "profile_picture_url": profile.get("profile_picture_url", account.profile_picture_url),
        },
        "totals": {m: total(m) for m in svc.DAILY_METRICS},
        "trends": {m: trend(m) for m in svc.DAILY_METRICS},
        "series": series,
        "note": "Instagram Graph API 는 프로필을 조회한 '개별 계정'을 제공하지 않습니다. "
        "집계 수치만 제공되며, 식별 가능한 계정은 /visitors 의 댓글·멘션 작성자입니다.",
    }


def _persist_snapshots(db: Session, account: Account, series: dict) -> None:
    """Meta 보존 기간(약 2년)을 넘겨서도 보려면 우리가 쌓아둬야 합니다."""
    by_date: dict[str, dict[str, int]] = {}
    for metric, points in series.items():
        for point in points:
            date = point.get("date")
            if not date:
                continue
            by_date.setdefault(date, {})[metric] = int(point.get("value") or 0)

    for date_str, metrics in by_date.items():
        try:
            day = dt.date.fromisoformat(date_str)
        except ValueError:
            continue
        snap = db.scalar(
            select(InsightSnapshot).where(
                InsightSnapshot.account_id == account.id, InsightSnapshot.date == day
            )
        )
        if snap is None:
            snap = InsightSnapshot(account_id=account.id, date=day)
            db.add(snap)
        snap.reach = metrics.get("reach", 0)
        snap.profile_views = metrics.get("profile_views", 0)
        snap.accounts_engaged = metrics.get("accounts_engaged", 0)
        snap.total_interactions = metrics.get("total_interactions", 0)
        snap.website_clicks = metrics.get("website_clicks", 0)
        snap.followers_count = account.followers_count
    db.commit()


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
        rows = []
        for m in media:
            rows.append({**m, "insights": svc.media_insights(client, m)})
    return {"data": rows}


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
                _persist_snapshots(db, account, series)
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
