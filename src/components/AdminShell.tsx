"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useState, type ReactNode } from "react";
import { api, LOGIN_URL, useApi } from "@/lib/api";
import { fmtCompact } from "@/lib/format";
import type { Me } from "@/lib/types";
import { IconChart, IconGrid, IconInbox, IconInstagram, IconLogout, IconReply, IconSpark } from "./icons";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/i18n/client";
import { Avatar, cx, Dialog, Notice, Spinner } from "./ui";

const MeContext = createContext<{ me: Me; refreshMe: () => void } | null>(null);

export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe 는 AdminShell 안에서만 쓸 수 있습니다.");
  return ctx;
}

const NAV = [
  { href: "/admin", label: "shell.dashboard", short: "shell.dashboardShort", icon: IconChart },
  { href: "/admin/studio", label: "shell.studio", short: "shell.studioShort", icon: IconSpark },
  { href: "/admin/jobs", label: "shell.jobs", short: "shell.jobsShort", icon: IconInbox },
  { href: "/admin/posts", label: "shell.posts", short: "shell.postsShort", icon: IconGrid },
  { href: "/admin/autoreply", label: "shell.autoreply", short: "shell.autoreplyShort", icon: IconReply },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useT();
  const me = useApi<Me>("/auth/me");

  if (me.loading && !me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-fg-3">
        <Spinner /> {t("shell.loadingAccount")}
      </div>
    );
  }

  if (!me.data) {
    return (
      <LoginGate message={me.error && me.error.status !== 401 ? me.error.message : undefined} />
    );
  }

  return (
    <MeContext.Provider value={{ me: me.data, refreshMe: me.reload }}>
      <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
        <Sidebar me={me.data} />
        {/* 휴대폰: 하단 탭바(약 64px + safe-area)에 가리지 않게 아래 여백 */}
        <main className="min-w-0 px-4 pt-5 pb-[calc(88px+env(safe-area-inset-bottom))] sm:px-8 sm:py-8 md:pb-8">
          <div className="mx-auto max-w-6xl">
            <Suspense fallback={null}>
              <OAuthResultBanner />
            </Suspense>
            {children}
          </div>
        </main>
      </div>
    </MeContext.Provider>
  );
}

function Sidebar({ me }: { me: Me }) {
  const t = useT();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function deleteAccount() {
    if (
      !window.confirm(t("shell.deleteConfirm", { username: me.username }))
    )
      return;
    setLoggingOut(true);
    try {
      const r = await api<{ confirmation_code: string }>("/auth/account", { method: "DELETE" });
      window.location.href = `/data-deletion?code=${r.confirmation_code}`;
    } catch (e) {
      setLoggingOut(false);
      window.alert(e instanceof Error ? e.message : t("shell.deleteFailed"));
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  const isActive = (href: string) => (href === "/admin" ? pathname === href : pathname.startsWith(href));
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <>
    {/* 휴대폰: 상단 바 (로고 + 계정 메뉴) */}
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface-1/95 px-4 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <Link href="/admin" className="flex h-14 items-center gap-2 text-sm font-semibold">
        <Logo size={26} />
        Auto Studio
      </Link>
      <button
        type="button"
        onClick={() => setAccountOpen(true)}
        className="-mr-1 flex items-center gap-2 rounded-full p-1 hover:bg-surface-2"
        aria-label={t("shell.accountMenu")}
      >
        <Avatar src={me.profile_picture_url} name={me.username} size={32} />
      </button>
    </header>

    {/* 휴대폰: 하단 탭바 */}
    <nav
      aria-label={t("shell.mainMenu")}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV.map(({ href, short, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cx(
            "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
            isActive(href) ? "text-accent" : "text-fg-3 active:text-fg",
          )}
        >
          <Icon width={22} height={22} />
          {t(short)}
        </Link>
      ))}
    </nav>

    <Dialog
      open={accountOpen}
      onClose={() => setAccountOpen(false)}
      title={`@${me.username}`}
      subtitle={`${t("shell.followers", { n: fmtCompact(me.followers_count) })}${me.fb_page_name ? ` · ${t("shell.page", { name: me.fb_page_name })}` : ""}`}
    >
      <div className="-mx-2 space-y-1">
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-surface-2"
        >
          <IconLogout width={18} height={18} /> {t("shell.logout")}
        </button>
        <button
          onClick={deleteAccount}
          disabled={loggingOut}
          className="flex h-12 w-full items-center rounded-lg px-3 text-left text-[14px] text-bad hover:bg-bad/10"
        >
          {t("shell.deleteAccount")}
        </button>
        <div className="flex flex-wrap items-center gap-4 px-3 pt-2 pb-1 text-[13px] text-fg-3">
          <LanguageSwitcher className="text-[13px]" />
          <Link href="/privacy">{t("common.privacy")}</Link>
          <Link href="/data-deletion">{t("common.dataDeletion")}</Link>
        </div>
      </div>
    </Dialog>

    {/* 태블릿·데스크톱: 왼쪽 사이드바 */}
    <aside className="sticky top-0 z-20 hidden h-dvh flex-col border-r border-line bg-surface-1 md:flex">
      <div className="flex items-center justify-between gap-3 px-5 py-5">
        <Link href="/admin" className="flex items-center gap-2 text-sm font-semibold">
          <Logo size={24} />
          Auto Studio
        </Link>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cx(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
              isActive(href) ? "bg-surface-2 text-fg" : "text-fg-3 hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon width={16} height={16} />
            {t(label)}
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t border-line p-4">
        <div className="flex items-center gap-3">
          <Avatar src={me.profile_picture_url} name={me.username} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">@{me.username}</p>
            <p className="truncate text-[12px] text-fg-3">{t("shell.followers", { n: fmtCompact(me.followers_count) })}</p>
          </div>
        </div>
        {me.fb_page_name && <p className="mt-2 truncate text-[12px] text-fg-3">{t("shell.page", { name: me.fb_page_name })}</p>}
        <button
          onClick={logout}
          disabled={loggingOut}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <IconLogout width={16} height={16} /> {t("shell.logout")}
        </button>
        <button
          onClick={deleteAccount}
          disabled={loggingOut}
          className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-fg-3 hover:bg-bad/10 hover:text-bad"
        >
          {t("shell.deleteAccount")}
        </button>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-2 text-[11px] text-fg-3">
          <Link href="/privacy" className="hover:text-fg">
            {t("common.privacy")}
          </Link>
          <Link href="/data-deletion" className="hover:text-fg">
            {t("common.dataDeletion")}
          </Link>
        </div>
        <LanguageSwitcher className="mt-3 px-2" />
      </div>
    </aside>
    </>
  );
}

/** 백엔드 OAuth 콜백이 /admin?connected=1 또는 ?error=... 로 돌려보냅니다. */
function OAuthResultBanner() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const connected = params.get("connected");
  const error = params.get("error");
  if (!connected && !error) return null;

  const dismiss = () => router.replace(pathname);
  return (
    <div className="mb-6">
      {error ? (
        <Notice tone="bad" title={t("shell.connectErrorTitle")} onClose={dismiss}>
          {error}
        </Notice>
      ) : (
        <Notice tone="good" title={t("shell.connectedTitle")} onClose={dismiss}>
          {t("shell.connectedBody")}
        </Notice>
      )}
    </div>
  );
}

function LoginGate({ message }: { message?: string }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-7 text-center">
        <Logo size={44} className="mx-auto" />
        <h1 className="mt-4 text-lg font-semibold">{t("shell.loginRequired")}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{t("shell.loginRequiredBody")}</p>
        <Suspense fallback={null}>
          <GateError fallback={message} />
        </Suspense>
        <a
          href={LOGIN_URL}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-on-accent hover:opacity-90"
        >
          <IconInstagram /> {t("common.connectInstagram")}
        </a>
        <Link href="/" className="mt-3 inline-block text-[13px] text-fg-3 hover:text-fg">
          {t("shell.backHome")}
        </Link>
      </div>
    </div>
  );
}

function GateError({ fallback }: { fallback?: string }) {
  const params = useSearchParams();
  const error = params.get("error") ?? fallback;
  if (!error) return null;
  return (
    <div className="mt-4 text-left">
      <Notice tone="bad">{error}</Notice>
    </div>
  );
}
