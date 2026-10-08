"use client";

/** 아이폰 사진 앱·iMovie 처럼 생긴 동영상 타임라인.
 *  - 맨 위: 장면 띠(썸네일) + 노란 자르기 틀(양 끝 손잡이를 끌어 자름)
 *  - 그 아래: 글자·스티커·그림·음악마다 한 줄 — 막대를 끌어 옮기고, 양 끝을 끌어 보이는 시간을 늘이고 줄임
 *  - 흰 세로줄(재생 위치): 띠를 누르거나 끌어서 옮김 */

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

export type Track = {
  id: string;
  label: string;
  icon?: string;
  start: number;
  end: number;
  color: string;
  selected?: boolean;
  /** 길이는 그대로 두고 옮기기만 (음악) */
  moveOnly?: boolean;
};

const MIN_LEN = 0.3;
export const fmtTime = (s: number) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.max(0, s) - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

/** 영상에서 장면 n 개를 뽑아 작은 그림으로 (다른 주소라 못 읽으면 빈 목록 — 띠는 단색으로) */
export function useFrames(src: string, count = 10) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.src = src;
    const out: string[] = [];
    const grab = async () => {
      const d = v.duration;
      if (!d || !isFinite(d)) return;
      const h = 64;
      const w = Math.max(1, Math.round((v.videoWidth / Math.max(1, v.videoHeight)) * h));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      for (let i = 0; i < count && alive; i++) {
        await new Promise<void>((resolve) => {
          const done = () => {
            v.removeEventListener("seeked", done);
            resolve();
          };
          v.addEventListener("seeked", done);
          v.currentTime = Math.min(d - 0.05, ((i + 0.5) / count) * d);
        });
        try {
          ctx.drawImage(v, 0, 0, w, h);
          out.push(c.toDataURL("image/jpeg", 0.6));
        } catch {
          return; // 다른 주소(CORS)라 읽을 수 없음
        }
        if (alive) setFrames([...out]);
      }
    };
    v.addEventListener("loadeddata", grab, { once: true });
    return () => {
      alive = false;
      v.removeAttribute("src");
      v.load();
    };
  }, [src, count]);
  return frames;
}

type Drag = { kind: "seek" } | { kind: "trimStart" | "trimEnd" } | { kind: "move" | "left" | "right"; id: string; s0: number; e0: number; x0: number };

export function Timeline({
  min,
  max,
  time,
  onSeek,
  frames,
  trim,
  onTrim,
  tracks = [],
  onTrack,
  onSelect,
  disabled,
}: {
  /** 띠가 보여 주는 구간 (초) */
  min: number;
  max: number;
  time: number;
  onSeek: (s: number) => void;
  frames: string[];
  /** 노란 자르기 틀 (없으면 안 보임) */
  trim?: { start: number; end: number };
  onTrim?: (start: number, end: number) => void;
  tracks?: Track[];
  onTrack?: (id: string, start: number, end: number, done: boolean) => void;
  onSelect?: (id: string) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const span = Math.max(0.1, max - min);
  const pct = (s: number) => `${((Math.min(max, Math.max(min, s)) - min) / span) * 100}%`;
  const at = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return min + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };
  const perPx = () => span / Math.max(1, box.current!.getBoundingClientRect().width);

  const start = (d: Drag) => (e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = "x0" in d ? { ...d, x0: e.clientX } : d;
    if (d.kind === "seek") onSeek(at(e.clientX));
    if ("id" in d) onSelect?.(d.id);
  };
  const move = (e: React.PointerEvent, done = false) => {
    const d = drag.current;
    if (!d) return;
    if (done) drag.current = null;
    if (d.kind === "seek") return onSeek(at(e.clientX));
    if (d.kind === "trimStart" && trim && onTrim) {
      const s = Math.min(at(e.clientX), trim.end - 0.5);
      onTrim(Math.max(min, s), trim.end);
      return onSeek(Math.max(min, s));
    }
    if (d.kind === "trimEnd" && trim && onTrim) {
      const s = Math.max(at(e.clientX), trim.start + 0.5);
      onTrim(trim.start, Math.min(max, s));
      return onSeek(Math.min(max, s));
    }
    if ("id" in d && onTrack) {
      const dt = (e.clientX - d.x0) * perPx();
      let s = d.s0;
      let en = d.e0;
      if (d.kind === "move") {
        const len = d.e0 - d.s0;
        s = Math.min(Math.max(min, d.s0 + dt), Math.max(min, max - len));
        en = s + len;
      } else if (d.kind === "left") s = Math.min(Math.max(min, d.s0 + dt), d.e0 - MIN_LEN);
      else en = Math.max(Math.min(max, d.e0 + dt), d.s0 + MIN_LEN);
      onTrack(d.id, s, en, done);
      onSeek(d.kind === "right" ? en - 0.01 : s);
    }
  };
  const handlers = { onPointerMove: (e: React.PointerEvent) => move(e), onPointerUp: (e: React.PointerEvent) => move(e, true), onPointerCancel: (e: React.PointerEvent) => move(e, true) };

  return (
    <div className={cx("select-none", disabled && "opacity-60")}>
      <div className="relative" ref={box}>
        {/* 장면 띠 */}
        <div className="relative h-12 overflow-hidden rounded-md bg-white/10 touch-none" onPointerDown={start({ kind: "seek" })} {...handlers}>
          <div className="flex h-full">
            {frames.map((f, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={f} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
            ))}
          </div>
          {trim && (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(trim.start) }} />
              <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(trim.end) }} />
            </>
          )}
        </div>
        {trim && onTrim && (
          <div
            className="pointer-events-none absolute top-0 h-12 rounded-md border-y-[3px] border-[#ffd60a]"
            style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }}
          >
            {(["trimStart", "trimEnd"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-label={k}
                onPointerDown={start({ kind: k })}
                {...handlers}
                className={cx(
                  "pointer-events-auto absolute -top-[3px] flex h-12 w-4 touch-none items-center justify-center bg-[#ffd60a] text-[10px] font-bold text-black",
                  k === "trimStart" ? "-left-4 rounded-l-md" : "-right-4 rounded-r-md",
                )}
              >
                {k === "trimStart" ? "‹" : "›"}
              </button>
            ))}
          </div>
        )}

        {/* 글자·스티커·그림·음악 줄 */}
        {tracks.length > 0 && (
          <div className="mt-1.5 max-h-36 space-y-1 overflow-y-auto pb-0.5">
            {tracks.map((tr) => (
              <div key={tr.id} className="relative h-7 rounded bg-white/[0.04]">
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={start({ kind: "move", id: tr.id, s0: tr.start, e0: tr.end, x0: 0 })}
                  {...handlers}
                  onKeyDown={(e) => e.key === "Enter" && onSelect?.(tr.id)}
                  className={cx(
                    "absolute inset-y-0 flex touch-none items-center overflow-hidden rounded px-2 text-[11px] font-medium text-white",
                    tr.selected ? "ring-2 ring-white" : "opacity-85",
                    onTrack ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                  )}
                  style={{ left: pct(tr.start), width: `max(1.25rem, calc(${pct(tr.end)} - ${pct(tr.start)}))`, background: tr.color }}
                  title={`${tr.label} · ${fmtTime(tr.start)}–${fmtTime(tr.end)}`}
                >
                  <span className="truncate">
                    {tr.icon ? `${tr.icon} ` : ""}
                    {tr.label}
                  </span>
                  {onTrack && !tr.moveOnly && tr.selected && (
                    <>
                      {(["left", "right"] as const).map((k) => (
                        <span
                          key={k}
                          onPointerDown={start({ kind: k, id: tr.id, s0: tr.start, e0: tr.end, x0: 0 })}
                          {...handlers}
                          className={cx("absolute inset-y-0 w-3 cursor-ew-resize touch-none bg-white/90", k === "left" ? "left-0 rounded-l" : "right-0 rounded-r")}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 재생 위치 */}
        <div className="pointer-events-none absolute -top-1 bottom-0 w-0.5 -translate-x-1/2 rounded bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: pct(time) }} />
      </div>
    </div>
  );
}
