"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconRefresh, IconReply, IconSpark } from "@/components/icons";
import { Badge, Button, Card, cx, Dialog, Empty, Notice, PageHeader, Segmented, Skeleton, Spinner } from "@/components/ui";
import { api, toApiError, useApi } from "@/lib/api";
import { fmtCompact, fmtInt, fmtPct, fmtRelative, postKind } from "@/lib/format";
import type { AutoReplyInput, AutoReplyRule, IgPost, Job, ListOf } from "@/lib/types";

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
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Posts />
    </Suspense>
  );
}

function Posts() {
  const [limit, setLimit] = useState(24);
  const posts = useApi<ListOf<IgPost>>(`/posts?limit=${limit}`);
  const jobs = useApi<ListOf<Job>>("/workflow/jobs?limit=100");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "timestamp", desc: true });
  const [togglingId, setTogglingId] = useState<string>();
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
    if (!next && !window.confirm("이 게시물의 댓글을 끌까요? 새 댓글을 달 수 없게 되고, 자동 응답도 동작하지 않습니다.")) return;
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

      <div className="mb-6">
        <Notice tone="neutral" title="기존 게시물에서 할 수 있는 것">
          여기서는 <b>댓글 켜기/끄기</b>와 <b>댓글 자동 응답</b>을 바꿀 수 있습니다. 캡션 수정과 삭제는 Instagram API 가 지원하지 않아
          (삭제는 Facebook 페이지 연결 계정만 가능) 각 게시물의 &lsquo;Instagram&rsquo; 링크에서 앱으로 처리해 주세요.
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
            <table className="w-full min-w-[1080px] text-[13px]">
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
                  <th className="px-5 py-2.5 text-left font-medium">관리</th>
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
                    <td className="px-3 py-2.5 text-right font-medium">{fmtPct(metric(p, "rate"))}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <button
                          onClick={() => toggleComments(p)}
                          disabled={togglingId === p.id}
                          title="댓글 허용 여부"
                          className={cx(
                            "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-medium",
                            (p.is_comment_enabled ?? true) ? "border-line-strong text-fg-2 hover:bg-surface-2" : "border-warn/50 bg-warn/10 text-fg",
                          )}
                        >
                          {togglingId === p.id && <Spinner className="size-3" />}
                          {(p.is_comment_enabled ?? true) ? "댓글 켜짐" : "댓글 꺼짐"}
                        </button>
                        <button
                          onClick={() => openAutoReply(p.id)}
                          className={cx(
                            "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-medium",
                            p.auto_reply?.enabled ? "border-accent/50 bg-accent/10 text-fg" : "border-line-strong text-fg-2 hover:bg-surface-2",
                          )}
                        >
                          <IconReply width={13} height={13} />
                          {p.auto_reply ? (p.auto_reply.enabled ? "자동 응답 켜짐" : "자동 응답 꺼짐") : "자동 응답"}
                        </button>
                        <a
                          href={p.permalink}
                          target="_blank"
                          rel="noreferrer"
                          title="캡션 수정·삭제는 Instagram 앱에서"
                          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-fg-3 hover:bg-surface-2 hover:text-fg"
                        >
                          Instagram <IconExternal width={12} height={12} />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <PostAutoReplyDialog
          post={editing}
          onClose={() => openAutoReply(null)}
          onSaved={(rule) => patchPost(editing.id, { auto_reply: rule.id ? { id: rule.id, enabled: rule.enabled } : null })}
        />
      )}

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

function PostAutoReplyDialog({
  post,
  onClose,
  onSaved,
}: {
  post: IgPost;
  onClose: () => void;
  onSaved: (rule: AutoReplyRule) => void;
}) {
  const rule = useApi<AutoReplyRule>(`/autoreply/media/${post.id}`);
  const [form, setForm] = useState<AutoReplyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // 기존 게시물에서 여는 건 '설정하려는' 의도이므로 새 규칙도 켜진 상태로 시작합니다.
    if (rule.data) setForm(rule.data.exists ? autoReplyForm(rule.data) : { ...autoReplyForm(rule.data), enabled: true });
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
      title="댓글 자동 응답"
      subtitle={
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbnail_url || post.media_url} alt="" className="size-6 rounded object-cover" />
          <span className="truncate">{post.caption?.split("\n")[0] || "(캡션 없음)"}</span>
        </span>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-fg-3">저장하면 새 댓글부터 적용됩니다.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              취소
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!form || !dirty || !autoReplyValid(form)}>
              저장
            </Button>
          </div>
        </div>
      }
    >
      {commentsOff && (
        <div className="mb-4">
          <Notice tone="warn">이 게시물은 댓글이 꺼져 있어 자동 응답이 동작하지 않습니다.</Notice>
        </div>
      )}
      {form ? (
        <AutoReplyFields form={form} onChange={setForm} published />
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
