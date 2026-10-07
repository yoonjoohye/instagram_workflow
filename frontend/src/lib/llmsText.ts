import { FAQ, HOW } from "@/app/landingContent";
import { LOCALE_LABEL, LOCALES, type Locale } from "@/i18n/config";
import { makeT } from "@/i18n/core";
import { localizedUrl, SITE_URL } from "./seo";

/** AI 답변 엔진용 안내문 (https://llmstxt.org 형식). 화면 문구(i18n)에서 만들어 항상 같은 내용을 유지합니다. */
export function llmsTxt(): string {
  const t = makeT("en");
  return [
    `# ${t("common.metaTitle")}`,
    "",
    `> ${t("common.metaDescription")} ${t("landing.faq1A")}`,
    "",
    `- ${t("landing.faq2Q")} ${t("landing.faq2A")}`,
    `- ${t("landing.faq8Q")} ${t("landing.faq8A")}`,
    "",
    "## Pages",
    "",
    ...LOCALES.map((l) => `- [Home (${LOCALE_LABEL[l]})](${localizedUrl("/", l)}): features, how it works and FAQ`),
    `- [Privacy Policy](${localizedUrl("/privacy", "en")}): what data is processed and why`,
    `- [Data Deletion](${localizedUrl("/data-deletion", "en")}): how to delete all your data`,
    "",
    "## Optional",
    "",
    `- [Full text for AI](${SITE_URL}/llms-full.txt): features, how it works and every FAQ answer in English, Korean and Japanese`,
    "",
  ].join("\n");
}

function section(locale: Locale): string {
  const t = makeT(locale);
  return [
    `## ${LOCALE_LABEL[locale]} (${localizedUrl("/", locale)})`,
    "",
    t("common.metaDescription"),
    "",
    `### ${t("landing.f1Title")}`,
    t("landing.f1Body"),
    `### ${t("landing.f2Title")}`,
    t("landing.f2Body"),
    `### ${t("landing.f3Title")}`,
    t("landing.f3Body"),
    "",
    `### ${t("landing.howTitle")}`,
    ...HOW.map((s, i) => `${i + 1}. **${t(s.title)}** — ${t(s.body)}`),
    "",
    `### ${t("landing.faqTitle")}`,
    ...FAQ.flatMap((f) => [`**${t(f.q)}**`, t(f.a), ""]),
  ].join("\n");
}

export function llmsFullTxt(): string {
  const t = makeT("en");
  return [`# ${t("common.metaTitle")}`, "", `> ${t("common.metaDescription")}`, "", ...LOCALES.map(section)].join("\n");
}
