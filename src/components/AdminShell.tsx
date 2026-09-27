"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useState, type ReactNode } from "react";
import { api, LOGIN_URL, useApi } from "@/lib/api";
import { fmtCompact } from "@/lib/format";
import type { Me } from "@/lib/types";
import { IconChart, IconGrid, IconInbox, IconInstagram, IconLogout, IconReply, IconSpark } from "./icons";
import { Avatar, cx, Notice, Spinner } from "./ui";

const MeContext = createContext<{ me: Me; refreshMe: () => void } | null>(null);

export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe 는 AdminShell 안에서만 쓸 수 있습니다.");
  return ctx;
}

const NAV = [
  { href: "/admin", label: "대시보드", icon: IconChart },
  { href: "/admin/studio", label: "만들기", icon: IconSpark },
  { href: "/admin/jobs", label: "작업함", icon: IconInbox },
  { href: "/admin/posts", label: "게시물 성과", icon: IconGrid },
  { href: "/admin/autoreply", label: "자동 응답", icon: IconReply },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const me = useApi<Me>("/auth/me");

  if (me.loading && !me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-fg-3">
        <Spinner /> 계정 정보를 불러오는 중…
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
        <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">
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
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function deleteAccount() {
    if (
      !window.confirm(
        `@${me.username} 연결을 해제하고 이 서비스에 저장된 모든 데이터(토큰, 생성 기록, 인사이트 기록, 자동 응답·댓글 분석 기록)를 삭제할까요?\n되돌릴 수 없습니다. Instagram 에 게시된 게시물은 그대로 남습니다.`,
      )
    )
      return;
    setLoggingOut(true);
    try {
      const r = await api<{ confirmation_code: string }>("/auth/account", { method: "DELETE" });
      window.location.href = `/data-deletion?code=${r.confirmation_code}`;
    } catch (e) {
      setLoggingOut(false);
      window.alert(e instanceof Error ? e.message : "삭제하지 못했습니다.");
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

  return (
    <aside className="sticky top-0 z-20 border-b border-line bg-surface-1 md:flex md:h-dvh md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-5">
        <Link href="/admin" className="flex items-center gap-2 text-sm font-semibold">
          <IconInstagram className="text-accent" />
          Auto Studio
        </Link>
        <button onClick={logout} className="text-fg-3 hover:text-fg md:hidden" aria-label="로그아웃">
          <IconLogout />
        </button>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:px-3 md:pb-0">
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
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto hidden border-t border-line p-4 md:block">
        <div className="flex items-center gap-3">
          <Avatar src={me.profile_picture_url} name={me.username} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">@{me.username}</p>
            <p className="truncate text-[12px] text-fg-3">팔로워 {fmtCompact(me.followers_count)}</p>
          </div>
        </div>
        {me.fb_page_name && <p className="mt-2 truncate text-[12px] text-fg-3">페이지 · {me.fb_page_name}</p>}
        <button
          onClick={logout}
          disabled={loggingOut}
          className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <IconLogout width={16} height={16} /> 로그아웃
        </button>
        <button
          onClick={deleteAccount}
          disabled={loggingOut}
          className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-fg-3 hover:bg-bad/10 hover:text-bad"
        >
          연결 해제 및 데이터 삭제
        </button>
        <div className="mt-2 flex gap-3 px-2 text-[11px] text-fg-3">
          <Link href="/privacy" className="hover:text-fg">
            개인정보처리방침
          </Link>
          <Link href="/data-deletion" className="hover:text-fg">
            데이터 삭제 안내
          </Link>
        </div>
      </div>
    </aside>
  );
}

/** 백엔드 OAuth 콜백이 /admin?connected=1 또는 ?error=... 로 돌려보냅니다. */
function OAuthResultBanner() {
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
        <Notice tone="bad" title="계정 연결 중 문제가 생겼습니다" onClose={dismiss}>
          {error}
        </Notice>
      ) : (
        <Notice tone="good" title="Instagram 계정이 연결됐습니다" onClose={dismiss}>
          이제 프롬프트로 콘텐츠를 만들고 게시할 수 있습니다.
        </Notice>
      )}
    </div>
  );
}

function LoginGate({ message }: { message?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-7 text-center">
        <IconInstagram className="mx-auto text-accent" width={28} height={28} />
        <h1 className="mt-4 text-lg font-semibold">로그인이 필요합니다</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
          Instagram 비즈니스·크리에이터 계정을 연결하세요.
        </p>
        <Suspense fallback={null}>
          <GateError fallback={message} />
        </Suspense>
        <a
          href={LOGIN_URL}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-on-accent hover:opacity-90"
        >
          <IconInstagram /> Instagram 계정 연결하기
        </a>
        <Link href="/" className="mt-3 inline-block text-[13px] text-fg-3 hover:text-fg">
          처음 화면으로
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
