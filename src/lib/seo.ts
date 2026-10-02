import type { Metadata } from "next";
import { LOCALES, type Locale } from "@/i18n/config";

/** 사이트 주소: NEXT_PUBLIC_SITE_URL → Vercel 프로덕션 도메인 → 로컬 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

export const OG_LOCALE: Record<Locale, string> = { ko: "ko_KR", en: "en_US", ja: "ja_JP" };

export const localizedUrl = (path: string, locale: Locale) => `${SITE_URL}/${locale}${path === "/" ? "" : path}`;

/** 언어별 주소(hreflang)와 대표 주소(canonical) */
export function alternates(path: string, locale: Locale): Metadata["alternates"] {
  return {
    canonical: localizedUrl(path, locale),
    languages: {
      ...Object.fromEntries(LOCALES.map((l) => [l, localizedUrl(path, l)])),
      "x-default": `${SITE_URL}${path}`,
    },
  };
}
