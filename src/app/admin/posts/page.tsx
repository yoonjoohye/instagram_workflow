"use client";

import { useMemo, useState } from "react";
import { IconExternal, IconRefresh, IconSpark } from "@/components/icons";
import { Badge, Button, Card, cx, Empty, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtCompact, fmtInt, fmtPct, fmtRelative, postKind } from "@/lib/format";
import type { IgPost, Job, ListOf } from "@/lib/types";

type SortKey = "timestamp" | "reach" | "views" | "likes" | "comments" | "saved" | "shares" | "rate";

const COLUMNS: { key: Exclude<SortKey, "timestamp">; label: string; hint: string }[] = [
  { key: "reach", label: "도달", hint: "게시물을 본 고유 계정 수" },
  { key: "views", label: "조회", hint: "재생·노출 횟수 (같은 계정의 반복 포함)" },
  { key: "likes", label: "좋아요", hint: "" },
  { key: "comments", label: "댓글", hint: "" },
  { key: "saved", label: "저장", hint: "" },
  { key: "shares", label: "공유", hint: "" },
  { key: "rate", label: "참여율", hint: "(좋아요+댓글+저장+공유) ÷ 도달" },
];

function metric(p: IgPost, key: SortKey): number | null {
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

export default function PostsPage() {
  const [limit, setLimit] = useState(24);
  const posts = useApi<ListOf<IgPost>>(`/posts?limit=${limit}`);
  const jobs = useApi<ListOf<Job>>("/workflow/jobs?limit=100");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "timestamp", desc: true });

  // 스튜디오에서 만든 게시물 표시 — 자동 생성 콘텐츠의 성과를 따로 볼 수 있게
  const studioIds = useMemo(
    () => new Set((jobs.data?.data ?? []).map((j) => j.ig_media_id).filter(Boolean)),
    [jobs.data],
  );

  const rows = useMemo(() => {
    const list = [...(posts.data?.data ?? [])];
    list.sort((a, b) => {
      const av = metric(a, sort.key) ?? -Infinity;
      const bv = metric(b, sort.key) ?? -Infinity;
      return sort.desc ? bv - av : av - bv;
    });
    return list;
  }, [posts.data, sort]);

  const maxReach = Math.max(1, ...rows.map((p) => p.insights?.reach ?? 0));

  const summary = useMemo(() => {
    const all = posts.data?.data ?? [];
    const pick = (onlyStudio: boolean) => {
      const set = all.filter((p) => !onlyStudio || studioIds.has(p.id));
      const withReach = set.filter((p) => p.insights?.reach != null);
      const reach = withReach.reduce((s, p) => s + (p.insights.reach ?? 0), 0);
      const rates = withReach.map((p) => metric(p, "rate")).filter((v): v is number => v != null);
      return {
        count: set.length,
        avgReach: withReach.length ? reach / withReach.length : null,
        avgRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
      };
    };
    return { all: pick(false), studio: pick(true) };
  }, [posts.data, studioIds]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }));

  return (
    <>
      <PageHeader
        title="게시물 성과"
        description="게시물마다 몇 개의 계정에 보였고 얼마나 반응을 얻었는지"
        action={
          <>
            <Segmented
              ariaLabel="게시물 수"
              value={limit}
              onChange={setLimit}
              options={[
                { value: 12, label: "12개" },
                { value: 24, label: "24개" },
                { value: 50, label: "50개" },
              ]}
            />
            <Button variant="ghost" size="sm" onClick={posts.reload} loading={posts.loading}>
              {!posts.loading && <IconRefresh />} 새로고침
            </Button>
          </>
        }
      />

      {posts.error && (
        <div className="mb-6">
          <Notice tone="bad" title="게시물을 불러오지 못했습니다">
            {posts.error.message}
          </Notice>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <SummaryTile title="전체 게시물" s={summary.all} loading={posts.loading && !posts.data} />
        <SummaryTile title="스튜디오에서 만든 게시물" s={summary.studio} loading={posts.loading && !posts.data} accent />
      </div>

      <Card bodyClassName="px-0 pb-0 pt-0">
        {posts.loading && !posts.data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-5">
            <Empty title="게시물이 없습니다" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-[13px]">
              <thead className="border-b border-line text-left text-fg-3">
                <tr>
                  <SortTh label="게시물" active={sort.key === "timestamp"} desc={sort.desc} onClick={() => onSort("timestamp")} left />
                  {COLUMNS.map((c) => (
                    <SortTh
                      key={c.key}
                      label={c.label}
                      hint={c.hint}
                      active={sort.key === c.key}
                      desc={sort.desc}
                      onClick={() => onSort(c.key)}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <a href={p.permalink} target="_blank" rel="noreferrer" className="group flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumbnail_url || p.media_url} alt="" className="size-11 shrink-0 rounded-md object-cover" loading="lazy" />
                        <span className="min-w-0 max-w-[260px]">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium group-hover:underline">
                              {p.caption?.split("\n")[0] || "(캡션 없음)"}
                            </span>
                            <IconExternal className="shrink-0 text-fg-3" />
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
                            {postKind(p)} · {fmtRelative(p.timestamp)}
                            {studioIds.has(p.id) && (
                              <Badge tone="accent" icon={<IconSpark width={11} height={11} />}>
                                스튜디오
                              </Badge>
                            )}
                          </span>
                        </span>
                      </a>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <span className="font-medium">{fmtCompact(p.insights?.reach)}</span>
                        <span className="hidden h-2 w-16 overflow-hidden rounded-full bg-surface-2 lg:block" aria-hidden>
                          <span
                            className="block h-full rounded-r"
                            style={{ width: `${((p.insights?.reach ?? 0) / maxReach) * 100}%`, background: "var(--seq-bar)" }}
                          />
                        </span>
                      </div>
                    </td>
                    {(["views", "likes", "comments", "saved", "shares"] as const).map((k) => (
                      <td key={k} className="px-3 py-2.5 text-right text-fg-2">
                        {fmtCompact(metric(p, k))}
                      </td>
                    ))}
                    <td className="px-5 py-2.5 text-right font-medium">{fmtPct(metric(p, "rate"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 text-[12px] leading-relaxed text-fg-3">
        도달은 게시물을 본 고유 계정 수입니다. Instagram 은 게시물을 본 개별 계정 목록을 제공하지 않으므로, 계정 단위로는{" "}
        <a href="/admin/visitors" className="underline">
          반응한 계정
        </a>
        에서 댓글·멘션을 남긴 사용자만 확인할 수 있습니다. 스토리는 게시 후 24시간이 지나면 인사이트가 사라집니다.
      </p>
    </>
  );
}

function SortTh({
  label,
  hint,
  active,
  desc,
  onClick,
  left,
}: {
  label: string;
  hint?: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  left?: boolean;
}) {
  return (
    <th
      className={cx("py-2.5 font-medium", left ? "px-5 text-left" : "px-3 text-right", "last:pr-5")}
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
    >
      <button onClick={onClick} title={hint || undefined} className={cx("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}>
        {label}
        <span className="text-[10px]">{active ? (desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}

function SummaryTile({
  title,
  s,
  loading,
  accent,
}: {
  title: string;
  s: { count: number; avgReach: number | null; avgRate: number | null };
  loading: boolean;
  accent?: boolean;
}) {
  if (loading) return <Skeleton className="h-[92px] rounded-xl" />;
  return (
    <div className={cx("rounded-xl border bg-surface-1 p-4", accent ? "border-accent/40" : "border-line")}>
      <p className="text-[13px] text-fg-3">
        {title} · <span className="tnum">{fmtInt(s.count)}</span>개
      </p>
      <div className="mt-1 flex gap-8">
        <div>
          <p className="pnum text-xl font-semibold">{s.avgReach == null ? "—" : fmtCompact(Math.round(s.avgReach))}</p>
          <p className="text-[12px] text-fg-3">평균 도달</p>
        </div>
        <div>
          <p className="pnum text-xl font-semibold">{fmtPct(s.avgRate)}</p>
          <p className="text-[12px] text-fg-3">평균 참여율</p>
        </div>
      </div>
    </div>
  );
}
