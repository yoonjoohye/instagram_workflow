"use client";

/** 퍼즐 피드: 사진 한 장을 3열 × 1~3줄로 잘라 각각 게시물로 만들고, 프로필에서 하나의 큰 사진처럼 보이게 순서대로 올립니다.
 *  프로필은 최신 글이 왼쪽 위라서 오른쪽 아래 조각부터 올리고 왼쪽 위 조각이 마지막. 바로 올리거나 1분 간격으로 예약. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMe } from "@/components/AdminShell";
import { FeedGrid } from "@/components/studio/FeedGrid";
import { Button, cx, Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { drawPreview, placement, splitImage, type GridView } from "@/lib/gridSplit";
import { toBrowserImage } from "@/lib/heic";
import { uploadImageBlob } from "@/lib/uploads";
import type { Job, Quota } from "@/lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const localValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function GridSplit({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { me } = useMe();
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [rows, setRows] = useState(3);
  const [view, setView] = useState<GridView>({ zoom: 1, x: 0, y: 0 });
  const [tiles, setTiles] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [captionAll, setCaptionAll] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [done, setDone] = useState<string>();
  const [at, setAt] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return localValue(d);
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; view: GridView } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 미리보기 (전체 그림 + 조각 경계)
  useEffect(() => {
    if (img && canvas.current) drawPreview(canvas.current, img, rows, view);
  }, [img, rows, view]);

  // 프로필 미리보기용 조각 (움직임이 멈추면)
  useEffect(() => {
    if (!img) return;
    let alive = true;
    const urls: string[] = [];
    const id = setTimeout(async () => {
      const blobs = await splitImage(img, rows, view);
      if (!alive) return;
      urls.push(...blobs.map((b) => URL.createObjectURL(b)));
      setTiles(urls);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
    };
  }, [img, rows, view]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function pick(file?: File) {
    if (!file) return;
    setError(undefined);
    try {
      const f = await toBrowserImage(file);
      setImg(await createImageBitmap(f, { imageOrientation: "from-image" } as ImageBitmapOptions));
      setView({ zoom: 1, x: 0, y: 0 });
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  // 끌어서 위치 맞추기 (x·y 는 남는 만큼의 비율 -1 ~ 1)
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !img || !canvas.current) return;
    const p = placement(img.width, img.height, rows, d.view);
    const scale = canvas.current.getBoundingClientRect().width / p.w;
    const roomX = ((p.dw - p.w) / 2) * scale;
    const roomY = ((p.dh - p.h) / 2) * scale;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    setView({
      ...d.view,
      x: roomX > 0.5 ? clamp(d.view.x + (e.clientX - d.x) / roomX) : 0,
      y: roomY > 0.5 ? clamp(d.view.y + (e.clientY - d.y) / roomY) : 0,
    });
  }

  async function make() {
    if (!img) return;
    setError(undefined);
    try {
      setBusy(t("growth.gridMaking", { done: 0, total: rows * 3 }));
      const blobs = await splitImage(img, rows, view);
      const ids: string[] = [];
      for (const [i, b] of blobs.entries()) {
        ids.push(await uploadImageBlob(b, `grid-${i + 1}.jpg`, t));
        setBusy(t("growth.gridMaking", { done: i + 1, total: blobs.length }));
      }
      const r = await api<{ jobs: Job[] }>("/studio/grid", { method: "POST", json: { upload_ids: ids, caption, caption_all: captionAll } });
      setJobs(r.jobs);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function publishNow() {
    if (!jobs) return;
    if (!window.confirm(t("growth.gridPublishConfirm", { username: me.username, n: jobs.length }))) return;
    setError(undefined);
    try {
      const quota = await api<Quota>("/workflow/quota");
      const left = jobs.filter((j) => j.status !== "published");
      if (quota.remaining < left.length) return setError(t("growth.gridQuota", { n: quota.remaining, total: left.length }));
      for (const [i, j] of left.entries()) {
        setBusy(t("growth.gridPublishing", { done: i, total: left.length }));
        const published = await api<Job>("/workflow/publish", { method: "POST", json: { job_id: j.id } });
        setJobs((js) => js!.map((x) => (x.id === published.id ? published : x)));
      }
      setDone(t("growth.gridDone"));
    } catch (e) {
      setError(toApiError(e).message); // 멈춘 곳부터는 작업함에 남아 있음
    } finally {
      setBusy(undefined);
    }
  }

  async function scheduleAll() {
    if (!jobs) return;
    setError(undefined);
    try {
      const start = new Date(at).getTime();
      for (const [i, j] of jobs.entries()) {
        setBusy(t("growth.gridMaking", { done: i, total: jobs.length }));
        await api(`/workflow/jobs/${j.id}/schedule`, { method: "POST", json: { at: new Date(start + i * 60000).toISOString() } });
      }
      setDone(t("growth.gridScheduled", { when: fmtDateTime(new Date(start).toISOString()) }));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  const n = rows * 3;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-surface-0" role="dialog" aria-modal="true" aria-label={t("growth.gridTitle")}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h2 className="flex-1 text-[16px] font-semibold">{t("growth.gridTitle")}</h2>
        <button type="button" onClick={onClose} disabled={!!busy} className="rounded-md px-2 py-1.5 text-[14px] text-fg-2 hover:bg-surface-2">
          {t("growth.gridClose")}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 p-4 lg:grid-cols-2">
          {/* 왼쪽: 사진·나누기 */}
          <div className="space-y-4">
            {!jobs && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => fileInput.current?.click()} disabled={!!busy}>
                    {t("growth.gridPick")}
                  </Button>
                  <input ref={fileInput} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => pick(e.target.files?.[0])} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-[12px] text-fg-3">{t("growth.gridRows")}</p>
                  <div className="flex gap-1.5">
                    {[1, 2, 3].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRows(r)}
                        className={cx("rounded-full border px-3 py-1.5 text-[12px]", rows === r ? "border-fg bg-fg text-surface-0" : "border-line text-fg-2")}
                      >
                        {t("growth.gridRowsN", { n: r, m: r * 3 })}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {img ? (
              <>
                <canvas
                  ref={canvas}
                  width={720}
                  className={cx("w-full touch-none rounded-lg border border-line", !jobs && "cursor-grab active:cursor-grabbing")}
                  onPointerDown={(e) => {
                    if (jobs) return;
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    drag.current = { x: e.clientX, y: e.clientY, view };
                  }}
                  onPointerMove={onMove}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                />
                {!jobs && (
                  <>
                    <p className="text-[12px] leading-relaxed text-fg-3">{t("growth.gridDragHint")}</p>
                    <label className="flex items-center gap-3 text-[13px]">
                      <span className="shrink-0 text-fg-2">{t("growth.gridZoom")}</span>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={view.zoom}
                        onChange={(e) => setView((v) => ({ ...v, zoom: Number(e.target.value) }))}
                        className="flex-1 accent-[#8b5cf6]"
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line text-[13px] text-fg-3 hover:border-line-strong"
              >
                <span className="text-3xl">🧩</span>
                {t("growth.gridOpenHint")}
              </button>
            )}

            {img && !jobs && (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold">{t("growth.gridCaption")}</p>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={2200}
                  rows={3}
                  className="w-full resize-y rounded-md border border-line bg-surface-1 px-2.5 py-2 text-[13px]"
                />
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" checked={captionAll} onChange={(e) => setCaptionAll(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                  <span>
                    {t("growth.gridCaptionAll")}
                    <span className="block text-[12px] text-fg-3">{t("growth.gridCaptionHint")}</span>
                  </span>
                </label>
                <Button variant="primary" className="w-full" onClick={make} loading={!!busy} disabled={!!busy}>
                  {busy ?? t("growth.gridMake", { n })}
                </Button>
              </div>
            )}

            {jobs && (
              <div className="space-y-3 rounded-lg border border-line p-4">
                <p className="text-[14px] font-semibold">{t("growth.gridMadeTitle", { n: jobs.length })}</p>
                <p className="text-[12px] leading-relaxed text-fg-3">{t("growth.gridOrderHint")}</p>
                {done ? (
                  <Notice tone="good">
                    {done}{" "}
                    <Link href="/admin/jobs" className="underline">
                      {t("growth.gridToJobs")}
                    </Link>
                  </Notice>
                ) : (
                  <>
                    <Button variant="primary" className="w-full" onClick={publishNow} loading={!!busy} disabled={!!busy}>
                      {busy ?? t("growth.gridPublishNow")}
                    </Button>
                    <div className="flex items-center gap-2">
                      <input
                        type="datetime-local"
                        value={at}
                        min={localValue(new Date())}
                        onChange={(e) => setAt(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-[13px]"
                      />
                      <Button onClick={scheduleAll} disabled={!!busy || !at}>
                        {t("growth.schedule")}
                      </Button>
                    </div>
                    <p className="text-[12px] text-fg-3">{t("growth.gridScheduleAt")}</p>
                    <Link href="/admin/jobs" className="block text-[12px] text-fg-3 underline">
                      {t("growth.gridToJobs")}
                    </Link>
                  </>
                )}
              </div>
            )}
            {error && <Notice tone="bad">{error}</Notice>}
          </div>

          {/* 오른쪽: 프로필에서 보이는 모습 */}
          <div>
            <p className="mb-2 text-[13px] font-semibold">{t("growth.gridProfile")}</p>
            <div className="mx-auto max-w-sm">
              <FeedGrid covers={tiles.length ? tiles : Array.from({ length: n }, () => "")} rows={rows + 2} compact />
              {jobs && (
                <ol className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px] text-fg-3">
                  {[...jobs]
                    .sort((a, b) => a.grid!.index - b.grid!.index)
                    .map((j) => (
                      <li key={j.id} className={cx("rounded bg-surface-2 py-1", j.status === "published" && "text-good")}>
                        {j.status === "published" ? "✓ " : ""}
                        {t("growth.gridOrder", { n: j.grid!.order + 1 })}
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
