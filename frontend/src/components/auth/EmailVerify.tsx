"use client";

/** 가입한 이메일 인증: [인증번호 받기] → 6자리 입력 → 인증. 프로필의 회원 정보와 '인증이 필요해요' 화면에서 같이 씁니다. */

import { useEffect, useState } from "react";
import { Badge, Button, cx, inputClass, Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const t = useT();
  return verified ? <Badge tone="good">✓ {t("auth.verified")}</Badge> : <Badge tone="warn">{t("auth.unverified")}</Badge>;
}

export function EmailVerify({ email, onVerified, autoOpen = false }: { email: string; onVerified: () => void; autoOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(autoOpen);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState<"send" | "verify">();
  const [error, setError] = useState<string>();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  async function send() {
    setBusy("send");
    setError(undefined);
    try {
      const r = await api<{ dev_code?: string }>("/auth/email/code", { method: "POST" });
      setSent(true);
      setDevCode(r.dev_code);
      setLeft(60);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function verify() {
    setBusy("verify");
    setError(undefined);
    try {
      await api("/auth/email/verify", { method: "POST", json: { code } });
      onVerified();
    } catch (e) {
      setError(toApiError(e).message);
      setBusy(undefined);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("auth.verifyNow")}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-[12px] text-fg-2">{sent ? t("auth.codeSent", { email }) : t("auth.verifyIntro", { email })}</p>
      {devCode && <Notice tone="warn">{t("auth.devCode", { code: devCode })}</Notice>}
      <div className="flex flex-wrap gap-2">
        {sent && (
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder={t("auth.code")}
            aria-label={t("auth.code")}
            className={cx(inputClass, "tnum h-9 w-36 tracking-[0.3em]")}
          />
        )}
        {sent && (
          <Button size="sm" variant="primary" loading={busy === "verify"} disabled={code.length !== 6 || !!busy} onClick={verify}>
            {t("auth.verifyConfirm")}
          </Button>
        )}
        <Button size="sm" loading={busy === "send"} disabled={left > 0 || !!busy} onClick={send}>
          {left > 0 ? t("auth.resendIn", { s: left }) : sent ? t("auth.resendCode") : t("auth.sendCode")}
        </Button>
      </div>
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}
