"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { BarList, Legend, LineChart, StatTile, type LineSeries } from "@/components/charts";
import { IconRefresh } from "@/components/icons";
import { Avatar, Button, Card, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtInt, fmtRelative, METRIC_HINT, METRIC_LABEL, postKind } from "@/lib/format";
import type { AudienceDetail, Breakdowns, IgPost, ListOf, MetricKey, Overview, SentimentOverview } from "@/lib/types";
import { AudienceDetailCard, ContentTypeCard, EngagementCard, FollowSplitCard, OnlineHoursCard } from "@/components/insightCards";
import { MIN_COMMENTS, SentimentBar } from "@/components/sentiment";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";

const TILE_METRICS: MetricKey[] = ["reach", "profile_views", "accounts_engaged", "total_interactions", "website_clicks"];

// 카테고리 색은 지표(엔티티)를 따라갑니다 — 필터로 숨겨도 남은 계열의 색이 바뀌지 않습니다.
const CHART_METRICS: { key: MetricKey; color: string }[] = [
  { key: "reach", color: "var(--series-1)" },
  { key: "profile_views", color: "var(--series-2)" },
  { key: "accounts_engaged", color: "var(--series-3)" },
];


export default function DashboardPage() {
  const { me } = useMe();
  const t = useT();
  const [days, setDays] = useState(30);
  const overview = useApi<Overview>(`/insights/overview?days=${days}`);
  const posts = useApi<ListOf<IgPost>>("/posts?limit=12");
  const breakdowns = useApi<Breakdowns>(`/insights/breakdowns?days=${days}`);
  const audience = useApi<AudienceDetail>("/insights/audience-detail");

  const refreshAll = () => {
    overview.reload();
    posts.reload();
    breakdowns.reload();
    audience.reload();
  };

  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.description", { username: me.username, days })}
        action={
          <>
            <Segmented
              ariaLabel={t("dashboard.period")}
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: t("dashboard.days", { n: 7 }) },
                { value: 30, label: t("dashboard.days", { n: 30 }) },
                { value: 90, label: t("dashboard.days", { n: 90 }) },
              ]}
            />
            <Button variant="ghost" size="sm" onClick={refreshAll} loading={overview.loading} aria-label={t("common.refresh")}>
              {!overview.loading && <IconRefresh />} {t("common.refresh")}
            </Button>
          </>
        }
      />

      {overview.error && (
        <div className="mb-6">
          <Notice tone="bad" title={t("dashboard.loadFailed")}>
            {overview.error.message}
          </Notice>
        </div>
      )}

      <Tiles overview={overview.data} loading={overview.loading && !overview.data} />

      <div className="mt-6">
        <TrendCard overview={overview.data} loading={overview.loading && !overview.data} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FollowSplitCard data={breakdowns.data} loading={breakdowns.loading && !breakdowns.data} />
        <ContentTypeCard data={breakdowns.data} loading={breakdowns.loading && !breakdowns.data} />
      </div>

      <div className="mt-6">
        <EngagementCard data={breakdowns.data} loading={breakdowns.loading && !breakdowns.data} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TopPostsCard posts={posts.data?.data} loading={posts.loading && !posts.data} error={posts.error?.message} />
        <SentimentCard />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AudienceDetailCard
          data={audience.data}
          loading={audience.loading && !audience.data}
          error={audience.error?.message}
        />
        <OnlineHoursCard data={audience.data} loading={audience.loading && !audience.data} />
      </div>


      {overview.data?.note && <p className="mt-6 text-[12px] leading-relaxed text-fg-3">{overview.data.note}</p>}
    </>
  );
}

function Tiles({ overview, loading }: { overview?: Overview; loading: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TILE_METRICS.map((m) =>
        loading || !overview ? (
          <Skeleton key={m} className="h-[132px] rounded-xl" />
        ) : (
          <StatTile
            key={m}
            label={METRIC_LABEL[m]}
            hint={METRIC_HINT[m]}
            value={overview.totals[m]}
            delta={overview.trends[m]}
            spark={overview.series[m]?.map((p) => Number(p.value) || 0)}
          />
        ),
      )}
    </div>
  );
}

function TrendCard({ overview, loading }: { overview?: Overview; loading: boolean }) {
  const t = useT();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [asTable, setAsTable] = useState(false);

  const all: LineSeries[] = useMemo(
    () =>
      CHART_METRICS.map(({ key, color }) => ({
        key,
        color,
        label: METRIC_LABEL[key],
        points: overview?.series[key] ?? [],
      })),
    [overview],
  );
  // reach 외 지표는 일자별 값이 쌓인 뒤부터 그려집니다 (Instagram 이 일자별로 주지 않음).
  const available = all.filter((s) => s.points.length);
  const visible = available.filter((s) => !hidden.has(s.key));

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (available.length - next.size > 1) next.add(key); // 최소 한 계열은 남깁니다
      return next;
    });

  return (
    <Card
      title={t("dashboard.trendTitle")}
      subtitle={
        available.length < all.length
          ? t("dashboard.trendCollecting")
          : t("dashboard.trendLegendHint")
      }
      action={
        <Segmented
          size="sm"
          ariaLabel={t("dashboard.viewMode")}
          value={asTable ? "table" : "chart"}
          onChange={(v) => setAsTable(v === "table")}
          options={[
            { value: "chart", label: t("dashboard.chart") },
            { value: "table", label: t("dashboard.table") },
          ]}
        />
      }
    >
      <div className="mb-3">
        <Legend items={available} hidden={hidden} onToggle={toggle} />
      </div>
      {loading ? (
        <Skeleton className="h-[260px]" />
      ) : asTable ? (
        <SeriesTable series={available} />
      ) : (
        <LineChart series={visible} />
      )}
    </Card>
  );
}

function SeriesTable({ series }: { series: LineSeries[] }) {
  const t = useT();
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort().reverse();
  const maps = series.map((s) => new Map(s.points.map((p) => [p.date, p.value])));
  return (
    <div className="max-h-[260px] overflow-auto rounded-lg border border-line">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface-2 text-left text-fg-3">
          <tr>
            <th className="px-3 py-2 font-medium">{t("dashboard.date")}</th>
            {series.map((s) => (
              <th key={s.key} className="px-3 py-2 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum">
          {dates.map((d) => (
            <tr key={d} className="border-t border-line">
              <td className="px-3 py-1.5 text-fg-2">{d}</td>
              {maps.map((m, i) => (
                <td key={series[i].key} className="px-3 py-1.5 text-right">
                  {fmtInt(m.get(d) ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopPostsCard({ posts, loading, error }: { posts?: IgPost[]; loading: boolean; error?: string }) {
  const t = useT();
  const rows = [...(posts ?? [])]
    .filter((p) => p.insights?.reach != null)
    .sort((a, b) => (b.insights.reach ?? 0) - (a.insights.reach ?? 0))
    .slice(0, 6);

  return (
    <Card
      title={t("dashboard.topPostsTitle")}
      subtitle={t("dashboard.topPostsSubtitle")}
      action={
        <Link href="/admin/posts" className="text-[13px] text-fg-3 hover:text-fg">
          {t("common.viewAll")}
        </Link>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : error ? (
        <Notice tone="bad">{error}</Notice>
      ) : (
        <BarList
          labelWidth={150}
          emptyText={t("dashboard.topPostsEmpty")}
          rows={rows.map((p) => ({
            key: p.id,
            value: p.insights.reach ?? 0,
            title: p.caption?.slice(0, 80),
            label: (
              <a href={p.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-fg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumbnail_url || p.media_url}
                  alt=""
                  className="size-8 shrink-0 rounded object-cover"
                  loading="lazy"
                />
                <span className="min-w-0">
                  <span className="block truncate">{p.caption?.split("\n")[0] || t("dashboard.noCaption")}</span>
                  <span className="block text-[11px] text-fg-3">
                    {postKind(p)} · {fmtRelative(p.timestamp)}
                  </span>
                </span>
              </a>
            ),
          }))}
        />
      )}
    </Card>
  );
}


function SentimentCard() {
  const tr = useT();
  const overview = useApi<SentimentOverview>("/sentiment/overview");
  const t = overview.data?.totals;
  const n = t ? t.positive + t.neutral + t.negative : 0;
  return (
    <Card
      title={tr("dashboard.sentimentTitle")}
      subtitle={
        overview.data
          ? tr("dashboard.sentimentSubtitle", {
              min: overview.data.min_comments,
              n: fmtInt(n),
              engine:
                overview.data.engine === "gemini"
                  ? tr("dashboard.engineGemini", { model: overview.data.model })
                  : tr("dashboard.engineRules"),
            })
          : tr("dashboard.sentimentPlaceholder")
      }
      action={
        <Link href="/admin/posts" className="text-[13px] text-fg-3 hover:text-fg">
          {tr("dashboard.byPost")}
        </Link>
      }
    >
      {overview.loading && !overview.data ? (
        <Skeleton className="h-16" />
      ) : overview.error ? (
        <Notice tone="bad">{overview.error.message}</Notice>
      ) : !t || n === 0 ? (
        <p className="py-6 text-center text-sm text-fg-3">
          {rich(tr("dashboard.sentimentEmpty", { min: MIN_COMMENTS }), {
            link: (chunk) => (
              <Link href="/admin/posts" className="underline">
                {chunk}
              </Link>
            ),
          })}
        </p>
      ) : (
        <>
          <p className="pnum text-3xl font-semibold tracking-tight">
            {Math.round((t.positive / n) * 100)}%<span className="ml-2 text-[13px] font-normal text-fg-3">{tr("dashboard.positiveRate")}</span>
          </p>
          <div className="mt-4">
            <SentimentBar counts={t} height={14} showLabels />
          </div>
        </>
      )}
    </Card>
  );
}
