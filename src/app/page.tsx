import { getT } from "@/i18n/server";
import { SITE_URL } from "@/lib/seo";
import { HomeClient } from "./HomeClient";

/** 첫 화면. 검색엔진용 구조화 데이터(JSON-LD)는 서버에서 함께 내보냅니다. */
export default async function Home() {
  const { t, locale } = await getT();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: t("common.metaTitle"),
    url: `${SITE_URL}/${locale}`,
    description: t("common.metaDescription"),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    inLanguage: locale,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    image: `${SITE_URL}/opengraph-image`,
    featureList: [t("landing.f1Title"), t("landing.f2Title"), t("landing.f3Title")],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <HomeClient />
    </>
  );
}
