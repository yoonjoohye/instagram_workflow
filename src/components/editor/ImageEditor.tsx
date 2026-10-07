"use client";

/** 이미지 편집기 — 인스타그램 편집 기능 + 그림판.
 *
 *  글자(스타일·글씨체·색·배경 상자·정렬) · 스티커(이모지·도형) · 그리기(펜·형광펜·네온·지우개, 사각형·선)
 *  · 보정(필터 + 밝기·대비·따뜻함·채도·페이드·비네트·선명하게) · 자르기(확대·이동·90° 회전·수평 맞추기·반전)
 *
 *  - 편집기 라이브러리(fabric.js)는 이 화면을 열 때만 내려받습니다.
 *  - 저장하면 합친 이미지와 편집 내용(layers)을 함께 보관해, 다시 열면 글자·스티커를 그대로 고칠 수 있습니다.
 *    편집 전 원본(base)은 따로 남아 있어 몇 번을 고쳐도 화질이 떨어지지 않습니다.
 *  - 오른쪽(넓은 화면)·미리보기 버튼(휴대폰)에 올라갈 모습을 편집할 때마다 보여 줍니다.
 */
import type * as F from "fabric";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { Button, cx, Spinner } from "@/components/ui";
import { useT } from "@/i18n/client";
import { useApi } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import type { Asset, MusicPick } from "@/lib/types";

type Tab = "text" | "sticker" | "draw" | "adjust" | "crop";
type Brush = "pen" | "marker" | "neon" | "eraser";
type Layers = { v: 1; w: number; h: number; canvas: object; adjust?: Adjust; crop?: Crop };
type Adjust = { preset: string; brightness: number; contrast: number; warmth: number; saturation: number; fade: number; vignette: number; sharpen: number };
type Crop = { zoom: number; turns: number; straighten: number; flip: boolean };
type FontItem = { key: string; label: string; preview: string };
type Named = F.FabricObject & { name?: string; isEditing?: boolean };

export type EditorPreview = { kind: "feed" | "story"; assets: Asset[]; username: string; avatar?: string; caption: string; music?: MusicPick | null };

const COLORS = ["#ffffff", "#111111", "#ff3b5c", "#ff9f1c", "#ffd60a", "#34c759", "#0a84ff", "#8b5cf6", "#ff7eb6"];
const EMOJIS = ["❤️", "✨", "🔥", "😍", "🥹", "😂", "👍", "🙌", "🎉", "📍", "✈️", "🗼", "☕", "🍰", "🌸", "🌊", "☀️", "🌙", "⭐", "💯", "👀", "📸", "🎵", "💌", "🍀", "🎂", "🍕", "🏖️"];
const SHAPES = {
  heart: "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z",
  arrow: "M2 12h16M12 5l7 7-7 7",
  star: "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z",
} as const;
const NO_ADJUST: Adjust = { preset: "none", brightness: 0, contrast: 0, warmth: 0, saturation: 0, fade: 0, vignette: 0, sharpen: 0 };
const NO_CROP: Crop = { zoom: 1, turns: 0, straighten: 0, flip: false };
// 필터: 보정 값 묶음 (사용자가 슬라이더로 더 조정 가능)
const PRESETS: Record<string, Partial<Adjust> & { mono?: boolean; sepia?: boolean }> = {
  none: {},
  clear: { brightness: 0.06, contrast: 0.12, saturation: 0.25 },
  film: { contrast: -0.08, warmth: 0.25, fade: 0.35, saturation: -0.1 },
  dreamy: { brightness: 0.1, contrast: -0.15, saturation: -0.15, warmth: 0.1, fade: 0.25 },
  fade: { fade: 0.55, saturation: -0.2 },
  warm: { warmth: 0.45, saturation: 0.08 },
  cool: { warmth: -0.45 },
  vivid: { saturation: 0.45, contrast: 0.12 },
  vintage: { sepia: true, fade: 0.2, contrast: -0.05 },
  mono: { mono: true },
  drama: { mono: true, contrast: 0.35 },
};
const fontFamily = (key: string) => `ffont-${key}`;
const loadedFonts = new Map<string, Promise<void>>();

/** 서버 글씨체를 브라우저에 등록 (한 번만) */
function loadFont(key: string): Promise<void> {
  if (!loadedFonts.has(key)) {
    const face = new FontFace(fontFamily(key), `url(/api/py/studio/fonts/${key}.font)`);
    loadedFonts.set(key, face.load().then((f) => void document.fonts.add(f)).catch(() => undefined));
  }
  return loadedFonts.get(key)!;
}

const blobIdOf = (url: string) => url.split("/media/").pop()!.replace(/\.jpg$/, "");
const SPECIAL = new Set(["base", "vignette"]);

export function ImageEditor({
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
  onSaved: () => Promise<void> | void;
}) {
  const t = useT();
  const fonts = useApi<{ data: FontItem[] }>("/studio/fonts");
  const holder = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const fab = useRef<typeof F | null>(null);
  const canvas = useRef<F.Canvas | null>(null);
  const size = useRef({ w: 1080, h: 1350 });
  const zoom = useRef(1);
  const history = useRef<{ stack: string[]; at: number; restoring: boolean }>({ stack: [], at: -1, restoring: false });
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("text");
  const [selected, setSelected] = useState<Named | null>(null);
  const [, force] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [brush, setBrush] = useState<{ kind: Brush; color: string; width: number }>({ kind: "pen", color: "#ffffff", width: 8 });
  const [fillShapes, setFillShapes] = useState(false);
  const [adjust, setAdjustState] = useState<Adjust>(NO_ADJUST);
  const [crop, setCropState] = useState<Crop>(NO_CROP);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const adjustRef = useRef(adjust);
  const cropRef = useRef(crop);

  const meta = (asset.meta ?? {}) as { edit?: { base_id: string; layers: string } };
  const baseId = meta.edit?.base_id || blobIdOf(asset.url);
  const find = (name: string) => canvas.current?.getObjects().find((o) => (o as Named).name === name);
  const base = () => find("base") as F.FabricImage | undefined;

  // ── 미리보기: 편집할 때마다(잠깐 쉬었다가) 작은 이미지로 갱신 ──────────────
  const refreshPreview = useCallback(() => {
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      const c = canvas.current;
      if (!c || !preview) return;
      const active = c.getActiveObject();
      c.discardActiveObject();
      setPreviewUrl(c.toDataURL({ format: "jpeg", quality: 0.8, multiplier: 540 / size.current.w / zoom.current }));
      if (active) c.setActiveObject(active);
      c.requestRenderAll();
    }, 350);
  }, [preview]);

  // ── 기록 (되돌리기) ─────────────────────────────────────────
  const snapshot = useCallback(() => {
    const c = canvas.current;
    const h = history.current;
    if (!c || h.restoring) return;
    const json = JSON.stringify({ canvas: c.toObject(["name", "selectable", "evented"]), adjust: adjustRef.current, crop: cropRef.current });
    if (h.stack[h.at] === json) return;
    h.stack = h.stack.slice(0, h.at + 1).concat(json).slice(-40);
    h.at = h.stack.length - 1;
    setDirty(h.at > 0);
    force((n) => n + 1);
    refreshPreview();
  }, [refreshPreview]);

  const restore = useCallback(
    async (to: number) => {
      const c = canvas.current;
      const h = history.current;
      if (!c || to < 0 || to >= h.stack.length) return;
      h.restoring = true;
      const state = JSON.parse(h.stack[to]);
      await c.loadFromJSON(state.canvas);
      adjustRef.current = state.adjust;
      cropRef.current = state.crop;
      setAdjustState(state.adjust);
      setCropState(state.crop);
      h.at = to;
      h.restoring = false;
      c.requestRenderAll();
      setSelected(null);
      setDirty(to > 0);
      force((n) => n + 1);
      refreshPreview();
    },
    [refreshPreview],
  );

  // ── 화면 크기에 맞게 보이기 (저장은 원래 크기) ──────────────────
  const fit = useCallback(() => {
    const c = canvas.current;
    const el = holder.current;
    if (!c || !el) return;
    const { w, h } = size.current;
    const z = Math.min((el.clientWidth - 24) / w, (el.clientHeight - 24) / h);
    zoom.current = z;
    c.setDimensions({ width: Math.floor(w * z), height: Math.floor(h * z) });
    c.setZoom(z);
    c.requestRenderAll();
  }, []);

  // ── 열기 ───────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        const f = await import("fabric");
        if (disposed || !canvasEl.current) return;
        fab.current = f;
        const c = new f.Canvas(canvasEl.current, { preserveObjectStacking: true, backgroundColor: "#000" });
        canvas.current = c;

        const saved = meta.edit?.layers ? (JSON.parse(meta.edit.layers) as Layers) : null;
        if (saved?.canvas) {
          size.current = { w: saved.w, h: saved.h };
          const families = new Set<string>(JSON.stringify(saved.canvas).match(/ffont-[a-z_]+/g) ?? []);
          await Promise.all([...families].map((ff) => loadFont(ff.replace("ffont-", ""))));
          await c.loadFromJSON(saved.canvas);
          adjustRef.current = saved.adjust ?? NO_ADJUST;
          cropRef.current = saved.crop ?? NO_CROP;
          setAdjustState(adjustRef.current);
          setCropState(cropRef.current);
        } else {
          const img = await f.FabricImage.fromURL(mediaSrc(`/api/py/media/${baseId}.jpg`), { crossOrigin: "anonymous" });
          const long = Math.max(img.width, img.height);
          const scale = long > 1920 ? 1920 / long : 1;
          size.current = { w: Math.round(img.width * scale), h: Math.round(img.height * scale) };
          img.set({ originX: "center", originY: "center", left: size.current.w / 2, top: size.current.h / 2, scaleX: scale, scaleY: scale, selectable: false, evented: false });
          (img as Named).name = "base";
          c.add(img);
        }
        await loadFont("pretendard");
        fit();
        ro = new ResizeObserver(fit);
        if (holder.current) ro.observe(holder.current);

        c.on("selection:created", (e) => setSelected((e.selected?.[0] as Named) ?? null));
        c.on("selection:updated", (e) => setSelected((e.selected?.[0] as Named) ?? null));
        c.on("selection:cleared", () => setSelected(null));
        for (const ev of ["object:added", "object:modified", "object:removed", "path:created", "text:changed"] as const) c.on(ev, () => snapshot());
        snapshot();
        setReady(true);
      } catch {
        if (!disposed) setError(t("editor.loadFailed"));
      }
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      clearTimeout(previewTimer.current);
      canvas.current?.dispose();
      canvas.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 탭·붓에 따라 그리기 / 지우개 / 사진 옮기기 모드 ─────────────────
  useEffect(() => {
    const c = canvas.current;
    const f = fab.current;
    if (!c || !f) return;
    const drawing = tab === "draw" && brush.kind !== "eraser";
    c.isDrawingMode = drawing;
    if (drawing) {
      const b = new f.PencilBrush(c);
      b.width = brush.kind === "marker" ? brush.width * 2.6 : brush.width;
      b.color = brush.kind === "marker" ? hexAlpha(brush.color, 0.45) : brush.kind === "neon" ? "#ffffff" : brush.color;
      b.strokeLineCap = brush.kind === "marker" ? "square" : "round";
      if (brush.kind === "neon") b.shadow = new f.Shadow({ color: brush.color, blur: brush.width * 2.5 });
      c.freeDrawingBrush = b;
    }
    // 지우개: 문지르는 그림·글자·스티커를 지움
    let erasing = false;
    const down = () => (erasing = true);
    const up = () => (erasing = false);
    const move = (e: { target?: F.FabricObject }) => {
      const o = e.target as Named | undefined;
      if (erasing && o && !SPECIAL.has(o.name ?? "")) c.remove(o);
    };
    const eraser = tab === "draw" && brush.kind === "eraser";
    if (eraser) {
      c.selection = false;
      c.on("mouse:down", down);
      c.on("mouse:up", up);
      c.on("mouse:move", move);
      c.on("mouse:down", move);
    } else c.selection = true;
    const img = base();
    if (img) {
      const movable = tab === "crop";
      img.set({ selectable: movable, evented: movable, hasControls: false, lockRotation: true });
      if (!movable && c.getActiveObject() === img) c.discardActiveObject();
    }
    c.requestRenderAll();
    return () => {
      c.off("mouse:down", down);
      c.off("mouse:up", up);
      c.off("mouse:move", move);
      c.off("mouse:down", move);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, brush, ready]);

  // Delete 키로 지우기 (글자 편집 중이 아닐 때)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const obj = canvas.current?.getActiveObject() as Named | undefined;
      if ((e.key === "Delete" || e.key === "Backspace") && obj && !obj.isEditing && !SPECIAL.has(obj.name ?? "")) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── 도구 ───────────────────────────────────────────────────
  const center = () => ({ left: size.current.w / 2, top: size.current.h / 2, originX: "center" as const, originY: "center" as const });
  const add = (obj: F.FabricObject) => {
    const c = canvas.current!;
    c.add(obj);
    c.setActiveObject(obj);
    c.requestRenderAll();
  };

  async function addText() {
    const f = fab.current!;
    await loadFont("pretendard");
    add(
      new f.IText(t("editor.defaultText"), {
        ...center(),
        fontFamily: fontFamily("pretendard"),
        fontSize: Math.round(size.current.w * 0.075),
        fill: "#ffffff",
        textAlign: "center",
        shadow: new f.Shadow({ color: "rgba(0,0,0,0.45)", blur: 12, offsetX: 0, offsetY: 3 }),
      }),
    );
  }

  const isText = (o: F.FabricObject | null): o is F.IText => !!o && (o.type === "i-text" || o.type === "text" || o.type === "textbox");
  async function setTextProp(props: Partial<F.IText>, fontKey?: string) {
    const o = selected;
    if (!isText(o)) return;
    if (fontKey) await loadFont(fontKey);
    o.set(props);
    canvas.current!.requestRenderAll();
    snapshot();
    force((n) => n + 1);
  }
  async function textStyle(style: "classic" | "bold" | "neon" | "hand" | "serif") {
    const f = fab.current!;
    const color = typeof selected?.fill === "string" ? selected.fill : "#ffffff";
    const font = { classic: "pretendard", bold: "black_han_sans", neon: "pretendard", hand: "nanum_pen", serif: "nanum_myeongjo" }[style];
    await setTextProp(
      {
        fontFamily: fontFamily(font),
        shadow:
          style === "neon"
            ? new f.Shadow({ color: color === "#ffffff" ? "#ff3b5c" : color, blur: 22 })
            : new f.Shadow({ color: "rgba(0,0,0,0.45)", blur: 12, offsetX: 0, offsetY: 3 }),
        ...(style === "neon" ? { fill: "#ffffff" } : {}),
      },
      font,
    );
  }

  function addEmoji(e: string) {
    const f = fab.current!;
    add(new f.FabricText(e, { ...center(), fontSize: Math.round(size.current.w * 0.16) }));
  }

  function addShape(kind: "heart" | "arrow" | "star" | "circle" | "highlight" | "rect" | "line") {
    const f = fab.current!;
    const s = size.current.w * 0.22;
    const color = brush.color;
    const stroke = { fill: fillShapes ? color : "", stroke: color, strokeWidth: s * 0.05 };
    if (kind === "circle") return add(new f.Circle({ ...center(), radius: s / 2, ...stroke }));
    if (kind === "rect") return add(new f.Rect({ ...center(), width: s * 1.3, height: s, rx: 6, ry: 6, ...stroke }));
    if (kind === "line") return add(new f.Line([0, 0, s * 1.5, 0], { ...center(), stroke: color, strokeWidth: s * 0.05, strokeLineCap: "round" }));
    if (kind === "highlight") return add(new f.Rect({ ...center(), width: s * 1.6, height: s * 0.4, fill: color, opacity: 0.4, rx: 8, ry: 8 }));
    const p = new f.Path(SHAPES[kind], {
      ...center(),
      fill: kind === "arrow" ? "" : color,
      stroke: kind === "arrow" ? color : "",
      strokeWidth: kind === "arrow" ? 2.2 : 0,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    });
    p.scaleToWidth(s);
    add(p);
  }

  /** 고른 도형·그림(글자 제외)의 색을 바꿉니다. 아무것도 안 골랐으면 다음에 추가할 도형·펜 색만 바뀜. */
  function recolor(color: string) {
    setBrush((b) => ({ ...b, color }));
    const c = canvas.current;
    if (!c) return;
    const objs = c.getActiveObjects().filter((o) => !SPECIAL.has((o as Named).name ?? "") && !isText(o));
    if (!objs.length) return;
    for (const o of objs) {
      const stroke = typeof o.stroke === "string" ? o.stroke : "";
      if (stroke === "#ffffff" && o.shadow) {
        o.shadow.color = color; // 네온 펜: 하얀 심 + 색 번짐
      } else if (stroke) {
        o.set("stroke", stroke.startsWith("rgba") ? hexAlpha(color, 0.45) : color); // 형광펜은 반투명 유지
      }
      if (typeof o.fill === "string" && o.fill) o.set("fill", color);
    }
    c.requestRenderAll();
    snapshot();
    force((n) => n + 1);
  }

  /** 채우기 켜기/끄기 — 고른 동그라미·사각형에도 바로 적용 */
  function toggleFill() {
    const next = !fillShapes;
    setFillShapes(next);
    const c = canvas.current;
    if (!c) return;
    const objs = c.getActiveObjects().filter((o) => o.type === "circle" || (o.type === "rect" && (o as Named).name !== "vignette" && o.stroke));
    if (!objs.length) return;
    for (const o of objs) o.set("fill", next ? (typeof o.stroke === "string" ? o.stroke : brush.color) : "");
    c.requestRenderAll();
    snapshot();
  }

  function removeSelected() {
    const c = canvas.current!;
    for (const o of c.getActiveObjects()) if (!SPECIAL.has((o as Named).name ?? "")) c.remove(o);
    c.discardActiveObject();
    c.requestRenderAll();
  }

  function bringFront() {
    const o = canvas.current?.getActiveObject();
    if (!o) return;
    canvas.current!.bringObjectToFront(o);
    canvas.current!.requestRenderAll();
    snapshot();
  }

  // ── 보정: 사진(base)에만 필터, 비네트는 위에 덮는 막 ─────────────────
  function applyAdjust(next: Adjust, commit = false) {
    adjustRef.current = next;
    setAdjustState(next);
    const f = fab.current!;
    const img = base();
    if (!img) return;
    const p = PRESETS[next.preset] ?? {};
    const v = (k: keyof Adjust) => Number(p[k] ?? 0) + Number(next[k]);
    const list: F.filters.BaseFilter<string, object>[] = [];
    if (p.mono) list.push(new f.filters.Grayscale());
    if (p.sepia) list.push(new f.filters.Sepia());
    if (v("brightness")) list.push(new f.filters.Brightness({ brightness: v("brightness") }));
    // 페이드: 어두운 곳을 띄우고 대비를 낮춤
    if (v("fade")) list.push(new f.filters.Brightness({ brightness: v("fade") * 0.12 }), new f.filters.Contrast({ contrast: -v("fade") * 0.35 }));
    if (v("contrast")) list.push(new f.filters.Contrast({ contrast: v("contrast") }));
    if (v("saturation")) list.push(new f.filters.Saturation({ saturation: v("saturation") }));
    const w = v("warmth");
    if (w) list.push(new f.filters.BlendColor({ color: w > 0 ? "#ff9a3c" : "#3c9aff", mode: "tint", alpha: Math.min(0.35, Math.abs(w) * 0.35) }));
    const sh = v("sharpen");
    if (sh > 0) list.push(new f.filters.Convolute({ matrix: [0, -sh, 0, -sh, 1 + 4 * sh, -sh, 0, -sh, 0] }));
    img.filters = list;
    img.applyFilters();

    // 비네트: 가장자리를 어둡게 하는 막
    const c = canvas.current!;
    let vig = find("vignette") as Named | undefined;
    if (next.vignette > 0) {
      if (!vig) {
        const { w: W, h: H } = size.current;
        // fabric 7 은 기본 기준점이 가운데라 left/top 0 이면 사진의 1/4 만 덮음 → 왼쪽 위 기준으로
        vig = new f.Rect({ left: 0, top: 0, originX: "left", originY: "top", width: W, height: H, selectable: false, evented: false }) as Named;
        vig.set(
          "fill",
          new f.Gradient({
            type: "radial",
            coords: { x1: W / 2, y1: H / 2, r1: Math.min(W, H) * 0.35, x2: W / 2, y2: H / 2, r2: Math.hypot(W, H) / 2 },
            colorStops: [
              { offset: 0, color: "rgba(0,0,0,0)" },
              { offset: 1, color: "rgba(0,0,0,0.85)" },
            ],
          }),
        );
        vig.name = "vignette";
        history.current.restoring = true; // 막 추가는 기록하지 않고 아래에서 한 번만
        c.add(vig);
        c.moveObjectTo(vig, 1);
        history.current.restoring = false;
      }
      // 예전에 저장한 편집(가운데 기준으로 잘못 놓인 막)도 바로잡습니다.
      vig.set({ opacity: next.vignette, left: 0, top: 0, originX: "left", originY: "top" });
    } else if (vig) {
      history.current.restoring = true;
      c.remove(vig);
      history.current.restoring = false;
    }
    c.requestRenderAll();
    if (commit) snapshot();
    else refreshPreview();
  }

  // ── 자르기: 틀은 그대로, 사진을 확대·이동·회전 (항상 틀을 덮도록) ──────────
  function applyCrop(next: Crop, recenter = false) {
    cropRef.current = next;
    setCropState(next);
    const img = base();
    if (!img) return;
    const { w, h } = size.current;
    const angle = next.turns * 90 + next.straighten;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const cover = Math.max((w * cos + h * sin) / img.width, (w * sin + h * cos) / img.height);
    const s = cover * next.zoom;
    img.set({ angle, flipX: next.flip, scaleX: s, scaleY: s, originX: "center", originY: "center" });
    if (recenter) img.set({ left: w / 2, top: h / 2 });
    img.setCoords();
    canvas.current!.requestRenderAll();
    refreshPreview();
  }

  // ── 저장 ───────────────────────────────────────────────────
  async function save() {
    const c = canvas.current;
    if (!c) return;
    setSaving(true);
    setError(undefined);
    try {
      c.discardActiveObject();
      c.isDrawingMode = false;
      c.requestRenderAll();
      const dataUrl = c.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 1 / zoom.current });
      const image = await (await fetch(dataUrl)).blob();
      const layers: Layers = {
        v: 1,
        w: size.current.w,
        h: size.current.h,
        canvas: c.toObject(["name", "selectable", "evented"]),
        adjust: adjustRef.current,
        crop: cropRef.current,
      };
      const body = new FormData();
      body.append("file", image, "edited.jpg");
      body.append("layers", JSON.stringify(layers));
      body.append("base_id", baseId);
      const res = await fetch(`/api/py/studio/${jobId}/slides/${index}/edit`, { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      await onSaved();
      onClose();
    } catch (e) {
      setError(t("editor.saveFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (dirty && !window.confirm(t("editor.discardConfirm"))) return;
    onClose();
  }

  // ── 화면 ───────────────────────────────────────────────────
  const h = history.current;
  const textSel = isText(selected) ? selected : null;
  // 고른 도형·그림의 지금 색 (색 고르기 칸에 표시)
  const shapeSel = selected && !textSel && !SPECIAL.has(selected.name ?? "") ? selected : null;
  const paintColor = (() => {
    const v = shapeSel && ((typeof shapeSel.fill === "string" && shapeSel.fill) || (typeof shapeSel.stroke === "string" && shapeSel.stroke));
    if (!v) return brush.color;
    if (v === "#ffffff" && shapeSel?.shadow) return String(shapeSel.shadow.color);
    const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? "#" + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("") : v;
  })();
  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "text", label: t("editor.tabText"), icon: "Aa" },
    { key: "sticker", label: t("editor.tabSticker"), icon: "☺" },
    { key: "draw", label: t("editor.tabDraw"), icon: "✎" },
    { key: "adjust", label: t("editor.tabAdjust"), icon: "◐" },
    { key: "crop", label: t("editor.tabCrop"), icon: "⤢" },
  ];
  const previewAssets = preview?.assets.map((a, i) => (i === index && previewUrl ? { ...a, url: previewUrl, type: "image" as const } : a)) ?? [];
  const previewPane = preview && (
    <div className="space-y-2">
      <p className="text-[12px] text-white/60">{t("editor.livePreview")}</p>
      <div className="rounded-xl bg-white p-2 text-black [color-scheme:light]">
        {preview.kind === "story" ? (
          <StoryPreview username={preview.username} avatar={preview.avatar} assets={previewAssets} />
        ) : (
          <InstagramPreview username={preview.username} avatar={preview.avatar} assets={previewAssets} caption={preview.caption} music={preview.music} />
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0b0c] text-white" role="dialog" aria-modal="true" aria-label={t("editor.title")}>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button type="button" onClick={close} className="rounded-md px-2 py-1.5 text-[14px] text-white/80 hover:bg-white/10">
          {t("editor.cancel")}
        </button>
        <span className="flex-1 text-center text-[14px] font-semibold">{t("editor.title")}</span>
        <button type="button" disabled={h.at <= 0} onClick={() => restore(h.at - 1)} aria-label={t("editor.undo")} className="rounded-md px-2 py-1.5 text-lg disabled:opacity-30">
          ↶
        </button>
        <button type="button" disabled={h.at >= h.stack.length - 1} onClick={() => restore(h.at + 1)} aria-label={t("editor.redo")} className="rounded-md px-2 py-1.5 text-lg disabled:opacity-30">
          ↷
        </button>
        {preview && (
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="rounded-md px-2 py-1.5 text-[13px] text-white/80 hover:bg-white/10 lg:hidden">
            {t("editor.preview")}
          </button>
        )}
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!ready}>
          {saving ? t("editor.saving") : t("editor.save")}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={holder} className="relative flex min-h-0 flex-1 items-center justify-center">
            <canvas ref={canvasEl} />
            {!ready && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-6" />
              </div>
            )}
            {selected && !SPECIAL.has(selected.name ?? "") && (
              <div className="absolute top-3 right-3 flex gap-1">
                <button type="button" onClick={bringFront} className="rounded-full bg-black/60 px-3 py-1.5 text-[12px]">
                  {t("editor.bringFront")}
                </button>
                <button type="button" onClick={removeSelected} className="rounded-full bg-[#ff3b5c] px-3 py-1.5 text-[12px] font-medium">
                  🗑 {t("editor.deleteSelected")}
                </button>
              </div>
            )}
            {showPreview && previewPane && (
              <div className="absolute inset-0 overflow-y-auto bg-black/85 p-4 lg:hidden" onClick={() => setShowPreview(false)}>
                <div className="mx-auto max-w-sm" onClick={(e) => e.stopPropagation()}>
                  {previewPane}
                </div>
              </div>
            )}
          </div>

          {error && <p className="bg-[#ff3b5c]/15 px-4 py-2 text-[13px] text-[#ffb3c0]">{error}</p>}

          {/* 도구 패널 */}
          <div className="border-t border-white/10 bg-[#141416] px-3 pt-3">
            <div className="min-h-[104px] text-[13px]">
              {tab === "text" && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={addText} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black">
                      + {t("editor.addText")}
                    </button>
                    <span className="text-[11px] text-white/50">{t("editor.textHint")}</span>
                  </div>
                  {textSel && (
                    <>
                      <Row>
                        {(["classic", "bold", "neon", "hand", "serif"] as const).map((st) => (
                          <Chip key={st} onClick={() => textStyle(st)}>
                            {t(`editor.style${st[0].toUpperCase()}${st.slice(1)}` as "editor.styleClassic")}
                          </Chip>
                        ))}
                        <Chip on={Boolean(textSel.backgroundColor)} onClick={() => setTextProp({ backgroundColor: textSel.backgroundColor ? "" : "rgba(0,0,0,0.55)" })}>
                          {t("editor.textBox")}
                        </Chip>
                        {(["left", "center", "right"] as const).map((a) => (
                          <Chip key={a} on={textSel.textAlign === a} onClick={() => setTextProp({ textAlign: a })}>
                            {t(a === "left" ? "editor.alignLeft" : a === "center" ? "editor.alignCenter" : "editor.alignRight")}
                          </Chip>
                        ))}
                      </Row>
                      <Swatches value={String(textSel.fill)} onPick={(c) => setTextProp({ fill: c })} customLabel={t("editor.customColor")} />
                      <Row>
                        {(fonts.data?.data ?? []).map((fo) => (
                          <button
                            key={fo.key}
                            type="button"
                            onClick={() => setTextProp({ fontFamily: fontFamily(fo.key) }, fo.key)}
                            className={cx("shrink-0 rounded-md bg-white px-2 py-1", textSel.fontFamily === fontFamily(fo.key) ? "ring-2 ring-[#8b5cf6]" : "opacity-80")}
                            title={fo.label}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fo.preview} alt={fo.label} className="h-5 w-auto" />
                          </button>
                        ))}
                      </Row>
                    </>
                  )}
                </div>
              )}

              {tab === "sticker" && (
                <div className="space-y-2.5">
                  <Row className="text-2xl">
                    {EMOJIS.map((e) => (
                      <button key={e} type="button" onClick={() => addEmoji(e)} className="shrink-0 rounded-md px-1.5 py-1 hover:bg-white/10">
                        {e}
                      </button>
                    ))}
                  </Row>
                  <Row>
                    {(["heart", "star", "arrow", "circle", "rect", "line", "highlight"] as const).map((k) => (
                      <Chip key={k} onClick={() => addShape(k)}>
                        {t(`editor.shape${k[0].toUpperCase()}${k.slice(1)}` as "editor.shapeHeart")}
                      </Chip>
                    ))}
                    <Chip on={fillShapes} onClick={toggleFill}>
                      {t("editor.fill")}
                    </Chip>
                  </Row>
                  <Swatches value={paintColor} onPick={recolor} customLabel={t("editor.customColor")} small />
                </div>
              )}

              {tab === "draw" && (
                <div className="space-y-2.5">
                  <Row>
                    {(["pen", "marker", "neon", "eraser"] as const).map((k) => (
                      <Chip key={k} on={brush.kind === k} onClick={() => setBrush({ ...brush, kind: k })}>
                        {t(k === "eraser" ? "editor.eraser" : (`editor.brush${k[0].toUpperCase()}${k.slice(1)}` as "editor.brushPen"))}
                      </Chip>
                    ))}
                    <Chip onClick={() => addShape("rect")}>{t("editor.shapeRect")}</Chip>
                    <Chip onClick={() => addShape("circle")}>{t("editor.shapeCircle")}</Chip>
                    <Chip onClick={() => addShape("line")}>{t("editor.shapeLine")}</Chip>
                  </Row>
                  {brush.kind === "eraser" ? (
                    <p className="text-[11px] text-white/50">{t("editor.eraserHint")}</p>
                  ) : (
                    <>
                      <Swatches value={paintColor} onPick={recolor} customLabel={t("editor.customColor")} />
                      <Slider label={t("editor.brushSize")} min={2} max={40} step={1} value={brush.width} onChange={(v) => setBrush({ ...brush, width: v })} />
                    </>
                  )}
                </div>
              )}

              {tab === "adjust" && (
                <div className="space-y-1.5">
                  <Row>
                    {Object.keys(PRESETS).map((p) => (
                      <Chip key={p} on={adjust.preset === p} onClick={() => applyAdjust({ ...adjust, preset: p }, true)}>
                        {t(`editor.preset${p[0].toUpperCase()}${p.slice(1)}` as "editor.presetNone")}
                      </Chip>
                    ))}
                    <Chip onClick={() => applyAdjust(NO_ADJUST, true)}>{t("editor.reset")}</Chip>
                  </Row>
                  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {(
                      [
                        ["brightness", -0.5, 0.5],
                        ["contrast", -0.5, 0.5],
                        ["warmth", -1, 1],
                        ["saturation", -1, 1],
                        ["fade", 0, 1],
                        ["vignette", 0, 1],
                        ["sharpen", 0, 0.6],
                      ] as const
                    ).map(([k, min, max]) => (
                      <Slider
                        key={k}
                        label={t(`editor.${k}`)}
                        min={min}
                        max={max}
                        step={0.02}
                        value={adjust[k]}
                        onChange={(v) => applyAdjust({ ...adjust, [k]: v })}
                        onCommit={snapshot}
                      />
                    ))}
                  </div>
                </div>
              )}

              {tab === "crop" && (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/50">{t("editor.cropHint")}</p>
                  <Slider label={t("editor.zoom")} min={1} max={3} step={0.05} value={crop.zoom} onChange={(v) => applyCrop({ ...crop, zoom: v })} onCommit={snapshot} />
                  <Slider label={t("editor.straighten")} min={-30} max={30} step={0.5} value={crop.straighten} onChange={(v) => applyCrop({ ...crop, straighten: v })} onCommit={snapshot} />
                  <Row>
                    <Chip onClick={() => (applyCrop({ ...crop, turns: (crop.turns + 1) % 4, zoom: 1 }, true), snapshot())}>⟳ {t("editor.rotate")}</Chip>
                    <Chip onClick={() => (applyCrop({ ...crop, flip: !crop.flip }), snapshot())}>⇋ {t("editor.flip")}</Chip>
                    <Chip onClick={() => (applyCrop(NO_CROP, true), snapshot())}>{t("editor.reset")}</Chip>
                  </Row>
                </div>
              )}
            </div>

            <nav className="mt-2 grid grid-cols-5 border-t border-white/10 pb-[max(0.5rem,env(safe-area-inset-bottom))]" aria-label={t("editor.title")}>
              {TABS.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setTab(x.key)}
                  aria-pressed={tab === x.key}
                  className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", tab === x.key ? "text-white" : "text-white/45")}
                >
                  <span className="text-[17px] leading-none">{x.icon}</span>
                  {x.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* 넓은 화면: 오른쪽에 올라갈 모습 */}
        {previewPane && <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-white/10 p-4 lg:block">{previewPane}</aside>}
      </div>
    </div>
  );
}

function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]", className)}>{children}</div>;
}

function Swatches({ value, onPick, small, customLabel }: { value: string; onPick: (c: string) => void; small?: boolean; customLabel: string }) {
  return (
    <Row>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onPick(c)}
          className={cx("shrink-0 rounded-full border border-white/30", small ? "size-6" : "size-7", value === c && "ring-2 ring-white ring-offset-2 ring-offset-[#141416]")}
          style={{ background: c }}
        />
      ))}
      <label className={cx("relative shrink-0 overflow-hidden rounded-full border border-white/30 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]", small ? "size-6" : "size-7")} title={customLabel}>
        <input type="color" value={value.startsWith("#") ? value : "#ffffff"} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={customLabel} />
      </label>
    </Row>
  );
}

function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("shrink-0 rounded-full border px-3 py-1 text-[12px]", on ? "border-white bg-white text-black" : "border-white/25 text-white/85 hover:bg-white/10")}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="flex items-center gap-3 text-[12px] text-white/70">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="flex-1 accent-white"
      />
    </label>
  );
}
