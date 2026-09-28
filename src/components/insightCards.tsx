"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { dimLabel, fmtCompact, fmtInt } from "@/lib/format";
import type { AudienceDetail, AudienceGroup, Breakdown, Breakdowns, KeyValue } from "@/lib/types";
import { BarList } from "./charts";
import { Card, cx, Notice, Segmented, Skeleton } from "./ui";

// 팔로워/비팔로워는 '정체성' 구분이라 범주형 색(고정 순서)을 씁니다.
const FOLLOW_COLORS: Record<string, string> = { FOLLOWER: "var(--series-1)", NON_FOLLOWER: "var(--series-2)" };

const pick = (rows: KeyValue[], key: string) => rows.find((r) => r.key === key)?.value ?? 0;

function Loading({ h = "h-32" }: { h?: string }) {
  return <Skeleton className={h} />;
}

// ───────────────────────────────────────────── 누가 봤나: 팔로워 vs 비팔로워

export function FollowSplitCard({ data, loading }: { data?: Breakdowns; loading: boolean }) {
  const reachF = pick(data?.reach_by_follow ?? [], "FOLLOWER");
  const reachN = pick(data?.reach_by_follow ?? [], "NON_FOLLOWER");
  const total = reachF + reachN;
  const t = useT();
  return (
    <Card title={t("dashboard.followTitle")} subtitle={t("dashboard.followSubtitle")}>
      {loading ? (
        <Loading />
      ) : !total ? (
        <p className="py-6 text-center text-sm text-fg-3">{t("dashboard.noDataPeriod")}</p>
      ) : (
        <>
          <p className="pnum text-3xl font-semibold tracking-tight">
            {Math.round((reachN / total) * 100)}%
            <span className="ml-2 text-[13px] font-normal text-fg-3">{t("dashboard.nonFollowerReach")}</span>
          </p>
          <div className="mt-5 space-y-4">
            <SplitRow label={t("dashboard.splitReach")} rows={data!.reach_by_follow} />
            <SplitRow label={t("dashboard.splitViews")} rows={data!.views_by_follow} />
          </div>
          <Legend2 />
        </>
      )}
    </Card>
  );
}

function SplitRow({ label, rows }: { label: string; rows: KeyValue[] }) {
  const f = pick(rows, "FOLLOWER");
  const n = pick(rows, "NON_FOLLOWER");
  const t = f + n;
  const tr = useT();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-fg-2">{label}</span>
        <span className="tnum text-[12px] text-fg-3">{tr("dashboard.sum", { n: fmtInt(t) })}</span>
      </div>
      {t ? (
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={tr("dashboard.splitAria", { label, f, n })}>
          {f > 0 && <span style={{ width: `${(f / t) * 100}%`, background: FOLLOW_COLORS.FOLLOWER }} title={tr("dashboard.followerN", { n: fmtInt(f) })} />}
          {n > 0 && <span style={{ width: `${(n / t) * 100}%`, background: FOLLOW_COLORS.NON_FOLLOWER }} title={tr("dashboard.nonFollowerN", { n: fmtInt(n) })} />}
        </div>
      ) : (
        <p className="text-[12px] text-fg-3">{tr("dashboard.noDataShort")}</p>
      )}
      <div className="tnum mt-1 flex justify-between text-[12px] text-fg-2">
        <span>
          {tr("dashboard.followerN", { n: fmtInt(f) })} <span className="text-fg-3">({t ? Math.round((f / t) * 100) : 0}%)</span>
        </span>
        <span>
          {tr("dashboard.nonFollowerN", { n: fmtInt(n) })} <span className="text-fg-3">({t ? Math.round((n / t) * 100) : 0}%)</span>
        </span>
      </div>
    </div>
  );
}

function Legend2() {
  return (
    <ul className="mt-4 flex gap-4 text-[12px] text-fg-2">
      {(["FOLLOWER", "NON_FOLLOWER"] as const).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[3px]" style={{ background: FOLLOW_COLORS[k] }} />
          {dimLabel(k)}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────────────────────────── 콘텐츠 유형별

type TypeMetric = "reach_by_type" | "views_by_type" | "interactions_by_type";

export function ContentTypeCard({ data, loading }: { data?: Breakdowns; loading: boolean }) {
  const [metric, setMetric] = useState<TypeMetric>("reach_by_type");
  const rows = data?.[metric] ?? [];
  const t = useT();
  return (
    <Card
      title={t("dashboard.typeTitle")}
      subtitle={t("dashboard.typeSubtitle")}
      action={
        <Segmented
          size="sm"
          ariaLabel={t("dashboard.metric")}
          value={metric}
          onChange={setMetric}
          options={[
            { value: "reach_by_type", label: t("dashboard.reach") },
            { value: "views_by_type", label: t("dashboard.views") },
            { value: "interactions_by_type", label: t("dashboard.interactions") },
          ]}
        />
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <BarList
          emptyText={t("dashboard.noDataPeriod")}
          rows={rows.map((r) => ({ key: r.key, label: dimLabel(r.key), value: r.value }))}
        />
      )}
    </Card>
  );
}

// ───────────────────────────────────────────── 반응 상세

const INTERACTION_LABEL = {
  likes: "dashboard.likes",
  comments: "dashboard.comments",
  saves: "dashboard.saves",
  shares: "dashboard.shares",
  replies: "dashboard.replies",
} as const satisfies Record<string, MessageKey>;

export function EngagementCard({ data, loading }: { data?: Breakdowns; loading: boolean }) {
  const follows = pick(data?.follows_unfollows ?? [], "FOLLOWER");
  const unfollows = pick(data?.follows_unfollows ?? [], "NON_FOLLOWER");
  const hasFollowData = (data?.follows_unfollows.length ?? 0) > 0;
  const t = useT();
  return (
    <Card title={t("dashboard.engagementTitle")} subtitle={t("dashboard.engagementSubtitle")}>
      {loading ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(Object.keys(INTERACTION_LABEL) as (keyof typeof INTERACTION_LABEL)[]).map((k) => (
              <Mini key={k} label={t(INTERACTION_LABEL[k])} value={data?.interactions[k]} />
            ))}
            <Mini label={t("dashboard.newFollows")} value={hasFollowData ? follows : null} />
            <Mini label={t("dashboard.unfollows")} value={hasFollowData ? unfollows : null} />
          </dl>
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg-2">{t("dashboard.linkTaps")}</p>
            <BarList
              labelWidth={110}
              emptyText={t("dashboard.linkTapsEmpty")}
              rows={(data?.link_taps ?? []).map((r) => ({ key: r.key, label: dimLabel(r.key), value: r.value }))}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2.5">
      <dt className="text-[12px] text-fg-3">{label}</dt>
      <dd className="pnum mt-0.5 text-lg font-semibold">{value == null ? "—" : fmtCompact(value)}</dd>
    </div>
  );
}

// ───────────────────────────────────────────── 보는 사람들 (인구통계)

const GROUPS: { value: AudienceGroup; label: MessageKey }[] = [
  { value: "reached", label: "dashboard.groupReached" },
  { value: "engaged", label: "dashboard.groupEngaged" },
  { value: "follower", label: "dashboard.groupFollower" },
];
const DIMS: { value: Breakdown; label: MessageKey }[] = [
  { value: "age", label: "dashboard.dimAge" },
  { value: "gender", label: "dashboard.dimGender" },
  { value: "country", label: "dashboard.dimCountry" },
  { value: "city", label: "dashboard.dimCity" },
];

export function AudienceDetailCard({ data, loading, error }: { data?: AudienceDetail; loading: boolean; error?: string }) {
  const [group, setGroup] = useState<AudienceGroup>("reached");
  const [dim, setDim] = useState<Breakdown>("age");
  const rows = data?.demographics[group]?.[dim] ?? [];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const t = useT();
  const groupOptions = GROUPS.map((o) => ({ value: o.value, label: t(o.label) }));
  const dimOptions = DIMS.map((o) => ({ value: o.value, label: t(o.label) }));
  return (
    <Card
      title={t("dashboard.audienceTitle")}
      subtitle={t("dashboard.audienceSubtitle")}
      action={<Segmented size="sm" ariaLabel={t("dashboard.audienceGroup")} value={group} onChange={setGroup} options={groupOptions} />}
    >
      <div className="mb-3">
        <Segmented size="sm" ariaLabel={t("dashboard.audienceDim")} value={dim} onChange={setDim} options={dimOptions} />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <Notice tone="bad">{error}</Notice>
      ) : !rows.length ? (
        <p className="py-6 text-center text-sm text-fg-3">{data?.note}</p>
      ) : (
        <BarList
          format={(n) => `${fmtInt(n)} (${Math.round((n / total) * 100)}%)`}
          rows={rows.slice(0, 10).map((r) => ({ key: r.label, label: dimLabel(r.label), value: r.value }))}
        />
      )}
    </Card>
  );
}

// ───────────────────────────────────────────── 팔로워 접속 시간대

export function OnlineHoursCard({ data, loading }: { data?: AudienceDetail; loading: boolean }) {
  const hours = data?.online_followers ?? [];
  const max = Math.max(1, ...hours);
  const peak = hours.length ? hours.indexOf(Math.max(...hours)) : -1;
  // 터치 화면에는 hover 가 없으므로 막대를 누르면 그 시간대 값을 보여줍니다.
  const [picked, setPicked] = useState<number | null>(null);
  const t = useT();
  return (
    <Card title={t("dashboard.onlineTitle")} subtitle={t("dashboard.onlineSubtitle")}>
      {loading ? (
        <Loading />
      ) : !hours.length ? (
        <p className="py-6 text-center text-sm text-fg-3">{t("dashboard.onlineUnavailable")}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-fg-2">
            <span>
              {t("dashboard.peakTime")} <span className="pnum text-lg font-semibold text-fg">{t("dashboard.hour", { h: peak })}</span>
            </span>
            {picked != null && (
              <span className="tnum text-[12px] text-fg-2">
                {t("dashboard.hour", { h: picked })} · <span className="font-medium text-fg">{t("dashboard.people", { n: fmtInt(hours[picked]) })}</span>
              </span>
            )}
          </p>
          <div className="mt-3 flex h-32 items-end gap-[2px]" role="img" aria-label={t("dashboard.onlineAria", { h: peak })}>
            {hours.map((v, h) => (
              <div
                key={h}
                className="group relative flex h-full flex-1 cursor-pointer items-end"
                title={t("dashboard.hourPeople", { h, n: fmtInt(v) })}
                onClick={() => setPicked((p) => (p === h ? null : h))}
                onPointerEnter={(e) => e.pointerType === "mouse" && setPicked(h)}
              >
                <span
                  className={cx(
                    "w-full rounded-t-[3px]",
                    h === picked || (picked == null && h === peak) ? "opacity-100" : "opacity-60 group-hover:opacity-100",
                  )}
                  style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: "var(--seq-bar)" }}
                />
              </div>
            ))}
          </div>
          <div className="tnum mt-1 flex justify-between text-[11px] text-fg-3">
            {[0, 6, 12, 18, 23].map((h) => (
              <span key={h}>{t("dashboard.hour", { h })}</span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
