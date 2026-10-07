"use client";

import { cx, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { fmtCompact, fmtInt, fmtPct } from "@/lib/format";

export function SortTh({
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

export function SummaryTile({
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
