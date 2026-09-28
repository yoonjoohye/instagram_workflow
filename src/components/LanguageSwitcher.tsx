"use client";

import { LOCALE_LABEL, LOCALES, type Locale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { cx } from "./ui";

/** 언어 선택. 고른 언어는 쿠키에 저장돼 다음 방문에도 유지됩니다. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={cx("relative inline-flex items-center gap-1.5 text-[12px] text-fg-3", className)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="cursor-pointer appearance-none bg-transparent pr-3 text-fg-2 hover:text-fg focus:outline-none"
        aria-label={t("common.language")}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-0 text-[9px]">▾</span>
    </label>
  );
}
