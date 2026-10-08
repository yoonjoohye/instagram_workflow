"use client";

/** 회원 화면: 로그인 · 회원가입(이메일 인증번호) · 비밀번호 재설정. 가운데 카드 하나로 단순하게. */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DevLoginLink } from "@/components/AdminShell";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { Button, cx, inputClass, Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { api, toApiError, useApi } from "@/lib/api";
import type { Health, Session } from "@/lib/types";

/** 로그인 후 돌아갈 곳 (우리 사이트 안의 주소만) */
function useNext(fallback = "/admin") {
  const next = useSearchParams().get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

/** 계정이 이미 있으면(예전 인스타 로그인에서 옮겨 온 경우) 가려던 곳, 없으면 'Instagram 연동하기' 한 버튼 화면부터 */
const landing = (s: Session, next: string) => (s.account ? next : "/admin");

function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold">
          <Logo size={28} /> Auto Studio
        </Link>
        <div className="rounded-2xl border border-line bg-surface-1 p-6 sm:p-7">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-[13px] text-fg-3">{footer}</div>}
        <div className="mt-6 flex justify-center">
          <LanguageSwitcher className="text-[13px]" />
        </div>
      </div>
    </main>
  );
}

function Input({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      <input {...props} className={cx(inputClass, "h-10", props.className)} />
      {hint && <span className="mt-1 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );
}

/** 인증번호 다시 받기까지 남은 초 */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return [left, setLeft] as const;
}

type CodeSent = { sent: boolean; dev_code?: string };

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const next = useNext();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(params.get("error") ?? undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const s = await api<Session>("/auth/signin", { method: "POST", json: { email, password } });
      router.replace(landing(s, next));
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  const keepNext = next !== "/admin" ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <AuthCard
      title={t("auth.loginTitle")}
      subtitle={t("auth.loginSubtitle")}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <Link href={`/signup${keepNext}`} className="font-medium text-fg hover:underline">
            {t("auth.toSignup")}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Input label={t("auth.email")} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t("auth.password")} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" variant="primary" loading={busy} className="h-11 w-full">
          {t("auth.loginButton")}
        </Button>
        <div className="flex justify-end">
          <Link href="/reset-password" className="text-[12px] text-fg-3 hover:text-fg hover:underline">
            {t("auth.forgot")}
          </Link>
        </div>
        <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-fg-3">{t("auth.legacyNote")}</p>
        <DevLoginLink />
      </form>
    </AuthCard>
  );
}

/** 회원가입·재설정 공통: 1) 이메일 → 인증번호 받기 2) 번호 + 비밀번호 */
function CodeFlow({
  purpose,
  title,
  subtitle,
  footer,
  submitLabel,
  extra,
  onSubmit,
}: {
  purpose: "signup" | "reset";
  title: string;
  subtitle: string;
  footer: ReactNode;
  submitLabel: string;
  extra?: ReactNode;
  onSubmit: (v: { email: string; code: string; password: string }) => Promise<void>;
}) {
  const t = useT();
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [devCode, setDevCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [left, setLeft] = useCountdown();

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<CodeSent>(purpose === "signup" ? "/auth/signup/code" : "/auth/password/code", { method: "POST", json: { email } });
      setDevCode(r.dev_code);
      setStep("verify");
      setLeft(60);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t("auth.passwordMismatch"));
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit({ email, code, password });
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title={title} subtitle={subtitle} footer={footer}>
      {step === "email" ? (
        <form onSubmit={send} className="space-y-3">
          <Input label={t("auth.email")} type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <Notice tone="bad">{error}</Notice>}
          <Button type="submit" variant="primary" loading={busy} className="h-11 w-full">
            {t("auth.sendCode")}
          </Button>
        </form>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-fg-2">
            {purpose === "signup" ? t("auth.codeSent", { email }) : t("auth.resetSent")}
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
              <button type="button" onClick={() => send()} disabled={left > 0 || busy} className="font-medium text-fg hover:underline disabled:text-fg-3 disabled:no-underline">
                {left > 0 ? t("auth.resendIn", { s: left }) : t("auth.resendCode")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(undefined);
                }}
                className="text-fg-3 hover:text-fg hover:underline"
              >
                {t("auth.changeEmail")}
              </button>
            </div>
          </div>
          {devCode && <Notice tone="warn">{t("auth.devCode", { code: devCode })}</Notice>}
          <Input
            label={t("auth.code")}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="tnum tracking-[0.3em]"
          />
          {extra}
          <Input
            label={purpose === "signup" ? t("auth.password") : t("auth.newPassword")}
            hint={t("auth.passwordHint")}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input label={t("auth.passwordConfirm")} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {error && <Notice tone="bad">{error}</Notice>}
          <Button type="submit" variant="primary" loading={busy} className="h-11 w-full">
            {submitLabel}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function SignupForm() {
  const t = useT();
  const router = useRouter();
  const next = useNext();
  const keepNext = next !== "/admin" ? `?next=${encodeURIComponent(next)}` : "";
  const footer = (
    <div className="space-y-2">
      <p className="text-[12px]">{rich(t("auth.agree"), { privacy: (c) => <Link href="/privacy" className="underline">{c}</Link> })}</p>
      <p>
        {t("auth.haveAccount")}{" "}
        <Link href={`/login${keepNext}`} className="font-medium text-fg hover:underline">
          {t("auth.toLogin")}
        </Link>
      </p>
    </div>
  );
  return <SimpleSignup footer={footer} onDone={(s) => router.replace(landing(s, next))} />;
}

/** 회원가입: 이름 · 생년월일 · 전화번호 · 이메일(입력하는 대로 중복 확인) · 비밀번호.
 *  서버에서 이메일 인증을 켜면(SIGNUP_EMAIL_VERIFY) 이메일 옆 '인증번호 받기' → 번호 입력이 함께 나옵니다. */
function SimpleSignup({ footer, onDone }: { footer: ReactNode; onDone: (s: Session) => void }) {
  const t = useT();
  const verify = Boolean(useApi<Health>("/health").data?.signup_email_verify);
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string>();
  const [devCode, setDevCode] = useState<string>();
  const [sending, setSending] = useState(false);
  const [left, setLeft] = useCountdown();
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [taken, setTaken] = useState<{ email: string; available: boolean } | null>(null);

  // 입력이 멈추면 중복 확인 (0.4초)
  useEffect(() => {
    setTaken(null);
    const value = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value)) return;
    const id = setTimeout(() => {
      api<{ email: string; available: boolean }>("/auth/signup/check", { method: "POST", json: { email: value } })
        .then((r) => setTaken({ email: value, available: r.available }))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [email]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t("auth.passwordMismatch"));
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api<Session>("/auth/signup", { method: "POST", json: { email, password, name, birth_date: birth, phone, code } }));
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  async function sendCode() {
    setSending(true);
    setError(undefined);
    try {
      const r = await api<CodeSent>("/auth/signup/code", { method: "POST", json: { email } });
      setSentTo(email.trim().toLowerCase());
      setDevCode(r.dev_code);
      setLeft(60);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSending(false);
    }
  }

  const hint = taken && taken.email === email.trim() ? (taken.available ? t("auth.emailAvailable") : t("auth.emailTaken")) : undefined;
  const codeReady = !verify || (sentTo === email.trim().toLowerCase() && code.length === 6);
  return (
    <AuthCard title={t("auth.signupTitle")} subtitle={t("auth.signupSubtitle")} footer={footer}>
      <form onSubmit={submit} className="space-y-3">
        <Input label={t("auth.name")} autoComplete="name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Input label={t("auth.birthDate")} type="date" autoComplete="bday" required max={new Date().toISOString().slice(0, 10)} value={birth} onChange={(e) => setBirth(e.target.value)} />
        <Input
          label={t("auth.phone")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder={t("auth.phonePh")}
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("auth.email")}</span>
          <div className="flex gap-2">
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={taken?.available === false || undefined}
              className={cx(inputClass, "h-10 min-w-0 flex-1", taken?.available === false && "border-bad")}
            />
            {verify && (
              <Button
                type="button"
                onClick={sendCode}
                loading={sending}
                disabled={!taken?.available || taken.email !== email.trim() || left > 0}
                className="h-10 shrink-0"
              >
                {left > 0 ? t("auth.resendIn", { s: left }) : sentTo ? t("auth.resendCode") : t("auth.sendCode")}
              </Button>
            )}
          </div>
          {hint && <span className={cx("mt-1 block text-[12px]", taken?.available ? "text-good" : "text-bad")}>{hint}</span>}
        </label>
        {verify && sentTo && (
          <div className="space-y-2">
            <p className="text-[12px] text-fg-3">{t("auth.codeSent", { email: sentTo })}</p>
            {devCode && <Notice tone="warn">{t("auth.devCode", { code: devCode })}</Notice>}
            <Input
              label={t("auth.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="tnum tracking-[0.3em]"
            />
          </div>
        )}
        <Input
          label={t("auth.password")}
          hint={t("auth.passwordHint")}
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input label={t("auth.passwordConfirm")} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <Notice tone="bad">{error}</Notice>}
        <Button type="submit" variant="primary" loading={busy} disabled={taken?.available === false || !codeReady} className="h-11 w-full">
          {t("auth.signupButton")}
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetForm() {
  const t = useT();
  const router = useRouter();
  return (
    <CodeFlow
      purpose="reset"
      title={t("auth.resetTitle")}
      subtitle={t("auth.resetSubtitle")}
      submitLabel={t("auth.resetButton")}
      footer={
        <Link href="/login" className="font-medium text-fg hover:underline">
          ← {t("auth.toLogin")}
        </Link>
      }
      onSubmit={async ({ email, code, password }) => {
        const s = await api<Session>("/auth/password/reset", { method: "POST", json: { email, code, password } });
        router.replace(landing(s, "/admin"));
      }}
    />
  );
}
