import type { Metadata } from "next";
import { alternates } from "@/lib/seo";
import Link from "next/link";
import type { ReactNode } from "react";
import { Contact, LegalPage, Section, SERVICE_NAME } from "@/components/LegalPage";
import type { MessageKey } from "@/i18n/core";
import { rich } from "@/i18n/rich";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  return {
    title: t("common.privacy"), // 레이아웃의 제목 틀이 ' · 서비스명' 을 붙임
    alternates: alternates("/privacy", locale),
    description: t("legal.pMetaDescription", { service: SERVICE_NAME }),
  };
}

// 처리하는 정보 표: [구분, 항목, 출처]
const ROWS = [
  ["legal.r1Type", "legal.r1Items", "legal.r1Source"],
  ["legal.r2Type", "legal.r2Items", "legal.r2Source"],
  ["legal.r3Type", "legal.r3Items", "legal.r3Source"],
  ["legal.r4Type", "legal.r4Items", "legal.r4Source"],
  ["legal.r5Type", "legal.r5Items", "legal.r5Source"],
  ["legal.r6Type", "legal.r6Items", "legal.r6Source"],
  ["legal.r7Type", "legal.r7Items", "legal.r7Source"],
] as const satisfies readonly (readonly MessageKey[])[];

const PURPOSES = ["legal.p2Li1", "legal.p2Li2", "legal.p2Li3", "legal.p2Li4", "legal.p2Li5", "legal.p2Li6"] as const;
const RETENTION = ["legal.p4Li1", "legal.p4Li2", "legal.p4Li3", "legal.p4Li4"] as const;
const SECURITY = ["legal.p6Li1", "legal.p6Li2", "legal.p6Li3"] as const;

export default async function PrivacyPage() {
  const { t } = await getT();
  const b = (c: ReactNode) => <b>{c}</b>;

  return (
    <LegalPage title={t("common.privacy")}>
      <p>{t("legal.pIntro", { service: SERVICE_NAME })}</p>

      <Section title={t("legal.p1Title")}>
        <table>
          <thead>
            <tr>
              <th>{t("legal.thType")}</th>
              <th>{t("legal.thItems")}</th>
              <th>{t("legal.thSource")}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([type, items, source]) => (
              <tr key={type}>
                <td>{t(type)}</td>
                <td>{t(items)}</td>
                <td>{t(source)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>{rich(t("legal.p1Note"), { b })}</p>
      </Section>

      <Section title={t("legal.p2Title")}>
        <ul>
          {PURPOSES.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        <p>{t("legal.p2Note")}</p>
      </Section>

      <Section title={t("legal.p3Title")}>
        <ul>
          <li>{rich(t("legal.p3Meta"), { b })}</li>
          <li>{rich(t("legal.p3Google"), { b })}</li>
          <li>{rich(t("legal.p3Infra"), { b })}</li>
        </ul>
        <p>{t("legal.p3Note")}</p>
      </Section>

      <Section title={t("legal.p4Title")}>
        <ul>
          {RETENTION.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("legal.p5Title")}>
        <p>{rich(t("legal.p5Body"), { b, link: (c) => <Link href="/data-deletion">{c}</Link> })}</p>
      </Section>

      <Section title={t("legal.p6Title")}>
        <ul>
          {SECURITY.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </Section>

      <Section title={t("legal.p7Title")}>
        <p>{t("legal.p7Body")}</p>
      </Section>

      <Section title={t("legal.p8Title")}>
        <p>{rich(t("legal.p8Contact"), { contact: () => <Contact /> })}</p>
        <p>{t("legal.p8Changes")}</p>
      </Section>
    </LegalPage>
  );
}
