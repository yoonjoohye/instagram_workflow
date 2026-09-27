import Link from "next/link";
import type { ReactNode } from "react";

export const SERVICE_NAME = "Instagram Auto Studio";
export const EFFECTIVE_DATE = "2026년 9월 27일";
// 문의처: 환경변수로 이메일을 지정할 수 있고, 없으면 서비스 Instagram 계정 DM 으로 안내합니다.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "";
export const CONTACT_INSTAGRAM = process.env.NEXT_PUBLIC_CONTACT_INSTAGRAM ?? "juiceistravel";

export function Contact() {
  return (
    <>
      {CONTACT_EMAIL && (
        <>
          이메일 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> 또는{" "}
        </>
      )}
      Instagram{" "}
      <a href={`https://www.instagram.com/${CONTACT_INSTAGRAM}/`} target="_blank" rel="noreferrer">
        @{CONTACT_INSTAGRAM}
      </a>{" "}
      DM
    </>
  );
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/" className="text-sm font-semibold text-fg-2 hover:text-fg">
        ← {SERVICE_NAME}
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-fg-3">시행일: {EFFECTIVE_DATE}</p>
      <article className="legal mt-8 space-y-8 text-[15px] leading-relaxed text-fg-2">{children}</article>
      <footer className="mt-16 flex gap-4 border-t border-line pt-6 text-sm text-fg-3">
        <Link href="/privacy" className="hover:text-fg">
          개인정보처리방침
        </Link>
        <Link href="/data-deletion" className="hover:text-fg">
          데이터 삭제 안내
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
