"""인사이트 조회.

Meta 는 '누가 내 프로필을 방문했는지'(계정 단위)를 제공하지 않습니다 — 집계 수치만
제공됩니다. 그래서 이 모듈은 두 갈래로 나뉩니다.

1) 집계 지표     : /{ig-user-id}/insights  (도달, 프로필 조회, 참여 계정 수 …)
2) 식별 가능한 계정: 댓글/멘션을 남긴 실제 사용자명 — API 로 알 수 있는 최대치

문서: https://developers.facebook.com/docs/instagram-platform/insights
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from .meta_graph import GraphClient, GraphError

# metric_type=total_value 로 한 번에 받을 수 있는 일별 지표.
DAILY_METRICS = [
    "reach",
    "profile_views",
    "accounts_engaged",
    "total_interactions",
    "website_clicks",
]

# 계정 종류/규모에 따라 지원되지 않는 지표가 섞여 있으면 요청 전체가 실패합니다.
# 그래서 실패 시 지표를 하나씩 줄여가며 재시도합니다.
DEMOGRAPHIC_BREAKDOWNS = ["city", "country", "age", "gender"]


def _day_range(days: int) -> tuple[int, int]:
    now = dt.datetime.now(dt.timezone.utc)
    until = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since = until - dt.timedelta(days=days)
    return int(since.timestamp()), int(until.timestamp())


def daily_timeseries(
    client: GraphClient, ig_user_id: str, *, days: int = 30
) -> dict[str, list[dict[str, Any]]]:
    """일자별 시계열. {metric: [{date, value}, ...]}"""
    since, until = _day_range(days)
    metrics = list(DAILY_METRICS)
    series: dict[str, list[dict[str, Any]]] = {}

    while metrics:
        try:
            data = client.get(
                f"{ig_user_id}/insights",
                {
                    "metric": ",".join(metrics),
                    "period": "day",
                    "metric_type": "time_series",
                    "since": since,
                    "until": until,
                },
            )
        except GraphError:
            # 지원되지 않는 지표를 하나 떨어뜨리고 다시 시도
            dropped = metrics.pop()
            series.setdefault(dropped, [])
            continue

        for row in data.get("data", []):
            name = row.get("name")
            values = [
                {
                    "date": (v.get("end_time") or "")[:10],
                    "value": v.get("value", 0),
                }
                for v in row.get("values", [])
            ]
            series[name] = values
        break

    for metric in DAILY_METRICS:
        series.setdefault(metric, [])
    return series


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
            "permalink,timestamp,like_count,comments_count",
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

    for media in recent_media(client, ig_user_id, limit=media_limit):
        try:
            comments = client.get(
                f"{media['id']}/comments",
                {"fields": "id,username,text,timestamp,like_count", "limit": 50},
            )
        except GraphError:
            continue
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
