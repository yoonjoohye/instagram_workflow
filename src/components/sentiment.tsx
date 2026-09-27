"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { fmtInt, fmtRelative } from "@/lib/format";
import type { IgPost, ListOf, Sentiment, SentimentComment, SentimentCounts } from "@/lib/types";
import { Badge, cx, Dialog, Empty, Notice, Segmented, Skeleton } from "./ui";

// 발산형: 긍정(파랑) ↔ 보통(회색) ↔ 부정(빨강). 막대 순서도 이 순서로 고정합니다.
export const SENTIMENTS: { key: Sentiment; label: string; color: string }[] = [
  { key: "positive", label: "긍정", color: "var(--sent-pos)" },
  { key: "neutral", label: "보통", color: "var(--sent-neu)" },
  { key: "negative", label: "부정", color: "var(--sent-neg)" },
];

const total = (c: SentimentCounts) => c.positive + c.neutral + c.negative;

/** 긍정/보통/부정 누적 막대. 세그먼트 사이는 2px 표면색 간격, 색만으로 구분하지 않도록 수치를 함께 둡니다. */
export function SentimentBar({ counts, height = 8, showLabels }: { counts: SentimentCounts; height?: number; showLabels?: boolean }) {
  const n = total(counts);
  if (!n) return <span className="text-[12px] text-fg-3">—</span>;
  const title = SENTIMENTS.map((s) => `${s.label} ${counts[s.key]}`).join(" · ");
  return (
    <div className="min-w-0" title={title}>
      <div className="flex w-full gap-[2px] overflow-hidden rounded-[4px]" style={{ height }} role="img" aria-label={`댓글 반응: ${title}`}>
        {SENTIMENTS.filter((s) => counts[s.key] > 0).map((s) => (
          <span key={s.key} style={{ width: `${(counts[s.key] / n) * 100}%`, background: s.color }} />
        ))}
      </div>
      {showLabels && (
        <div className="tnum mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-fg-2">
          {SENTIMENTS.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-[2px]" style={{ background: s.color }} />
              {s.label} {fmtInt(counts[s.key])}
              <span className="text-fg-3">({Math.round((counts[s.key] / n) * 100)}%)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function SentimentChip({ value }: { value: Sentiment }) {
  const s = SENTIMENTS.find((x) => x.key === value)!;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[12px] font-medium text-fg-2">
      <span className="inline-block size-2 rounded-[2px]" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

type Filter = "all" | Sentiment;

export function SentimentDialog({ post, onClose }: { post: IgPost; onClose: () => void }) {
  const comments = useApi<ListOf<SentimentComment>>(`/sentiment/media/${post.id}`);
  const [filter, setFilter] = useState<Filter>("all");
  const rows = (comments.data?.data ?? []).filter((c) => filter === "all" || c.sentiment === filter);
  const counts = post.sentiment;

  return (
    <Dialog
      open
      onClose={onClose}
      title="댓글 반응"
      subtitle={
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbnail_url || post.media_url} alt="" className="size-6 rounded object-cover" />
          <span className="truncate">{post.caption?.split("\n")[0] || "(캡션 없음)"}</span>
        </span>
      }
    >
      {counts && total(counts) > 0 && (
        <div className="mb-4">
          <SentimentBar counts={counts} height={12} showLabels />
        </div>
      )}
      <div className="mb-3">
        <Segmented
          size="sm"
          ariaLabel="감정 필터"
          value={filter}
          onChange={setFilter}
          options={[{ value: "all" as Filter, label: "전체" }, ...SENTIMENTS.map((s) => ({ value: s.key as Filter, label: s.label }))]}
        />
      </div>
      {comments.loading && !comments.data ? (
        <Skeleton className="h-32" />
      ) : comments.error ? (
        <Notice tone="bad">{comments.error.message}</Notice>
      ) : rows.length === 0 ? (
        <Empty title={filter === "all" ? "분석된 댓글이 없습니다" : "해당하는 댓글이 없습니다"}>
          {filter === "all" && "상단의 '댓글 분석'을 눌러 최근 댓글을 분류하세요."}
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.comment_id} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:underline">
                  @{c.username || "알 수 없음"}
                </a>
                <span className="flex items-center gap-2">
                  <SentimentChip value={c.sentiment} />
                  <span className="text-[12px] text-fg-3">{fmtRelative(c.commented_at)}</span>
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-fg">{c.text}</p>
              {c.reason && (
                <p className={cx("mt-0.5 text-[12px] text-fg-3")}>
                  {c.reason}
                  {c.classified_by === "rules" && <Badge>규칙</Badge>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
