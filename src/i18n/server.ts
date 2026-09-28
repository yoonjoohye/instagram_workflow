import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, pickLocale, type Locale } from "./config";
import { makeT } from "./core";

/** 서버 컴포넌트용: 쿠키(사용자가 고른 언어) → 브라우저 언어 → 기본값 */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  return pickLocale((await headers()).get("accept-language"));
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: makeT(locale) };
}
