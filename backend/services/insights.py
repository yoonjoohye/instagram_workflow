"""인사이트 조회.

Meta 는 '누가 내 프로필을 방문했는지'(계정 단위)를 제공하지 않습니다 — 집계 수치만
제공됩니다. 그래서 이 모듈은 두 갈래로 나뉩니다.

1) 집계 지표     : /{ig-user-id}/insights  (도달, 프로필 조회, 참여 계정 수 …)
2) 식별 가능한 계정: 댓글/멘션을 남긴 실제 사용자명 — API 로 알 수 있는 최대치

문서: https://developers.facebook.com/docs/instagram-platform/insights
"""
from __future__ import annotations

import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .meta_graph import GraphClient, GraphError

# 대시보드 지표. Instagram API 는 reach 만 일자별(time_series)로 주고,
# 나머지는 기간 합계(total_value)로만 줍니다 — time_series 로 요청하면 빈 배열이 옵니다.
DAILY_METRICS = [
    "reach",
    "profile_views",
    "accounts_engaged",
    "total_interactions",
    "website_clicks",
]
TIME_SERIES_METRICS = ["reach"]

DEMOGRAPHIC_BREAKDOWNS = ["city", "country", "age", "gender"]


def _day_range(days: int, *, offset_days: int = 0) -> tuple[int, int]:
    """오늘 0시(UTC) 기준 [since, until). offset_days 만큼 과거로 민 구간도 만들 수 있습니다."""
    now = dt.datetime.now(dt.timezone.utc)
    until = now.replace(hour=0, minute=0, second=0, microsecond=0) - dt.timedelta(days=offset_days)
    since = until - dt.timedelta(days=days)
    return int(since.timestamp()), int(until.timestamp())


def daily_timeseries(
    client: GraphClient, ig_user_id: str, *, days: int = 30
) -> dict[str, list[dict[str, Any]]]:
    """일자별 시계열. {metric: [{date, value}, ...]} — 일자별 제공 지표(reach)만 채워집니다."""
    since, until = _day_range(days)
    series: dict[str, list[dict[str, Any]]] = {m: [] for m in DAILY_METRICS}
    try:
        data = client.get(
            f"{ig_user_id}/insights",
            {
                "metric": ",".join(TIME_SERIES_METRICS),
                "period": "day",
                "metric_type": "time_series",
                "since": since,
                "until": until,
            },
        )
    except GraphError:
        return series

    for row in data.get("data", []):
        series[row.get("name")] = [
            {"date": (v.get("end_time") or "")[:10], "value": v.get("value", 0)}
            for v in row.get("values", [])
        ]
    return series


def range_totals(
    client: GraphClient, ig_user_id: str, *, since: int, until: int
) -> dict[str, int | None]:
    """[since, until) 구간 합계. 지원되지 않는 지표는 None.

    reach 의 total_value 는 기간 내 '고유' 계정 수라 일별 도달의 합보다 작습니다.
    """
    metrics = list(DAILY_METRICS)
    out: dict[str, int | None] = {m: None for m in DAILY_METRICS}
    # 계정 종류에 따라 지원되지 않는 지표가 섞이면 요청 전체가 실패하므로 하나씩 줄여가며 재시도합니다.
    while metrics:
        try:
            data = client.get(
                f"{ig_user_id}/insights",
                {
                    "metric": ",".join(metrics),
                    "period": "day",
                    "metric_type": "total_value",
                    "since": since,
                    "until": until,
                },
            )
        except GraphError:
            metrics.pop()
            continue
        for row in data.get("data", []):
            out[row.get("name")] = int((row.get("total_value") or {}).get("value") or 0)
        break
    return out


def day_totals(client: GraphClient, ig_user_id: str, day: dt.date) -> dict[str, int | None]:
    """하루치 합계 — cron 이 매일 쌓아서 reach 외 지표의 일자별 추이를 만듭니다."""
    start = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)
    return range_totals(
        client,
        ig_user_id,
        since=int(start.timestamp()),
        until=int((start + dt.timedelta(days=1)).timestamp()),
    )


def follower_demographics(client: GraphClient, ig_user_id: str) -> dict[str, list[dict[str, Any]]]:
    """팔로워 인구통계(도시/국가/연령/성별). 팔로워 100명 미만이면 비어 있습니다."""
    out: dict[str, list[dict[str, Any]]] = {}
    for breakdown in DEMOGRAPHIC_BREAKDOWNS:
        try:
            data = client.get(
                f"{ig_user_id}/insights",
                {
                    "metric": "follower_demographics",
                    "period": "lifetime",
                    "metric_type": "total_value",
                    "breakdown": breakdown,
                    "timeframe": "this_month",
                },
            )
        except GraphError:
            out[breakdown] = []
            continue

        rows: list[dict[str, Any]] = []
        for entry in data.get("data", []):
            total = entry.get("total_value") or {}
            for result in total.get("breakdowns", [{}])[0].get("results", []):
                dims = result.get("dimension_values") or []
                rows.append({"label": dims[0] if dims else "기타", "value": result.get("value", 0)})
        rows.sort(key=lambda r: r["value"], reverse=True)
        out[breakdown] = rows[:20]
    return out


def recent_media(client: GraphClient, ig_user_id: str, *, limit: int = 12) -> list[dict[str, Any]]:
    data = client.get(
        f"{ig_user_id}/media",
        {
            "fields": "id,caption,media_type,media_product_type,media_url,thumbnail_url,"
            "permalink,timestamp,like_count,comments_count,is_comment_enabled",
            "limit": limit,
        },
    )
    return data.get("data", [])


# 게시물 종류별로 지원 지표가 다릅니다.
_FEED_METRICS = "reach,likes,comments,saved,shares,total_interactions,views"
_REELS_METRICS = "reach,likes,comments,saved,shares,views,ig_reels_avg_watch_time"
_STORY_METRICS = "reach,replies,navigation"


def media_insights(client: GraphClient, media: dict[str, Any]) -> dict[str, Any]:
    product = (media.get("media_product_type") or "").upper()
    if product == "REELS":
        metrics = _REELS_METRICS
    elif product == "STORY":
        metrics = _STORY_METRICS
    else:
        metrics = _FEED_METRICS

    try:
        data = client.get(f"{media['id']}/insights", {"metric": metrics})
    except GraphError:
        return {}
    return {
        row["name"]: (row.get("values") or [{}])[0].get("value", 0)
        for row in data.get("data", [])
    }


def interacting_accounts(
    client: GraphClient, ig_user_id: str, *, media_limit: int = 12
) -> list[dict[str, Any]]:
    """댓글/멘션을 남긴 계정 목록 — API 가 알려주는 유일한 '식별된 방문자'."""
    found: dict[str, dict[str, Any]] = {}

    def fetch_comments(media: dict[str, Any]) -> dict[str, Any]:
        if not media.get("comments_count"):
            return {}  # 댓글 없는 게시물은 호출하지 않습니다.
        try:
            return client.get(
                f"{media['id']}/comments",
                {"fields": "id,username,text,timestamp,like_count", "limit": 50},
            )
        except GraphError:
            return {}

    medias = recent_media(client, ig_user_id, limit=media_limit)
    with ThreadPoolExecutor(max_workers=6) as pool:
        all_comments = list(pool.map(fetch_comments, medias))

    for media, comments in zip(medias, all_comments):
        for c in comments.get("data", []):
            username = c.get("username")
            if not username:
                continue
            entry = found.setdefault(
                username,
                {
                    "username": username,
                    "source": "comment",
                    "interactions": 0,
                    "last_text": "",
                    "last_media_id": media["id"],
                    "last_permalink": media.get("permalink", ""),
                    "last_seen_at": c.get("timestamp", ""),
                },
            )
            entry["interactions"] += 1
            if c.get("timestamp", "") >= entry["last_seen_at"]:
                entry["last_seen_at"] = c.get("timestamp", "")
                entry["last_text"] = c.get("text", "")
                entry["last_media_id"] = media["id"]
                entry["last_permalink"] = media.get("permalink", "")

    try:
        tags = client.get(
            f"{ig_user_id}/tags",
            {"fields": "id,username,caption,permalink,timestamp", "limit": 50},
        )
        for t in tags.get("data", []):
            username = t.get("username")
            if not username:
                continue
            entry = found.setdefault(
                username,
                {
                    "username": username,
                    "source": "mention",
                    "interactions": 0,
                    "last_text": t.get("caption", ""),
                    "last_media_id": t.get("id", ""),
                    "last_permalink": t.get("permalink", ""),
                    "last_seen_at": t.get("timestamp", ""),
                },
            )
            entry["interactions"] += 1
    except GraphError:
        pass

    rows = list(found.values())
    rows.sort(key=lambda r: (r["interactions"], r["last_seen_at"]), reverse=True)
    return rows
