"use client";

/** 동영상 편집기 (사진 편집기와 같은 전체 화면): 자르기 · 소리 끄기 · 대표 화면 · 꾸미기(글자·스티커·그리기).
 *  화면에서는 원본을 재생하며 바로 확인하고(꾸민 것은 위에 겹쳐 보임), '저장'하면 서버가 원본에서 새로 만듭니다 (원본은 그대로 남음). */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { EditorPreview } from "@/components/editor/ImageEditor";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { Button, cx, Switch } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import type { Asset, Job, VideoEdit } from "@/lib/types";

const ImageEditor = dynamic(() => import("@/components/editor/ImageEditor").then((m) => m.ImageEditor), { ssr: false });

const MIN_SECONDS = 3; // 인스타그램 동영상 최소 길이
// 1×1 투명 PNG — 꾸민 게 하나도 없을 때 '꾸미기 지우기'로 보냄
const EMPTY_PNG = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73,
  68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];
const fmt = (s: number) => (Math.round(s * 10) / 10).toFixed(1);

export function VideoEditor({
  jobId,
  index,
  asset,
  preview,
  onClose,
  onSaved,
}: {
  jobId: number;
  index: number;
  asset: Asset;
  preview?: EditorPreview;
  onClose: () => void;
  onSaved: (job: Job) => void;
}) {
  const t = useT();
  const edit = asset.meta?.video_edit as VideoEdit | undefined;
  const source = edit?.source ?? { url: asset.url, thumbnail_url: asset.thumbnail_url };
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(edit?.start ?? 0);
  const [end, setEnd] = useState<number | null>(edit?.end ?? null);
  const [mute, setMute] = useState(edit?.mute ?? false);
  const [cover, setCover] = useState<number | null>(edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null);
  const [busy, setBusy] = useState<"save" | "reset">();
  const [error, setError] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const [decorating, setDecorating] = useState(false);
  const stop = end ?? duration;
  const length = Math.max(0, stop - start);
  const dirty =
    start !== (edit?.start ?? 0) || end !== (edit?.end ?? null) || mute !== (edit?.mute ?? false) ||
    cover !== (edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null);

  useEffect(() => {
    if (video.current) video.current.muted = mute;
  }, [mute]);

  // 화면을 연 동안 뒤 페이지가 스크롤되지 않게, Esc 로 닫기
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  });

  const onTime = () => {
    const v = video.current;
    if (!v || !stop) return;
    if (v.currentTime >= stop - 0.05 || v.currentTime < start - 0.3) v.currentTime = start; // 자른 구간만 반복 재생
  };
  const seek = (s: number) => {
    if (video.current) video.current.currentTime = s;
  };

  function close() {
    if (busy) return;
    if (dirty && !window.confirm(t("editor.discardConfirm"))) return;
    onClose();
  }

  async function save(close = true) {
    if (duration && length < MIN_SECONDS) return setError(t("media.tooShort"));
    setBusy("save");
    setError(undefined);
    try {
      const r = await api<{ job: Job }>(`/studio/${jobId}/videos/${index}/edit`, {
        method: "POST",
        json: {
          start: start > 0.05 ? start : 0,
          end: end !== null && end < duration - 0.05 ? end : null,
          mute,
          cover_at: cover === null ? null : Math.max(0, cover - start),
        },
      });
      onSaved(r.job);
      if (close) onClose();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  /** 꾸미기: 자르기 등 바꾼 게 있으면 먼저 저장하고 사진 편집기(꾸미기 모드)를 엶 */
  async function decorate() {
    if (dirty && !(await save(false))) return;
    setDecorating(true);
  }

  async function submitOverlay(png: Blob | null, layers: string) {
    const body = new FormData();
    if (png) body.append("file", png, "overlay.png");
    else body.append("file", new Blob([new Uint8Array(EMPTY_PNG)], { type: "image/png" }), "empty.png");
    body.append("layers", layers);
    setBusy("save");
    try {
      const res = await fetch(`/api/py/studio/${jobId}/videos/${index}/overlay`, { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      onSaved(data.job);
    } finally {
      setBusy(undefined);
    }
  }

  async function reset() {
    if (!window.confirm(t("media.resetConfirm"))) return;
    setBusy("reset");
    setError(undefined);
    try {
      const r = await api<{ job: Job }>(`/studio/${jobId}/videos/${index}/edit`, { method: "POST", json: { reset: true } });
      onSaved(r.job);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  const slider = (label: string, value: number, set: (n: number) => void) => (
    <div className="flex items-center gap-2 text-[12px] text-white/80">
      <span className="w-10 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={value}
        disabled={!duration || !!busy}
        onChange={(e) => {
          const n = Number(e.target.value);
          set(n);
          seek(n);
        }}
        className="w-full accent-[#8b5cf6]"
      />
      <span className="tnum w-12 shrink-0 text-right text-white/60">{fmt(value)}s</span>
      <button
        type="button"
        onClick={() => video.current && set(video.current.currentTime)}
        disabled={!duration || !!busy}
        className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-50"
      >
        {t("media.setHere")}
      </button>
    </div>
  );

  // 오른쪽 미리보기: 이 동영상 자리에 편집 중인 원본을 보여 줌
  const previewAssets = preview?.assets.map((a, i) => (i === index ? { ...a, url: source.url, thumbnail_url: source.thumbnail_url, type: "video" as const } : a)) ?? [];
  const previewPane = preview && (
    <div className="space-y-2">
      <p className="text-[12px] text-white/60">{t("editor.livePreview")}</p>
      <div className="rounded-xl bg-white p-2 text-black [color-scheme:light]">
        {preview.kind === "story" ? (
          <StoryPreview username={preview.username} avatar={preview.avatar} assets={previewAssets} />
        ) : (
          <InstagramPreview username={preview.username} avatar={preview.avatar} assets={previewAssets} caption={preview.caption} />
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0b0c] text-white" role="dialog" aria-modal="true" aria-label={t("media.videoTitle")}>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button type="button" onClick={close} className="rounded-md px-2 py-1.5 text-[14px] text-white/80 hover:bg-white/10">
          {t("editor.cancel")}
        </button>
        <span className="flex-1 text-center text-[14px] font-semibold">{t("media.videoTitle")}</span>
        {edit && (
          <button type="button" onClick={reset} disabled={!!busy} className="rounded-md px-2 py-1.5 text-[13px] text-white/80 hover:bg-white/10 disabled:opacity-50">
            {t("media.reset")}
          </button>
        )}
        {preview && (
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="rounded-md px-2 py-1.5 text-[13px] text-white/80 hover:bg-white/10 lg:hidden">
            {t("editor.preview")}
          </button>
        )}
        <Button variant="primary" size="sm" onClick={() => save()} loading={busy === "save"} disabled={!!busy || !duration}>
          {busy === "save" ? t("editor.saving") : t("editor.save")}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
            {/* 영상과 꾸민 그림을 같은 틀에 '맞춤'으로 겹쳐 같은 자리에 보이게 */}
            <div className="relative h-full w-full">
              <video
                ref={video}
                src={mediaSrc(source.url)}
                poster={mediaSrc(source.thumbnail_url) || undefined}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  e.currentTarget.currentTime = start;
                  e.currentTarget.muted = mute;
                }}
                onTimeUpdate={onTime}
                className="absolute inset-0 h-full w-full rounded-lg bg-black object-contain"
              />
              {edit?.overlay_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaSrc(edit.overlay_url)} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
              )}
            </div>
            {busy === "save" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[13px]">{t("media.applying")}</div>
            )}
          </div>

          <div className="space-y-4 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <section className="space-y-2">
              <div className="flex items-center justify-between text-[13px] font-semibold">
                ✂️ {t("media.trim")}
                <span className="tnum text-[12px] font-normal text-white/60">{t("media.length", { s: fmt(length) })}</span>
              </div>
              {slider(t("media.start"), start, (n) => setStart(Math.min(n, stop - 0.5)))}
              {slider(t("media.end"), stop, (n) => setEnd(Math.max(n, start + 0.5)))}
            </section>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-[13px] text-white/85">
                <Switch checked={mute} onChange={setMute} label={t("media.mute")} disabled={!!busy} /> 🔇 {t("media.mute")}
              </label>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-white/85">🖼️ {t("media.cover")}</span>
                <button
                  type="button"
                  onClick={() => video.current && setCover(Math.min(Math.max(video.current.currentTime, start), stop))}
                  disabled={!duration || !!busy}
                  className="rounded-md border border-white/20 px-2 py-1 text-[12px] hover:bg-white/10 disabled:opacity-50"
                >
                  {t("media.useThisFrame")}
                </button>
                <button type="button" onClick={() => cover !== null && seek(cover)} className="tnum text-[12px] text-white/60 underline-offset-2 hover:underline">
                  {cover === null ? t("media.coverDefault") : t("media.coverAt", { s: fmt(cover) })}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-white/45">{t("media.coverHint")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={decorate}
                disabled={!!busy || !duration}
                className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
              >
                ✏️ {edit?.overlay_url ? t("media.decorateEdit") : t("media.decorate")}
              </button>
              {edit?.overlay_url && (
                <button
                  type="button"
                  onClick={() => window.confirm(t("media.decorateRemoveConfirm")) && submitOverlay(null, "").catch((e) => setError(toApiError(e).message))}
                  disabled={!!busy}
                  className="rounded-md border border-white/20 px-2 py-1 text-[12px] hover:bg-white/10 disabled:opacity-50"
                >
                  {t("media.decorateRemove")}
                </button>
              )}
              <span className="text-[11px] text-white/45">{t("media.decorateHint")}</span>
            </div>
            {error && <p className="rounded-md bg-red-500/15 px-2 py-1.5 text-[12px] text-red-300">{error}</p>}
          </div>
        </div>

        {/* 오른쪽: 올라갈 모습 (넓은 화면) / 미리보기 버튼 (휴대폰) */}
        {previewPane && <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-l border-white/10 p-4 lg:block">{previewPane}</aside>}
        {previewPane && showPreview && (
          <div className={cx("fixed inset-0 z-[61] overflow-y-auto bg-black/85 p-4 lg:hidden")} onClick={() => setShowPreview(false)}>
            <div className="mx-auto max-w-sm" onClick={(e) => e.stopPropagation()}>
              {previewPane}
            </div>
          </div>
        )}
      </div>
      {decorating && (
        <ImageEditor
          jobId={jobId}
          index={index}
          asset={asset}
          overlay={{
            title: t("media.decorateTitle"),
            // 꾸미지 않은 원본의 장면을 바탕으로 (꾸민 결과 장면엔 이미 글자가 들어 있어서)
            baseUrl: source.thumbnail_url,
            layers: edit?.overlay_layers || undefined,
            onSubmit: submitOverlay,
          }}
          onClose={() => setDecorating(false)}
          onSaved={() => undefined}
        />
      )}
    </div>
  );
}
