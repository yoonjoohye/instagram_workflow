import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("common.metaTitle"), description: t("common.metaDescription") };
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
  // 쿠키(사용자가 고른 언어) → 브라우저 언어 → 영어
  const { locale } = await getT();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
