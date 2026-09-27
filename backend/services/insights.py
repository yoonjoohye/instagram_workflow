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


# ── 세부 분석: 나눠 보기(breakdown) · 인구통계 · 게시물 상세 · 태그 · DM ─────────
# 전부 집계 수치입니다. 게시물을 '본' 개별 계정은 어떤 API 로도 제공되지 않습니다.

def breakdown_totals(
    client: GraphClient, ig_user_id: str, metric: str, breakdown: str, *, since: int, until: int
) -> list[dict[str, Any]]:
    """[{key, value}] — 지원 안 되거나 데이터가 없으면 빈 목록."""
    try:
        data = client.get(
            f"{ig_user_id}/insights",
            {
                "metric": metric,
                "period": "day",
                "metric_type": "total_value",
                "breakdown": breakdown,
                "since": since,
                "until": until,
            },
        )
    except GraphError:
        return []
    rows: list[dict[str, Any]] = []
    for entry in data.get("data", []):
        for bd in (entry.get("total_value") or {}).get("breakdowns", []):
            for r in bd.get("results", []):
                dims = r.get("dimension_values") or ["UNKNOWN"]
                rows.append({"key": dims[0], "value": int(r.get("value") or 0)})
    rows.sort(key=lambda r: r["value"], reverse=True)
    return rows


def _single_totals(client: GraphClient, ig_user_id: str, metrics: list[str], *, since: int, until: int) -> dict[str, int | None]:
    """지표별로 따로 요청해 하나가 미지원이어도 나머지는 받습니다."""

    def one(metric: str) -> tuple[str, int | None]:
        try:
            data = client.get(
                f"{ig_user_id}/insights",
                {"metric": metric, "period": "day", "metric_type": "total_value", "since": since, "until": until},
            )
        except GraphError:
            return metric, None
        rows = data.get("data", [])
        return metric, int((rows[0].get("total_value") or {}).get("value") or 0) if rows else None

    with ThreadPoolExecutor(max_workers=6) as pool:
        return dict(pool.map(one, metrics))


BREAKDOWN_SPECS = {
    "reach_by_follow": ("reach", "follow_type"),
    "views_by_follow": ("views", "follow_type"),
    "reach_by_type": ("reach", "media_product_type"),
    "views_by_type": ("views", "media_product_type"),
    "interactions_by_type": ("total_interactions", "media_product_type"),
    "follows_unfollows": ("follows_and_unfollows", "follow_type"),
    "link_taps": ("profile_links_taps", "contact_button_type"),
}
INTERACTION_METRICS = ["likes", "comments", "saves", "shares", "replies"]


def account_breakdowns(client: GraphClient, ig_user_id: str, *, days: int) -> dict[str, Any]:
    since, until = _day_range(days)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            key: pool.submit(breakdown_totals, client, ig_user_id, metric, bd, since=since, until=until)
            for key, (metric, bd) in BREAKDOWN_SPECS.items()
        }
        interactions = pool.submit(_single_totals, client, ig_user_id, INTERACTION_METRICS, since=since, until=until)
        out: dict[str, Any] = {key: f.result() for key, f in futures.items()}
        out["interactions"] = interactions.result()
    return out


AUDIENCE_METRICS = {
    "follower": "follower_demographics",
    "reached": "reached_audience_demographics",
    "engaged": "engaged_audience_demographics",
}


def _demographic(client: GraphClient, ig_user_id: str, metric: str, breakdown: str, timeframe: str) -> list[dict[str, Any]]:
    try:
        data = client.get(
            f"{ig_user_id}/insights",
            {
                "metric": metric,
                "period": "lifetime",
                "metric_type": "total_value",
                "breakdown": breakdown,
                "timeframe": timeframe,
            },
        )
    except GraphError:
        return []
    rows: list[dict[str, Any]] = []
    for entry in data.get("data", []):
        for bd in (entry.get("total_value") or {}).get("breakdowns", []):
            for r in bd.get("results", []):
                dims = r.get("dimension_values") or []
                rows.append({"label": dims[0] if dims else "기타", "value": int(r.get("value") or 0)})
    rows.sort(key=lambda r: r["value"], reverse=True)
    return rows[:20]


def audience_all(client: GraphClient, ig_user_id: str, *, timeframe: str = "this_month") -> dict[str, dict[str, list]]:
    """{팔로워|도달|반응: {age|gender|city|country: [{label, value}]}} — 모수가 적으면 비어 있습니다."""
    jobs = [(who, metric, bd) for who, metric in AUDIENCE_METRICS.items() for bd in DEMOGRAPHIC_BREAKDOWNS]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda j: _demographic(client, ig_user_id, j[1], j[2], timeframe), jobs))
    out: dict[str, dict[str, list]] = {who: {} for who in AUDIENCE_METRICS}
    for (who, _, bd), rows in zip(jobs, results):
        out[who][bd] = rows
    return out


def online_followers(client: GraphClient, ig_user_id: str) -> list[float]:
    """시간대(0~23시)별 팔로워 평균 접속 수. 데이터가 없으면 빈 목록."""
    since, until = _day_range(7)
    try:
        data = client.get(
            f"{ig_user_id}/insights",
            {"metric": "online_followers", "period": "lifetime", "since": since, "until": until},
        )
    except GraphError:
        return []
    days = [v.get("value") for row in data.get("data", []) for v in row.get("values", []) if isinstance(v.get("value"), dict)]
    days = [d for d in days if d]
    if not days:
        return []
    return [round(sum(int(d.get(str(h), 0) or 0) for d in days) / len(days), 1) for h in range(24)]


# 게시물 유형별 상세 지표 (문서: instagram-media/insights)
_DETAIL_METRICS = {
    "FEED": ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "profile_visits", "follows", "profile_activity"],
    "REELS": ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"],
    "STORY": ["reach", "views", "total_interactions", "follows", "profile_visits", "profile_activity", "link_clicks", "navigation", "replies"],
}


def _media_metrics(client: GraphClient, media_id: str, metrics: list[str]) -> dict[str, Any]:
    """한 번에 요청하고, 미지원 지표가 섞여 실패하면 지표별로 나눠 다시 받습니다."""

    def parse(data: dict[str, Any]) -> dict[str, Any]:
        return {r["name"]: (r.get("values") or [{}])[0].get("value", 0) for r in data.get("data", [])}

    try:
        return parse(client.get(f"{media_id}/insights", {"metric": ",".join(metrics)}))
    except GraphError:
        pass

    def one(metric: str) -> dict[str, Any]:
        try:
            return parse(client.get(f"{media_id}/insights", {"metric": metric}))
        except GraphError:
            return {}

    out: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for part in pool.map(one, metrics):
            out.update(part)
    return out


def _media_breakdown(client: GraphClient, media_id: str, metric: str, breakdown: str) -> list[dict[str, Any]]:
    try:
        data = client.get(f"{media_id}/insights", {"metric": metric, "breakdown": breakdown})
    except GraphError:
        return []
    rows = []
    for entry in data.get("data", []):
        for bd in (entry.get("total_value") or {}).get("breakdowns", []):
            for r in bd.get("results", []):
                dims = r.get("dimension_values") or ["OTHER"]
                rows.append({"key": dims[0], "value": int(r.get("value") or 0)})
    return sorted(rows, key=lambda r: r["value"], reverse=True)


def media_detail(client: GraphClient, media_id: str) -> dict[str, Any]:
    media = client.get(
        media_id,
        {"fields": "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count"},
    )
    product = (media.get("media_product_type") or "FEED").upper()
    kind = "REELS" if product == "REELS" else "STORY" if product == "STORY" else "FEED"
    with ThreadPoolExecutor(max_workers=4) as pool:
        f_metrics = pool.submit(_media_metrics, client, media_id, _DETAIL_METRICS[kind])
        f_activity = (
            pool.submit(_media_breakdown, client, media_id, "profile_activity", "action_type")
            if kind in ("FEED", "STORY")
            else None
        )
        f_nav = (
            pool.submit(_media_breakdown, client, media_id, "navigation", "story_navigation_action_type")
            if kind == "STORY"
            else None
        )
        f_comments = pool.submit(
            lambda: client.get(
                f"{media_id}/comments",
                {"fields": "id,username,text,timestamp,like_count,replies{id}", "limit": 50},
            ).get("data", [])
            if media.get("comments_count")
            else []
        )
        metrics = f_metrics.result()
        try:
            comments = f_comments.result()
        except GraphError:
            comments = []
    return {
        "id": media_id,
        "kind": kind,
        "metrics": metrics,
        "profile_activity": f_activity.result() if f_activity else [],
        "navigation": f_nav.result() if f_nav else [],
        "comments": [
            {
                "id": c.get("id"),
                "username": c.get("username", ""),
                "text": c.get("text", ""),
                "timestamp": c.get("timestamp"),
                "like_count": c.get("like_count", 0),
                "reply_count": len((c.get("replies") or {}).get("data", [])),
            }
            for c in comments
        ],
    }


def tagged_media(client: GraphClient, ig_user_id: str, *, limit: int = 30) -> list[dict[str, Any]]:
    """나를 태그한 게시물 (작성자·캡션·링크)."""
    try:
        data = client.get(
            f"{ig_user_id}/tags",
            {"fields": "id,username,caption,media_type,media_url,permalink,timestamp,like_count,comments_count", "limit": limit},
        )
    except GraphError:
        return []
    return data.get("data", [])


def dm_contacts(client: GraphClient, *, own_id: str, own_username: str, limit: int = 20) -> list[dict[str, Any]]:
    """DM 을 주고받은 상대의 프로필. 상대가 먼저 DM 을 보낸 경우에만 조회됩니다(Meta 정책)."""
    try:
        data = client.get(
            "me/conversations", {"platform": "instagram", "fields": "id,updated_time,participants", "limit": limit}
        )
    except GraphError:
        return []
    people: dict[str, str] = {}
    for conv in data.get("data", []):
        for p in (conv.get("participants") or {}).get("data", []):
            pid = str(p.get("id") or "")
            if pid and pid != own_id and p.get("username") != own_username:
                people.setdefault(pid, conv.get("updated_time") or "")

    def profile(item: tuple[str, str]) -> dict[str, Any] | None:
        pid, updated = item
        try:
            prof = client.get(
                pid,
                {"fields": "name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user"},
            )
        except GraphError:
            return None
        return {"id": pid, "last_message_at": updated, **prof}

    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = [r for r in pool.map(profile, list(people.items())) if r]
    rows.sort(key=lambda r: r.get("last_message_at") or "", reverse=True)
    return rows
