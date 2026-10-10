"use client";

/** 내 피드에서 보기: 프로필 격자(3열, 세로 3:4 칸)의 맨 앞에 새 게시물을 넣어 최근 게시물들과 함께 보여 줍니다.
 *  피드 통일감(색·톤)이 맞는지 올리기 전에 확인하려고. */

import { useT } from "@/i18n/client";
import { useApi } from "@/lib/api";
import { cx, Skeleton } from "@/components/ui";

type FeedItem = { id: string; thumb: string; permalink: string; media_type: string };

/** covers: 새로 올릴 게시물 그림 (프로필에 보이는 순서, 왼쪽 위부터 — 그리드 분할이면 여러 장) */
export function FeedGrid({ covers, rows = 4, compact }: { covers: string[]; rows?: number; compact?: boolean }) {
  const t = useT();
  const shown = Math.max(rows * 3, covers.length + 3);
  const feed = useApi<{ data: FeedItem[] }>(`/studio/feed?limit=${Math.min(24, Math.max(3, shown - covers.length))}`);
  if (feed.error) return <p className="py-6 text-center text-[12px] text-fg-3">{t("growth.feedFail", { e: feed.error.message })}</p>;
  return (
    <div>
      {!compact && <p className="mb-2 text-[12px] text-fg-3">{feed.data && !feed.data.data.length ? t("growth.feedEmpty") : t("growth.feedHint")}</p>}
      {/* 칸 사이 간격은 인스타 프로필처럼 아주 얇게 (조각을 이어 붙였을 때 실제처럼 보이게) */}
      <div className={cx("grid grid-cols-3 gap-px overflow-hidden rounded-md", covers.length > 1 ? "bg-black" : "bg-transparent")}>
        {(covers.length ? covers : [""]).map((src, i) => (
          <div key={`new${i}`} className="relative aspect-[3/4] bg-surface-2">
            {/* 4:5 게시물은 프로필에서 가운데 3:4 만 보임 — object-cover 가 같은 부분을 보여 줌 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src && <img src={src} alt="" className="h-full w-full object-cover" />}
            {covers.length <= 1 && <span className="absolute inset-0 ring-2 ring-inset ring-accent" aria-hidden />}
            {i === 0 && <span className="absolute top-1 left-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">{t("growth.feedNew")}</span>}
          </div>
        ))}
        {feed.loading && !feed.data
          ? Array.from({ length: shown - Math.max(1, covers.length) }, (_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-none" />)
          : (feed.data?.data ?? []).slice(0, shown - Math.max(1, covers.length)).map((m) => (
              <a key={m.id} href={m.permalink} target="_blank" rel="noreferrer" className="relative block aspect-[3/4] bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                {m.media_type === "CAROUSEL_ALBUM" && <span className="absolute top-1 right-1 text-[11px] text-white drop-shadow">❐</span>}
                {m.media_type === "VIDEO" && <span className="absolute top-1 right-1 text-[11px] text-white drop-shadow">▶</span>}
              </a>
            ))}
      </div>
    </div>
  );
}

/** 게시 후 성과 (도달·좋아요·댓글·저장·공유) — 크론이 하루 한 번 모음 */
export function PerfStats({ perf }: { perf?: { reach: number; likes: number; comments: number; saved: number; shares: number } | null }) {
  const t = useT();
  if (!perf) return <p className="text-[12px] text-fg-3">{t("growth.perfPending")}</p>;
  const items = [
    ["reach", perf.reach],
    ["likes", perf.likes],
    ["comments", perf.comments],
    ["saved", perf.saved],
    ["shares", perf.shares],
  ] as const;
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg-2">{t("growth.perfTitle")}</p>
      <dl className="grid grid-cols-5 gap-1 text-center">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-md bg-surface-2 px-1 py-1.5">
            <dd className="tnum text-[14px] font-semibold">{v.toLocaleString()}</dd>
            <dt className="text-[10px] text-fg-3">{t(`growth.${k}`)}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
