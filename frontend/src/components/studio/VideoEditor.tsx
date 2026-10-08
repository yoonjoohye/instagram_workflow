"use client";

/** 동영상 편집 — 한 화면에서 다: 영상을 재생하며 바로 글자·스티커·그리기를 넣고(누르면 고르고 끌어 옮김),
 *  타임라인 하나에서 자르기·꾸민 것의 시간·음악 구간을 정하고, 🎵 소리 탭(원본 소리·음악 여러 개)과
 *  🖼 대표 화면 탭(장면을 보고 고름)까지. 편집하는 동안은 화면에만 두고 '적용하기' 한 번으로 서버가 원본에서 새로 만듭니다.
 *  화면 자체는 사진 편집기의 동영상 모드(꾸미기 화면)에 소리·대표 화면 탭과 음악 줄을 붙여 씁니다. */

import { upload as blobUpload } from "@vercel/blob/client";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import type { EditorPreview, OverlayPart } from "@/components/editor/ImageEditor";
import { fmtTime, useFrames, type Track } from "@/components/studio/Timeline";
import { cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import { pendingUploads, useUploads, waitForUploads } from "@/lib/localMedia";
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
  const savedAudios = useMemo(
    () => (edit?.audios ?? (edit?.audio ? [edit.audio] : [])).map((a) => ({ ...a, length: a.length ?? null, volume: a.volume ?? 1 })),
    [edit],
  );
  const savedVolume = edit?.mute ? 0 : (edit?.volume ?? 1);
  const savedCover = edit?.cover_at != null ? (edit.start ?? 0) + edit.cover_at : null;
  // 처음 열 때의 꾸미기 상태 (적용한 뒤에도 편집기 안의 것을 그대로 쓰므로 다시 불러오지 않음)
  const [initialLayers] = useState(edit?.overlay_layers || undefined);
  const controller = useRef<{ seek: (t: number) => void; time: () => number } | null>(null);
  const music = useRef(new Map<string, HTMLAudioElement>());
  const file = useRef<HTMLInputElement>(null);
  const [cut, setCut] = useState({ start: edit?.start ?? 0, end: edit?.end ?? 0 });
  const [volume, setVolume] = useState(savedVolume);
  const [audios, setAudios] = useState<VideoAudio[]>(savedAudios);
  const [selected, setSelected] = useState<string | null>(null);
  const [cover, setCover] = useState<number | null>(savedCover);
  const [busy, setBusy] = useState<"apply" | "audio" | "reset">();
  const [applied, setApplied] = useState(false);
  const [uploadPct, setUploadPct] = useState<number>();
  const [error, setError] = useState<string>();
  useUploads(); // 뒤에서 올리는 중인 원본 영상 진행률을 다시 그림
  const sourceUpload = pendingUploads().find((u) => u.url === source.url);
  const dirty = volume !== savedVolume || cover !== savedCover || audioKey(audios) !== audioKey(savedAudios);
  const playState = useRef({ t: 0, playing: false });

  /** 음악들을 영상 위치에 맞춰 재생·멈춤 (영상 at 초 = 곡 offset 초, length 초 동안) */
  function syncMusic(vt: number, play: boolean) {
    playState.current = { t: vt, playing: play };
    for (const a of audios) {
      const m = music.current.get(a.id);
      if (!m) continue;
      const pos = a.offset + (vt - a.at);
      const inside = vt >= a.at && pos < a.offset + audioLen(a);
      if (!play || !inside) {
        if (!m.paused) m.pause();
        if (!play && inside && Math.abs(m.currentTime - pos) > 0.05) m.currentTime = pos;
        continue;
      }
      if (Math.abs(m.currentTime - pos) > 0.25) m.currentTime = pos;
      if (m.paused) void m.play().catch(() => undefined);
    }
  }

  /** 적용하기: 편집한 것을 모두 한 번에 보내 원본에서 영상을 만듦 (편집기는 그대로 열어 둠) */
  async function apply(parts: OverlayPart[], layers: string, c?: { start: number; end: number }) {
    const k = c ?? cut;
    if (k.end - k.start < MIN_SECONDS) throw new Error(t("media.tooShort"));
    setBusy("apply");
    setError(undefined);
    setApplied(false);
    syncMusic(playState.current.t, false);
    try {
      // 원본 영상이 아직 올라가는 중이면 다 올라갈 때까지 (서버가 그 파일로 만들어서)
      await waitForUploads([source.url]);
      const body = new FormData();
      body.append(
        "state",
        JSON.stringify({
          start: k.start > 0.05 ? k.start : 0,
          end: k.end > 0 ? k.end : null, // 영상 길이 이상이면 서버가 끝까지로 처리
          volume,
          audios: audios.map((a) => ({ id: a.id, at: a.at, offset: a.offset, length: a.length, volume: a.volume })),
          cover_at: cover === null ? null : Math.max(0, Math.min(cover, k.end) - k.start),
          overlays_changed: true,
        }),
      );
      parts.forEach((p, i) => body.append("files", p.png, `overlay${i}.png`));
      body.append("timings", JSON.stringify(parts.map((p) => [p.start, p.end])));
      body.append("layers", layers);
      const res = await fetch(`/api/py/studio/${jobId}/videos/${index}/apply`, { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      onSaved(data.job);
      setApplied(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : toApiError(e).message;
      setError(msg);
      throw new Error(msg);
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
      const now = controller.current?.time() ?? cut.start;
      const at = Math.min(Math.max(now, cut.start), Math.max(cut.start, cut.end - MIN_AUDIO));
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
  function dragAudio(id: string, s: number, e: number, how: "move" | "left" | "right") {
    const a = audios.find((x) => `a:${x.id}` === id);
    if (!a) return;
    setSelected(id);
    if (how === "move") return updateAudio(a.id, { at: r1(Math.max(0, s)) });
    if (how === "left") {
      const d = Math.max(-a.offset, Math.min(s - a.at, audioLen(a) - MIN_AUDIO));
      return updateAudio(a.id, { at: r1(a.at + d), offset: r1(a.offset + d), length: r1(audioLen(a) - d) });
    }
    updateAudio(a.id, { length: r1(Math.min(a.duration - a.offset, Math.max(MIN_AUDIO, e - a.at))) });
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

  const tracks: Track[] = audios.map((a, i) => ({
    id: `a:${a.id}`,
    label: a.offset > 0.05 ? `${a.name} · ${fmtTime(a.offset)}~` : a.name,
    icon: "🎵",
    start: a.at,
    end: a.at + audioLen(a),
    color: AUDIO_COLORS[i % AUDIO_COLORS.length],
    selected: selected === `a:${a.id}`,
  }));

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

  const soundPanel = (
    <div className="space-y-2.5">
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={!!busy || audios.length >= MAX_AUDIOS}
          className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
        >
          🎵 {t("media.audioAdd")}
        </button>
        {busy === "audio" && <span className="text-[12px] text-white/60">{t("media.audioUploading", { pct: uploadPct ?? 0 })}</span>}
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
      </div>
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
              {fmtTime(a.offset)}–{fmtTime(a.offset + audioLen(a))}
            </span>
            <button
              type="button"
              onClick={() => updateAudio(a.id, { at: r1(Math.max(cut.start, controller.current?.time() ?? cut.start)) })}
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
      {error && <p className="rounded-md bg-red-500/15 px-2 py-1.5 text-[12px] text-red-300">{error}</p>}
    </div>
  );

  return (
    <>
      <ImageEditor
        jobId={jobId}
        index={index}
        asset={asset}
        overlay={{
          title: t("media.videoTitle"),
          // 꾸미지 않은 원본의 장면을 바탕으로 (꾸민 결과 장면엔 이미 글자가 들어 있어서)
          baseUrl: source.thumbnail_url,
          layers: initialLayers,
          video: { src: source.url, start: cut.start, end: cut.end, duration: 0 }, // 길이는 편집기가 영상에서 읽음
          guideKind: preview?.kind,
          onSubmit: apply,
          extras: {
            tabs: [
              { key: "sound", label: t("media.tabSound"), icon: "🎵", panel: soundPanel },
              {
                key: "cover",
                label: t("media.cover"),
                icon: "🖼",
                panel: (
                  <CoverPanel
                    src={mediaSrc(source.url)}
                    cut={cut}
                    cover={cover}
                    onPick={(at) => {
                      setCover(at);
                      controller.current?.seek(at);
                      setApplied(false);
                    }}
                    onHere={() => {
                      setCover(r1(Math.min(Math.max(controller.current?.time() ?? cut.start, cut.start), cut.end)));
                      setApplied(false);
                    }}
                  />
                ),
              },
            ],
            tracks,
            onTrack: dragAudio,
            onSelectTrack: setSelected,
            onTime: syncMusic,
            onCut: (k) => {
              setCut(k);
              setApplied(false);
            },
            volume,
            dirty,
            submitLabel: t("media.apply"),
            submittingLabel: t("media.applyingShort"),
            busy:
              busy === "apply"
                ? sourceUpload
                  ? t("studio.stepUploadVideo", { pct: sourceUpload.pct })
                  : t("media.applying")
                : null,
            notice: applied ? (
              <p className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[12px] text-emerald-200">✓ {t("media.appliedHint")}</p>
            ) : error && busy === undefined ? (
              <p className="rounded-lg bg-red-500/15 px-3 py-1.5 text-[12px] text-red-300">{error}</p>
            ) : null,
            headerExtra: edit ? (
              <button type="button" onClick={reset} disabled={!!busy} className="rounded-md px-2 py-1.5 text-[13px] text-white/80 hover:bg-white/10 disabled:opacity-50">
                {t("media.reset")}
              </button>
            ) : null,
            controller,
          },
        }}
        onClose={onClose}
        onSaved={() => undefined}
      />
      {audios.map((a) => (
        <audio
          key={a.id}
          ref={(el) => {
            if (el) {
              music.current.set(a.id, el);
              el.volume = Math.min(1, a.volume);
            } else music.current.delete(a.id);
          }}
          src={mediaSrc(a.url)}
          preload="auto"
        />
      ))}
    </>
  );
}

/** 대표 화면: 자른 구간에서 장면 8개를 보고 고름 (탭을 열었을 때만 장면을 뽑음) */
function CoverPanel({
  src,
  cut,
  cover,
  onPick,
  onHere,
}: {
  src: string;
  cut: { start: number; end: number };
  cover: number | null;
  onPick: (at: number) => void;
  onHere: () => void;
}) {
  const t = useT();
  const ready = cut.end > cut.start;
  const frames = useFrames(src, 8, ready ? { from: cut.start, to: cut.end } : null);
  const len = Math.max(0, cut.end - cut.start);
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-white/70">
        🖼️ {cover === null ? t("media.coverDefault") : t("media.coverAt", { s: fmt(cover - cut.start) })}
      </p>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {Array.from({ length: 8 }, (_, i) => {
          const at = r1(cut.start + ((i + 0.5) / 8) * len);
          const on = cover !== null && Math.abs(cover - at) < 0.06;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(at)}
              className={cx("relative aspect-[9/16] overflow-hidden rounded-md bg-white/10", on ? "ring-2 ring-[#ffd60a]" : "opacity-80 hover:opacity-100")}
            >
              {frames[i] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={frames[i]} alt="" className="h-full w-full object-cover" />
              )}
              <span className="tnum absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[10px]">{fmt(at - cut.start)}s</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <button type="button" onClick={onHere} className="rounded-md border border-white/20 px-2 py-1 hover:bg-white/10">
          {t("media.useThisFrame")}
        </button>
        <span className="text-white/45">{t("media.coverHint")}</span>
      </div>
    </div>
  );
}
