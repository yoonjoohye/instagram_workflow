import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { alternates, OG_LOCALE, SITE_URL } from "@/lib/seo";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  const title = t("common.seoTitle");
  const description = t("common.metaDescription");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s · ${t("common.metaTitle")}` },
    description,
    keywords: t("common.seoKeywords").split(",").map((k) => k.trim()),
    applicationName: t("common.metaTitle"),
    alternates: alternates("/", locale),
    openGraph: {
      type: "website",
      siteName: t("common.metaTitle"),
      title,
      description,
      url: "/",
      locale: OG_LOCALE[locale],
      alternateLocale: Object.values(OG_LOCALE).filter((l) => l !== OG_LOCALE[locale]),
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    // 서치 콘솔·네이버 서치어드바이저 소유 확인 (Vercel 환경변수에 값을 넣으면 메타 태그가 붙습니다)
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
      other: process.env.NAVER_SITE_VERIFICATION ? { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION } : undefined,
    },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 아이폰 홈 인디케이터·노치 영역까지 쓰고, 하단 탭바는 safe-area 만큼 띄웁니다.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 주소의 ?lang= → 쿠키(사용자가 고른 언어) → 브라우저 언어 → 영어
  const { locale } = await getT();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
