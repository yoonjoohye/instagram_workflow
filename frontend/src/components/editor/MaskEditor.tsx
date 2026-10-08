"use client";

/** 누끼 다듬기: 배경을 지운 사진(투명 PNG)을 붓으로 직접 손봅니다.
 *  - 지우개: 덜 지워진 배경을 투명하게
 *  - 되살리기: 잘못 지워진 부분을 원본에서 다시 칠해 살림
 *  붓 크기·되돌리기·적용. 결과는 원본 크기 그대로의 투명 PNG. */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { useT } from "@/i18n/client";

type Mode = "erase" | "restore";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image"));
    im.src = src;
  });
}

export function MaskEditor({
  src,
  original,
  onApply,
  onClose,
}: {
  /** 지금 모습 (배경이 지워진 투명 PNG) */
  src: string;
  /** 되살리기에 쓰는 원본 (배경이 있는 사진) */
  original: string;
  onApply: (png: Blob) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const orig = useRef<HTMLImageElement | null>(null);
  const history = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>("erase");
  const [size, setSize] = useState(40); // 화면 기준 붓 지름(px)
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cur, o] = await Promise.all([loadImage(src), loadImage(original)]);
      if (!alive || !canvas.current) return;
      orig.current = o;
      const c = canvas.current;
      c.width = cur.naturalWidth;
      c.height = cur.naturalHeight;
      c.getContext("2d", { willReadFrequently: true })!.drawImage(cur, 0, 0);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [src, original]);

  // 화면 좌표 → 캔버스 픽셀
  const toCanvas = (e: React.PointerEvent) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const scale = c.width / r.width;
    return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale, scale };
  };

  const dab = useCallback(
    (x: number, y: number, radius: number) => {
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      ctx.save();
      if (mode === "erase") {
        ctx.globalCompositeOperation = "destination-out";
        const g = ctx.createRadialGradient(x, y, radius * 0.7, x, y, radius);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (orig.current) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(orig.current, 0, 0, c.width, c.height);
      }
      ctx.restore();
    },
    [mode],
  );

  // 빠르게 움직여도 끊기지 않게 지난 점과 사이를 메움
  const stroke = (x: number, y: number, radius: number) => {
    const p = last.current;
    if (p) {
      const dist = Math.hypot(x - p.x, y - p.y);
      const steps = Math.max(1, Math.ceil(dist / (radius * 0.35)));
      for (let i = 1; i <= steps; i++) dab(p.x + ((x - p.x) * i) / steps, p.y + ((y - p.y) * i) / steps, radius);
    } else dab(x, y, radius);
    last.current = { x, y };
  };

  const down = (e: React.PointerEvent) => {
    if (!ready || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const c = canvas.current!;
    history.current.push(c.getContext("2d")!.getImageData(0, 0, c.width, c.height));
    if (history.current.length > 15) history.current.shift();
    force((n) => n + 1);
    last.current = null;
    const { x, y, scale } = toCanvas(e);
    stroke(x, y, (size / 2) * scale);
  };
  const move = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (!last.current || e.buttons === 0) return;
    const { x, y, scale } = toCanvas(e);
    stroke(x, y, (size / 2) * scale);
  };
  const up = () => {
    last.current = null;
  };

  const undo = () => {
    const snap = history.current.pop();
    if (snap) canvas.current!.getContext("2d")!.putImageData(snap, 0, 0);
    force((n) => n + 1);
  };

  async function apply() {
    setBusy(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.current!.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
      await onApply(blob);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b0b0c] text-white" role="dialog" aria-modal="true" aria-label={t("editor.refineTitle")}>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1.5 text-[14px] text-white/80 hover:bg-white/10">
          {t("editor.cancel")}
        </button>
        <span className="flex-1 text-center text-[14px] font-semibold">{t("editor.refineTitle")}</span>
        <button
          type="button"
          onClick={undo}
          disabled={!history.current.length}
          aria-label={t("editor.undo")}
          className="rounded-md px-2 py-1.5 text-lg disabled:opacity-30"
        >
          ↶
        </button>
        <Button variant="primary" size="sm" onClick={apply} loading={busy} disabled={!ready}>
          {t("editor.apply")}
        </Button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {/* 투명한 곳이 보이게 체크무늬 위에 */}
        <div className="relative max-h-full max-w-full bg-[repeating-conic-gradient(#3a3a3e_0_25%,#26262a_0_50%)] bg-[length:20px_20px]">
          <canvas
            ref={canvas}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={() => setCursor(null)}
            className="block max-h-[calc(100dvh-210px)] max-w-full touch-none"
            style={{ cursor: "none" }}
          />
          {cursor && (
            <span
              aria-hidden
              className={cx("pointer-events-none absolute rounded-full border-2", mode === "erase" ? "border-white" : "border-[#22c55e]")}
              style={{ width: size, height: size, left: cursor.x - size / 2, top: cursor.y - size / 2, boxShadow: "0 0 0 1px rgba(0,0,0,0.6)" }}
            />
          )}
        </div>
      </div>
      <div className="space-y-2 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-wrap items-center gap-2">
          {(["erase", "restore"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cx("rounded-full border px-3 py-1 text-[12px]", mode === m ? "border-white bg-white text-black" : "border-white/25 text-white/85")}
            >
              {m === "erase" ? `🧽 ${t("editor.refineErase")}` : `🖌 ${t("editor.refineRestore")}`}
            </button>
          ))}
          <label className="ml-2 flex min-w-[12rem] flex-1 items-center gap-3 text-[12px] text-white/70">
            {t("editor.brushSize")}
            <input type="range" min={6} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} className="flex-1 accent-white" />
          </label>
        </div>
        <p className="text-[11px] text-white/45">{t("editor.refineHint")}</p>
      </div>
    </div>
  );
}
