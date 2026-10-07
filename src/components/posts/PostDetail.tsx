"use client";

/** 게시물을 펼쳤을 때: 상세 지표 · 댓글 반응 · 관리(댓글 허용, 자동 응답) */

import { useState } from "react";
import { BarList } from "@/components/charts";
import { autoReplySummary } from "@/components/AutoReplyCard";
import { IconExternal, IconReply } from "@/components/icons";
import { MIN_COMMENTS, SentimentBar } from "@/components/sentiment";
import { Button, cx, Skeleton, Spinner, Switch } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { api, toApiError, useApi } from "@/lib/api";
import { dimLabel, fmtCompact, fmtDuration, fmtPct } from "@/lib/format";
import type { IgPost, PostDetailData, SentimentMediaSync } from "@/lib/types";

/** 행을 펼쳤을 때 보이는 상세: 댓글 반응 + 관리 */
export function PostDetail({
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
export const DETAIL_TILES: Record<PostDetailData["kind"], { key: string; label: MessageKey; fmt?: (v: number) => string }[]> = {
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
export function PostMetrics({ post }: { post: IgPost }) {
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
