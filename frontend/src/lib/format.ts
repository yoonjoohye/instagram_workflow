import { localSrc } from "@/lib/localMedia";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/i18n/config";
import { translate, type MessageKey, type Vars } from "@/i18n/core";
import type { IgPost, JobStatus, MediaKind, MetricKey } from "./types";

// 화면 언어 (I18nProvider 가 렌더할 때 맞춰 둡니다). 날짜·숫자·라벨 형식이 이 언어를 따릅니다.
let current: Locale = DEFAULT_LOCALE;
let intFmt = new Intl.NumberFormat(INTL_LOCALE[current]);
let compactFmt = new Intl.NumberFormat(INTL_LOCALE[current], { notation: "compact", maximumFractionDigits: 1 });

export function setFormatLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  intFmt = new Intl.NumberFormat(INTL_LOCALE[locale]);
  compactFmt = new Intl.NumberFormat(INTL_LOCALE[locale], { notation: "compact", maximumFractionDigits: 1 });
}

export const getFormatLocale = () => current;

const tf = (key: MessageKey, vars?: Vars) => translate(current, key, vars);

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : intFmt.format(n));

/** 1,284 / 1.2만 · 12K 처럼 자리수에 따라 줄여서 표시 */
export const fmtCompact = (n: number | null | undefined) =>
  n == null ? "—" : Math.abs(n) < 10_000 ? intFmt.format(n) : compactFmt.format(n);

export const fmtPct = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(digits)}%`;

export function fmtShortDate(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(INTL_LOCALE[current], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return tf("format.justNow");
  if (diff < 3600) return tf("format.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400) return tf("format.hoursAgo", { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 30) return tf("format.daysAgo", { n: Math.floor(diff / 86400) });
  return new Date(iso).toLocaleDateString(INTL_LOCALE[current]);
}

/** 키로 읽으면 현재 언어의 라벨을 돌려주는 표 (METRIC_LABEL[m] 처럼 그대로 씁니다) */
function labels<K extends string>(prefix: string): Record<K, string> {
  return new Proxy({} as Record<K, string>, {
    get: (_, key) => (typeof key === "string" ? translate(current, `format.${prefix}.${key}` as MessageKey) : undefined),
  });
}

export const METRIC_LABEL = labels<MetricKey>("metric");
export const METRIC_HINT = labels<MetricKey>("hint");
export const KIND_LABEL = labels<MediaKind>("kind");
export const STATUS_LABEL = labels<JobStatus>("status");

export function postKind(p: IgPost): string {
  if (p.media_product_type === "REELS") return KIND_LABEL.REELS;
  if (p.media_product_type === "STORY") return KIND_LABEL.STORIES;
  if (p.media_type === "CAROUSEL_ALBUM") return KIND_LABEL.CAROUSEL;
  if (p.media_type === "VIDEO") return tf("format.kind.VIDEO");
  return KIND_LABEL.IMAGE;
}

/** 백엔드 compose_caption 과 같은 규칙: 본문 + 빈 줄 + 해시태그 */
export function composeCaption(caption: string, hashtags: string[]) {
  const body = caption.trim();
  if (!hashtags.length) return body;
  return `${body}\n\n${hashtags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}`;
}

export function parseHashtags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#+/, "").trim())
    .filter(Boolean);
}

/** Instagram API 의 분류 값(dimension) → 화면 라벨 (모르는 값은 그대로) */
export const dimLabel = (key: string) => {
  const text = tf(`format.dim.${key}` as MessageKey);
  return text === `format.dim.${key}` ? key : text;
};

/** 초 → "1분 5초" / 밀리초 입력도 처리 */
export function fmtDuration(value: number | null | undefined, unit: "s" | "ms" = "ms") {
  if (value == null) return "—";
  const total = Math.round(unit === "ms" ? value / 1000 : value);
  if (total < 60) return tf("format.sec", { s: total });
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s ? tf("format.minSec", { m, s }) : tf("format.min", { m });
  return tf("format.hourMin", { h: Math.floor(m / 60), m: m % 60 });
}

/** 우리 서버가 제공하는 이미지(/api/py/media/…)는 접속 도메인과 무관하게 보이도록 상대 주소로 바꿉니다.
 *  아직 뒤에서 올리는 중인 동영상은 기기 안의 파일로 (바로 재생·편집). */
export function mediaSrc(url: string | undefined | null) {
  if (!url) return "";
  const local = localSrc(url);
  if (local) return local;
  const i = url.indexOf("/api/py/media/");
  return i >= 0 ? url.slice(i) : url;
}
