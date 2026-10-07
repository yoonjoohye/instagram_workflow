"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { translate } from "@/i18n/core";
import { fmtCompact, fmtInt, fmtPct, fmtShortDate, getFormatLocale } from "@/lib/format";
import type { Point } from "@/lib/types";
import { cx } from "./ui";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 0 / 1,000 / 2,000 처럼 깔끔한 눈금. 개수 지표라 최소 간격은 1. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return ticks;
}

// ───────────────────────────────────────────────────────────── Line chart

export type LineSeries = { key: string; label: string; color: string; points: Point[] };

const PAD = { top: 12, right: 56, bottom: 28, left: 48 };

export function LineChart({ series, height = 260 }: { series: LineSeries[]; height?: number }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const { dates, lookup, ticks } = useMemo(() => {
    const dateSet = new Set<string>();
    series.forEach((s) => s.points.forEach((p) => p.date && dateSet.add(p.date)));
    const dates = [...dateSet].sort();
    const lookup = series.map((s) => new Map(s.points.map((p) => [p.date, Number(p.value) || 0])));
    const max = Math.max(0, ...lookup.flatMap((m) => [...m.values()]));
    return { dates, lookup, ticks: niceTicks(max) };
  }, [series]);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const top = ticks[ticks.length - 1] || 1;
  const n = dates.length;
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;

  const paths = series.map((_, si) => {
    let d = "";
    let pen = false;
    dates.forEach((date, i) => {
      const v = lookup[si].get(date);
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  // 끝점 라벨: 서로 겹치면 쌓지 않고 생략합니다 (범례 + 툴팁이 대신 전달).
  const endLabels = useMemo(() => {
    if (!n) return [];
    const last = dates[n - 1];
    const items = series
      .map((s, si) => ({ key: s.key, v: lookup[si].get(last) }))
      .filter((it): it is { key: string; v: number } => it.v != null)
      .map((it) => ({ ...it, y: y(it.v) }))
      .sort((a, b) => a.y - b.y);
    const kept: typeof items = [];
    for (const it of items) if (!kept.length || it.y - kept[kept.length - 1].y >= 14) kept.push(it);
    return kept;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, lookup, series, height, top]);

  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 72))));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (n === 0) return;
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    const i = n <= 1 ? 0 : Math.round((px / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }

  const label = translate(getFormatLocale(), "common.dailyTrend", { names: series.map((s) => s.label).join(", ") });

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tnum fill-fg-3 text-[11px]">
                {fmtCompact(t)}
              </text>
            </g>
          ))}
          {dates.map((d, i) =>
            i % xTickEvery === 0 || i === n - 1 ? (
              <text key={d} x={x(i)} y={height - 8} textAnchor="middle" className="tnum fill-fg-3 text-[11px]">
                {fmtShortDate(d)}
              </text>
            ) : null,
          )}

          {series.length === 1 && paths[0] && (
            <path
              d={`${paths[0]}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`}
              fill={series[0].color}
              opacity={0.1}
            />
          )}
          {series.map((s, si) => (
            <path key={s.key} d={paths[si]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {endLabels.map((l) => (
            <text key={l.key} x={x(n - 1) + 8} y={l.y} dy="0.32em" className="tnum fill-fg-2 text-[11px] font-medium">
              {fmtCompact(l.v)}
            </text>
          ))}

          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--border-strong)" strokeWidth={1} />
              {series.map((s, si) => {
                const v = lookup[si].get(dates[hover]);
                return v == null ? null : (
                  <circle key={s.key} cx={x(hover)} cy={y(v)} r={4.5} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
                );
              })}
            </g>
          )}

          <rect
            x={PAD.left - 8}
            y={0}
            width={innerW + 16}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            // 터치는 손을 떼면 바로 leave 가 와서 툴팁이 사라지므로, 마우스일 때만 닫습니다 (터치는 다른 곳을 누르면 바뀜).
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
      )}

      {hover != null && width > 0 && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-line bg-surface-1 px-3 py-2 text-[12px] shadow-lg"
          style={x(hover) > width - 190 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
        >
          <p className="mb-1 font-medium text-fg">{dates[hover]}</p>
          {series.map((s, si) => (
            <p key={s.key} className="flex items-center justify-between gap-4 text-fg-2">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tnum font-medium text-fg">{fmtInt(lookup[si].get(dates[hover]) ?? null)}</span>
            </p>
          ))}
        </div>
      )}

      {width > 0 && n === 0 && (
        <div className="flex h-full items-center justify-center text-sm text-fg-3">{translate(getFormatLocale(), "common.noChartData")}</div>
      )}
    </div>
  );
}

export function Legend({
  items,
  hidden,
  onToggle,
}: {
  items: { key: string; label: string; color: string }[];
  hidden?: Set<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((it) => {
        const off = hidden?.has(it.key);
        return (
          <li key={it.key}>
            <button
              type="button"
              disabled={!onToggle}
              aria-pressed={!off}
              onClick={() => onToggle?.(it.key)}
              className={cx("flex items-center gap-1.5 text-[12px] text-fg-2", onToggle && "hover:text-fg", off && "opacity-40")}
            >
              <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: it.color }} />
              {it.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────────────────────────────────────────── Sparkline

export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return <div className={className} />;
  const max = Math.max(...points, 1);
  const d = points
    .map((v, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * 100).toFixed(2)},${(28 - (v / max) * 26).toFixed(2)}`)
    .join("");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <path d={d} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// ───────────────────────────────────────────────────────────── Stat tile

export function StatTile({
  label,
  value,
  delta,
  hint,
  spark,
}: {
  label: string;
  value: number | null | undefined;
  delta?: number | null;
  hint?: string;
  spark?: number[];
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface-1 p-4" title={hint}>
      <p className="truncate text-[13px] text-fg-3">{label}</p>
      <p className="pnum mt-1 text-2xl font-semibold tracking-tight" title={fmtInt(value)}>
        {fmtCompact(value)}
      </p>
      <p className="mt-1 text-[12px] text-fg-3">
        {delta == null ? (
          translate(getFormatLocale(), "common.noCompare")
        ) : (
          <>
            <span className={cx("font-medium", delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-fg-2")}>
              {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {fmtPct(Math.abs(delta))}
            </span>{" "}
            {translate(getFormatLocale(), "common.vsPrev")}
          </>
        )}
      </p>
      {spark && <Sparkline points={spark} className="mt-3 h-7 w-full" />}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Horizontal bars

export type BarRow = { key: string; label: ReactNode; value: number; title?: string };

export function BarList({
  rows,
  format = fmtInt,
  labelWidth = 120,
  emptyText,
}: {
  rows: BarRow[];
  format?: (n: number) => string;
  labelWidth?: number;
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-sm text-fg-3">{emptyText ?? translate(getFormatLocale(), "common.noData")}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid items-center gap-3 rounded-md px-1 py-0.5 hover:bg-surface-2"
          // 좁은 화면에서는 라벨이 너비의 45% 를 넘지 않게 (막대 자리를 남김)
          style={{ gridTemplateColumns: `min(${labelWidth}px, 45%) minmax(0, 1fr)` }}
          title={r.title ?? `${typeof r.label === "string" ? r.label : ""} ${fmtInt(r.value)}`}
        >
          <div className="min-w-0 truncate text-[13px] text-fg-2">{r.label}</div>
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="h-3 shrink-0 rounded-r"
              style={{ width: `calc(${(r.value / max) * 100}% - 56px)`, minWidth: 2, background: "var(--seq-bar)" }}
            />
            <span className="tnum text-[12px] font-medium text-fg">{format(r.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
