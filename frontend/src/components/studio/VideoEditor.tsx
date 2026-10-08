"use client";

/** 동영상 편집기 (아이폰 사진 앱·iMovie 처럼): 타임라인에서 자르기 · 원본 소리 크기 · 음악 여러 개(곡의 원하는 구간만) ·
 *  대표 화면(장면을 보고 고름) · 꾸미기(글자·스티커·그리기 — 하나하나 보이는 시간을 정함).
 *  편집하는 동안은 화면에만 두고(서버·DB 에 저장하지 않음), '적용하기'를 누르면 모두 한 번에 보내 원본에서 새로 만듭니다.
 *  음악 파일만은 빨리 적용되도록 고르자마자 미리 올려 둡니다. */

import { upload as blobUpload } from "@vercel/blob/client";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorPreview, OverlayPart } from "@/components/editor/ImageEditor";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { fmtTime, Timeline, useFrames, type Track } from "@/components/studio/Timeline";
import { Button, cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import type { Asset, Job, VideoAudio, VideoEdit } from "@/lib/types";

const ImageEditor = dynamic(() => import("@/components/editor/ImageEditor").then((m) => m.ImageEditor), { ssr: false });

const MIN_SECONDS = 3; // 인스타그램 동영상 최소 길이
const MIN_AUDIO = 0.5; // 음악 구간 최소 길이
const MAX_AUDIOS = 8;
const DIRECT_AUDIO_BYTES = 4 * 1024 * 1024; // 이보다 크면 Blob 저장소에 바로 올림 (Vercel 함수 4.5MB 제한)
const AUDIO_COLORS = ["#0891b2", "#0d9488", "#2563eb", "#4f46e5"];
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (s: number) => r1(s).toFixed(1);
/** 음악이 실제로 나오는 길이 (구간을 정하지 않았으면 곡 끝까지) */
const audioLen = (a: VideoAudio) => a.length ?? Math.max(0, a.duration - a.offset);
const audioKey = (list: VideoAudio[]) => JSON.stringify(list.map((a) => [a.id, a.at, a.offset, a.length, a.volume]));

/** 꾸미기 화면에서 만든 것 (적용하기 전까지 화면에만) */
type Deco = { parts: OverlayPart[]; layers: string; urls: string[] };

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
  // 예전 방식(영상 전체에 한 장)도 '처음부터 끝까지 보이는 꾸미기 하나'로
  const savedOverlays = useMemo(
    () => edit?.overlays ?? (edit?.overlay_url ? [{ id: edit.overlay_id ?? "", url: edit.overlay_url, start: null, end: null }] : []),
    [edit],
  );
  const savedAudios = useMemo(
    () => (edit?.audios ?? (edit?.audio ? [edit.audio] : [])).map((a) => ({ ...a, length: a.length ?? null, volume: a.volume ?? 1 })),
    [edit],
  );
  const savedVolume = edit?.mute ? 0 : (edit?.volume ?? 1);
  const savedCover = edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null;
  const video = useRef<HTMLVideoElement>(null);
  const music = useRef(new Map<string, HTMLAudioElement>());
  const file = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(edit?.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const [start, setStart] = useState(edit?.start ?? 0);
  const [end, setEnd] = useState<number | null>(edit?.end ?? null);
  const [volume, setVolume] = useState(savedVolume);
  const [audios, setAudios] = useState<VideoAudio[]>(savedAudios);
  const [deco, setDeco] = useState<Deco | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cover, setCover] = useState<number | null>(savedCover);
  const [coverOpen, setCoverOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "reset" | "audio">();
  const [applied, setApplied] = useState(false);
  const [uploadPct, setUploadPct] = useState<number>();
  const [error, setError] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const [decorating, setDecorating] = useState(false);
  const frames = useFrames(mediaSrc(source.url), 12);
  const stop = end ?? duration;
  const length = Math.max(0, stop - start);
  const coverFrames = useFrames(mediaSrc(source.url), 8, coverOpen && duration ? { from: start, to: stop } : null);
  const overlays = deco ? deco.parts.map((p, i) => ({ id: `new${i}`, url: deco.urls[i], start: p.start, end: p.end })) : savedOverlays;
  const dirty =
    start !== (edit?.start ?? 0) || end !== (edit?.end ?? null) || volume !== savedVolume || cover !== savedCover ||
    audioKey(audios) !== audioKey(savedAudios) || deco !== null;

  // 화면을 연 동안 뒤 페이지가 스크롤되지 않게, Esc 로 닫기, 스페이스로 재생
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (decorating) return;
      if (e.key === "Escape") close();
      const el = e.target as HTMLElement;
      if (e.key === " " && el.tagName !== "INPUT" && el.tagName !== "BUTTON") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  });
  // 꾸미기 미리보기 그림 주소는 바뀌거나 닫을 때 정리
  useEffect(() => () => deco?.urls.forEach((u) => URL.revokeObjectURL(u)), [deco]);

  useEffect(() => {
    if (video.current) video.current.volume = Math.min(1, volume);
    for (const a of audios) {
      const el = music.current.get(a.id);
      if (el) el.volume = Math.min(1, a.volume);
    }
  }, [volume, audios]);

  /** 음악들을 영상 위치에 맞춰 재생·멈춤 (영상 at 초 = 곡 offset 초, length 초 동안) */
  const syncMusic = (vt: number, play: boolean) => {
    for (const a of audios) {
      const m = music.current.get(a.id);
      if (!m) continue;
      const pos = a.offset + (vt - a.at);
      const inside = vt >= a.at && pos < a.offset + audioLen(a);
      if (!play || !inside) {
        if (!m.paused) m.pause();
        if (!play && inside) m.currentTime = pos;
        continue;
      }
      if (Math.abs(m.currentTime - pos) > 0.25) m.currentTime = pos;
      if (m.paused) void m.play().catch(() => undefined);
    }
  };

  // 재생 중: 재생 위치를 따라가고, 자른 구간만 반복하고, 음악을 맞춤
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        if (v.currentTime >= stop - 0.03 || v.currentTime < start - 0.3) v.currentTime = start;
        setTime(v.currentTime);
        syncMusic(v.currentTime, true);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, start, stop, audios]);

  const seek = (s: number) => {
    const x = Math.min(duration || s, Math.max(0, s));
    if (video.current) video.current.currentTime = x;
    setTime(x);
    syncMusic(x, playing);
  };
  function toggle() {
    const v = video.current;
    if (!v || !duration) return;
    if (v.paused) {
      if (v.currentTime >= stop - 0.05 || v.currentTime < start) v.currentTime = start;
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
      syncMusic(v.currentTime, false);
    }
  }
  const pause = () => {
    video.current?.pause();
    setPlaying(false);
    syncMusic(time, false);
  };

  function close() {
    if (busy) return;
    if (dirty && !window.confirm(t("media.unappliedConfirm"))) return;
    onClose();
  }

  /** 적용하기: 편집한 것을 모두 한 번에 보내 원본에서 영상을 만듦 */
  async function apply() {
    if (duration && length < MIN_SECONDS) return setError(t("media.tooShort"));
    setBusy("save");
    setError(undefined);
    setApplied(false);
    pause();
    try {
      const body = new FormData();
      body.append(
        "state",
        JSON.stringify({
          start: start > 0.05 ? start : 0,
          end: end !== null && end < duration - 0.05 ? end : null,
          volume,
          audios: audios.map((a) => ({ id: a.id, at: a.at, offset: a.offset, length: a.length, volume: a.volume })),
          cover_at: cover === null ? null : Math.max(0, cover - start),
          overlays_changed: deco !== null,
        }),
      );
      if (deco) {
        deco.parts.forEach((p, i) => body.append("files", p.png, `overlay${i}.png`));
        body.append("timings", JSON.stringify(deco.parts.map((p) => [p.start, p.end])));
        body.append("layers", deco.layers);
      }
      const res = await fetch(`/api/py/studio/${jobId}/videos/${index}/apply`, { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      setDeco(null);
      onSaved(data.job);
      setApplied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  /** 꾸미기 화면에서 '완료': 화면에만 담아 둠 (적용하기 때 함께 보냄). 거기서 바꾼 자르기도 반영 */
  async function keepDecoration(parts: OverlayPart[], layers: string, cut?: { start: number; end: number }) {
    setDeco({ parts, layers, urls: parts.map((p) => URL.createObjectURL(p.png)) });
    setApplied(false);
    if (cut) {
      setStart(cut.start > 0.05 ? r1(cut.start) : 0);
      setEnd(duration && cut.end < duration - 0.05 ? r1(cut.end) : null);
    }
  }

  /** 음악 파일 올리기 → 지금 재생 위치(자른 구간 안)부터 들리게 */
  async function addAudio(f: File) {
    setBusy("audio");
    setError(undefined);
    setUploadPct(undefined);
    try {
      const body = new FormData();
      body.append("name", f.name);
      if (f.size <= DIRECT_AUDIO_BYTES) {
        body.append("file", f, f.name);
      } else {
        const ext = f.name.split(".").pop()?.toLowerCase() || "mp3";
        const blob = await blobUpload(`audio/${Date.now()}.${ext}`, f, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: f.type || "audio/mpeg",
          onUploadProgress: ({ percentage }) => setUploadPct(Math.round(percentage)),
        });
        body.append("url", blob.url);
      }
      const res = await fetch(`/api/py/studio/${jobId}/videos/${index}/audio`, { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      const at = Math.min(Math.max(time, start), Math.max(start, stop - MIN_AUDIO));
      setAudios((list) => [...list, { id: data.id, url: data.url, name: data.name || f.name, duration: data.duration, at: r1(at), offset: 0, length: null, volume: 1 }]);
      setSelected(`a:${data.id}`);
      setApplied(false);
    } catch (e) {
      setError(t("media.audioFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(undefined);
      setUploadPct(undefined);
    }
  }
  const updateAudio = (id: string, patch: Partial<VideoAudio>) => {
    setAudios((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setApplied(false);
  };

  /** 타임라인에서 음악 막대를 끌 때: 가운데 = 위치 옮기기, 왼쪽 끝 = 곡의 시작 지점, 오른쪽 끝 = 끝나는 지점 */
  function dragAudio(a: VideoAudio, s: number, e: number, how: "move" | "left" | "right") {
    if (how === "move") return updateAudio(a.id, { at: r1(Math.max(0, s)) });
    if (how === "left") {
      // 왼쪽 끝을 끌면 곡의 더 앞/뒤에서 시작 (곡 처음보다 앞으로는 못 감)
      const d = Math.max(-a.offset, Math.min(s - a.at, audioLen(a) - MIN_AUDIO));
      return updateAudio(a.id, { at: r1(a.at + d), offset: r1(a.offset + d), length: r1(audioLen(a) - d) });
    }
    const len = Math.min(a.duration - a.offset, Math.max(MIN_AUDIO, e - a.at));
    updateAudio(a.id, { length: r1(len) });
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

  // 타임라인 줄: 꾸민 것(꾸미기 화면에서 시간 조절) + 음악들(끌어서 옮기고 양 끝으로 구간 조절)
  const tracks: Track[] = [
    ...overlays.map((o, i) => ({
      id: `o${i}`,
      label: t("media.decoration", { n: i + 1 }),
      icon: "✏️",
      start: o.start ?? start,
      end: o.end ?? stop,
      color: "#7c3aed",
      selected: selected === `o${i}`,
      moveOnly: true,
    })),
    ...audios.map((a, i) => ({
      id: `a:${a.id}`,
      label: a.offset > 0.05 ? `${a.name} · ${fmtTime(a.offset)}~` : a.name,
      icon: "🎵",
      start: a.at,
      end: Math.min(duration || Infinity, a.at + audioLen(a)),
      color: AUDIO_COLORS[i % AUDIO_COLORS.length],
      selected: selected === `a:${a.id}`,
    })),
  ];

  const row = (label: string, value: number, max: number, set: (n: number) => void, display: string, step = 0.01) => (
    <label className="flex items-center gap-3 text-[12px] text-white/80">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={!!busy}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full accent-[#8b5cf6]"
      />
      <span className="tnum w-12 shrink-0 text-right text-white/60">{display}</span>
    </label>
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
          {t("media.close")}
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
        <Button variant="primary" size="sm" onClick={apply} loading={busy === "save"} disabled={!!busy || !duration || !dirty}>
          {busy === "save" ? t("media.applyingShort") : t("media.apply")}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-3" onClick={toggle}>
            {/* 영상과 꾸민 그림들을 같은 틀에 '맞춤'으로 겹쳐 같은 자리에 보이게 — 그림은 정한 시간에만 */}
            <div className="relative h-full w-full">
              <video
                ref={video}
                src={mediaSrc(source.url)}
                poster={mediaSrc(source.thumbnail_url) || undefined}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  e.currentTarget.currentTime = start;
                }}
                onPause={() => setPlaying(false)}
                className="absolute inset-0 h-full w-full rounded-lg bg-black object-contain"
              />
              {overlays.map(
                (o) =>
                  (o.start == null || time >= o.start) &&
                  (o.end == null || time <= o.end) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={o.id + o.url} src={mediaSrc(o.url)} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
                  ),
              )}
              {!playing && duration > 0 && (
                <span className="pointer-events-none absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-xl">
                  ▶
                </span>
              )}
            </div>
            {audios.map((a) => (
              <audio
                key={a.id}
                ref={(el) => {
                  if (el) music.current.set(a.id, el);
                  else music.current.delete(a.id);
                }}
                src={mediaSrc(a.url)}
                preload="auto"
              />
            ))}
            {(busy === "save" || busy === "audio") && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[13px]">
                {busy === "audio" ? t("media.audioUploading", { pct: uploadPct ?? 0 }) : t("media.applying")}
              </div>
            )}
          </div>

          <div className="max-h-[52dvh] space-y-3 overflow-y-auto border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {dirty && !busy ? (
              <div className="flex items-center gap-2 rounded-lg bg-[#8b5cf6]/15 px-3 py-2 text-[12px] text-[#d8ccff]">
                <span className="flex-1">{t("media.unappliedHint")}</span>
                <button type="button" onClick={apply} disabled={!duration} className="shrink-0 rounded-md bg-[#8b5cf6] px-2.5 py-1 font-semibold text-white">
                  {t("media.apply")}
                </button>
              </div>
            ) : (
              applied && !busy && <p className="rounded-lg bg-emerald-500/15 px-3 py-2 text-[12px] text-emerald-200">✓ {t("media.appliedHint")}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggle}
                disabled={!duration}
                aria-label={playing ? t("media.pause") : t("media.play")}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[13px] text-black disabled:opacity-40"
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <span className="tnum text-[12px] text-white/70">
                {fmtTime(Math.max(0, time - start))} / {fmtTime(length)}
              </span>
              <span className="ml-auto text-[11px] text-white/45">{t("media.trimHint")}</span>
            </div>
            <Timeline
              min={0}
              max={duration || 1}
              time={time}
              onSeek={seek}
              frames={frames}
              trim={{ start, end: stop }}
              onTrim={(a, b) => {
                setStart(r1(a));
                setEnd(r1(b));
                setApplied(false);
              }}
              tracks={tracks}
              onSelect={setSelected}
              onTrack={(id, s, e, _done, how) => {
                const a = audios.find((x) => `a:${x.id}` === id);
                if (a) dragAudio(a, s, e, how);
              }}
              disabled={!duration || !!busy}
            />

            {/* 꾸미기 · 음악 추가 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  pause();
                  setDecorating(true);
                }}
                disabled={!!busy || !duration}
                className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
              >
                ✏️ {overlays.length ? t("media.decorateEdit") : t("media.decorate")}
              </button>
              <button
                type="button"
                onClick={() => file.current?.click()}
                disabled={!!busy || !duration || audios.length >= MAX_AUDIOS}
                className="rounded-lg border border-white/25 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
              >
                🎵 {t("media.audioAdd")}
              </button>
              <input
                ref={file}
                type="file"
                accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void addAudio(f);
                }}
              />
              {overlays.length > 0 && (
                <button
                  type="button"
                  onClick={() => window.confirm(t("media.decorateRemoveConfirm")) && setDeco({ parts: [], layers: "", urls: [] })}
                  disabled={!!busy}
                  className="rounded-md px-2 py-1 text-[12px] text-white/70 hover:bg-white/10 disabled:opacity-50"
                >
                  {t("media.decorateRemove")}
                </button>
              )}
              <span className="text-[11px] text-white/45">{t("media.decorateHint")}</span>
            </div>

            {/* 소리 */}
            <section className="space-y-2 rounded-lg bg-white/[0.04] p-3">
              {row(
                `🔊 ${t("media.originalSound")}`,
                volume,
                1,
                (n) => {
                  setVolume(n);
                  setApplied(false);
                },
                volume === 0 ? t("media.off") : `${Math.round(volume * 100)}%`,
              )}
              {audios.map((a, i) => (
                <div
                  key={a.id}
                  className={cx("space-y-1.5 rounded-md border px-2.5 py-2", selected === `a:${a.id}` ? "border-white/40" : "border-white/10")}
                  onClick={() => setSelected(`a:${a.id}`)}
                >
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: AUDIO_COLORS[i % AUDIO_COLORS.length] }} />
                    <span className="truncate font-medium">🎵 {a.name}</span>
                    <span className="tnum shrink-0 text-white/50">
                      {fmtTime(a.offset)}–{fmtTime(a.offset + audioLen(a))} / {fmtTime(a.duration)}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateAudio(a.id, { at: r1(Math.max(start, time)) })}
                      disabled={!!busy}
                      className="ml-auto shrink-0 rounded-md border border-white/20 px-2 py-0.5 text-[11px] hover:bg-white/10"
                    >
                      {t("media.audioStartHere")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        music.current.get(a.id)?.pause();
                        setAudios((list) => list.filter((x) => x.id !== a.id));
                        setApplied(false);
                      }}
                      disabled={!!busy}
                      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-[#ff8fa3] hover:bg-white/10"
                    >
                      {t("media.audioRemove")}
                    </button>
                  </div>
                  {row(t("media.audioVolume"), a.volume, 1, (n) => updateAudio(a.id, { volume: n }), `${Math.round(a.volume * 100)}%`)}
                  {row(
                    t("media.audioOffset"),
                    a.offset,
                    Math.max(0, a.duration - MIN_AUDIO),
                    (n) => updateAudio(a.id, { offset: r1(n), length: a.length === null ? null : r1(Math.min(a.length, a.duration - n)) }),
                    fmtTime(a.offset),
                    0.1,
                  )}
                </div>
              ))}
              {audios.length > 0 && <p className="text-[11px] text-white/45">{t("media.audioHint")}</p>}
            </section>

            {/* 대표 화면: 장면을 보고 고름 */}
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-white/85">🖼️ {t("media.cover")}</span>
                <span className="tnum text-[12px] text-white/60">
                  {cover === null ? t("media.coverDefault") : t("media.coverAt", { s: fmt(cover - start) })}
                </span>
                <button
                  type="button"
                  onClick={() => setCoverOpen((v) => !v)}
                  disabled={!duration || !!busy}
                  className="rounded-md border border-white/20 px-2 py-1 text-[12px] hover:bg-white/10 disabled:opacity-50"
                >
                  {coverOpen ? t("media.coverClose") : t("media.coverPick")}
                </button>
              </div>
              {coverOpen && (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                    {Array.from({ length: 8 }, (_, i) => {
                      const at = r1(start + ((i + 0.5) / 8) * length);
                      const on = cover !== null && Math.abs(cover - at) < 0.06;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setCover(at);
                            seek(at);
                            setApplied(false);
                          }}
                          className={cx("relative aspect-[9/16] overflow-hidden rounded-md bg-white/10", on ? "ring-2 ring-[#ffd60a]" : "opacity-80 hover:opacity-100")}
                        >
                          {coverFrames[i] && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={coverFrames[i]} alt="" className="h-full w-full object-cover" />
                          )}
                          <span className="tnum absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[10px]">{fmt(at - start)}s</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => {
                        setCover(r1(Math.min(Math.max(time, start), stop)));
                        setApplied(false);
                      }}
                      disabled={!duration || !!busy}
                      className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:opacity-50"
                    >
                      {t("media.useThisFrame")}
                    </button>
                    <span className="text-white/45">{t("media.coverHint")}</span>
                  </div>
                </div>
              )}
            </section>
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
            layers: (deco ? deco.layers : edit?.overlay_layers) || undefined,
            video: { src: source.url, start, end: stop, duration },
            onSubmit: keepDecoration,
          }}
          onClose={() => setDecorating(false)}
          onSaved={() => undefined}
        />
      )}
    </div>
  );
}
