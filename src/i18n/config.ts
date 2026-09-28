/** 지원 언어. 새 언어는 여기와 messages/*.ts 의 각 네임스페이스에 추가하면 됩니다. */
export const LOCALES = ["ko", "en", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

/** 브라우저 언어가 지원 목록에 없을 때 (글로벌 서비스 기본값) */
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "lang";

export const LOCALE_LABEL: Record<Locale, string> = { ko: "한국어", en: "English", ja: "日本語" };
/** Intl 날짜·숫자 형식용 */
export const INTL_LOCALE: Record<Locale, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** 'ko-KR,ko;q=0.9,en;q=0.8' → 지원하는 첫 언어 */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const base = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
