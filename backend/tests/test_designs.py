"""디자인 템플릿: 템플릿으로 만든 장들로 작업 만들기(바로 편집 가능), 내 테마, 내 템플릿."""
import io
import json

from PIL import Image

from backend.models import DesignTemplate, GenerationJob, MediaBlob


def _jpg(color="red", size=(108, 135)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


def _page(title: str) -> str:
    return json.dumps({"v": 1, "w": 1080, "h": 1350, "canvas": {"objects": [
        {"type": "Image", "name": "base", "src": "__BG__"},
        {"type": "Textbox", "text": title, "tk": {"fill": "text", "font": "heading"}},
    ]}})


def test_create_design_job_with_editable_pages(client, login, account, db):
    login(account)
    files = [("bgs", ("b0.jpg", _jpg("white"), "image/jpeg")), ("bgs", ("b1.jpg", _jpg("white"), "image/jpeg")),
             ("imgs", ("i0.jpg", _jpg("red"), "image/jpeg")), ("imgs", ("i1.jpg", _jpg("blue"), "image/jpeg"))]
    r = client.post("/studio/designs", data={"pages": json.dumps([_page("표지"), _page("본문")]), "name": "미니멀 카드뉴스"}, files=files)
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["media_kind"] == "CAROUSEL" and len(job["assets"]) == 2 and job["prompt"] == "미니멀 카드뉴스"
    meta = job["assets"][0]["meta"]
    base = db.get(MediaBlob, meta["edit"]["base_id"])
    assert base.kind == "upload" and meta["edited"] and meta["engine"] == "design"
    layers = json.loads(meta["edit"]["layers"])
    assert layers["canvas"]["objects"][0]["src"] == f"/api/py/media/{base.id}.jpg"  # __BG__ → 바탕 그림 (상대 주소)
    assert "__BG__" not in meta["edit"]["layers"]
    # 장 수와 그림 수가 다르면 거절
    bad = client.post("/studio/designs", data={"pages": json.dumps([_page("a")])}, files=files)
    assert bad.status_code == 400
    # 스토리
    s = client.post("/studio/designs", data={"pages": json.dumps([_page("s")]), "post_type": "story"},
                    files=[("bgs", ("b.jpg", _jpg(), "image/jpeg")), ("imgs", ("i.jpg", _jpg(), "image/jpeg"))]).json()
    assert s["media_kind"] == "STORIES"


def test_my_themes(client, login, account):
    login(account)
    theme = {"name": "우리 가게", "colors": {"bg": "#FFF8F0", "surface": "#ffffff", "text": "#2b2118", "primary": "#e8743b", "on_primary": "#ffffff", "accent": "#f4c095"},
             "fonts": {"heading": "black_han_sans", "body": "pretendard"}}
    r = client.post("/studio/themes", json=theme)
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["colors"]["bg"] == "#fff8f0"
    client.post("/studio/themes", json={**theme, "fonts": {"heading": "jua", "body": "pretendard"}})  # 같은 이름은 덮어쓰기
    data = client.get("/studio/themes").json()["data"]
    assert len(data) == 1 and data[0]["fonts"]["heading"] == "jua"
    assert client.post("/studio/themes", json={**theme, "colors": {**theme["colors"], "bg": "red"}}).status_code == 422
    assert client.post("/studio/themes", json={**theme, "fonts": {"heading": "../x", "body": "a"}}).status_code == 422
    assert client.delete(f"/studio/themes/{item['id']}").status_code == 204
    assert client.get("/studio/themes").json()["data"] == []


def test_my_templates(client, login, account, db):
    login(account)
    files = [("bgs", ("b0.jpg", _jpg("white"), "image/jpeg")), ("bgs", ("b1.jpg", _jpg("gray"), "image/jpeg")),
             ("thumb", ("t.jpg", _jpg("red"), "image/jpeg"))]
    r = client.post("/studio/templates", data={"pages": json.dumps([_page("1"), _page("2")]), "name": "내 카드뉴스"}, files=files)
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["pages"] == 2 and item["thumb_url"]
    listed = client.get("/studio/templates").json()["data"]
    assert [x["id"] for x in listed] == [item["id"]]
    full = client.get(f"/studio/templates/{item['id']}").json()
    t = db.get(DesignTemplate, item["id"])
    assert json.loads(full["pages"][1])["canvas"]["objects"][0]["src"] == f"/api/py/media/{t.bg_ids[1]}.jpg"
    assert db.get(MediaBlob, t.bg_ids[0]).kind == "template"
    # 고치기: 장·바탕을 새것으로, 예전 바탕은 지움
    old_bgs = list(t.bg_ids)
    up = client.put(f"/studio/templates/{item['id']}", data={"pages": json.dumps([_page("새 표지")]), "name": "고친 템플릿"},
                    files=[("bgs", ("b.jpg", _jpg("blue"), "image/jpeg")), ("thumb", ("t.jpg", _jpg(), "image/jpeg"))])
    assert up.status_code == 200, up.text
    assert up.json()["name"] == "고친 템플릿" and up.json()["pages"] == 1
    db.expire_all()
    t = db.get(DesignTemplate, item["id"])
    assert all(db.get(MediaBlob, b) is None for b in old_bgs) and len(t.bg_ids) == 1
    page = json.loads(client.get(f"/studio/templates/{item['id']}").json()["pages"][0])
    assert page["canvas"]["objects"][1]["text"] == "새 표지"
    bg_ids = list(t.bg_ids)
    assert client.delete(f"/studio/templates/{item['id']}").status_code == 204
    db.expire_all()
    assert db.get(DesignTemplate, item["id"]) is None and all(db.get(MediaBlob, b) is None for b in bg_ids)
    assert client.get(f"/studio/templates/{item['id']}").status_code == 404
