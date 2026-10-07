"""게시물 만들기 API 흐름: 업로드 → 구성 → 이미지 → 마무리 → 삭제 (Gemini 는 가짜)."""
import base64
import io
import json

from PIL import Image

from backend.models import GenerationJob, MediaBlob
from backend.services.studio import gemini

PREFIX = "/studio"


def jpeg(color="red") -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (120, 90), color).save(b, "JPEG")
    return b.getvalue()


PLAN = {
    "requirements": [], "concept": "c", "format": "f", "art_style": "a", "font": "pretendard",
    "slides": [{"photos": [0, 1], "layout": "overlay", "title": "PARIS ✨", "body": "", "cta": "", "image_text": "", "visual": "v"}],
    "caption_parts": ["파리"], "hashtags": ["파리"],
}


def fake_gemini(model, parts, cfg=None, **_):
    if cfg and "responseSchema" in cfg:
        return {"candidates": [{"content": {"parts": [{"text": json.dumps(PLAN)}]}}]}
    if cfg and "responseModalities" in cfg:  # 이미지 생성
        b = io.BytesIO()
        Image.new("RGB", (400, 500), "green").save(b, "PNG")
        return {"candidates": [{"content": {"parts": [{"inlineData": {"data": base64.b64encode(b.getvalue()).decode()}}]}}]}
    raise gemini.GeminiError("quota exceeded")


def test_full_flow(monkeypatch, client, login, account, db):
    monkeypatch.setattr(gemini, "call", fake_gemini)
    login(account)
    ids = [client.post("/media/uploads", files={"file": (f"{c}.jpg", jpeg(c), "image/jpeg")}).json()["id"] for c in ("red", "blue")]

    r = client.post(f"{PREFIX}/plan", json={"upload_ids": ids, "prompt": "파리 여행", "caption_format": ""})
    assert r.status_code == 201, r.text
    job, slides = r.json()["job"], r.json()["slides"]
    assert job["media_kind"] == "IMAGE" and len(slides) == 1
    assert "music" not in job  # 인스타 음악 추천은 없앰 (API 로 붙일 수 없음)

    r = client.post(f"{PREFIX}/{job['id']}/slides/0")
    assert r.status_code == 200 and r.json()["engine"] == "gemini"
    visual_id = r.json()["asset"]["meta"]["visual_id"]

    assert client.post(f"{PREFIX}/{job['id']}/finalize").json()["status"] == "ready"

    # 이미지 수정 실패(strict)면 원래 이미지를 바꾸지 않고 이유를 알림
    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(gemini.GeminiError("quota exceeded")))
    r = client.post(f"{PREFIX}/{job['id']}/slides/0", json={"instruction": "밝게", "from_current": True, "strict": True})
    assert r.status_code == 502

    slide_id = client.get(f"/workflow/jobs/{job['id']}").json()["assets"][0]["url"].rsplit("/media/", 1)[1][:-4]
    assert client.delete(f"/workflow/jobs/{job['id']}").status_code == 204
    db.expire_all()
    assert db.get(MediaBlob, slide_id) is None and db.get(MediaBlob, visual_id) is None  # 만든 이미지는 삭제
    assert all(db.get(MediaBlob, i) is not None for i in ids)  # 올린 원본은 유지


def test_plan_busy_gemini_returns_503(monkeypatch, client, login, account):
    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(gemini.GeminiError("model is experiencing high demand")))
    gemini._cooldown.clear()
    login(account)
    r = client.post(f"{PREFIX}/plan", json={"upload_ids": [], "prompt": "파리 여행"})
    assert r.status_code == 503
    gemini._cooldown.clear()


def test_manual_edit_keeps_base_and_cleans_up(monkeypatch, client, login, account, db):
    monkeypatch.setattr(gemini, "call", fake_gemini)
    login(account)
    up = client.post("/media/uploads", files={"file": ("a.jpg", jpeg(), "image/jpeg")}).json()["id"]
    job = client.post(f"{PREFIX}/plan", json={"upload_ids": [up], "prompt": "편집 테스트"}).json()["job"]
    first = client.post(f"{PREFIX}/{job['id']}/slides/0").json()["asset"]
    base_id = first["url"].rsplit("/media/", 1)[1][:-4]

    def save(layers):
        r = client.post(
            f"{PREFIX}/{job['id']}/slides/0/edit",
            files={"file": ("e.jpg", jpeg("yellow"), "image/jpeg")},
            data={"layers": layers, "base_id": base_id},
        )
        assert r.status_code == 200, r.text
        return r.json()["asset"]

    a1 = save('{"objects":[1]}')
    a2 = save('{"objects":[1,2]}')
    db.expire_all()
    edited1, edited2 = (a["url"].rsplit("/media/", 1)[1][:-4] for a in (a1, a2))
    assert a2["meta"]["edit"] == {"base_id": base_id, "layers": '{"objects":[1,2]}'}
    assert a2["meta"]["text_baked"] is True
    assert db.get(MediaBlob, base_id) is not None  # 편집 전 원본은 남김
    assert db.get(MediaBlob, edited1) is None  # 이전 편집 결과는 정리
    assert client.get(f"{PREFIX}/fonts/pretendard.font").status_code == 200

    client.delete(f"/workflow/jobs/{job['id']}")
    db.expire_all()
    assert db.get(MediaBlob, base_id) is None and db.get(MediaBlob, edited2) is None
    assert db.get(MediaBlob, up) is not None  # 올린 사진은 유지


def test_caption_rewrite_keeps_template(monkeypatch, client, login, account):
    seen = {}

    def fake(model, parts, cfg=None, **_):
        if "캡션 작가" in parts[0]["text"]:
            seen["prompt"] = parts[0]["text"]
            return {"candidates": [{"content": {"parts": [{"text": json.dumps({"caption_parts": ["짧게 다시 씀"], "hashtags": ["#파리"]})}]}}]}
        return fake_gemini(model, parts, cfg)

    monkeypatch.setattr(gemini, "call", fake)
    login(account)
    job = client.post(f"{PREFIX}/plan", json={"prompt": "파리", "caption_format": "[본문]\n👉 링크는 프로필"}).json()["job"]
    r = client.post(f"{PREFIX}/{job['id']}/caption", json={"instruction": "더 짧게", "caption": "지금 캡션"})
    assert r.status_code == 200, r.text
    assert r.json() == {"caption": "짧게 다시 씀\n👉 링크는 프로필", "hashtags": ["파리"], "hashtags_inline": False, "requests": ["더 짧게"]}
    assert "더 짧게" in seen["prompt"] and "지금 캡션" in seen["prompt"]
    assert "존댓말은 쓰지 마" in seen["prompt"]  # 기본 말투는 반말

    # 바란 점은 기록되고 다음 자동 작성에도 계속 반영
    r = client.post(f"{PREFIX}/{job['id']}/caption", json={"instruction": "이모지 많이", "caption": "x"})
    assert r.json()["requests"] == ["더 짧게", "이모지 많이"]
    assert "앞서 바란 점" in seen["prompt"] and "더 짧게" in seen["prompt"].split("앞서 바란 점")[1]
    # 말투·길이를 바꾸고 기록 하나를 지우면 그대로 반영
    s = client.patch(f"{PREFIX}/{job['id']}/settings", json={"caption_tone": "polite", "caption_length": "short", "caption_requests": ["이모지 많이"]}).json()["settings"]
    assert s["caption_tone"] == "polite" and s["caption_length"] == "short" and s["caption_requests"] == ["이모지 많이"]
    client.post(f"{PREFIX}/{job['id']}/caption", json={"instruction": "", "caption": "x"})
    assert "해요체" in seen["prompt"] and "15~60자" in seen["prompt"] and "더 짧게" not in seen["prompt"]
    assert client.patch(f"{PREFIX}/{job['id']}/settings", json={"caption_tone": "formal"}).status_code == 422
    client.delete(f"/workflow/jobs/{job['id']}")


def test_reorder_moves_images_with_their_slide_plan(client, login, account, db):
    from backend.models import GenerationJob

    login(account)
    job = GenerationJob(
        account_id=account.id, prompt="p", media_kind="CAROUSEL", status="ready", provider="studio", caption="", hashtags=[],
        assets=[{"type": "image", "url": f"u{i}", "thumbnail_url": "", "meta": {}} for i in range(3)],
        plan={"slides": [{"title": f"s{i}"} for i in range(3)]},
    )
    db.add(job)
    db.commit()
    r = client.post(f"{PREFIX}/{job.id}/reorder", json={"order": [2, 0, 1]})
    assert [a["url"] for a in r.json()["assets"]] == ["u2", "u0", "u1"]
    db.expire_all()
    assert [s["title"] for s in db.get(GenerationJob, job.id).plan["slides"]] == ["s2", "s0", "s1"]
    assert client.post(f"{PREFIX}/{job.id}/reorder", json={"order": [0, 0, 1]}).status_code == 400


def test_hashtags_from_photos_and_caption(monkeypatch, client, login, account, db):
    seen = {}

    def fake(model, parts, cfg=None, **_):
        seen["images"] = sum(1 for p in parts if "inlineData" in p)
        seen["text"] = parts[-1]["text"]
        return {"candidates": [{"content": {"parts": [{"text": json.dumps({"hashtags": ["#파리 여행", "파리여행", "eiffel"]})}]}}]}

    monkeypatch.setattr(gemini, "call", fake)
    login(account)
    ids = [client.post("/media/uploads", files={"file": ("a.jpg", jpeg("red"), "image/jpeg")}).json()["id"]]
    job = client.post("/studio/manual", json={"upload_ids": ids}).json()
    r = client.post(f"{PREFIX}/{job['id']}/hashtags", json={"caption": "에펠탑 앞에서", "language": "ko"})
    assert r.status_code == 200, r.text
    assert r.json()["hashtags"] == ["파리여행", "eiffel"]  # 띄어쓰기·# 제거, 중복 제거
    assert seen["images"] == 1 and "에펠탑 앞에서" in seen["text"]


def test_caption_written_from_photos_when_empty(monkeypatch, client, login, account, db):
    seen = {}

    def fake(model, parts, cfg=None, **_):
        seen["images"] = sum(1 for p in parts if "inlineData" in p)
        seen["text"] = parts[-1]["text"]
        return {"candidates": [{"content": {"parts": [{"text": json.dumps({"caption_parts": ["에펠탑 앞 노을 🌅"], "hashtags": ["파리"]})}]}}]}

    monkeypatch.setattr(gemini, "call", fake)
    login(account)
    ids = [client.post("/media/uploads", files={"file": ("a.jpg", jpeg("red"), "image/jpeg")}).json()["id"]]
    job = client.post("/studio/manual", json={"upload_ids": ids, "prompt": "파리 여행"}).json()
    r = client.post(f"{PREFIX}/{job['id']}/caption", json={"caption": "", "instruction": "", "language": "ko"})
    assert r.status_code == 200, r.text
    assert r.json()["caption"] == "에펠탑 앞 노을 🌅"
    assert seen["images"] == 1 and "사진과 주제에 어울리게" in seen["text"] and "파리 여행" in seen["text"]


def test_manual_edit_keeps_story_links(client, login, account, db):
    login(account)
    up = client.post("/media/uploads", files={"file": ("a.jpg", jpeg("red"), "image/jpeg")}).json()["id"]
    job = client.post("/studio/manual", json={"upload_ids": [up], "post_type": "story"}).json()
    links = json.dumps([{"kind": "link", "url": "https://shop.example.com"}, {"kind": "post", "url": "https://instagram.com/p/x"}, {"url": "javascript:alert(1)"}])
    r = client.post(
        f"{PREFIX}/{job['id']}/slides/0/edit",
        files={"file": ("e.jpg", jpeg("blue"), "image/jpeg")},
        data={"layers": "{}", "base_id": up, "links": links},
    )
    assert r.status_code == 200, r.text
    assert r.json()["asset"]["meta"]["story_links"] == [
        {"kind": "link", "url": "https://shop.example.com"}, {"kind": "post", "url": "https://instagram.com/p/x"},
    ]


def test_manual_post_writes_caption_from_photos_topic_and_concept(monkeypatch, client, login, account, db):
    seen = {}

    def fake(model, parts, cfg=None, **_):
        seen["images"] = sum(1 for p in parts if "inlineData" in p)
        seen["text"] = parts[-1]["text"]
        return {"candidates": [{"content": {"parts": [{"text": json.dumps({"caption_parts": ["노을 지는 분수 앞에서 🌇"], "hashtags": ["에든버러"]})}]}}]}

    monkeypatch.setattr(gemini, "call", fake)
    login(account)
    up = client.post("/media/uploads", files={"file": ("a.jpg", jpeg("red"), "image/jpeg")}).json()["id"]
    job = client.post("/studio/manual", json={
        "upload_ids": [up], "prompt": "에든버러 여행", "style": "필름 감성", "caption_format": "", "write_caption": True,
    }).json()
    assert job["caption"] == "노을 지는 분수 앞에서 🌇" and job["hashtags"] == ["에든버러"]
    assert seen["images"] == 1 and "에든버러 여행" in seen["text"] and "필름 감성" in seen["text"]

    # Gemini 가 실패해도 작업은 만들고 안내만
    client.cookies.set("lang", "ko")
    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(gemini.GeminiError("quota exceeded")))
    job = client.post("/studio/manual", json={"upload_ids": [up], "write_caption": True}).json()
    assert job["caption"] == "" and "자동으로 쓰지 못했습니다" in job["error"]


def test_workspace_media_add_remove_generate_and_settings(monkeypatch, client, login, account, db):
    """사진을 고르면 바로 작업 공간 → 사진 더 넣기·빼기, AI 로 새 이미지, 컨셉·주제·피드/스토리 바꾸기, 사진별 AI 수정."""
    login(account)
    up = lambda c: client.post("/media/uploads", files={"file": (f"{c}.jpg", jpeg(c), "image/jpeg")}).json()["id"]
    job = client.post("/studio/manual", json={"upload_ids": [up("red")]}).json()
    assert job["media_kind"] == "IMAGE"

    job = client.post(f"{PREFIX}/{job['id']}/media", json={"upload_ids": [up("blue")]}).json()
    assert job["media_kind"] == "CAROUSEL" and len(job["assets"]) == 2

    monkeypatch.setattr(gemini, "call", fake_gemini)  # 이미지 생성은 초록 이미지
    r = client.post(f"{PREFIX}/{job['id']}/media/generate", json={"instruction": "에펠탑 일러스트"})
    assert r.status_code == 200, r.text
    assert len(r.json()["assets"]) == 3 and r.json()["assets"][2]["meta"]["generated"]

    # 직접 만든 작업의 사진도 '지금 이미지에서 고치기' 가 됨 (예전엔 layout 이 없어 서버 오류)
    r = client.post(f"{PREFIX}/{job['id']}/slides/0", json={"instruction": "밝게", "from_current": True})
    assert r.status_code == 200, r.text

    job = client.delete(f"{PREFIX}/{job['id']}/media/1").json()
    assert len(job["assets"]) == 2 and job["media_kind"] == "CAROUSEL"

    job = client.patch(f"{PREFIX}/{job['id']}/settings", json={"post_type": "story", "prompt": "파리 여행", "template": "travel"}).json()
    assert job["media_kind"] == "STORIES"
    plan = db.get(GenerationJob, job["id"]).plan
    assert plan["topic"] == "파리 여행" and plan["template"] == "travel"

    # Gemini 이미지 생성이 실패하면 빈 배경을 넣지 않고 알림
    monkeypatch.setattr(gemini, "call", lambda *a, **k: (_ for _ in ()).throw(gemini.GeminiError("quota exceeded")))
    assert client.post(f"{PREFIX}/{job['id']}/media/generate", json={}).status_code == 502
