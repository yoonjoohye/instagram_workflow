"use client";

/** 비밀번호 변경 (프로필 → 회원 정보에서 들어옴). 바꾸면 다른 기기는 로그아웃되고 이 브라우저는 로그인 유지. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, cx, inputClass, Notice, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";

export default function PasswordPage() {
  const t = useT();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError(t("auth.passwordMismatch"));
    setBusy(true);
    setError(undefined);
    try {
      await api("/auth/password", { method: "POST", json: { current_password: current, new_password: next } });
      setDone(true);
      setTimeout(() => router.push("/admin/profile"), 1500);
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, auto: string, hint?: string, autoFocus?: boolean) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      <input
        type="password"
        required
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => set(e.target.value)}
        autoComplete={auto}
        className={cx(inputClass, "h-10")}
      />
      {hint && <span className="mt-1 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/admin/profile" className="inline-block text-[13px] text-fg-3 hover:text-fg">
        ← {t("auth.profile")}
      </Link>
      <PageHeader title={t("auth.changePassword")} description={t("auth.passwordPageHint")} />
      <Card>
        {done ? (
          <Notice tone="good">{t("auth.passwordChanged")}</Notice>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {field(t("auth.currentPassword"), current, setCurrent, "current-password", undefined, true)}
            {field(t("auth.newPassword"), next, setNext, "new-password", t("auth.passwordHint"))}
            {field(t("auth.passwordConfirm"), confirm, setConfirm, "new-password")}
            {error && <Notice tone="bad">{error}</Notice>}
            <div className="flex items-center justify-between gap-3 pt-1">
              <Link href="/reset-password" className="text-[12px] text-fg-3 hover:text-fg hover:underline">
                {t("auth.forgot")}
              </Link>
              <Button type="submit" variant="primary" loading={busy}>
                {t("auth.changePassword")}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
