"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useMemo, useState } from "react";
import { IconRefresh, IconReply, IconSpark } from "@/components/icons";
import { SentimentDialog } from "@/components/sentiment";
import { Badge, Button, Card, cx, Empty, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { api, toApiError, useApi } from "@/lib/api";
import { fmtCompact, fmtPct, fmtRelative, postKind } from "@/lib/format";
import type { IgPost, Job, ListOf } from "@/lib/types";
import { COLUMNS, SortKey, metric } from "@/components/posts/metrics";
import { SortTh, SummaryTile } from "@/components/posts/tableParts";
import { PostDetail } from "@/components/posts/PostDetail";
import { PostAutoReplyDialog } from "@/components/posts/PostAutoReplyDialog";

export default function PostsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Posts />
    </Suspense>
  );
}

function Posts() {
  const t = useT();
  const [limit, setLimit] = useState(24);
  // 페이지마다 받은 '다음 페이지 커서'를 쌓아 두고 이전으로 돌아갈 땐 하나씩 뺍니다 (Instagram 은 커서로 페이지를 넘김).
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors[cursors.length - 1];
  const posts = useApi<ListOf<IgPost> & { paging?: { after: string | null } }>(
    `/posts?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
  );
  const page = cursors.length + 1;
  const nextCursor = posts.data?.paging?.after ?? null;
  const goPage = (next: string[]) => {
    setCursors(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const jobs = useApi<ListOf<Job>>("/workflow/jobs?limit=100");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "timestamp", desc: true });
  const [togglingId, setTogglingId] = useState<string>();
  const [sentimentPost, setSentimentPost] = useState<IgPost | null>(null);
  // 댓글 반응·관리는 행을 펼쳤을 때만 보여줍니다.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [actionError, setActionError] = useState<string>();
  // 자동 응답 페이지의 '수정' 링크가 ?autoreply=<media_id> 로 바로 열 수 있게 합니다.
  const params = useSearchParams();
  const router = useRouter();
  const editingId = params.get("autoreply");
  const editing = (posts.data?.data ?? []).find((p) => p.id === editingId) ?? null;
  const openAutoReply = (id: string | null) =>
    router.replace(id ? `/admin/posts?autoreply=${id}` : "/admin/posts", { scroll: false });

  const patchPost = (id: string, patch: Partial<IgPost>) =>
    posts.setData({ ...posts.data, data: (posts.data?.data ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  async function toggleComments(p: IgPost) {
    const next = !(p.is_comment_enabled ?? true);
    if (!next && !window.confirm(t("posts.confirmCommentsOff"))) return;
    setTogglingId(p.id);
    setActionError(undefined);
    try {
      const r = await api<{ is_comment_enabled: boolean }>(`/posts/${p.id}/comments`, { method: "POST", json: { enabled: next } });
      patchPost(p.id, { is_comment_enabled: r.is_comment_enabled });
    } catch (e) {
      setActionError(toApiError(e).message);
    } finally {
      setTogglingId(undefined);
    }
  }

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
        title={t("posts.title")}
        description={t("posts.description")}
        action={
          <>
            <Segmented
              ariaLabel={t("posts.countAria")}
              value={limit}
              onChange={(n) => {
                setLimit(n);
                setCursors([]); // 개수를 바꾸면 첫 페이지부터
              }}
              options={[
                { value: 12, label: t("posts.countOption", { n: 12 }) },
                { value: 24, label: t("posts.countOption", { n: 24 }) },
                { value: 50, label: t("posts.countOption", { n: 50 }) },
              ]}
            />
            <Button variant="ghost" size="sm" onClick={posts.reload} loading={posts.loading}>
              {!posts.loading && <IconRefresh />} {t("common.refresh")}
            </Button>
          </>
        }
      />

      <div className="mb-6">
        <Notice tone="neutral" title={t("posts.noticeTitle")}>
          {rich(t("posts.noticeBody"), { b: (chunk) => <b>{chunk}</b> })}
        </Notice>
      </div>

      {actionError && (
        <div className="mb-6">
          <Notice tone="bad" onClose={() => setActionError(undefined)}>
            {actionError}
          </Notice>
        </div>
      )}

      {posts.error && (
        <div className="mb-6">
          <Notice tone="bad" title={t("posts.loadFailed")}>
            {posts.error.message}
          </Notice>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <SummaryTile title={t("posts.summaryAll")} s={summary.all} loading={posts.loading && !posts.data} />
        <SummaryTile title={t("posts.summaryStudio")} s={summary.studio} loading={posts.loading && !posts.data} accent />
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
            <Empty title={t("posts.empty")} />
          </div>
        ) : (
          <>
          {/* 휴대폰: 카드 목록 */}
          <div className="md:hidden">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <label htmlFor="post-sort" className="text-[12px] text-fg-3">
                {t("posts.sort")}
              </label>
              <select
                id="post-sort"
                value={sort.key}
                onChange={(e) => setSort({ key: e.target.value as SortKey, desc: true })}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-1 px-2 text-sm"
              >
                <option value="timestamp">{t("posts.sortNewest")}</option>
                {COLUMNS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {t(c.label)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSort((s) => ({ ...s, desc: !s.desc }))}
                className="h-9 shrink-0 rounded-lg border border-line-strong px-3 text-[13px] text-fg-2"
                aria-label={sort.desc ? t("posts.sortDescAria") : t("posts.sortAscAria")}
              >
                {sort.desc ? t("posts.sortDesc") : t("posts.sortAsc")}
              </button>
            </div>
            <ul className="tnum divide-y divide-line">
              {rows.map((p) => {
                const open = expanded.has(p.id);
                return (
                  <li key={p.id} className={cx(open && "bg-surface-2")}>
                    <button
                      type="button"
                      onClick={() => toggleRow(p.id)}
                      aria-expanded={open}
                      className="grid w-full grid-cols-[56px_minmax(0,1fr)_18px] items-start gap-x-3 px-4 py-3 text-left active:bg-surface-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumbnail_url || p.media_url} alt="" className="size-14 shrink-0 rounded-md object-cover" loading="lazy" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{p.caption?.split("\n")[0] || t("posts.noCaption")}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
                          {postKind(p)} · {fmtRelative(p.timestamp)}
                          {studioIds.has(p.id) && (
                            <Badge tone="accent" icon={<IconSpark width={11} height={11} />}>
                              {t("posts.badgeStudio")}
                            </Badge>
                          )}
                          {p.auto_reply?.enabled && (
                            <Badge tone="accent" icon={<IconReply width={11} height={11} />}>
                              {t("posts.badgeAutoReply")}
                            </Badge>
                          )}
                        </span>
                      </span>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={cx("mt-1 shrink-0 text-fg-3 transition-transform", open && "rotate-180")}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                      <span className="col-span-3 mt-2.5 grid grid-cols-4 gap-2 text-[12px]">
                        {([
                          ["posts.reach", fmtCompact(p.insights?.reach)],
                          ["posts.likes", fmtCompact(metric(p, "likes"))],
                          ["posts.comments", fmtCompact(metric(p, "comments"))],
                          ["posts.rate", fmtPct(metric(p, "rate"))],
                        ] as const).map(([label, value]) => (
                          <span key={label} className="min-w-0">
                            <span className="block truncate text-[11px] text-fg-3">{t(label)}</span>
                            <span className="block font-semibold text-fg">{value}</span>
                          </span>
                        ))}
                      </span>
                    </button>
                    {open && (
                      <div className="px-3 pb-4">
                        <PostDetail
                          post={p}
                          toggling={togglingId === p.id}
                          onToggleComments={() => toggleComments(p)}
                          onOpenComments={() => setSentimentPost(p)}
                          onAnalyzed={(counts) => patchPost(p.id, { sentiment: counts })}
                          onOpenAutoReply={() => openAutoReply(p.id)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* 태블릿·데스크톱: 표 */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="border-b border-line text-left text-fg-3">
                <tr>
                  <SortTh label={t("posts.colPost")} active={sort.key === "timestamp"} desc={sort.desc} onClick={() => onSort("timestamp")} left />
                  {COLUMNS.map((c) => (
                    <SortTh
                      key={c.key}
                      label={t(c.label)}
                      hint={c.hint && t(c.hint)}
                      active={sort.key === c.key}
                      desc={sort.desc}
                      onClick={() => onSort(c.key)}
                    />
                  ))}
                  <th className="w-12 pr-4" aria-label={t("posts.detailAria")} />
                </tr>
              </thead>
              <tbody className="tnum">
                {rows.map((p) => {
                  const open = expanded.has(p.id);
                  return (
                    <Fragment key={p.id}>
                      <tr
                        onClick={() => toggleRow(p.id)}
                        className={cx("cursor-pointer border-b border-line hover:bg-surface-2", open && "bg-surface-2 border-b-0")}
                      >
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.thumbnail_url || p.media_url} alt="" className="size-11 shrink-0 rounded-md object-cover" loading="lazy" />
                            <span className="min-w-0 max-w-[300px]">
                              <span className="block truncate font-medium">{p.caption?.split("\n")[0] || t("posts.noCaption")}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-3">
                                {postKind(p)} · {fmtRelative(p.timestamp)}
                                {studioIds.has(p.id) && (
                                  <Badge tone="accent" icon={<IconSpark width={11} height={11} />}>
                                    {t("posts.badgeStudio")}
                                  </Badge>
                                )}
                                {p.auto_reply?.enabled && (
                                  <Badge tone="accent" icon={<IconReply width={11} height={11} />}>
                                    {t("posts.badgeAutoReply")}
                                  </Badge>
                                )}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-medium">{fmtCompact(p.insights?.reach)}</span>
                            <span className="hidden h-2 w-16 overflow-hidden rounded-full bg-surface-1 lg:block" aria-hidden>
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
                        <td className="px-3 py-2.5 text-right font-medium">{fmtPct(metric(p, "rate"))}</td>
                        <td className="pr-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRow(p.id);
                            }}
                            aria-expanded={open}
                            aria-label={open ? t("posts.detailClose") : t("posts.detailOpen")}
                            className="inline-flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-surface-1 hover:text-fg"
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={cx("transition-transform", open && "rotate-180")}
                              aria-hidden
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-line bg-surface-2">
                          <td colSpan={9} className="px-5 pt-1 pb-4">
                            <PostDetail
                              post={p}
                              toggling={togglingId === p.id}
                              onToggleComments={() => toggleComments(p)}
                              onOpenComments={() => setSentimentPost(p)}
                              onAnalyzed={(counts) => patchPost(p.id, { sentiment: counts })}
                              onOpenAutoReply={() => openAutoReply(p.id)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      {(page > 1 || nextCursor) && (
        <nav aria-label={t("posts.pagination")} className="mt-4 flex items-center justify-center gap-3">
          <Button size="sm" disabled={page === 1 || posts.loading} onClick={() => goPage(cursors.slice(0, -1))}>
            ← {t("posts.prev")}
          </Button>
          <span className="tnum min-w-[4.5rem] text-center text-[13px] text-fg-2">{t("posts.page", { n: page })}</span>
          <Button size="sm" disabled={!nextCursor || posts.loading} onClick={() => nextCursor && goPage([...cursors, nextCursor])}>
            {t("posts.next")} →
          </Button>
        </nav>
      )}
      {sentimentPost && <SentimentDialog post={sentimentPost} onClose={() => setSentimentPost(null)} />}

      {editing && (
        <PostAutoReplyDialog
          post={editing}
          onClose={() => openAutoReply(null)}
          onSaved={(rule) =>
            patchPost(editing.id, {
              auto_reply: rule.id
                ? { id: rule.id, enabled: rule.enabled, public_reply_enabled: rule.public_reply_enabled, dm_enabled: rule.dm_enabled }
                : null,
            })
          }
        />
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-fg-3">
        {t("posts.footnote")}
      </p>
    </>
  );
}
