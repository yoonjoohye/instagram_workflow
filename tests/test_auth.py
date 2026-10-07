"""로그인·세션: 앱 로그인 코드 교환, 계정 전환, 로컬 테스트 로그인 차단."""
import pytest

from backend.routers import auth


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


def test_login_remembers_only_allowed_app_redirect(client):
    r = client.get("/auth/login?app=instaautostudio://auth", follow_redirects=False)
    assert "iaw_app_redirect=" in r.headers["set-cookie"]
    r = client.get("/auth/login?app=https://evil.com", follow_redirects=False)
    assert "iaw_app_redirect=https" not in r.headers.get("set-cookie", "")


def test_switch_login_forces_instagram_login_screen(client):
    r = client.get("/auth/login?switch=1", follow_redirects=False)
    assert "force_authentication=1" in r.headers["location"]


def test_app_session_exchanges_code(client, account):
    code = auth._app_signer().dumps({"account_id": account.id})
    r = client.get(f"/auth/app-session?code={code}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/admin?connected=1"
    assert "iaw_session=" in r.headers["set-cookie"]


def test_app_session_rejects_bad_code(client):
    r = client.get("/auth/app-session?code=bogus", follow_redirects=False)
    assert "error=" in r.headers["location"]


def test_switch_only_to_linked_accounts(client, login, account, db):
    from backend.models import Account
    from backend.security import encrypt

    other = Account(ig_user_id="999000111222", username="other", name="", access_token_enc=encrypt("t"), profile_picture_url="")
    stranger = Account(ig_user_id="999000111333", username="stranger", name="", access_token_enc=encrypt("t"), profile_picture_url="")
    db.add_all([other, stranger])
    db.commit()
    try:
        login(account, linked=[account.id, other.id])
        names = [a["username"] for a in client.get("/auth/accounts").json()["data"]]
        assert names == [account.username, "other"]
        assert client.post("/auth/switch", json={"account_id": other.id}).status_code == 200
        assert client.post("/auth/switch", json={"account_id": stranger.id}).status_code == 403
    finally:
        for a in (other, stranger):
            db.delete(db.get(Account, a.id))
        db.commit()


def test_dev_login_is_off_unless_enabled(client):
    assert client.get("/auth/dev-login", follow_redirects=False).status_code == 404
