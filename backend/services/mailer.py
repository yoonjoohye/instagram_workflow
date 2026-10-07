"""이메일 발송 (Resend HTTP API — https://resend.com/docs/api-reference/emails/send-email).

RESEND_API_KEY 가 없으면: 로컬에서는 보내지 않고 서버 로그에 남기며 dev_code 로 화면에도 보여 주고,
배포 환경(Vercel)에서는 오류로 알립니다 (인증번호가 화면에 노출되면 안 되므로).
"""
from __future__ import annotations

import html
import logging
import os

import httpx

from ..config import settings

log = logging.getLogger("iaw.mail")

RESEND_URL = "https://api.resend.com/emails"


class MailError(RuntimeError):
    pass


def can_show_code_locally() -> bool:
    return not settings.resend_api_key and not os.environ.get("VERCEL")


_SUBJECT = {
    "signup": {"ko": "[Auto Studio] 회원가입 인증번호", "en": "[Auto Studio] Your sign-up code", "ja": "[Auto Studio] 会員登録の認証番号"},
    "reset": {"ko": "[Auto Studio] 비밀번호 재설정 인증번호", "en": "[Auto Studio] Your password reset code", "ja": "[Auto Studio] パスワード再設定の認証番号"},
}
_BODY = {
    "signup": {
        "ko": "Auto Studio 회원가입 화면에 아래 인증번호를 입력해 주세요.",
        "en": "Enter this code on the Auto Studio sign-up screen.",
        "ja": "Auto Studio の会員登録画面に次の認証番号を入力してください。",
    },
    "reset": {
        "ko": "비밀번호 재설정 화면에 아래 인증번호를 입력해 주세요.",
        "en": "Enter this code on the password reset screen.",
        "ja": "パスワード再設定画面に次の認証番号を入力してください。",
    },
}
_FOOT = {
    "ko": "번호는 10분 동안 유효합니다. 요청하지 않았다면 이 메일은 무시해 주세요.",
    "en": "The code is valid for 10 minutes. If you didn't request it, you can ignore this email.",
    "ja": "番号の有効期限は10分です。心当たりがない場合はこのメールを無視してください。",
}


def send_code(email: str, code: str, purpose: str, lang: str = "ko") -> None:
    """인증번호 메일. 실패하면 MailError."""
    lang = lang if lang in ("ko", "en", "ja") else "en"
    subject, body, foot = _SUBJECT[purpose][lang], _BODY[purpose][lang], _FOOT[lang]
    if not settings.resend_api_key:
        if can_show_code_locally():
            log.warning("RESEND_API_KEY 없음 — 메일 대신 로그: %s %s 인증번호 %s", email, purpose, code)
            return
        raise MailError("메일 발송이 설정되지 않았습니다. 관리자에게 문의해 주세요.")
    page = (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#111">'
        f'<p style="font-size:15px;margin:0 0 16px">{html.escape(body)}</p>'
        f'<p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 16px">{code}</p>'
        f'<p style="font-size:13px;color:#666;margin:0">{html.escape(foot)}</p></div>'
    )
    try:
        resp = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.mail_from, "to": [email], "subject": subject, "html": page, "text": f"{body}\n\n{code}\n\n{foot}"},
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise MailError("메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.") from exc
    if resp.status_code >= 400:
        log.warning("Resend 발송 실패 %s: %s", resp.status_code, resp.text[:300])
        raise MailError("메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.")
