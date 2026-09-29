"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { LOGIN_URL, SWITCH_LOGIN_URL, useApi } from "@/lib/api";
import type { Health, Me } from "@/lib/types";
import { IconChart, IconInstagram, IconReply, IconSpark } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { Notice, Spinner } from "@/components/ui";

const FEATURES = [
  { icon: IconSpark, title: "landing.f1Title", body: "landing.f1Body" },
  { icon: IconChart, title: "landing.f2Title", body: "landing.f2Body" },
  { icon: IconReply, title: "landing.f3Title", body: "landing.f3Body" },
] as const;

export default function Home() {
  const t = useT();
  const code = (c: ReactNode) => <code>{c}</code>;
  const me = useApi<Me>("/auth/me");
  const health = useApi<Health>("/health");
  const loggedIn = Boolean(me.data);
  // Next 프록시는 백엔드 연결 실패를 500 으로 돌려주므로 0 과 5xx 를 모두 "백엔드 꺼짐"으로 봅니다.
  const backendDown = Boolean(health.error && (health.error.status === 0 || health.error.status >= 500));
  const loginBlocked = backendDown || health.data?.meta_configured === false;
  const viaFacebook = health.data?.auth_mode === "facebook";

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Logo size={24} />
          Instagram Auto Studio
        </div>
        <LanguageSwitcher />
      </div>

      <section className="mt-16 sm:mt-24">
        <h1 className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight sm:text-5xl">
          {t("landing.headline")}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-2 sm:text-lg">
          {t("landing.lead")}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {me.loading ? (
            <span className="inline-flex h-11 items-center gap-2 px-2 text-sm text-fg-3">
              <Spinner /> {t("common.checking")}
            </span>
          ) : loggedIn ? (
            <Link
              href="/admin"
              className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              {t("landing.goDashboard", { username: me.data!.username })}
            </Link>
          ) : null}
          {loggedIn && !me.loading ? (
            <a href={SWITCH_LOGIN_URL} className="text-[13px] text-fg-3 underline-offset-2 hover:text-fg hover:underline">
              {t("shell.addAccount")}
            </a>
          ) : null}
          {me.loading || loggedIn ? null : loginBlocked ? (
            <span className="inline-flex h-11 cursor-not-allowed items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent opacity-50">
              <IconInstagram /> {t("common.connectInstagram")}
            </span>
          ) : (
            <a
              href={LOGIN_URL}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-on-accent hover:opacity-90"
            >
              <IconInstagram /> {t("common.connectInstagram")}
            </a>
          )}
          {!loggedIn && !me.loading && !loginBlocked && (
            <span className="text-[13px] text-fg-3">
              {viaFacebook ? t("landing.viaFacebook") : t("landing.viaInstagram")}
            </span>
          )}
        </div>

        {health.data && !health.data.meta_configured && (
          <div className="mt-6 max-w-xl">
            <Notice tone="warn" title={t("landing.metaMissingTitle")}>
              {rich(t("landing.metaMissingBody", { uri: health.data.redirect_uri }), {
                code,
                uri: (c) => <code className="break-all">{c}</code>,
              })}
            </Notice>
          </div>
        )}
        {backendDown && (
          <div className="mt-6 max-w-xl">
            <Notice tone="bad" title={t("landing.backendDownTitle")}>
              {rich(t("landing.backendDownBody"), { code })}
            </Notice>
          </div>
        )}
      </section>

      <section className="mt-16 grid gap-4 sm:mt-24 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-line bg-surface-1 p-5">
            <Icon className="text-accent" />
            <h2 className="mt-3 text-[15px] font-semibold">{t(title)}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{t(body)}</p>
          </div>
        ))}
      </section>

      <nav className="mt-auto flex gap-4 pt-16 text-[12px] text-fg-3">
        <Link href="/privacy" className="hover:text-fg">
          {t("common.privacy")}
        </Link>
        <Link href="/data-deletion" className="hover:text-fg">
          {t("common.dataDeletion")}
        </Link>
      </nav>
      <p className="pt-3 text-[12px] leading-relaxed text-fg-3">
        {t("landing.footnote", { fb: viaFacebook ? t("landing.footnoteFb") : "" })}
      </p>
    </main>
  );
}
