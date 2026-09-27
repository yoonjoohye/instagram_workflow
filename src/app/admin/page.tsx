"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { BarList, Legend, LineChart, StatTile, type LineSeries } from "@/components/charts";
import { IconRefresh } from "@/components/icons";
import { Avatar, Button, Card, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtInt, fmtRelative, METRIC_HINT, METRIC_LABEL, postKind } from "@/lib/format";
import type { Audience, Breakdown, IgPost, ListOf, MetricKey, Overview, SentimentOverview, Visitor } from "@/lib/types";
import { SentimentBar } from "@/components/sentiment";

const TILE_METRICS: MetricKey[] = ["reach", "profile_views", "accounts_engaged", "total_interactions", "website_clicks"];

// 카테고리 색은 지표(엔티티)를 따라갑니다 — 필터로 숨겨도 남은 계열의 색이 바뀌지 않습니다.
const CHART_METRICS: { key: MetricKey; color: string }[] = [
  { key: "reach", color: "var(--series-1)" },
  { key: "profile_views", color: "var(--series-2)" },
  { key: "accounts_engaged", color: "var(--series-3)" },
];

const BREAKDOWNS: { value: Breakdown; label: string }[] = [
  { value: "country", label: "국가" },
  { value: "city", label: "도시" },
  { value: "age", label: "연령" },
  { value: "gender", label: "성별" },
];

const GENDER_LABEL: Record<string, string> = { F: "여성", M: "남성", U: "미상" };

export default function DashboardPage() {
  const { me } = useMe();
  const [days, setDays] = useState(30);
  const overview = useApi<Overview>(`/insights/overview?days=${days}`);
  const posts = useApi<ListOf<IgPost>>("/posts?limit=12");
  const visitors = useApi<ListOf<Visitor>>("/visitors?refresh=false");

  const refreshAll = () => {
    overview.reload();
    posts.reload();
    visitors.reload();
  };

  return (
    <>
      <PageHeader
        title="대시보드"
        description={`@${me.username} · 최근 ${days}일 동안 콘텐츠가 얼마나 보였는지`}
        action={
          <>
            <Segmented
              ariaLabel="기간"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: "7일" },
                { value: 30, label: "30일" },
                { value: 90, label: "90일" },
              ]}
            />
            <Button variant="ghost" size="sm" onClick={refreshAll} loading={overview.loading} aria-label="새로고침">
              {!overview.loading && <IconRefresh />} 새로고침
            </Button>
          </>
        }
      />

      {overview.error && (
        <div className="mb-6">
          <Notice tone="bad" title="인사이트를 불러오지 못했습니다">
            {overview.error.message}
          </Notice>
        </div>
      )}

      <Tiles overview={overview.data} loading={overview.loading && !overview.data} />

      <div className="mt-6">
        <TrendCard overview={overview.data} loading={overview.loading && !overview.data} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <TopPostsCard posts={posts.data?.data} loading={posts.loading && !posts.data} error={posts.error?.message} />
        <RecentVisitorsCard visitors={visitors.data?.data} loading={visitors.loading && !visitors.data} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <AudienceCard />
        <SentimentCard />
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
      title="일자별 노출 추이"
      subtitle={
        available.length < all.length
          ? "프로필 조회·참여 계정의 일자별 값은 매일 수집되며 쌓이는 대로 표시됩니다."
          : "범례를 눌러 계열을 끄고 켤 수 있습니다."
      }
      action={
        <Segmented
          size="sm"
          ariaLabel="보기 방식"
          value={asTable ? "table" : "chart"}
          onChange={(v) => setAsTable(v === "table")}
          options={[
            { value: "chart", label: "차트" },
            { value: "table", label: "표" },
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
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort().reverse();
  const maps = series.map((s) => new Map(s.points.map((p) => [p.date, p.value])));
  return (
    <div className="max-h-[260px] overflow-auto rounded-lg border border-line">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-surface-2 text-left text-fg-3">
          <tr>
            <th className="px-3 py-2 font-medium">날짜</th>
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
  const rows = [...(posts ?? [])]
    .filter((p) => p.insights?.reach != null)
    .sort((a, b) => (b.insights.reach ?? 0) - (a.insights.reach ?? 0))
    .slice(0, 6);

  return (
    <Card
      title="게시물별 도달"
      subtitle="최근 게시물 12개 중 도달 상위 6개"
      action={
        <Link href="/admin/posts" className="text-[13px] text-fg-3 hover:text-fg">
          전체 보기 →
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
          emptyText="아직 성과 데이터가 있는 게시물이 없습니다."
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
                  <span className="block truncate">{p.caption?.split("\n")[0] || "(캡션 없음)"}</span>
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

function RecentVisitorsCard({ visitors, loading }: { visitors?: Visitor[]; loading: boolean }) {
  const rows = (visitors ?? []).slice(0, 6);
  return (
    <Card
      title="반응한 계정"
      subtitle="댓글·멘션으로 확인된 계정 (상호작용 많은 순)"
      action={
        <Link href="/admin/visitors" className="text-[13px] text-fg-3 hover:text-fg">
          전체 보기 →
        </Link>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-3">
          아직 수집된 계정이 없습니다.{" "}
          <Link href="/admin/visitors" className="underline">
            지금 동기화
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((v) => (
            <li key={v.username} className="flex items-center gap-3 py-2.5">
              <Avatar name={v.username} size={32} />
              <div className="min-w-0 flex-1">
                <a href={v.profile_url} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:underline">
                  @{v.username}
                </a>
                <p className="truncate text-[12px] text-fg-3">{v.last_text || "—"}</p>
              </div>
              <div className="text-right">
                <p className="tnum text-[13px] font-medium">{fmtInt(v.interactions)}회</p>
                <p className="text-[11px] text-fg-3">{fmtRelative(v.last_seen_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AudienceCard() {
  const audience = useApi<Audience>("/insights/audience");
  const [breakdown, setBreakdown] = useState<Breakdown>("country");
  const rows = audience.data?.demographics[breakdown] ?? [];

  return (
    <Card
      title="팔로워 분포"
      subtitle="이번 달 기준 팔로워 인구통계 (상위 10개)"
      action={<Segmented size="sm" ariaLabel="분류" value={breakdown} onChange={setBreakdown} options={BREAKDOWNS} />}
    >
      {audience.loading && !audience.data ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : audience.error ? (
        <Notice tone="bad">{audience.error.message}</Notice>
      ) : audience.data?.empty ? (
        <p className="py-6 text-center text-sm text-fg-3">{audience.data.note || "인구통계 데이터가 없습니다."}</p>
      ) : (
        <BarList
          rows={rows.slice(0, 10).map((r) => ({
            key: r.label,
            value: r.value,
            label: breakdown === "gender" ? (GENDER_LABEL[r.label] ?? r.label) : r.label,
          }))}
        />
      )}
    </Card>
  );
}

function SentimentCard() {
  const overview = useApi<SentimentOverview>("/sentiment/overview");
  const t = overview.data?.totals;
  const n = t ? t.positive + t.neutral + t.negative : 0;
  return (
    <Card
      title="댓글 반응"
      subtitle={
        overview.data
          ? `분석된 댓글 ${fmtInt(n)}개 · ${overview.data.engine === "gemini" ? `Gemini(${overview.data.model})` : "키워드·이모지 규칙"}로 분류`
          : "긍정 · 보통 · 부정"
      }
      action={
        <Link href="/admin/posts" className="text-[13px] text-fg-3 hover:text-fg">
          게시물별 보기 →
        </Link>
      }
    >
      {overview.loading && !overview.data ? (
        <Skeleton className="h-16" />
      ) : overview.error ? (
        <Notice tone="bad">{overview.error.message}</Notice>
      ) : !t || n === 0 ? (
        <p className="py-6 text-center text-sm text-fg-3">
          아직 분석된 댓글이 없습니다.{" "}
          <Link href="/admin/posts" className="underline">
            게시물 성과
          </Link>
          에서 게시물을 펼쳐 &lsquo;댓글 분석&rsquo;을 눌러 주세요.
        </p>
      ) : (
        <>
          <p className="pnum text-3xl font-semibold tracking-tight">
            {Math.round((t.positive / n) * 100)}%<span className="ml-2 text-[13px] font-normal text-fg-3">긍정 비율</span>
          </p>
          <div className="mt-4">
            <SentimentBar counts={t} height={14} showLabels />
          </div>
        </>
      )}
    </Card>
  );
}
