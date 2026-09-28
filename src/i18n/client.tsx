"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { setFormatLocale } from "@/lib/format";
import { LOCALE_COOKIE, type Locale } from "./config";
import { makeT, type T } from "./core";

type Ctx = { locale: Locale; t: T; setLocale: (l: Locale) => void };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ locale: initial, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const [locale, setState] = useState<Locale>(initial);
  // 날짜·숫자 형식도 같은 언어로 (렌더 중에 맞춰 두어 서버·브라우저 결과가 같게)
  setFormatLocale(locale);

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      setState(next);
      router.refresh(); // 서버 컴포넌트(개인정보처리방침 등)도 새 언어로
    },
    [router],
  );

  const value = useMemo(() => ({ locale, t: makeT(locale), setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n 은 I18nProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

export const useT = () => useI18n().t;
