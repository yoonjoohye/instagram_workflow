"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { api, startLink, useApi } from "@/lib/api";
import { fmtCompact } from "@/lib/format";
import type { Health, Me, Session } from "@/lib/types";
import { IconChart, IconGrid, IconInbox, IconInstagram, IconLogout, IconReply, IconSpark, IconUser } from "./icons";
import { Logo } from "@/components/Logo";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/i18n/client";
import { Avatar, cx, Dialog, Notice, Spinner } from "./ui";

const MeContext = createContext<{ me: Me; refreshMe: () => void } | null>(null);
const SessionContext = createContext<{ session: Session; refresh: () => void } | null>(null);

/** 지금 고른 Instagram 계정 (계정이 필요한 화면에서만 — 계정이 없으면 AdminShell 이 연동 안내를 대신 보여 줌) */
export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe 는 AdminShell 안에서만 쓸 수 있습니다.");
  return ctx;
}

/** 회원 정보 + 연동 상태 (프로필 화면처럼 계정이 없어도 되는 곳) */
export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession 은 AdminShell 안에서만 쓸 수 있습니다.");
  return ctx;
}

const PROFILE = "/admin/profile";

const NAV = [
  { href: "/admin", label: "shell.dashboard", short: "shell.dashboardShort", icon: IconChart },
  { href: "/admin/studio", label: "shell.studio", short: "shell.studioShort", icon: IconSpark },
  { href: "/admin/jobs", label: "shell.jobs", short: "shell.jobsShort", icon: IconInbox },
  { href: "/admin/posts", label: "shell.posts", short: "shell.postsShort", icon: IconGrid },
  { href: "/admin/autoreply", label: "shell.autoreply", short: "shell.autoreplyShort", icon: IconReply },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const session = useApi<Session>("/auth/session");
  const unauthorized = session.error?.status === 401;

  // 로그인하지 않았으면 로그인 화면으로 (끝나면 이 화면으로 돌아옴)
  useEffect(() => {
    if (unauthorized) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthorized, pathname, router]);

  if ((session.loading && !session.data) || unauthorized) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-fg-3">
        <Spinner /> {t("shell.loadingAccount")}
      </div>
    );
  }

  if (!session.data) return <LoadError message={session.error?.message} onRetry={session.reload} />;

  const s = session.data;
  const body = s.account || pathname === PROFILE ? children : <ConnectGate />;
  const page = (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <Sidebar session={s} />
      {/* 휴대폰: 하단 탭바(약 64px + safe-area)에 가리지 않게 아래 여백 */}
      <main className="min-w-0 px-4 pt-5 pb-[calc(88px+env(safe-area-inset-bottom))] sm:px-8 sm:py-8 md:pb-8">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={null}>
            <OAuthResultBanner />
          </Suspense>
          {body}
        </div>
      </main>
    </div>
  );

  return (
    <SessionContext.Provider value={{ session: s, refresh: session.reload }}>
      {s.account ? <MeContext.Provider value={{ me: s.account, refreshMe: session.reload }}>{page}</MeContext.Provider> : page}
    </SessionContext.Provider>
  );
}

function Sidebar({ session }: { session: Session }) {
  const t = useT();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const me = session.account;
  // 왼쪽 아래·계정 메뉴에는 우리 서비스 회원 정보 (Instagram 계정은 그 아래 전환 목록에)
  const who = session.user.name || session.user.email;
  const sub = session.user.name ? session.user.email : "";

  async function logout() {
    setLoggingOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  const isActive = (href: string) => (href === "/admin" ? pathname === href : pathname.startsWith(href));

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
        <Avatar name={who} size={32} />
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

    <Dialog open={accountOpen} onClose={() => setAccountOpen(false)} title={who} subtitle={sub}>
      <div className="-mx-2 space-y-1">
        <AccountSwitcher session={session} onSwitched={() => setAccountOpen(false)} />
        <Link
          href={PROFILE}
          onClick={() => setAccountOpen(false)}
          className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-surface-2"
        >
          <IconUser width={18} height={18} /> {t("auth.profile")}
        </Link>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-surface-2"
        >
          <IconLogout width={18} height={18} /> {t("shell.logout")}
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
        <Link href={PROFILE} className="-m-2 flex items-center gap-3 rounded-lg p-2 hover:bg-surface-2" title={t("auth.profile")}>
          <Avatar name={who} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{who}</p>
            {sub && <p className="truncate text-[12px] text-fg-3">{sub}</p>}
          </div>
        </Link>
        <div className="-mx-2 mt-2">
          <AccountSwitcher session={session} compact />
        </div>
        <Link
          href={PROFILE}
          aria-current={isActive(PROFILE) ? "page" : undefined}
          className={cx(
            "mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2 hover:text-fg",
            isActive(PROFILE) ? "bg-surface-2 text-fg" : "text-fg-3",
          )}
        >
          <IconUser width={16} height={16} /> {t("auth.profile")}
        </Link>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <IconLogout width={16} height={16} /> {t("shell.logout")}
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

/** 회원이 연동한 다른 Instagram 계정으로 전환 + 다른 계정 연동 */
function AccountSwitcher({ session, compact, onSwitched }: { session: Session; compact?: boolean; onSwitched?: () => void }) {
  const t = useT();
  const [switching, setSwitching] = useState<number>();
  const others = session.accounts.filter((a) => !a.current);

  async function switchTo(id: number) {
    setSwitching(id);
    try {
      await api("/auth/switch", { method: "POST", json: { account_id: id } });
      onSwitched?.();
      window.location.reload(); // 모든 화면을 새 계정 데이터로
    } catch (e) {
      setSwitching(undefined);
      window.alert(e instanceof Error ? e.message : t("shell.switchFailed"));
    }
  }

  const row = compact ? "h-9 px-2 text-[13px]" : "h-12 px-3 text-[15px]";
  const current = session.account;
  return (
    <div className="space-y-0.5">
      {session.accounts.length > 0 && (
        <p className={cx("pt-1 pb-0.5 text-fg-3", compact ? "px-2 text-[11px]" : "px-3 text-[12px]")}>Instagram</p>
      )}
      {current && (
        <div className={cx("flex w-full items-center gap-2.5 rounded-lg", row)} title={t("shell.followers", { n: fmtCompact(current.followers_count) })}>
          <Avatar src={current.profile_picture_url} name={current.username} size={compact ? 22 : 28} />
          <span className="min-w-0 flex-1 truncate font-medium">@{current.username}</span>
          <span className="shrink-0 rounded-full bg-good/15 px-1.5 py-0.5 text-[10px] font-medium text-good">{t("auth.current")}</span>
        </div>
      )}
      {others.map((a) => (
        <button
          key={a.id}
          onClick={() => switchTo(a.id)}
          disabled={switching !== undefined}
          className={cx("flex w-full items-center gap-2.5 rounded-lg text-left hover:bg-surface-2 disabled:opacity-60", row)}
        >
          <Avatar src={a.profile_picture_url} name={a.username} size={compact ? 22 : 28} />
          <span className="min-w-0 flex-1 truncate">@{a.username}</span>
          {switching === a.id && <Spinner className="size-3" />}
        </button>
      ))}
      {session.can_link.instagram && (
        <button
          type="button"
          onClick={() => startLink("instagram", { switch: session.accounts.length > 0 })}
          title={t("shell.addAccountHint")}
          className={cx("flex w-full items-center gap-2.5 rounded-lg text-fg-2 hover:bg-surface-2 hover:text-fg", row)}
        >
          <span
            aria-hidden
            className={cx("inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong", compact ? "size-[22px] text-[13px]" : "size-7")}
          >
            +
          </span>
          {session.accounts.length ? t("shell.addAccount") : t("auth.connectInstagram")}
        </button>
      )}
    </div>
  );
}

/** 연동 콜백이 ?connected=instagram|facebook (&skipped, &warning) 또는 ?error=... 로 돌려보냅니다. */
function OAuthResultBanner() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const connected = params.get("connected");
  const error = params.get("error");
  const skipped = params.get("skipped");
  const warning = params.get("warning");
  if (!connected && !error) return null;

  const dismiss = () => router.replace(pathname);
  if (error) {
    return (
      <div className="mb-6">
        <Notice tone="bad" title={t("auth.linkError")} onClose={dismiss}>
          {error}
        </Notice>
      </div>
    );
  }
  return (
    <div className="mb-6 space-y-2">
      <Notice tone="good" title={connected === "facebook" ? t("auth.connectedFacebook") : t("auth.connectedInstagram")} onClose={dismiss}>
        {t("shell.connectedBody")}
      </Notice>
      {skipped && <Notice tone="warn">{t("auth.skipped", { names: skipped.split(",").map((n) => `@${n}`).join(", ") })}</Notice>}
      {warning && <Notice tone="warn">{warning}</Notice>}
    </div>
  );
}

/** 회원은 로그인했지만 Instagram 계정이 아직 없음 */
function ConnectGate() {
  const t = useT();
  const { session } = useSession();
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-7 text-center">
        <IconInstagram className="mx-auto text-fg-2" width={36} height={36} />
        <h1 className="mt-4 text-lg font-semibold">{t("auth.connectGateTitle")}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{t("auth.connectGateBody")}</p>
        {session.can_link.instagram && (
          <button
            type="button"
            onClick={() => startLink("instagram")}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-on-accent hover:opacity-90"
          >
            <IconInstagram /> {t("auth.connectInstagram")}
          </button>
        )}
        <Link href={PROFILE} className="mt-3 inline-block text-[13px] text-fg-3 hover:text-fg">
          {t("auth.goProfile")}
        </Link>
        <DevLoginLink />
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <Notice tone="bad">{message ?? t("common.serverUnreachable")}</Notice>
        <button type="button" onClick={onRetry} className="text-[13px] text-fg-2 underline">
          {t("common.retry")}
        </button>
        <div>
          <Link href="/" className="text-[13px] text-fg-3 hover:text-fg">
            {t("shell.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/** 로컬 개발 전용: 메일·인스타 로그인 없이 저장된 계정으로 들어가기 (서버가 허용할 때만 보임) */
export function DevLoginLink() {
  const health = useApi<Health>("/health");
  if (!health.data?.dev_login) return null;
  return (
    <a
      href="/api/py/auth/dev-login"
      className="mt-3 flex h-10 w-full items-center justify-center rounded-lg border border-dashed border-warn/60 text-[13px] font-medium text-fg-2 hover:bg-warn/10"
    >
      🛠 로컬 테스트 로그인 (개발용)
    </a>
  );
}
