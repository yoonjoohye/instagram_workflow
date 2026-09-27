"use client";

import Link from "next/link";
import { LOGIN_URL, useApi } from "@/lib/api";
import type { Health, Me } from "@/lib/types";
import { IconChart, IconInstagram, IconReply, IconSpark } from "@/components/icons";
import { Notice, Spinner } from "@/components/ui";

const FEATURES = [
  {
    icon: IconSpark,
    title: "주제대로 게시물 제작",
    body: "주제와 컨셉을 적으면 Gemini가 조사하고, 사진을 연출하거나 새로 만들어 캡션·해시태그까지 완성합니다. 검수 후 바로 게시.",
  },
  {
    icon: IconChart,
    title: "게시물 성과 대시보드",
    body: "도달, 프로필 조회, 참여 계정을 일자별로 추적하고 게시물별 성과를 비교합니다.",
  },
  {
    icon: IconReply,
    title: "댓글 자동 응답",
    body: "새 댓글에 고정 답글을 달고, 팔로우 여부에 따라 다른 DM을 자동으로 보냅니다.",
  },
];

export default function Home() {
  const me = useApi<Me>("/auth/me");
  const health = useApi<Health>("/health");
  const loggedIn = Boolean(me.data);
  // Next 프록시는 백엔드 연결 실패를 500 으로 돌려주므로 0 과 5xx 를 모두 "백엔드 꺼짐"으로 봅니다.
  const backendDown = Boolean(health.error && (health.error.status === 0 || health.error.status >= 500));
  const loginBlocked = backendDown || health.data?.meta_configured === false;
  const viaFacebook = health.data?.auth_mode === "facebook";

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <IconInstagram className="text-accent" />
        Instagram Auto Studio
      </div>

      <section className="mt-16 sm:mt-24">
        <h1 className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
          쓰면, 만들어지고, 올라갑니다.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-2 sm:text-lg">
          Instagram 계정을 연결하고 사진과 주제만 올리세요. 게시물 제작부터 게시, 댓글 자동 응답, 성과 분석까지 한곳에서 끝납니다.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {me.loading ? (
            <span className="inline-flex h-11 items-center gap-2 px-2 text-sm text-fg-3">
              <Spinner /> 확인 중…
            </span>
          ) : loggedIn ? (
            <Link
              href="/admin"
              className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              @{me.data!.username} 대시보드로 이동 →
            </Link>
          ) : loginBlocked ? (
            <span className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent opacity-50">
              <IconInstagram /> Instagram 계정 연결하기
            </span>
          ) : (
            <a
              href={LOGIN_URL}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              <IconInstagram /> Instagram 계정 연결하기
            </a>
          )}
          {!loggedIn && !me.loading && !loginBlocked && (
            <span className="text-[13px] text-fg-3">
              {viaFacebook
                ? "Facebook 로그인으로 비즈니스·크리에이터 계정을 연결합니다."
                : "Instagram 로그인으로 비즈니스·크리에이터 계정을 연결합니다."}
            </span>
          )}
        </div>

        {health.data && !health.data.meta_configured && (
          <div className="mt-6 max-w-xl">
            <Notice tone="warn" title="Meta 앱이 아직 설정되지 않았습니다">
              환경변수에 <code>INSTAGRAM_APP_ID</code>, <code>INSTAGRAM_APP_SECRET</code> 를 넣고 다시 배포(로컬은 백엔드 재시작)하세요. OAuth
              리디렉션 URI 는 <code className="break-all">{health.data.redirect_uri}</code> 입니다.
            </Notice>
          </div>
        )}
        {backendDown && (
          <div className="mt-6 max-w-xl">
            <Notice tone="bad" title="백엔드에 연결할 수 없습니다">
              다른 터미널에서 <code>npm run dev:api</code> 로 FastAPI 서버(포트 8000)를 실행한 뒤 새로고침하세요.
            </Notice>
          </div>
        )}
      </section>

      <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-line bg-surface-1 p-5">
            <Icon className="text-accent" />
            <h2 className="mt-3 text-[15px] font-semibold">{title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{body}</p>
          </div>
        ))}
      </section>

      <nav className="mt-auto flex gap-4 pt-16 text-[12px] text-fg-3">
        <Link href="/privacy" className="hover:text-fg">
          개인정보처리방침
        </Link>
        <Link href="/data-deletion" className="hover:text-fg">
          데이터 삭제 안내
        </Link>
      </nav>
      <p className="pt-3 text-[12px] leading-relaxed text-fg-3">
        Instagram 프로페셔널(비즈니스/크리에이터) 계정이어야 합니다{viaFacebook && " (Facebook 페이지 연결 필요)"}. Meta 정책상 프로필을 조회한
        개별 계정 목록은 제공되지 않으며, 집계 수치와 댓글·멘션을 남긴 계정만 확인할 수 있습니다.
      </p>
    </main>
  );
}
