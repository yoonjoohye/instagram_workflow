/** 게시물 성과 표의 열과 값 계산 */

import type { MessageKey } from "@/i18n/core";
import type { IgPost } from "@/lib/types";

export type SortKey = "timestamp" | "reach" | "views" | "likes" | "comments" | "saved" | "shares" | "rate";

export const COLUMNS: { key: Exclude<SortKey, "timestamp">; label: MessageKey; hint?: MessageKey }[] = [
  { key: "reach", label: "posts.reach", hint: "posts.reachHint" },
  { key: "views", label: "posts.views", hint: "posts.viewsHint" },
  { key: "likes", label: "posts.likes" },
  { key: "comments", label: "posts.comments" },
  { key: "saved", label: "posts.saved" },
  { key: "shares", label: "posts.shares" },
  { key: "rate", label: "posts.rate", hint: "posts.rateHint" },
];

export function metric(p: IgPost, key: SortKey): number | null {
  const i = p.insights ?? {};
  switch (key) {
    case "timestamp":
      return new Date(p.timestamp).getTime();
    case "likes":
      return i.likes ?? p.like_count ?? null;
    case "comments":
      return i.comments ?? p.comments_count ?? null;
    case "rate": {
      if (!i.reach) return null;
      const inter = i.total_interactions ?? (i.likes ?? 0) + (i.comments ?? 0) + (i.saved ?? 0) + (i.shares ?? 0);
      return (inter / i.reach) * 100;
    }
    default:
      return i[key] ?? null;
  }
}
