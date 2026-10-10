"use client";

/** 예약 게시: 팔로워가 많이 접속하는 시간(인사이트)을 먼저 권하고, 날짜·시각을 직접 고를 수도 있게.
 *  '매주 반복'이면 올린 뒤 다음 주 같은 시간의 초안을 만들어 둡니다 (내용을 고쳐서 다시 예약). */

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, cx, Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError, useApi } from "@/lib/api";
import type { Job } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
/** <input type="datetime-local"> 값 (현지 시각) */
const localValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 오늘·내일 중 그 시각이 아직 10분 넘게 남은 가장 가까운 때 */
function nextAt(hour: number, now = new Date()): { date: Date; tomorrow: boolean } {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() - now.getTime() < 10 * 60000) {
    d.setDate(d.getDate() + 1);
    return { date: d, tomorrow: true };
  }
  return { date: d, tomorrow: false };
}

export function ScheduleDialog({
  job,
  initial,
  beforeSchedule,
  onDone,
  onClose,
}: {
  job: Job;
  /** 처음 고른 시각 (다음 주 초안이면 권하는 시각) */
  initial?: string | null;
  /** 예약 전에 캡션 저장·동영상 업로드 기다리기 (실패하면 false) */
  beforeSchedule: () => Promise<boolean>;
  onDone: (j: Job) => void;
  onClose: () => void;
}) {
  const t = useT();
  const best = useApi<{ hours: number[] }>("/studio/best-times");
  const hasVideo = job.assets.some((a) => a.type === "video");
  const quick = useMemo(() => {
    const hours = best.data?.hours?.length ? best.data.hours : [];
    const fallback = [19, 9, 12].filter((h) => !hours.includes(h));
    return [...hours.map((h) => ({ h, best: true })), ...fallback.slice(0, Math.max(0, 3 - hours.length)).map((h) => ({ h, best: false }))].map((x) => ({
      ...x,
      ...nextAt(x.h),
    }));
  }, [best.data]);
  const [value, setValue] = useState(() => localValue(initial ? new Date(initial) : job.scheduled_at ? new Date(job.scheduled_at) : nextAt(19).date));
  const [repeat, setRepeat] = useState(Boolean(job.repeat_weekly && !hasVideo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setError(undefined);
    setBusy(true);
    try {
      if (!(await beforeSchedule())) return;
      onDone(await api<Job>(`/workflow/jobs/${job.id}/schedule`, { method: "POST", json: { at: new Date(value).toISOString(), repeat_weekly: repeat } }));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={t("growth.scheduleTitle")}>
      <div className="w-full max-w-md space-y-4 rounded-t-2xl bg-surface-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
        <div>
          <h3 className="text-[16px] font-semibold">{t("growth.scheduleTitle")}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-fg-3">{t("growth.scheduleHint")}</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12px] text-fg-3">{best.data?.hours?.length ? t("growth.bestTimes") : t("growth.quickTimes")}</p>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => {
              const v = localValue(q.date);
              return (
                <button
                  key={q.h}
                  type="button"
                  onClick={() => setValue(v)}
                  className={cx("rounded-full border px-3 py-1.5 text-[12px]", value === v ? "border-fg bg-fg text-surface-0" : "border-line text-fg-2 hover:border-line-strong")}
                >
                  {q.best && "🔥 "}
                  {q.tomorrow ? t("growth.tomorrow", { h: q.h }) : t("growth.today", { h: q.h })}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-[12px] text-fg-3">{t("growth.pickTime")}</span>
          <input
            type="datetime-local"
            value={value}
            min={localValue(new Date())}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-[14px]"
          />
        </label>
        <label className={cx("flex items-start gap-2 text-[13px]", hasVideo && "opacity-50")}>
          <input type="checkbox" checked={repeat} disabled={hasVideo} onChange={(e) => setRepeat(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            {t("growth.repeatWeekly")}
            <span className="block text-[12px] text-fg-3">{hasVideo ? t("growth.repeatNoVideo") : t("growth.repeatHint")}</span>
          </span>
        </label>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onClose} disabled={busy}>
            {t("growth.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!value}>
            {t("growth.scheduleSubmit")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
