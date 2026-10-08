"use client";

/** 동영상 편집기 (아이폰 사진 앱·iMovie 처럼): 타임라인에서 자르기 · 원본 소리 크기 · 음악 넣기 · 대표 화면 ·
 *  꾸미기(글자·스티커·그리기 — 하나하나 보이는 시간을 정함).
 *  화면에서는 원본을 재생하며 바로 확인하고(꾸민 것은 그 시간에만 겹쳐 보이고 음악도 같이 들림),
 *  '저장'하면 서버가 원본에서 새로 만듭니다 (원본은 그대로 남음). */

import { upload as blobUpload } from "@vercel/blob/client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
const DIRECT_AUDIO_BYTES = 4 * 1024 * 1024; // 이보다 크면 Blob 저장소에 바로 올림 (Vercel 함수 4.5MB 제한)
const fmt = (s: number) => (Math.round(s * 10) / 10).toFixed(1);
const sameAudio = (a: VideoAudio | null, b: VideoAudio | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.at === b.at && a.offset === b.offset && a.volume === b.volume);

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
  const overlays = edit?.overlays ?? (edit?.overlay_url ? [{ id: edit.overlay_id ?? "", url: edit.overlay_url, start: null, end: null }] : []);
  const savedAudio = edit?.audio ?? null;
  const savedVolume = edit?.mute ? 0 : (edit?.volume ?? 1);
  const video = useRef<HTMLVideoElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(edit?.start ?? 0);
  const [playing, setPlaying] = useState(false);
  const [start, setStart] = useState(edit?.start ?? 0);
  const [end, setEnd] = useState<number | null>(edit?.end ?? null);
  const [volume, setVolume] = useState(savedVolume);
  const [audio, setAudio] = useState<VideoAudio | null>(savedAudio);
  const [selected, setSelected] = useState<string | null>(null);
  const [cover, setCover] = useState<number | null>(edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null);
  const [busy, setBusy] = useState<"save" | "reset" | "audio">();
  const [uploadPct, setUploadPct] = useState<number>();
  const [error, setError] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const [decorating, setDecorating] = useState(false);
  const frames = useFrames(mediaSrc(source.url), 12);
  const stop = end ?? duration;
  const length = Math.max(0, stop - start);
  const dirty =
    start !== (edit?.start ?? 0) || end !== (edit?.end ?? null) || volume !== savedVolume || !sameAudio(audio, savedAudio) ||
    cover !== (edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null);

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

  useEffect(() => {
    if (video.current) video.current.volume = Math.min(1, volume);
    if (music.current) music.current.volume = Math.min(1, audio?.volume ?? 1);
  }, [volume, audio?.volume]);

  /** 음악을 영상 위치에 맞춰 재생·멈춤 (영상 at 초 = 음악 offset 초) */
  const syncMusic = (vt: number, play: boolean) => {
    const m = music.current;
    if (!m || !audio) return;
    const pos = audio.offset + (vt - audio.at);
    const inside = vt >= audio.at && pos < audio.duration;
    if (!play || !inside) {
      if (!m.paused) m.pause();
      if (!play && inside) m.currentTime = pos;
      return;
    }
    if (Math.abs(m.currentTime - pos) > 0.25) m.currentTime = pos;
    if (m.paused) void m.play().catch(() => undefined);
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
  }, [playing, start, stop, audio]);

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

  function close() {
    if (busy) return;
    if (dirty && !window.confirm(t("editor.discardConfirm"))) return;
    onClose();
  }

  async function save(closeAfter = true) {
    if (duration && length < MIN_SECONDS) return setError(t("media.tooShort"));
    setBusy("save");
    setError(undefined);
    video.current?.pause();
    try {
      const r = await api<{ job: Job }>(`/studio/${jobId}/videos/${index}/edit`, {
        method: "POST",
        json: {
          start: start > 0.05 ? start : 0,
          end: end !== null && end < duration - 0.05 ? end : null,
          mute: volume === 0,
          volume,
          audio: audio && { id: audio.id, at: audio.at, offset: audio.offset, volume: audio.volume },
          cover_at: cover === null ? null : Math.max(0, cover - start),
        },
      });
      onSaved(r.job);
      if (closeAfter) onClose();
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  /** 꾸미기: 바꾼 게 있으면 먼저 저장하고 꾸미기 화면(사진 편집기의 꾸미기 모드)을 엶 */
  async function decorate() {
    if (dirty && !(await save(false))) return;
    video.current?.pause();
    setDecorating(true);
  }

  async function submitOverlay(parts: OverlayPart[], layers: string) {
    const body = new FormData();
    parts.forEach((p, i) => body.append("files", p.png, `overlay${i}.png`));
    body.append("timings", JSON.stringify(parts.map((p) => [p.start, p.end])));
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
      const at = Math.min(Math.max(time, start), Math.max(start, stop - 0.5));
      setAudio({ id: data.id, url: data.url, name: data.name || f.name, duration: data.duration, at: Math.round(at * 10) / 10, offset: 0, volume: 1 });
      setSelected("audio");
    } catch (e) {
      setError(t("media.audioFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(undefined);
      setUploadPct(undefined);
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

  // 타임라인 줄: 꾸민 것(누르면 꾸미기 화면) + 음악(끌어서 옮김)
  const audioEnd = audio ? Math.min(stop || Infinity, audio.at + (audio.duration - audio.offset)) : 0;
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
    ...(audio ? [{ id: "audio", label: audio.name, icon: "🎵", start: audio.at, end: audioEnd, color: "#0891b2", selected: selected === "audio", moveOnly: true }] : []),
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
          <div className="relative flex min-h-0 flex-1 items-center justify-center p-3" onClick={toggle}>
            {/* 영상과 꾸민 그림들을 같은 틀에 '맞춤'으로 겹쳐 같은 자리에 보이게 — 그림은 정한 시간에만 */}
            <div className="relative h-full w-full">
              <video
                ref={video}
                src={mediaSrc(source.url)}
                poster={mediaSrc(source.thumbnail_url) || undefined}
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration);
                  e.currentTarget.currentTime = start;
                }}
                onPause={() => setPlaying(false)}
                className="absolute inset-0 h-full w-full rounded-lg bg-black object-contain"
              />
              {overlays.map(
                (o, i) =>
                  (o.start == null || time >= o.start) &&
                  (o.end == null || time <= o.end) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={mediaSrc(o.url)} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
                  ),
              )}
              {!playing && duration > 0 && (
                <span className="pointer-events-none absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-xl">
                  ▶
                </span>
              )}
            </div>
            {audio && <audio ref={music} src={mediaSrc(audio.url)} preload="auto" />}
            {(busy === "save" || busy === "audio") && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[13px]">
                {busy === "audio" ? t("media.audioUploading", { pct: uploadPct ?? 0 }) : t("media.applying")}
              </div>
            )}
          </div>

          <div className="max-h-[52dvh] space-y-3 overflow-y-auto border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
                setStart(Math.round(a * 10) / 10);
                setEnd(Math.round(b * 10) / 10);
              }}
              tracks={tracks}
              onSelect={setSelected}
              onTrack={(id, a) => {
                if (id === "audio" && audio) setAudio({ ...audio, at: Math.round(Math.max(0, a) * 10) / 10 });
              }}
              disabled={!duration || !!busy}
            />

            {/* 꾸미기 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={decorate}
                disabled={!!busy || !duration}
                className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
              >
                ✏️ {overlays.length ? t("media.decorateEdit") : t("media.decorate")}
              </button>
              <button
                type="button"
                onClick={() => file.current?.click()}
                disabled={!!busy || !duration}
                className="rounded-lg border border-white/25 px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
              >
                🎵 {audio ? t("media.audioChange") : t("media.audioAdd")}
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
                  onClick={() => window.confirm(t("media.decorateRemoveConfirm")) && submitOverlay([], "").catch((e) => setError(toApiError(e).message))}
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
              {row(`🔊 ${t("media.originalSound")}`, volume, 1, setVolume, volume === 0 ? t("media.off") : `${Math.round(volume * 100)}%`)}
              {audio && (
                <>
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="truncate font-medium">🎵 {audio.name}</span>
                    <span className="tnum shrink-0 text-white/50">{fmtTime(audio.duration)}</span>
                    <button
                      type="button"
                      onClick={() => setAudio({ ...audio, at: Math.round(Math.max(start, time) * 10) / 10 })}
                      disabled={!!busy}
                      className="ml-auto shrink-0 rounded-md border border-white/20 px-2 py-0.5 text-[11px] hover:bg-white/10"
                    >
                      {t("media.audioStartHere")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        music.current?.pause();
                        setAudio(null);
                      }}
                      disabled={!!busy}
                      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-[#ff8fa3] hover:bg-white/10"
                    >
                      {t("media.audioRemove")}
                    </button>
                  </div>
                  {row(`🎵 ${t("media.audioVolume")}`, audio.volume, 1, (n) => setAudio({ ...audio, volume: n }), `${Math.round(audio.volume * 100)}%`)}
                  {row(
                    t("media.audioOffset"),
                    audio.offset,
                    Math.max(0, audio.duration - 1),
                    (n) => {
                      setAudio({ ...audio, offset: Math.round(n * 10) / 10 });
                      if (music.current && !playing) music.current.currentTime = n;
                    },
                    `${fmt(audio.offset)}s`,
                    0.1,
                  )}
                  <p className="text-[11px] text-white/45">{t("media.audioHint")}</p>
                </>
              )}
            </section>

            {/* 대표 화면 */}
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-white/85">🖼️ {t("media.cover")}</span>
              <button
                type="button"
                onClick={() => setCover(Math.min(Math.max(time, start), stop))}
                disabled={!duration || !!busy}
                className="rounded-md border border-white/20 px-2 py-1 text-[12px] hover:bg-white/10 disabled:opacity-50"
              >
                {t("media.useThisFrame")}
              </button>
              <button type="button" onClick={() => cover !== null && seek(cover)} className="tnum text-[12px] text-white/60 underline-offset-2 hover:underline">
                {cover === null ? t("media.coverDefault") : t("media.coverAt", { s: fmt(cover - start) })}
              </button>
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
            video: { src: source.url, start, end: stop },
            onSubmit: submitOverlay,
          }}
          onClose={() => setDecorating(false)}
          onSaved={() => undefined}
        />
      )}
    </div>
  );
}
