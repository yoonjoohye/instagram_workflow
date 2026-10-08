"""내 필터: 저장·같은 이름 덮어쓰기·삭제·회원별."""


def test_filter_presets(client, login, account):
    login(account)
    assert client.get("/studio/filters").json()["data"] == []
    r = client.post("/studio/filters", json={"name": "여름 디카", "values": {"contrast": -0.2, "warmth": 0.15, "hslH_orange": -0.03, "bad key!": 1}})
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["values"] == {"contrast": -0.2, "warmth": 0.15, "hslH_orange": -0.03}  # 이상한 키는 버림
    # 같은 이름으로 다시 저장하면 덮어쓰기 (개수 그대로)
    client.post("/studio/filters", json={"name": "여름 디카", "values": {"contrast": -0.1}})
    data = client.get("/studio/filters").json()["data"]
    assert len(data) == 1 and data[0]["values"] == {"contrast": -0.1} and data[0]["id"] == item["id"]
    assert client.post("/studio/filters", json={"name": "", "values": {}}).status_code == 422
    assert client.delete(f"/studio/filters/{item['id']}").status_code == 204
    assert client.get("/studio/filters").json()["data"] == []
    assert client.delete("/studio/filters/nope").status_code == 404
