import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Contact, LegalPage, Section, SERVICE_NAME } from "@/components/LegalPage";
import { rich } from "@/i18n/rich";
import { getT } from "@/i18n/server";
import { DeletionStatus } from "./DeletionStatus";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: `${t("common.dataDeletion")} · ${SERVICE_NAME}`,
    description: t("legal.dMetaDescription", { service: SERVICE_NAME }),
  };
}

export default async function DataDeletionPage() {
  const { t } = await getT();
  const b = (c: ReactNode) => <b>{c}</b>;

  return (
    <LegalPage title={t("common.dataDeletion")}>
      <Suspense fallback={null}>
        <DeletionStatus />
      </Suspense>

      <p>{t("legal.dIntro", { service: SERVICE_NAME })}</p>

      <Section title={t("legal.d1Title")}>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>{rich(t("legal.d1Step1"), { link: (c) => <Link href="/admin">{c}</Link> })}</li>
          <li>{rich(t("legal.d1Step2"), { b })}</li>
          <li>{t("legal.d1Step3")}</li>
        </ol>
      </Section>

      <Section title={t("legal.d2Title")}>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>{rich(t("legal.d2Step1"), { b })}</li>
          <li>{rich(t("legal.d2Step2", { service: SERVICE_NAME }), { b })}</li>
          <li>{t("legal.d2Step3")}</li>
        </ol>
      </Section>

      <Section title={t("legal.d3Title")}>
        <p>{rich(t("legal.d3Body"), { contact: () => <Contact /> })}</p>
      </Section>
    </LegalPage>
  );
}
