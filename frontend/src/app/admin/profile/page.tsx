"use client";

/** 프로필: 회원 정보 · 연동한 계정(Instagram 여러 개, Facebook 하나) · 비밀번호 변경 · 회원 탈퇴 */

import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/components/AdminShell";
import { IconFacebook, IconInstagram } from "@/components/icons";
import { Avatar, Badge, Button, Card, cx, Dialog, inputClass, Notice, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, startLink, toApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { LinkedAccount } from "@/lib/types";

export default function ProfilePage() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t("auth.profileTitle")} description={t("auth.profileSubtitle")} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <LinkedAccounts />
        </div>
        <div className="min-w-0 space-y-6">
          <MemberInfo />
          <PasswordCard />
          <WithdrawCard />
        </div>
      </div>
    </div>
  );
}

function Msg({ ok, text }: { ok?: boolean; text?: string }) {
  if (!text) return null;
  return <p className={cx("text-[12px]", ok ? "text-good" : "text-bad")}>{text}</p>;
}

function MemberInfo() {
  const t = useT();
  const { session, refresh } = useSession();
  const [name, setName] = useState(session.user.name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  useEffect(() => setName(session.user.name), [session.user.name]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      await api("/auth/profile", { method: "PATCH", json: { name } });
      setMsg({ ok: true, text: t("auth.saved") });
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: toApiError(err).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("auth.memberInfo")} subtitle={t("auth.joined", { date: fmtDateTime(session.user.created_at) })}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-fg-2">{t("auth.email")}</p>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">{session.user.email}</p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{t("auth.name")}</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={cx(inputClass, "h-10")} autoComplete="name" />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={busy} disabled={name === session.user.name}>
            {t("auth.save")}
          </Button>
          <Msg {...msg} />
        </div>
      </form>
    </Card>
  );
}

function LinkedAccounts() {
  const t = useT();
  const { session, refresh } = useSession();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const fb = session.facebook;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(undefined);
    }
  }

  const link = (provider: "instagram" | "facebook", opts?: { switch?: boolean }) => run(`link-${provider}`, () => startLink(provider, opts));

  async function unlinkInstagram(a: LinkedAccount) {
    if (!window.confirm(t("auth.unlinkIgConfirm", { username: a.username }))) return;
    await run(`unlink-${a.id}`, async () => {
      await api(`/auth/accounts/${a.id}`, { method: "DELETE" });
      window.location.reload(); // 지금 쓰던 계정이 빠졌을 수 있어 모든 화면을 새로
    });
  }

  async function unlinkFacebook() {
    if (!window.confirm(t("auth.unlinkFbConfirm"))) return;
    await run("unlink-fb", async () => {
      await api("/auth/facebook", { method: "DELETE" });
      window.location.reload();
    });
  }

  async function use(a: LinkedAccount) {
    await run(`use-${a.id}`, async () => {
      await api("/auth/switch", { method: "POST", json: { account_id: a.id } });
      refresh();
      setBusy(undefined);
    });
  }

  return (
    <Card title={t("auth.linkedAccounts")}>
      <div className="space-y-6">
        {/* Instagram */}
        <section>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-2">
              <IconInstagram width={20} height={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold">Instagram</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-fg-3">{t("auth.igDesc")}</p>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {session.accounts.length === 0 && <li className="px-3 py-3 text-[13px] text-fg-3">{t("auth.noInstagram")}</li>}
            {session.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Avatar src={a.profile_picture_url} name={a.username} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">@{a.username}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {a.current && <Badge tone="good">{t("auth.current")}</Badge>}
                    {a.provider === "facebook" ? (
                      <Badge>{t("auth.viaFacebook")}</Badge>
                    ) : (
                      a.facebook_linked && <Badge>{t("auth.fbAlso", { name: a.fb_page_name })}</Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {!a.current && (
                    <Button size="sm" variant="ghost" loading={busy === `use-${a.id}`} disabled={!!busy} onClick={() => use(a)}>
                      {t("auth.useThis")}
                    </Button>
                  )}
                  <Button size="sm" variant="danger" loading={busy === `unlink-${a.id}`} disabled={!!busy} onClick={() => unlinkInstagram(a)}>
                    {t("auth.unlink")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            {session.can_link.instagram ? (
              <Button
                variant={session.accounts.length ? "secondary" : "primary"}
                loading={busy === "link-instagram"}
                disabled={!!busy}
                onClick={() => link("instagram", { switch: session.accounts.length > 0 })}
              >
                <IconInstagram width={16} height={16} />
                {session.accounts.length ? t("auth.connectAnotherInstagram") : t("auth.connectInstagram")}
              </Button>
            ) : (
              <Badge>{t("auth.notReady")}</Badge>
            )}
          </div>
        </section>

        {/* Facebook */}
        <section className="border-t border-line pt-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-2">
              <IconFacebook width={20} height={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold">Facebook</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-fg-3">{t("auth.fbDesc")}</p>
            </div>
          </div>
          {fb ? (
            <div className="mt-3 rounded-lg border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{fb.name}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {session.can_link.facebook && (
                    <Button size="sm" variant="ghost" loading={busy === "link-facebook"} disabled={!!busy} onClick={() => link("facebook", { switch: true })}>
                      {t("auth.reconnect")}
                    </Button>
                  )}
                  <Button size="sm" variant="danger" loading={busy === "unlink-fb"} disabled={!!busy} onClick={unlinkFacebook}>
                    {t("auth.unlink")}
                  </Button>
                </div>
              </div>
              {fb.pages.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[12px] text-fg-3">
                  {fb.pages.map((p) => (
                    <li key={p.id}>{p.ig_username ? t("auth.fbPageItem", { page: p.name, ig: p.ig_username }) : t("auth.fbPageNoIg", { page: p.name })}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-3">
              {session.can_link.facebook ? (
                <Button loading={busy === "link-facebook"} disabled={!!busy} onClick={() => link("facebook")}>
                  <IconFacebook width={16} height={16} />
                  {t("auth.connectFacebook")}
                </Button>
              ) : (
                <Badge>{t("auth.notReady")}</Badge>
              )}
            </div>
          )}
        </section>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: t("auth.passwordMismatch") });
    setBusy(true);
    setMsg(undefined);
    try {
      await api("/auth/password", { method: "POST", json: { current_password: current, new_password: next } });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ ok: true, text: t("auth.passwordChanged") });
    } catch (err) {
      setMsg({ ok: false, text: toApiError(err).message });
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, auto: string, hint?: string) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      <input type="password" required value={value} onChange={(e) => set(e.target.value)} autoComplete={auto} className={cx(inputClass, "h-10")} />
      {hint && <span className="mt-1 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );

  return (
    <Card title={t("auth.changePassword")}>
      <form onSubmit={submit} className="space-y-3">
        {field(t("auth.currentPassword"), current, setCurrent, "current-password")}
        {field(t("auth.newPassword"), next, setNext, "new-password", t("auth.passwordHint"))}
        {field(t("auth.passwordConfirm"), confirm, setConfirm, "new-password")}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={busy}>
            {t("auth.changePassword")}
          </Button>
        </div>
        <Msg {...msg} />
      </form>
    </Card>
  );
}

function WithdrawCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function withdraw(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ confirmation_code: string }>("/auth/user", { method: "DELETE", json: { password } });
      window.location.href = `/data-deletion?code=${r.confirmation_code}`;
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  return (
    <Card title={t("auth.withdraw")}>
      <p className="text-[13px] leading-relaxed text-fg-3">{t("auth.withdrawDesc")}</p>
      <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        {t("auth.withdrawButton")}
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} title={t("auth.withdrawConfirmTitle")} subtitle={t("auth.withdrawDesc")}>
        <form onSubmit={withdraw} className="space-y-3">
          <input
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.withdrawPasswordPh")}
            autoComplete="current-password"
            className={cx(inputClass, "h-10")}
          />
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!password}>
              {t("auth.withdrawFinal")}
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
