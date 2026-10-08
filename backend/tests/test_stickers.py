"""내 스티커: 투명 PNG 저장(가장자리 자르기) · 목록 · 삭제 · 다른 계정 막기."""
import io

from PIL import Image

from backend.models import Account
from backend.security import encrypt


def png(size=(200, 100), box=(50, 20, 150, 80)) -> bytes:
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    img.paste((255, 0, 0, 255), box)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_sticker_roundtrip(client, login, account, db):
    login(account)
    r = client.post("/studio/stickers", files={"file": ("s.png", png(), "image/png")})
    assert r.status_code == 201, r.text
    s = r.json()
    assert (s["width"], s["height"]) == (100, 60) and s["url"].endswith(f"/media/{s['id']}.png")  # 투명한 가장자리는 잘림
    served = client.get(f"/media/{s['id']}.png")
    assert served.headers["content-type"] == "image/png" and Image.open(io.BytesIO(served.content)).mode == "RGBA"
    assert [x["id"] for x in client.get("/studio/stickers").json()["data"]] == [s["id"]]

    empty = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    buf = io.BytesIO()
    empty.save(buf, "PNG")
    assert client.post("/studio/stickers", files={"file": ("e.png", buf.getvalue(), "image/png")}).status_code == 400

    other = Account(ig_user_id="777888999", username="other_st", access_token_enc=encrypt("t"))
    db.add(other)
    db.commit()
    try:
        login(other)
        assert client.get("/studio/stickers").json()["data"] == []
        assert client.delete(f"/studio/stickers/{s['id']}").status_code == 404
    finally:
        login(account)
        db.delete(db.get(Account, other.id))
        db.commit()
    assert client.delete(f"/studio/stickers/{s['id']}").status_code == 204
    assert client.get("/studio/stickers").json()["data"] == []


def test_layers_keep_size_and_are_not_listed(client, login, account):
    login(account)
    r = client.post("/studio/layers", files={"file": ("l.png", png(), "image/png")})
    assert r.status_code == 201, r.text
    assert (r.json()["width"], r.json()["height"]) == (200, 100)  # 레이어는 가장자리를 자르지 않음
    assert client.get(f"/media/{r.json()['id']}.png").headers["content-type"] == "image/png"
    photo = io.BytesIO()
    Image.new("RGB", (300, 200), "blue").save(photo, "JPEG")
    r2 = client.post("/studio/layers", files={"file": ("p.jpg", photo.getvalue(), "image/jpeg")})
    assert client.get(f"/media/{r2.json()['id']}.png").headers["content-type"] == "image/jpeg"  # 투명한 곳이 없으면 JPEG
    assert client.get("/studio/stickers").json()["data"] == []  # 내 스티커 목록엔 안 나옴
