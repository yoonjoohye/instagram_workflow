import type { IgPost, JobStatus, MediaKind, MetricKey } from "./types";

const intFmt = new Intl.NumberFormat("ko-KR");
const compactFmt = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : intFmt.format(n));

/** 1,284 / 1.2만 처럼 자리수에 따라 줄여서 표시 */
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
  return new Date(iso).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR");
}

export const METRIC_LABEL: Record<MetricKey, string> = {
  reach: "도달 계정",
  profile_views: "프로필 조회",
  accounts_engaged: "참여 계정",
  total_interactions: "총 상호작용",
  website_clicks: "웹사이트 클릭",
};

export const METRIC_HINT: Record<MetricKey, string> = {
  reach: "게시물·스토리·프로필을 한 번 이상 본 고유 계정 수",
  profile_views: "프로필이 조회된 횟수",
  accounts_engaged: "좋아요·댓글·저장·공유 등으로 반응한 고유 계정 수",
  total_interactions: "좋아요+댓글+저장+공유+답장의 합",
  website_clicks: "프로필의 웹사이트 링크를 누른 횟수",
};

export const KIND_LABEL: Record<MediaKind, string> = {
  IMAGE: "이미지",
  CAROUSEL: "캐러셀",
  REELS: "릴스",
  STORIES: "스토리",
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  draft: "초안",
  generating: "생성 중",
  ready: "검수 대기",
  publishing: "발행 중",
  published: "게시됨",
  failed: "실패",
};

export function postKind(p: IgPost): string {
  if (p.media_product_type === "REELS") return "릴스";
  if (p.media_product_type === "STORY") return "스토리";
  if (p.media_type === "CAROUSEL_ALBUM") return "캐러셀";
  if (p.media_type === "VIDEO") return "동영상";
  return "이미지";
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
