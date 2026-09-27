"use client";

import { useState } from "react";
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
  return (
    <Card title="누가 봤나" subtitle="도달·조회 중 팔로워와 비팔로워의 비율 (개별 계정은 Instagram 이 제공하지 않습니다)">
      {loading ? (
        <Loading />
      ) : !total ? (
        <p className="py-6 text-center text-sm text-fg-3">이 기간의 데이터가 없습니다.</p>
      ) : (
        <>
          <p className="pnum text-3xl font-semibold tracking-tight">
            {Math.round((reachN / total) * 100)}%
            <span className="ml-2 text-[13px] font-normal text-fg-3">비팔로워에게 도달 — 새로운 사람에게 노출된 비율</span>
          </p>
          <div className="mt-5 space-y-4">
            <SplitRow label="도달 계정" rows={data!.reach_by_follow} />
            <SplitRow label="조회" rows={data!.views_by_follow} />
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
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-fg-2">{label}</span>
        <span className="tnum text-[12px] text-fg-3">합계 {fmtInt(t)}</span>
      </div>
      {t ? (
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={`${label}: 팔로워 ${f}, 비팔로워 ${n}`}>
          {f > 0 && <span style={{ width: `${(f / t) * 100}%`, background: FOLLOW_COLORS.FOLLOWER }} title={`팔로워 ${fmtInt(f)}`} />}
          {n > 0 && <span style={{ width: `${(n / t) * 100}%`, background: FOLLOW_COLORS.NON_FOLLOWER }} title={`비팔로워 ${fmtInt(n)}`} />}
        </div>
      ) : (
        <p className="text-[12px] text-fg-3">데이터 없음</p>
      )}
      <div className="tnum mt-1 flex justify-between text-[12px] text-fg-2">
        <span>
          팔로워 {fmtInt(f)} <span className="text-fg-3">({t ? Math.round((f / t) * 100) : 0}%)</span>
        </span>
        <span>
          비팔로워 {fmtInt(n)} <span className="text-fg-3">({t ? Math.round((n / t) * 100) : 0}%)</span>
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
  return (
    <Card
      title="콘텐츠 유형별 성과"
      subtitle="사진 · 캐러셀 · 릴스 · 스토리 중 어떤 형식이 잘 보였는지"
      action={
        <Segmented
          size="sm"
          ariaLabel="지표"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "reach_by_type", label: "도달" },
            { value: "views_by_type", label: "조회" },
            { value: "interactions_by_type", label: "상호작용" },
          ]}
        />
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <BarList
          emptyText="이 기간의 데이터가 없습니다."
          rows={rows.map((r) => ({ key: r.key, label: dimLabel(r.key), value: r.value }))}
        />
      )}
    </Card>
  );
}

// ───────────────────────────────────────────── 반응 상세

const INTERACTION_LABEL = { likes: "좋아요", comments: "댓글", saves: "저장", shares: "공유", replies: "스토리 답장" } as const;

export function EngagementCard({ data, loading }: { data?: Breakdowns; loading: boolean }) {
  const follows = pick(data?.follows_unfollows ?? [], "FOLLOWER");
  const unfollows = pick(data?.follows_unfollows ?? [], "NON_FOLLOWER");
  const hasFollowData = (data?.follows_unfollows.length ?? 0) > 0;
  return (
    <Card title="반응 상세" subtitle="기간 내 반응 종류별 합계와 팔로우 변화, 프로필 링크 탭">
      {loading ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(Object.keys(INTERACTION_LABEL) as (keyof typeof INTERACTION_LABEL)[]).map((k) => (
              <Mini key={k} label={INTERACTION_LABEL[k]} value={data?.interactions[k]} />
            ))}
            <Mini label="새 팔로우" value={hasFollowData ? follows : null} />
            <Mini label="언팔로우" value={hasFollowData ? unfollows : null} />
          </dl>
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg-2">프로필 링크 탭</p>
            <BarList
              labelWidth={110}
              emptyText="프로필의 웹사이트·전화·길찾기·이메일 버튼을 누른 기록이 없습니다."
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

const GROUPS: { value: AudienceGroup; label: string }[] = [
  { value: "reached", label: "도달한 사람" },
  { value: "engaged", label: "반응한 사람" },
  { value: "follower", label: "팔로워" },
];
const DIMS: { value: Breakdown; label: string }[] = [
  { value: "age", label: "연령" },
  { value: "gender", label: "성별" },
  { value: "country", label: "국가" },
  { value: "city", label: "도시" },
];

export function AudienceDetailCard({ data, loading, error }: { data?: AudienceDetail; loading: boolean; error?: string }) {
  const [group, setGroup] = useState<AudienceGroup>("reached");
  const [dim, setDim] = useState<Breakdown>("age");
  const rows = data?.demographics[group]?.[dim] ?? [];
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <Card
      title="보는 사람들"
      subtitle="이번 달 기준 연령·성별·지역 분포 (상위 10개)"
      action={<Segmented size="sm" ariaLabel="대상" value={group} onChange={setGroup} options={GROUPS} />}
    >
      <div className="mb-3">
        <Segmented size="sm" ariaLabel="분류" value={dim} onChange={setDim} options={DIMS} />
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
  return (
    <Card title="팔로워 접속 시간대" subtitle="최근 7일, 시간대별 평균 접속 팔로워 수 (게시 시간 정할 때 참고)">
      {loading ? (
        <Loading />
      ) : !hours.length ? (
        <p className="py-6 text-center text-sm text-fg-3">팔로워 100명 미만이면 Meta 가 접속 시간대를 제공하지 않습니다.</p>
      ) : (
        <>
          <p className="text-[13px] text-fg-2">
            가장 많이 접속하는 시간 <span className="pnum text-lg font-semibold text-fg">{peak}시</span>
          </p>
          <div className="mt-3 flex h-32 items-end gap-[2px]" role="img" aria-label={`시간대별 접속, 최대 ${peak}시`}>
            {hours.map((v, h) => (
              <div key={h} className="group relative flex h-full flex-1 items-end" title={`${h}시 · ${fmtInt(v)}명`}>
                <span
                  className={cx("w-full rounded-t-[3px]", h === peak ? "opacity-100" : "opacity-70 group-hover:opacity-100")}
                  style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: "var(--seq-bar)" }}
                />
              </div>
            ))}
          </div>
          <div className="tnum mt-1 flex justify-between text-[11px] text-fg-3">
            {[0, 6, 12, 18, 23].map((h) => (
              <span key={h}>{h}시</span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
