"use client";

/** 프로필 (한 줄): 회원 정보(→ 비밀번호 변경 페이지) · 계정 연동(Instagram 여러 개, Facebook 하나) · 회원 탈퇴 */

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/components/AdminShell";
import { EmailVerify, VerifiedBadge } from "@/components/auth/EmailVerify";
import { IconFacebook, IconInstagram } from "@/components/icons";
import { Avatar, Badge, Button, Card, cx, Dialog, inputClass, Notice, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, startLink, toApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { LinkedAccount } from "@/lib/types";

export default function ProfilePage() {
  const t = useT();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t("auth.profileTitle")} description={t("auth.profileSubtitle")} />
      <MemberInfo />
      <LinkedAccounts />
      <WithdrawCard />
    </div>
  );
}

function Msg({ ok, text }: { ok?: boolean; text?: string }) {
  if (!text) return null;
  return <p className={cx("text-[12px]", ok ? "text-good" : "text-bad")}>{text}</p>;
}

/** 전화번호 보기 좋게 (010-1234-5678) */
const showPhone = (p: string) => (/^01\d{8,9}$/.test(p) ? p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : p);

function MemberInfo() {
  const t = useT();
  const { session, refresh } = useSession();
  const u = session.user;
  const [name, setName] = useState(u.name);
  const [birth, setBirth] = useState(u.birth_date ?? "");
  const [phone, setPhone] = useState(showPhone(u.phone));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  useEffect(() => {
    setName(u.name);
    setBirth(u.birth_date ?? "");
    setPhone(showPhone(u.phone));
  }, [u.name, u.birth_date, u.phone]);
  const dirty = name !== u.name || birth !== (u.birth_date ?? "") || phone !== showPhone(u.phone);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      await api("/auth/profile", { method: "PATCH", json: { name, ...(birth ? { birth_date: birth } : {}), ...(phone ? { phone } : {}) } });
      setMsg({ ok: true, text: t("auth.saved") });
      refresh();
    } catch (err) {
      setMsg({ ok: false, text: toApiError(err).message });
    } finally {
      setBusy(false);
    }
  }

  const input = (label: string, el: React.ReactNode) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg-2">{label}</span>
      {el}
    </label>
  );

  return (
    <Card
      title={t("auth.memberInfo")}
      subtitle={t("auth.joined", { date: fmtDateTime(u.created_at) })}
      action={
        <Link href="/admin/profile/password" className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2">
          {t("auth.changePassword")} →
        </Link>
      }
    >
      <form onSubmit={save} className="space-y-3">
        <div>
          <p className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-fg-2">
            {t("auth.email")} <VerifiedBadge verified={u.email_verified} />
          </p>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">{u.email}</p>
          {!u.email_verified && (
            <div className="mt-2">
              <EmailVerify email={u.email} onVerified={refresh} autoOpen={u.verify_required} />
            </div>
          )}
        </div>
        {input(t("auth.name"), <input value={name} required maxLength={80} onChange={(e) => setName(e.target.value)} className={cx(inputClass, "h-10")} autoComplete="name" />)}
        {input(
          t("auth.birthDate"),
          <input type="date" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} className={cx(inputClass, "h-10")} autoComplete="bday" />,
        )}
        {input(
          t("auth.phone"),
          <input type="tel" inputMode="tel" value={phone} maxLength={20} placeholder={t("auth.phonePh")} onChange={(e) => setPhone(e.target.value)} className={cx(inputClass, "h-10")} autoComplete="tel" />,
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={busy} disabled={!dirty}>
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
