"""게시물 성과: 커서로 페이지 넘기기."""
from backend.routers import insights


class FakeGraph:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return None

    def get(self, path, params=None):
        params = params or {}
        if path.endswith("/media"):
            self.calls.append(params.get("after"))
            return self.pages[params.get("after")]
        return {"data": []}  # 인사이트


def test_posts_pages_with_cursor(monkeypatch, client, login, account):
    pages = {
        None: {"data": [{"id": "m1", "media_product_type": "FEED"}], "paging": {"cursors": {"after": "C1"}, "next": "https://x"}},
        "C1": {"data": [{"id": "m2", "media_product_type": "FEED"}], "paging": {"cursors": {"after": "C2"}}},  # next 없음 = 마지막
    }
    graph = FakeGraph(pages)
    synced = []
    monkeypatch.setattr(insights, "graph_for", lambda acc: graph)
    monkeypatch.setattr(insights.svc, "media_insights", lambda c, m: {})
    monkeypatch.setattr(insights.media_sync, "sync_deleted", lambda *a: synced.append(1))
    login(account)
    first = client.get("/posts?limit=1").json()
    assert [p["id"] for p in first["data"]] == ["m1"] and first["paging"] == {"after": "C1"}
    second = client.get("/posts?limit=1&after=C1").json()
    assert [p["id"] for p in second["data"]] == ["m2"] and second["paging"] == {"after": None}
    assert graph.calls == [None, "C1"] and synced == [1]  # 지운 게시물 정리는 첫 페이지에서만
