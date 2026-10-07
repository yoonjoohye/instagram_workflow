"""회원(이메일 가입·로그인·재설정·탈퇴)과 Instagram·Facebook 연동."""
import pytest

from backend.models import Account, EmailCode, FacebookLink, User
from backend.routers import auth
from backend.security import SESSION_COOKIE, encrypt, load_session, sign_session


def _signup(client, email="new@test.dev", password="abcd1234"):
    """기본: 이메일 인증 없이 중복 확인만 (SIGNUP_EMAIL_VERIFY 꺼짐)."""
    return client.post("/auth/signup", json={"email": email, "password": password, **PROFILE})


PROFILE = {"name": "새 회원", "birth_date": "1995-03-14", "phone": "010-1234-5678"}


@pytest.fixture
def verify_on(monkeypatch):
    from backend.routers import members

    monkeypatch.setattr(members.settings, "signup_email_verify", True)


@pytest.fixture
def cleanup(db):
    emails: list[str] = []
    yield emails
    for email in emails:
        user = db.query(User).filter(User.email == email).first()
        if user is not None:
            db.delete(user)
        db.query(EmailCode).filter(EmailCode.email == email).delete()
    db.commit()


def test_signup_login_logout(client, cleanup):
    cleanup.append("new@test.dev")
    r = _signup(client, "New@Test.dev ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "new@test.dev" and body["account"] is None and body["accounts"] == []
    assert client.get("/auth/session").json()["user"]["name"] == "새 회원"
    # Instagram 계정이 없으면 계정이 필요한 화면은 409 로 '연동' 안내
    assert client.get("/auth/me").status_code == 409

    client.post("/auth/logout")
    client.cookies.clear()
    assert client.get("/auth/session").status_code == 401
    assert client.post("/auth/signin", json={"email": "new@test.dev", "password": "wrong1234"}).status_code == 401
    r = client.post("/auth/signin", json={"email": "NEW@test.dev", "password": "abcd1234"})
    assert r.status_code == 200 and r.json()["user"]["email"] == "new@test.dev"


def test_signup_profile_fields(client, cleanup):
    cleanup.append("prof2@test.dev")
    base = {"email": "prof2@test.dev", "password": "abcd1234"}
    assert client.post("/auth/signup", json={**base, "name": "", "birth_date": "1995-03-14", "phone": "01012345678"}).status_code == 422
    assert client.post("/auth/signup", json={**base, "name": "김", "birth_date": "2020-01-01", "phone": "01012345678"}).status_code == 422  # 만 14세 미만
    assert client.post("/auth/signup", json={**base, "name": "김", "birth_date": "1995-03-14", "phone": "12"}).status_code == 422
    assert client.post("/auth/signup", json={**base, "name": "김"}).status_code == 422  # 생년월일·전화번호 필수
    r = client.post("/auth/signup", json={**base, "name": " 김  하나 ", "birth_date": "1995-03-14", "phone": "010-1234-5678"})
    assert r.status_code == 201, r.text
    u = r.json()["user"]
    assert (u["name"], u["birth_date"], u["phone"]) == ("김 하나", "1995-03-14", "01012345678")
    u = client.patch("/auth/profile", json={"phone": "+82 10 9999 8888"}).json()
    assert u["phone"] == "+821099998888" and u["name"] == "김 하나"


def test_signup_check_duplicate(client, cleanup):
    cleanup.append("check@test.dev")
    assert client.post("/auth/signup/check", json={"email": "Check@Test.dev"}).json() == {"email": "check@test.dev", "available": True}
    assert _signup(client, "check@test.dev").status_code == 201
    assert client.post("/auth/signup/check", json={"email": "check@test.dev"}).json()["available"] is False
    assert client.post("/auth/signup/check", json={"email": "nope"}).status_code == 422
    client.cookies.clear()
    assert _signup(client, "CHECK@test.dev").status_code == 409


def test_signup_needs_code_when_verify_on(client, cleanup, verify_on):
    cleanup.append("verify@test.dev")
    assert _signup(client, "verify@test.dev").status_code == 400  # 번호 없이 가입 불가
    code = client.post("/auth/signup/code", json={"email": "verify@test.dev"}).json()["dev_code"]
    r = client.post("/auth/signup", json={"email": "verify@test.dev", "code": code, "password": "abcd1234", **PROFILE})
    assert r.status_code == 201, r.text


def test_signup_rules(client, cleanup, db, verify_on):
    cleanup.append("rules@test.dev")
    assert client.post("/auth/signup/code", json={"email": "not-an-email"}).status_code == 422
    code = client.post("/auth/signup/code", json={"email": "rules@test.dev"}).json()["dev_code"]
    # 1분 안에 다시 요청 불가
    assert client.post("/auth/signup/code", json={"email": "rules@test.dev"}).status_code == 429
    weak = client.post("/auth/signup", json={"email": "rules@test.dev", "code": code, "password": "short", **PROFILE})
    assert weak.status_code == 422
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert client.post("/auth/signup", json={"email": "rules@test.dev", "code": wrong, "password": "abcd1234", **PROFILE}).status_code == 400
    # 5번 틀리면 맞는 번호도 막힘 (새 번호를 받아야 함)
    assert client.post("/auth/signup", json={"email": "rules@test.dev", "code": code, "password": "abcd1234", **PROFILE}).status_code == 429
    # 번호는 해시로만 저장
    assert all(code not in c.code_hash for c in db.query(EmailCode).filter(EmailCode.email == "rules@test.dev"))


def test_duplicate_email_and_lockout(client, cleanup, db):
    cleanup.append("dup@test.dev")
    assert _signup(client, "dup@test.dev").status_code == 201
    client.cookies.clear()
    assert client.post("/auth/signup/code", json={"email": "dup@test.dev"}).status_code == 409
    for _ in range(10):
        client.post("/auth/signin", json={"email": "dup@test.dev", "password": "nope12345"})
    r = client.post("/auth/signin", json={"email": "dup@test.dev", "password": "abcd1234"})
    assert r.status_code == 429  # 10번 틀리면 15분 잠금


def test_password_reset_logs_out_other_sessions(client, cleanup):
    cleanup.append("reset@test.dev")
    _signup(client, "reset@test.dev")
    old_cookie = client.cookies.get(SESSION_COOKIE)
    client.cookies.clear()
    # 가입 안 한 이메일도 똑같이 '보냈다'고 답함 (가입 여부 노출 X)
    assert client.post("/auth/password/code", json={"email": "nobody@test.dev"}).json()["sent"] is True
    code = client.post("/auth/password/code", json={"email": "reset@test.dev"}).json()["dev_code"]
    r = client.post("/auth/password/reset", json={"email": "reset@test.dev", "code": code, "password": "newpass99"})
    assert r.status_code == 200, r.text
    assert client.post("/auth/signin", json={"email": "reset@test.dev", "password": "newpass99"}).status_code == 200
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, old_cookie)
    assert client.get("/auth/session").status_code == 401  # 예전 세션은 끊김


def test_change_password_and_profile(client, cleanup):
    cleanup.append("prof@test.dev")
    _signup(client, "prof@test.dev")
    assert client.patch("/auth/profile", json={"name": "바뀐 이름"}).json()["name"] == "바뀐 이름"
    assert client.post("/auth/password", json={"current_password": "xxxx1111", "new_password": "next1234"}).status_code == 400
    assert client.post("/auth/password", json={"current_password": "abcd1234", "new_password": "next1234"}).status_code == 200
    assert client.get("/auth/session").status_code == 200  # 이 브라우저는 로그인 유지


def test_withdraw_deletes_everything(client, cleanup, db):
    cleanup.append("bye@test.dev")
    _signup(client, "bye@test.dev")
    user = db.query(User).filter(User.email == "bye@test.dev").one()
    acc = Account(ig_user_id="555000111", username="bye_ig", access_token_enc=encrypt("t"), user_id=user.id)
    db.add_all([acc, FacebookLink(user_id=user.id, fb_user_id="fb1", access_token_enc=encrypt("t"))])
    db.commit()
    acc_id = acc.id
    assert client.request("DELETE", "/auth/user", json={"password": "wrong999"}).status_code == 400
    r = client.request("DELETE", "/auth/user", json={"password": "abcd1234"})
    assert r.status_code == 200 and r.json()["confirmation_code"]
    db.expire_all()
    assert db.get(Account, acc_id) is None
    assert db.query(User).filter(User.email == "bye@test.dev").first() is None
    assert db.query(FacebookLink).filter(FacebookLink.fb_user_id == "fb1").first() is None


def test_legacy_instagram_session_moves_to_member(client, cleanup, db):
    """회원 기능 전에 인스타 로그인으로 쓰던 브라우저: 가입하면 그 계정이 회원으로 옮겨짐."""
    cleanup.append("legacy@test.dev")
    acc = Account(ig_user_id="777000222", username="legacy_ig", access_token_enc=encrypt("t"))
    db.add(acc)
    db.commit()
    try:
        client.cookies.set(SESSION_COOKIE, sign_session({"account_id": acc.id, "linked": [acc.id]}))
        assert client.get("/auth/session").status_code == 401  # 예전 세션만으로는 못 들어옴
        r = _signup(client, "legacy@test.dev")
        assert r.json()["account"]["username"] == "legacy_ig"
        assert client.get("/auth/me").json()["username"] == "legacy_ig"
    finally:
        db.expire_all()
        if db.get(Account, acc.id) is not None:
            db.delete(db.get(Account, acc.id))
            db.commit()


def test_switch_and_unlink_only_own_accounts(client, login, account, db):
    other = Account(ig_user_id="999000111222", username="other", access_token_enc=encrypt("t"))
    stranger = Account(ig_user_id="999000111333", username="stranger", access_token_enc=encrypt("t"))
    db.add_all([other, stranger])
    db.commit()
    ids = [other.id, stranger.id]
    try:
        login(account, linked=[other.id])
        names = [a["username"] for a in client.get("/auth/accounts").json()["data"]]
        assert names == [account.username, "other"]
        other_id, stranger_id = ids
        assert client.post("/auth/switch", json={"account_id": other_id}).status_code == 200
        assert client.get("/auth/me").json()["username"] == "other"
        assert client.post("/auth/switch", json={"account_id": stranger_id}).status_code == 403
        assert client.delete(f"/auth/accounts/{stranger_id}").status_code == 404
        assert client.delete(f"/auth/accounts/{other_id}").status_code == 200
        db.expire_all()
        assert db.get(Account, other_id) is None
        assert client.get("/auth/me").json()["username"] == account.username  # 남은 계정으로
    finally:
        db.expire_all()
        for i in ids:
            if db.get(Account, i) is not None:
                db.delete(db.get(Account, i))
        db.commit()


def test_link_requires_member(client):
    r = client.get("/auth/login", follow_redirects=False)
    assert r.status_code == 307 and "/login?next=/admin/profile" in r.headers["location"]


def test_link_with_session_or_ticket(client, login, account):
    login(account)
    r = client.get("/auth/login?switch=1&app=instaautostudio://auth", follow_redirects=False)
    assert "instagram.com/oauth/authorize" in r.headers["location"] and "force_authentication=1" in r.headers["location"]
    assert "iaw_app_redirect=" in r.headers["set-cookie"]
    ticket = client.post("/auth/link-ticket").json()["ticket"]
    client.cookies.clear()
    # 휴대폰 앱의 시스템 브라우저: 세션 쿠키 없이 티켓으로
    r = client.get(f"/auth/login?ticket={ticket}&app=https://evil.com", follow_redirects=False)
    assert "instagram.com/oauth/authorize" in r.headers["location"]
    assert "iaw_app_redirect=https" not in r.headers.get("set-cookie", "")
    assert "/login" in client.get("/auth/login?ticket=bogus", follow_redirects=False).headers["location"]


def test_facebook_link_needs_app_config(client, login, account):
    login(account)
    r = client.get("/auth/login?provider=facebook", follow_redirects=False)
    assert "/admin/profile?error=" in r.headers["location"]


def _callback(client, monkeypatch, provider, linked):
    """연동 시작 → (가짜) Meta 로그인 → 콜백."""
    monkeypatch.setattr(auth, "_link_instagram" if provider == "instagram" else "_link_facebook", lambda code: linked)
    monkeypatch.setattr(auth.settings, "meta_app_id", "m1")
    monkeypatch.setattr(auth.settings, "meta_app_secret", "s1")
    r = client.get(f"/auth/login?provider={provider}", follow_redirects=False)
    state = r.headers["location"].split("state=")[1].split("&")[0]
    return client.get(f"/auth/callback?code=c&state={state}", follow_redirects=False)


def test_instagram_link_and_taken_account(client, login, account, db, monkeypatch):
    monkeypatch.setattr(auth.GraphClient, "subscribe_webhooks", lambda self, *a: {})
    login(account)
    ig = {"id": "424242", "username": "linked_ig", "name": "L"}
    r = _callback(client, monkeypatch, "instagram", auth._IgLinked(ig=ig, token="tok", expires_at=None, granted="a,b"))
    assert r.headers["location"].endswith("/admin/profile?connected=instagram")
    linked = db.query(Account).filter(Account.ig_user_id == "424242").one()
    assert linked.user_id == db.get(Account, account.id).user_id and linked.provider == "instagram"
    assert client.get("/auth/me").json()["username"] == "linked_ig"  # 방금 연동한 계정으로 전환

    # 다른 회원이 같은 인스타 계정을 연동하려 하면 거절
    other_user = User(email="other@test.dev", password_hash="x")
    db.add(other_user)
    db.commit()
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, sign_session({"uid": other_user.id, "sv": 1, "account_id": None}))
    r = _callback(client, monkeypatch, "instagram", auth._IgLinked(ig=ig, token="tok2", expires_at=None, granted=""))
    assert "error=" in r.headers["location"]
    db.delete(linked)
    db.delete(other_user)
    db.commit()


def test_facebook_link_adds_pages_and_unlink(client, login, account, db, monkeypatch):
    login(account)
    acc = db.get(Account, account.id)
    pages = [
        {"id": "p1", "name": "내 가게", "access_token": "page-1", "instagram_business_account": {"id": acc.ig_user_id, "username": acc.username}},
        {"id": "p2", "name": "두 번째", "access_token": "page-2", "instagram_business_account": {"id": "838383", "username": "fb_only"}},
    ]
    r = _callback(client, monkeypatch, "facebook", auth._FbLinked(fb_user_id="fbu", name="Kim", token="ut", expires_at=None, granted="x", pages=pages))
    assert "connected=facebook" in r.headers["location"]
    s = client.get("/auth/session").json()
    assert s["facebook"]["name"] == "Kim" and [p["name"] for p in s["facebook"]["pages"]] == ["내 가게", "두 번째"]
    db.expire_all()
    same = db.get(Account, account.id)
    assert same.provider == "instagram" and same.fb_page_id == "p1" and same.fb_page_token_enc  # 인스타 연동은 그대로, 페이지 토큰만 더함
    fb_only = db.query(Account).filter(Account.ig_user_id == "838383").one()
    assert fb_only.provider == "facebook" and fb_only.user_id == same.user_id

    r = client.delete("/auth/facebook")
    assert r.json()["removed"] == ["fb_only"]
    db.expire_all()
    assert db.query(Account).filter(Account.ig_user_id == "838383").first() is None
    assert db.get(Account, account.id).fb_page_id == ""
    assert client.get("/auth/session").json()["facebook"] is None


def test_callback_shows_facebook_error_message(client):
    msg = "Can't load URL: The domain of this URL isn't included in the app's domains."
    r = client.get("/auth/callback", params={"error_code": "1349048", "error_message": msg}, follow_redirects=False)
    assert "error=Can%27t+load+URL" in r.headers["location"]


def test_app_session_exchanges_code(client, login, account, db):
    login(account)
    user = db.get(User, db.get(Account, account.id).user_id)
    code = auth._app_signer().dumps({"uid": user.id, "sv": user.session_version, "account_id": account.id, "connected": "instagram"})
    client.cookies.clear()
    r = client.get(f"/auth/app-session?code={code}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/admin/profile?connected=instagram"
    assert load_session(r.cookies.get(SESSION_COOKIE) or client.cookies.get(SESSION_COOKIE))["uid"] == user.id


def test_app_session_rejects_bad_code(client):
    r = client.get("/auth/app-session?code=bogus", follow_redirects=False)
    assert "error=" in r.headers["location"]


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("instaautostudio://auth", True),
        ("exp://192.168.0.5:8081/--/auth", True),  # 같은 와이파이의 Expo Go
        ("exp://evil.exp.direct/--/auth", False),
        ("exp://8.8.8.8/--/auth", False),
        ("https://evil.com", False),
    ],
)
def test_allowed_app_redirect(url, ok):
    assert auth._allowed_app_redirect(url) is ok


def test_dev_login_is_off_unless_enabled(client):
    assert client.get("/auth/dev-login", follow_redirects=False).status_code == 404
