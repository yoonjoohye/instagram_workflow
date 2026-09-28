"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { BarList } from "@/components/charts";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplySummary, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconRefresh, IconReply, IconSpark } from "@/components/icons";
import { MIN_COMMENTS, SentimentBar, SentimentDialog } from "@/components/sentiment";
import { Badge, Button, Card, cx, Dialog, Empty, Notice, PageHeader, Segmented, Skeleton, Spinner, Switch } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { rich } from "@/i18n/rich";
import { api, toApiError, useApi } from "@/lib/api";
import { dimLabel, fmtCompact, fmtDuration, fmtInt, fmtPct, fmtRelative, postKind } from "@/lib/format";
import type { AutoReplyInput, AutoReplyRule, IgPost, Job, ListOf, PostDetailData, SentimentMediaSync } from "@/lib/types";

type SortKey = "timestamp" | "reach" | "views" | "likes" | "comments" | "saved" | "shares" | "rate";

const COLUMNS: { key: Exclude<SortKey, "timestamp">; label: MessageKey; hint?: MessageKey }[] = [
  { key: "reach", label: "posts.reach", hint: "posts.reachHint" },
  { key: "views", label: "posts.views", hint: "posts.viewsHint" },
  { key: "likes", label: "posts.likes" },
  { key: "comments", label: "posts.comments" },
  { key: "saved", label: "posts.saved" },
  { key: "shares", label: "posts.shares" },
  { key: "rate", label: "posts.rate", hint: "posts.rateHint" },
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
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Posts />
    </Suspense>
  );
}

function Posts() {
  const t = useT();
  const [limit, setLimit] = useState(24);
  const posts = useApi<ListOf<IgPost>>(`/posts?limit=${limit}`);
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
    posts.setData({ data: (posts.data?.data ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) });

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
              onChange={setLimit}
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
      className={cx("py-2.5 font-medium whitespace-nowrap", left ? "px-5 text-left" : "px-3 text-right", "last:pr-5")}
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
  const t = useT();
  if (loading) return <Skeleton className="h-[92px] rounded-xl" />;
  return (
    <div className={cx("rounded-xl border bg-surface-1 p-4", accent ? "border-accent/40" : "border-line")}>
      <p className="text-[13px] text-fg-3">
        {rich(t("posts.summaryCount", { title, n: fmtInt(s.count) }), { n: (chunk) => <span className="tnum">{chunk}</span> })}
      </p>
      <div className="mt-1 flex gap-8">
        <div>
          <p className="pnum text-xl font-semibold">{s.avgReach == null ? "—" : fmtCompact(Math.round(s.avgReach))}</p>
          <p className="text-[12px] text-fg-3">{t("posts.avgReach")}</p>
        </div>
        <div>
          <p className="pnum text-xl font-semibold">{fmtPct(s.avgRate)}</p>
          <p className="text-[12px] text-fg-3">{t("posts.avgRate")}</p>
        </div>
      </div>
    </div>
  );
}

function PostAutoReplyDialog({
  post,
  onClose,
  onSaved,
}: {
  post: IgPost;
  onClose: () => void;
  onSaved: (rule: AutoReplyRule) => void;
}) {
  const t = useT();
  const rule = useApi<AutoReplyRule>(`/autoreply/media/${post.id}`);
  const [form, setForm] = useState<AutoReplyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // 기존 게시물에서 여는 건 '설정하려는' 의도이므로 새 규칙도 켜진 상태로 시작합니다.
    // 기존 게시물에서 여는 건 '설정하려는' 의도이므로 새 규칙은 답글을 켠 상태로 시작합니다.
    if (rule.data) setForm(rule.data.exists ? autoReplyForm(rule.data) : { ...autoReplyForm(rule.data), public_reply_enabled: true });
  }, [rule.data]);

  const dirty = Boolean(rule.data && form && (!rule.data.exists || autoReplyDirty(rule.data, form)));
  const commentsOff = post.is_comment_enabled === false;

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api<AutoReplyRule>(`/autoreply/media/${post.id}`, {
        method: "PUT",
        json: {
          ...form,
          post_caption: (post.caption ?? "").slice(0, 500),
          post_thumbnail: post.thumbnail_url || post.media_url || "",
          post_permalink: post.permalink,
        },
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("posts.autoReplyTitle")}
      subtitle={
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbnail_url || post.media_url} alt="" className="size-6 rounded object-cover" />
          <span className="truncate">{post.caption?.split("\n")[0] || t("posts.noCaption")}</span>
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-fg-3">{t("posts.autoReplyFootnote")}</p>
          <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!form || !dirty || !autoReplyValid(form)}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      }
    >
      {commentsOff && (
        <div className="mb-4">
          <Notice tone="warn">{t("posts.autoReplyCommentsOff")}</Notice>
        </div>
      )}
      {form ? (
        <AutoReplyFields form={form} onChange={setForm} />
      ) : rule.error ? (
        <Notice tone="bad">{rule.error.message}</Notice>
      ) : (
        <Skeleton className="h-40" />
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Dialog>
  );
}

/** 행을 펼쳤을 때 보이는 상세: 댓글 반응 + 관리 */
function PostDetail({
  post,
  toggling,
  onToggleComments,
  onOpenComments,
  onOpenAutoReply,
  onAnalyzed,
}: {
  post: IgPost;
  toggling: boolean;
  onToggleComments: () => void;
  onOpenComments: () => void;
  onOpenAutoReply: () => void;
  onAnalyzed: (counts: IgPost["sentiment"]) => void;
}) {
  const t = useT();
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<{ tone: "good" | "warn" | "bad"; text: string }>();

  async function analyze() {
    setAnalyzing(true);
    setResult(undefined);
    try {
      const r = await api<SentimentMediaSync>(`/sentiment/media/${post.id}/sync`, { method: "POST" });
      onAnalyzed(r.counts);
      const engine =
        r.engine === "gemini"
          ? r.last_error
            ? t("posts.engineGeminiFailed", { error: r.last_error })
            : t("posts.engineGemini")
          : t("posts.engineRules");
      if (r.skipped) {
        setResult({ tone: "warn", text: t("posts.skipped", { min: MIN_COMMENTS, n: r.comments_count }) });
      } else if (r.comments_count > 0 && r.comments_seen === 0) {
        setResult({
          tone: "warn",
          text: t("posts.notFetched", { n: r.comments_count }),
        });
      } else {
        setResult({
          tone: r.last_error ? "warn" : "good",
          text: t("posts.analyzeResult", { seen: r.comments_seen, classified: r.classified, engine }),
        });
      }
    } catch (e) {
      setResult({ tone: "bad", text: toApiError(e).message });
    } finally {
      setAnalyzing(false);
    }
  }

  const commentsOn = post.is_comment_enabled ?? true;
  const ar = post.auto_reply;
  const analyzed = post.sentiment ? post.sentiment.positive + post.sentiment.neutral + post.sentiment.negative : 0;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <PostMetrics post={post} />
      <section className="rounded-lg border border-line bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">{t("posts.sentimentTitle")}</h3>
          <div className="flex items-center gap-1">
            {analyzed > 0 && (
              <button onClick={onOpenComments} className="h-7 rounded-md px-2 text-[12px] text-fg-3 hover:bg-surface-2 hover:text-fg">
                {t("posts.viewComments", { n: analyzed })}
              </button>
            )}
            {(post.comments_count ?? 0) >= MIN_COMMENTS && (
              <Button size="sm" onClick={analyze} loading={analyzing}>
                {analyzed > 0 ? t("posts.analyzeNew") : t("posts.analyze")}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3">
          {post.sentiment && analyzed > 0 ? (
            <SentimentBar counts={post.sentiment} height={10} showLabels />
          ) : (
            <p className="text-[12px] text-fg-3">
              {(post.comments_count ?? 0) >= MIN_COMMENTS
                ? t("posts.notAnalyzed")
                : t("posts.minComments", { min: MIN_COMMENTS, n: post.comments_count ?? 0 })}
            </p>
          )}
        </div>
        {result && (
          <p className={cx("mt-3 text-[12px] leading-relaxed", result.tone === "bad" ? "text-bad" : "text-fg-3")}>
            {result.tone === "warn" && "⚠ "}
            {result.text}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface-1 p-4">
        <h3 className="text-[13px] font-semibold">{t("posts.manage")}</h3>
        <dl className="mt-3 space-y-2.5 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-2">
              {t("posts.allowComments")}
              <span className={cx("ml-1.5 text-[12px] font-medium", commentsOn ? "text-fg" : "text-fg-3")}>
                {commentsOn ? t("posts.commentsOn") : t("posts.commentsOff")}
              </span>
            </dt>
            <dd className="flex items-center gap-2">
              {toggling && <Spinner className="size-3 text-fg-3" />}
              <Switch checked={commentsOn} onChange={onToggleComments} disabled={toggling} label={t("posts.allowComments")} />
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-2">
              {t("posts.autoReply")}
              <span className="ml-1.5 text-[12px] text-fg-3">
                {ar && ar.enabled ? autoReplySummary(ar, t) : ar ? t("posts.autoReplyPaused") : t("posts.autoReplyNotSet")}
              </span>
            </dt>
            <dd>
              <button
                onClick={onOpenAutoReply}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[12px] font-medium text-fg-2 hover:bg-surface-2"
              >
                <IconReply width={13} height={13} /> {t("posts.configure")}
              </button>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-fg-2">
              {t("posts.editDelete")}
              <span className="ml-1.5 text-[12px] text-fg-3">{t("posts.apiUnsupported")}</span>
            </dt>
            <dd>
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-fg-2 hover:bg-surface-2 hover:text-fg"
              >
                {t("posts.openInInstagram")} <IconExternal width={12} height={12} />
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

// 게시물 유형별로 보여줄 상세 지표 (값이 없는 지표는 자동으로 숨깁니다)
const DETAIL_TILES: Record<PostDetailData["kind"], { key: string; label: MessageKey; fmt?: (v: number) => string }[]> = {
  FEED: [
    { key: "reach", label: "posts.reach" },
    { key: "views", label: "posts.views" },
    { key: "profile_visits", label: "posts.profileVisits" },
    { key: "follows", label: "posts.follows" },
    { key: "saved", label: "posts.saved" },
    { key: "shares", label: "posts.shares" },
  ],
  REELS: [
    { key: "views", label: "posts.plays" },
    { key: "reach", label: "posts.reach" },
    { key: "ig_reels_avg_watch_time", label: "posts.avgWatchTime", fmt: (v) => fmtDuration(v, "ms") },
    { key: "ig_reels_video_view_total_time", label: "posts.totalWatchTime", fmt: (v) => fmtDuration(v, "ms") },
    { key: "reels_skip_rate", label: "posts.skipRate", fmt: (v) => fmtPct(v) },
    { key: "shares", label: "posts.shares" },
  ],
  STORY: [
    { key: "reach", label: "posts.reach" },
    { key: "views", label: "posts.views" },
    { key: "link_clicks", label: "posts.linkClicks" },
    { key: "replies", label: "posts.replies" },
    { key: "profile_visits", label: "posts.profileVisits" },
    { key: "follows", label: "posts.follows" },
  ],
};

/** 펼쳤을 때 불러오는 게시물 상세 지표 */
function PostMetrics({ post }: { post: IgPost }) {
  const t = useT();
  const detail = useApi<PostDetailData>(`/posts/${post.id}/detail`);
  const d = detail.data;
  const reach = d?.metrics.reach ?? 0;
  const followRate = d && reach ? ((d.metrics.follows ?? 0) / reach) * 100 : null;
  const visitRate = d && reach ? ((d.metrics.profile_visits ?? 0) / reach) * 100 : null;
  const topComments = [...(d?.comments ?? [])].sort((a, b) => b.like_count - a.like_count).slice(0, 3);

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 md:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{t("posts.detailMetrics")}</h3>
        {d && d.kind !== "REELS" && reach > 0 && (
          <span className="tnum text-[12px] text-fg-3">
            {t("posts.visitFollowRate", { visit: fmtPct(visitRate), follow: fmtPct(followRate) })}
          </span>
        )}
      </div>
      {detail.loading && !d ? (
        <Skeleton className="mt-3 h-16" />
      ) : detail.error ? (
        <p className="mt-3 text-[12px] text-bad">{detail.error.message}</p>
      ) : d ? (
        <div className="mt-3 space-y-4">
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {DETAIL_TILES[d.kind]
              .filter((tile) => d.metrics[tile.key] != null)
              .map((tile) => (
                <div key={tile.key} className="rounded-md bg-surface-2 px-3 py-2">
                  <dt className="text-[11px] text-fg-3">{t(tile.label)}</dt>
                  <dd className="pnum text-[15px] font-semibold">{tile.fmt ? tile.fmt(d.metrics[tile.key]) : fmtCompact(d.metrics[tile.key])}</dd>
                </div>
              ))}
          </dl>

          {(d.profile_activity.length > 0 || d.navigation.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {d.profile_activity.length > 0 && (
                <div>
                  <p className="mb-2 text-[12px] font-medium text-fg-2">{t("posts.profileActivity")}</p>
                  <BarList labelWidth={96} rows={d.profile_activity.map((r) => ({ key: r.key, label: dimLabel(r.key), value: r.value }))} />
                </div>
              )}
              {d.navigation.length > 0 && (
                <div>
                  <p className="mb-2 text-[12px] font-medium text-fg-2">{t("posts.storyNavigation")}</p>
                  <BarList labelWidth={120} rows={d.navigation.map((r) => ({ key: r.key, label: dimLabel(r.key), value: r.value }))} />
                </div>
              )}
            </div>
          )}

          {topComments.length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-fg-2">{t("posts.topComments")}</p>
              <ul className="space-y-1.5">
                {topComments.map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">@{c.username}</span> <span className="text-fg-2">{c.text}</span>
                    </span>
                    <span className="tnum shrink-0 text-[12px] text-fg-3">
                      ♥ {c.like_count} · {t("posts.replyCount", { n: c.reply_count })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
