"""모두의 템플릿: 공개 → 다른 회원이 둘러보기·좋아요·보관·사용·리믹스(원작자 표시) · 신고가 쌓이면 숨김 · 공개 취소."""
import io
import json
import secrets

import pytest
from PIL import Image

from backend.models import Account, DesignTemplate, TemplateReaction
from backend.security import encrypt


def _jpg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (108, 135), "white").save(buf, "JPEG")
    return buf.getvalue()


def _page(title: str) -> str:
    return json.dumps({"v": 1, "w": 1080, "h": 1350, "canvas": {"objects": [{"type": "Image", "name": "base", "src": "__BG__"}, {"type": "Textbox", "text": title}]}})


@pytest.fixture
def others(db):
    """다른 회원들의 계정 3개"""
    from backend.services import account_data

    made = []
    for _ in range(3):
        acc = Account(ig_user_id=str(secrets.randbelow(10**15)), username="u_" + secrets.token_hex(3), name="U",
                      access_token_enc=encrypt("fake"), profile_picture_url="")
        db.add(acc)
        db.commit()
        made.append(acc)
    yield made
    for acc in made:
        if db.get(Account, acc.id) is not None:
            account_data.delete_account(db, acc)
    db.commit()


def _make(client, name: str) -> dict:
    r = client.post("/studio/templates", data={"pages": json.dumps([_page(name)]), "name": name},
                    files=[("bgs", ("b.jpg", _jpg(), "image/jpeg")), ("thumb", ("t.jpg", _jpg(), "image/jpeg"))])
    assert r.status_code == 201, r.text
    return r.json()


def test_community_flow(client, login, account, others, db):
    a = login(account)
    mine = _make(a, "카페 공지")
    # 공개 전엔 안 보임
    b = login(others[0])
    assert b.get("/community/templates").json()["data"] == []
    a = login(account)
    pub = a.post(f"/studio/templates/{mine['id']}/publish", json={"category": "notice", "tags": ["#카페", "공지", "카페"], "author_name": "주스가게"})
    assert pub.status_code == 200, pub.text
    assert pub.json()["is_public"] and pub.json()["tags"] == ["카페", "공지"]
    assert a.post(f"/community/templates/{mine['id']}/report", json={}).status_code == 400  # 내 것은 신고 불가

    b = login(others[0])
    listed = b.get("/community/templates", params={"q": "카페"}).json()
    card = listed["data"][0]
    assert card["id"] == mine["id"] and card["author"]["name"] == "주스가게" and not card["is_mine"]
    assert "T" not in card["author"]["name"]  # 회원 실명(T)은 보이지 않음
    assert b.get("/community/templates", params={"category": "story"}).json()["data"] == []
    # 좋아요·보관 (두 번 눌러도 한 번), 사용
    b.post(f"/community/templates/{mine['id']}/like")
    b.post(f"/community/templates/{mine['id']}/like")
    b.post(f"/community/templates/{mine['id']}/save")
    b.post(f"/community/templates/{mine['id']}/use")
    full = b.get(f"/community/templates/{mine['id']}").json()
    assert full["likes"] == 1 and full["saves"] == 1 and full["uses"] == 1 and full["liked"] and full["saved"]
    assert "__BG" not in full["pages"][0]
    assert [x["id"] for x in b.get("/community/saved").json()["data"]] == [mine["id"]]
    b.post(f"/community/templates/{mine['id']}/like", params={"on": "false"})
    assert b.get(f"/community/templates/{mine['id']}").json()["likes"] == 0

    # 리믹스 → 내 템플릿으로 복사, 다시 공개하면 원본 표시
    rx = b.post(f"/community/templates/{mine['id']}/remix")
    assert rx.status_code == 201, rx.text
    copy = rx.json()
    t = db.get(DesignTemplate, copy["id"])
    assert t.remix_of == mine["id"] and t.bg_ids[0] != db.get(DesignTemplate, mine["id"]).bg_ids[0]
    b.post(f"/studio/templates/{copy['id']}/publish", json={"category": "notice", "author_name": "리믹서"})
    new = b.get("/community/templates", params={"sort": "new"}).json()["data"]
    assert new[0]["id"] == copy["id"] and new[0]["remix_of"] == {"id": mine["id"], "name": "카페 공지", "author": "주스가게"}
    # 제작자별
    by = b.get("/community/templates", params={"author": card["author"]["id"]}).json()
    assert [x["id"] for x in by["data"]] == [mine["id"]] and by["author"]["name"] == "주스가게"

    # 신고 3번 → 숨김
    for acc in others:
        login(acc).post(f"/community/templates/{mine['id']}/report", json={"reason": "스팸"})
    db.expire_all()
    assert db.get(DesignTemplate, mine["id"]).hidden == 1
    c = login(others[1])
    assert mine["id"] not in [x["id"] for x in c.get("/community/templates").json()["data"]]
    assert c.get(f"/community/templates/{mine['id']}").status_code == 404
    a = login(account)
    assert a.post(f"/studio/templates/{mine['id']}/publish", json={"author_name": "x"}).status_code == 409

    # 공개 취소 → 안 보임, 지우면 반응도 정리
    b = login(others[0])
    b.post(f"/studio/templates/{copy['id']}/unpublish")
    assert copy["id"] not in [x["id"] for x in b.get("/community/templates").json()["data"]]
    a = login(account)
    a.delete(f"/studio/templates/{mine['id']}")
    db.expire_all()
    assert db.query(TemplateReaction).filter_by(template_id=mine["id"]).count() == 0
    b = login(others[0])
    b.delete(f"/studio/templates/{copy['id']}")
