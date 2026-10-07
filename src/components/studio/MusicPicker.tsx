"use client";

/** 영상에 넣을 음악 고르기: 기본 제공 곡(저작권 걱정 없음) 또는 내 음원 올리기 + 시작 위치·음량.
 *  '음악 넣어 영상으로'(SoundtrackCard)와 '영상 편집'(VideoEditor)에서 함께 씁니다. */

import { upload as blobUpload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { cx, Spinner } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import type { MusicSource, Track } from "@/lib/types";

const TRACK_LABEL: Record<string, MessageKey> = {
  "sunny-pop": "media.trackSunnyPop",
  "lofi-chill": "media.trackLofiChill",
  "calm-piano": "media.trackCalmPiano",
  "dreamy-night": "media.trackDreamyNight",
};
const MAX_AUDIO_MB = 30;

export const emptyMusic = (): MusicSource => ({ track: "", audio_id: "", offset: 0, volume: 1 });
export const hasMusic = (m: MusicSource | null | undefined): m is MusicSource => Boolean(m && (m.track || m.audio_id));

/** 화면에 보여 줄 곡 이름 (기본 곡은 분위기 이름을 번역해서) */
export function useMusicLabel() {
  const t = useT();
  return (m: MusicSource | null | undefined) =>
    !hasMusic(m) ? t("media.none") : m.track && TRACK_LABEL[m.track] ? t(TRACK_LABEL[m.track]) : (m.name ?? "");
}

export function MusicPicker({
  value,
  onChange,
  disabled,
  allowNone = false,
}: {
  value: MusicSource;
  onChange: (m: MusicSource) => void;
  disabled?: boolean;
  /** '음악 없음' 선택지 (영상 편집) */
  allowNone?: boolean;
}) {
  const t = useT();
  const tracks = useApi<{ data: Track[] }>("/studio/tracks");
  const audio = useRef<HTMLAudioElement | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [playing, setPlaying] = useState<string>();
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [length, setLength] = useState(40); // 곡 길이 (시작 위치 최대값)

  useEffect(() => () => audio.current?.pause(), []);

  // 고른 곡의 길이를 알아내 시작 위치 범위를 맞춥니다.
  useEffect(() => {
    const src = value.url;
    if (!src) return;
    const a = new Audio(mediaSrc(src));
    a.preload = "metadata";
    const onMeta = () => Number.isFinite(a.duration) && setLength(Math.max(1, Math.floor(a.duration)));
    a.addEventListener("loadedmetadata", onMeta);
    return () => a.removeEventListener("loadedmetadata", onMeta);
  }, [value.url]);

  function toggle(key: string, src: string) {
    if (playing === key) {
      audio.current?.pause();
      setPlaying(undefined);
      return;
    }
    audio.current?.pause();
    const a = new Audio(mediaSrc(src));
    a.volume = Math.min(1, value.volume);
    if (key === "selected") a.currentTime = value.offset;
    a.onended = () => setPlaying(undefined);
    a.play().catch(() => setPlaying(undefined));
    audio.current = a;
    setPlaying(key);
  }

  async function uploadAudio(f: File) {
    setError(undefined);
    if (f.size > MAX_AUDIO_MB * 1024 * 1024) {
      setError(t("media.myAudioTooBig"));
      return;
    }
    setUploading(0);
    try {
      const ext = f.name.split(".").pop()?.toLowerCase() || "mp3";
      const blob = await blobUpload(`audio/${Date.now()}.${ext}`, f, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: f.type || "audio/mpeg",
        onUploadProgress: ({ percentage }) => setUploading(Math.round(percentage)),
      });
      const name = f.name.replace(/\.[^.]+$/, "").slice(0, 120);
      const reg = await api<{ id: string }>("/media/audio", {
        method: "POST",
        json: { url: blob.url, name, content_type: f.type || "audio/mpeg" },
      });
      onChange({ track: "", audio_id: reg.id, offset: 0, volume: value.volume, name, url: blob.url });
    } catch (e) {
      setError(t("media.uploadFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUploading(null);
    }
  }

  const pick = (tr: Track) => onChange({ ...value, track: tr.key, audio_id: "", name: tr.title, url: tr.url, offset: 0 });
  const radio = (on: boolean) =>
    cx(
      "flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50",
      on ? "border-accent bg-accent/10 font-semibold text-fg" : "border-line text-fg-2 hover:bg-surface-2",
    );

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[12px] font-medium text-fg-2">{t("media.builtIn")}</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {allowNone && (
            <button type="button" className={radio(!hasMusic(value))} disabled={disabled} onClick={() => onChange(emptyMusic())}>
              <span aria-hidden>∅</span> {t("media.none")}
            </button>
          )}
          {tracks.loading && <Spinner />}
          {tracks.data?.data.map((tr) => (
            <div key={tr.key} className="flex min-w-0 items-center gap-1">
              <button type="button" role="radio" aria-checked={value.track === tr.key} className={radio(value.track === tr.key)} disabled={disabled} onClick={() => pick(tr)}>
                <span aria-hidden>♪</span>
                <span className="truncate">{TRACK_LABEL[tr.key] ? t(TRACK_LABEL[tr.key]) : tr.title}</span>
              </button>
              <button
                type="button"
                onClick={() => toggle(tr.key, tr.url)}
                aria-label={`${playing === tr.key ? t("media.stop") : t("media.listen")}: ${tr.title}`}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg"
              >
                {playing === tr.key ? "■" : "▶"}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-fg-3">{t("media.builtInNote")}</p>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          {value.audio_id ? (
            <span className={cx(radio(true), "flex-none")}>
              <span aria-hidden>♪</span> <span className="max-w-[14rem] truncate">{value.name}</span>
            </span>
          ) : null}
          <button
            type="button"
            disabled={disabled || uploading !== null}
            onClick={() => file.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 text-[13px] text-fg-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {uploading !== null ? (
              <>
                <Spinner className="size-3" /> {t("media.uploading", { pct: uploading })}
              </>
            ) : (
              <>⤒ {t("media.myAudio")}</>
            )}
          </button>
          <input
            ref={file}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,.mp3,.m4a,.wav,.aac"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) uploadAudio(f);
            }}
          />
        </div>
        <p className="mt-1 text-[11px] text-fg-3">{t("media.myAudioNote")}</p>
        {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
      </div>

      {hasMusic(value) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12px] text-fg-2">
            <span className="flex items-center justify-between">
              {t("media.startAt")}
              <span className="tnum flex items-center gap-1 text-fg-3">
                {t("media.sec", { n: Math.round(value.offset) })}
                {value.url && (
                  <button type="button" onClick={() => toggle("selected", value.url!)} className="rounded px-1 hover:bg-surface-2 hover:text-fg">
                    {playing === "selected" ? "■" : "▶"}
                  </button>
                )}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, length - 3)}
              step={1}
              value={value.offset}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, offset: Number(e.target.value) })}
              className="mt-1 w-full accent-[var(--accent)]"
            />
          </label>
          <label className="block text-[12px] text-fg-2">
            <span className="flex items-center justify-between">
              {t("media.volume")} <span className="tnum text-fg-3">{Math.round(value.volume * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={value.volume}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, volume: Number(e.target.value) })}
              className="mt-1 w-full accent-[var(--accent)]"
            />
          </label>
        </div>
      )}
    </div>
  );
}
