import { getT } from "@/i18n/server";
import { localizedUrl, SITE_URL } from "@/lib/seo";
import { HomeClient } from "./HomeClient";
import { FAQ, HOW } from "./landingContent";

/** 첫 화면. 검색엔진·AI 답변 엔진용 구조화 데이터(JSON-LD)를 서버에서 함께 내보냅니다.
 *  화면에 보이는 문구와 같은 내용만 넣습니다 (보이지 않는 내용을 넣으면 신뢰도가 떨어짐). */
export default async function Home() {
  const { t, locale } = await getT();
  const url = localizedUrl("/", locale);
  const name = t("common.metaTitle");
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE_URL}/#org`, name, url: SITE_URL, logo: `${SITE_URL}/logo.png` },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#app`,
        name,
        url,
        description: t("common.metaDescription"),
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android",
        inLanguage: ["ko", "en", "ja"],
        image: `${SITE_URL}/opengraph-image`,
        publisher: { "@id": `${SITE_URL}/#org` },
        featureList: [t("landing.f1Title"), t("landing.f2Title"), t("landing.f3Title")],
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        inLanguage: locale,
        mainEntity: FAQ.map((f) => ({
          "@type": "Question",
          name: t(f.q),
          acceptedAnswer: { "@type": "Answer", text: t(f.a) },
        })),
      },
      {
        "@type": "HowTo",
        "@id": `${url}#how`,
        name: t("landing.howTitle"),
        inLanguage: locale,
        step: HOW.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: t(s.title), text: t(s.body) })),
      },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <HomeClient />
    </>
  );
}
