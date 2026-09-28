import Link from "next/link";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { rich } from "@/i18n/rich";
import { getT } from "@/i18n/server";
import type { ReactNode } from "react";

export const SERVICE_NAME = "Instagram Auto Studio";
// 시행일은 legal.effectiveDate 문구(언어별 날짜 표기)에 있습니다.
// 문의처: 환경변수로 이메일을 지정할 수 있고, 없으면 서비스 Instagram 계정 DM 으로 안내합니다.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
export const CONTACT_INSTAGRAM = process.env.NEXT_PUBLIC_CONTACT_INSTAGRAM ?? "juiceistravel";

export async function Contact() {
  const { t } = await getT();
  return (
    <>
      {CONTACT_EMAIL &&
        rich(t("legal.contactEmail", { email: CONTACT_EMAIL }), {
          a: (c) => <a href={`mailto:${CONTACT_EMAIL}`}>{c}</a>,
        })}
      {rich(t("legal.contactInstagram", { instagram: CONTACT_INSTAGRAM }), {
        a: (c) => (
          <a href={`https://www.instagram.com/${CONTACT_INSTAGRAM}/`} target="_blank" rel="noreferrer">
            {c}
          </a>
        ),
      })}
    </>
  );
}

export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = await getT();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-fg-2 hover:text-fg">
          ← <Logo size={20} /> {SERVICE_NAME}
        </Link>
        {/* 검수자가 언어를 바꿔 볼 수 있게 */}
        <LanguageSwitcher />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-fg-3">{t("legal.effectiveLabel", { date: t("legal.effectiveDate") })}</p>
      <article className="legal mt-8 space-y-8 text-[15px] leading-relaxed text-fg-2">{children}</article>
      <footer className="mt-16 flex gap-4 border-t border-line pt-6 text-sm text-fg-3">
        <Link href="/privacy" className="hover:text-fg">
          {t("common.privacy")}
        </Link>
        <Link href="/data-deletion" className="hover:text-fg">
          {t("common.dataDeletion")}
        </Link>
      </footer>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-fg">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
