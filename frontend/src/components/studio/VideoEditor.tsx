"use client";

/** 동영상 편집: 자르기 · 원래 소리 끄기/크기 · 음악 넣기 · 대표 화면 고르기.
 *  화면에서는 원본을 재생하며 바로 확인하고(음악도 같이 재생), '적용'하면 서버가 원본에서 새로 만듭니다. */

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { Button, Dialog, Notice, Switch } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import type { Asset, Job, MusicSource, VideoEdit } from "@/lib/types";
import { emptyMusic, hasMusic, MusicPicker } from "./MusicPicker";

const MIN_SECONDS = 3; // 인스타그램 동영상 최소 길이
const fmt = (s: number) => (Math.round(s * 10) / 10).toFixed(1);

export function VideoEditor({
  jobId,
  index,
  asset,
  onClose,
  onSaved,
}: {
  jobId: number;
  index: number;
  asset: Asset;
  onClose: () => void;
  onSaved: (job: Job) => void;
}) {
  const t = useT();
  const edit = asset.meta?.video_edit as VideoEdit | undefined;
  const source = edit?.source ?? { url: asset.url, thumbnail_url: asset.thumbnail_url };
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(edit?.start ?? 0);
  const [end, setEnd] = useState<number | null>(edit?.end ?? null);
  const [mute, setMute] = useState(edit?.mute ?? false);
  const [origVolume, setOrigVolume] = useState(edit?.original_volume ?? 1);
  const [cover, setCover] = useState<number | null>(edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null);
  const [music, setMusic] = useState<MusicSource>(edit?.music ?? emptyMusic());
  const [busy, setBusy] = useState<"apply" | "reset">();
  const [error, setError] = useState<string>();
  const stop = end ?? duration;

  // 음악 미리 듣기: 영상과 함께 재생
  useEffect(() => {
    audio.current?.pause();
    audio.current = hasMusic(music) && music.url ? new Audio(mediaSrc(music.url)) : null;
    return () => audio.current?.pause();
  }, [music.url, music.track, music.audio_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = mute;
    v.volume = Math.min(1, origVolume);
    if (audio.current) audio.current.volume = Math.min(1, music.volume);
  }, [mute, origVolume, music.volume]);

  const syncAudio = () => {
    const v = video.current;
    const a = audio.current;
    if (!v || !a) return;
    a.currentTime = music.offset + Math.max(0, v.currentTime - start);
    if (!v.paused) a.play().catch(() => {});
  };

  const onTime = () => {
    const v = video.current;
    if (!v || !stop) return;
    if (v.currentTime >= stop - 0.05 || v.currentTime < start - 0.3) {
      v.currentTime = start; // 자른 구간만 반복 재생
      syncAudio();
    }
  };

  const seek = (s: number) => {
    if (video.current) video.current.currentTime = s;
  };
  const length = Math.max(0, stop - start);

  async function apply() {
    if (duration && length < MIN_SECONDS) {
      setError(t("media.tooShort"));
      return;
    }
    setBusy("apply");
    setError(undefined);
    try {
      const r = await api<{ job: Job }>(`/studio/${jobId}/videos/${index}/edit`, {
        method: "POST",
        json: {
          start: start > 0.05 ? start : 0,
          end: end !== null && end < duration - 0.05 ? end : null,
          mute,
          original_volume: origVolume,
          cover_at: cover === null ? null : Math.max(0, cover - start),
          music: hasMusic(music) ? { track: music.track, audio_id: music.audio_id, offset: music.offset, volume: music.volume } : null,
        },
      });
      onSaved(r.job);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
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

  const slider = (value: number, min: number, max: number, set: (n: number) => void) => (
    <input
      type="range"
      min={min}
      max={max}
      step={0.1}
      value={value}
      disabled={!duration || !!busy}
      onChange={(e) => {
        const n = Number(e.target.value);
        set(n);
        seek(n);
      }}
      className="w-full accent-[var(--accent)]"
    />
  );

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={t("media.videoTitle")}
      subtitle={t("media.videoSubtitle")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {edit ? (
            <Button variant="ghost" onClick={reset} loading={busy === "reset"} disabled={!!busy}>
              {t("media.reset")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={!!busy}>
              {t("editor.cancel")}
            </Button>
            <Button variant="primary" onClick={apply} loading={busy === "apply"} disabled={!!busy || !duration}>
              {busy === "apply" ? t("media.applying") : t("media.apply")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <video
          ref={video}
          src={mediaSrc(source.url)}
          poster={mediaSrc(source.thumbnail_url) || undefined}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            setDuration(d);
            e.currentTarget.currentTime = start;
          }}
          onTimeUpdate={onTime}
          onPlay={syncAudio}
          onPause={() => audio.current?.pause()}
          onSeeked={syncAudio}
          className="mx-auto block max-h-[45dvh] w-full rounded-lg bg-black object-contain"
        />

        {/* 자르기 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-[13px] font-semibold">
            {t("media.trim")} <span className="tnum text-[12px] font-normal text-fg-3">{t("media.length", { s: fmt(length) })}</span>
          </div>
          {[
            { label: t("media.start"), value: start, set: (n: number) => setStart(Math.min(n, stop - 0.5)), min: 0, max: duration },
            { label: t("media.end"), value: stop, set: (n: number) => setEnd(Math.max(n, start + 0.5)), min: 0, max: duration },
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2 text-[12px] text-fg-2">
              <span className="w-10 shrink-0">{row.label}</span>
              {slider(row.value, row.min, row.max, row.set)}
              <span className="tnum w-12 shrink-0 text-right text-fg-3">{fmt(row.value)}s</span>
              <button
                type="button"
                onClick={() => video.current && row.set(video.current.currentTime)}
                disabled={!duration || !!busy}
                className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-fg-2 hover:bg-surface-2 disabled:opacity-50"
              >
                {t("media.setHere")}
              </button>
            </div>
          ))}
        </section>

        {/* 원래 소리 */}
        <section className="space-y-2">
          <p className="text-[13px] font-semibold">{t("media.sound")}</p>
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            <Switch checked={mute} onChange={setMute} label={t("media.mute")} disabled={!!busy} /> {t("media.mute")}
          </label>
          {!mute && hasMusic(music) && (
            <label className="block max-w-sm text-[12px] text-fg-2">
              <span className="flex justify-between">
                {t("media.originalVolume")} <span className="tnum text-fg-3">{Math.round(origVolume * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={origVolume}
                onChange={(e) => setOrigVolume(Number(e.target.value))}
                className="mt-1 w-full accent-[var(--accent)]"
              />
            </label>
          )}
        </section>

        {/* 음악 */}
        <section className="space-y-2">
          <p className="text-[13px] font-semibold">{t("media.music")}</p>
          <MusicPicker value={music} onChange={setMusic} disabled={!!busy} allowNone />
        </section>

        {/* 대표 화면 */}
        <section className="space-y-2">
          <p className="text-[13px] font-semibold">{t("media.cover")}</p>
          <p className="text-[12px] text-fg-3">{t("media.coverHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => video.current && setCover(Math.min(Math.max(video.current.currentTime, start), stop))}
              disabled={!duration || !!busy}
            >
              {t("media.useThisFrame")}
            </Button>
            <button
              type="button"
              onClick={() => cover !== null && seek(cover)}
              className="tnum text-[12px] text-fg-2 underline-offset-2 hover:underline"
            >
              {cover === null ? t("media.coverDefault") : t("media.coverAt", { s: fmt(cover) })}
            </button>
          </div>
        </section>

        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Dialog>
  );
}
