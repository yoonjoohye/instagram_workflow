/** 디자인 템플릿 그리기 (사진 편집기와 같은 fabric 캔버스).
 *  - buildPage: 템플릿 한 장 + 테마 + 사진 → 캔버스 (바탕은 'base' 그림, 나머지는 편집할 수 있는 글자·도형·사진 칸)
 *  - exportPage: 캔버스 → 바탕 그림·완성 그림·편집기 상태(바탕 주소 자리는 __BG__)
 *  - applyTheme: 이미 만든 장을 다른 테마로 다시 칠함 (요소마다 남겨 둔 토큰 tk 로)
 *  - fitToSlot: 사진 칸에 새 사진을 꽉 차게 */

import type * as F from "fabric";
import { fontFamily, loadFont } from "@/lib/fonts";
import type { Bg, El, Page } from "./templates";
import { colorOf, type ColorToken, type Theme } from "./themes";

/** 편집기 상태에 남길 값 (사진 편집기의 KEEP 과 같아야 함) */
export const KEEP = ["name", "selectable", "evented", "link", "orig", "tStart", "tEnd", "tk"];

/** 요소마다 남기는 테마 토큰 — 테마를 바꾸면 이걸 보고 다시 칠함 */
export type Tk = {
  fill?: ColorToken;
  stroke?: ColorToken;
  box?: ColorToken;
  font?: "heading" | "body";
  bg?: Bg;
  slot?: { x: number; y: number; w: number; h: number; r?: number; circle?: boolean };
};
type WithTk = F.FabricObject & { tk?: Tk; name?: string };

export type PageInput = {
  page: Page;
  /** 본문 번호 (카드뉴스) */
  n?: number;
  /** 쪽 번호·전체 */
  index: number;
  total: number;
  /** 이 장의 사진 칸에 차례로 넣을 사진 주소 (없으면 '사진을 넣어 주세요' 자리) */
  photos: string[];
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image"));
    im.src = src;
  });

let placeholderUrl = "";
/** 사진을 아직 안 고른 칸: 부드러운 회색 + 카메라 + 안내 */
export function placeholder(): string {
  if (placeholderUrl) return placeholderUrl;
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 800;
  const x = c.getContext("2d")!;
  const g = x.createLinearGradient(0, 0, 800, 800);
  g.addColorStop(0, "#d9d9de");
  g.addColorStop(1, "#bcbcc4");
  x.fillStyle = g;
  x.fillRect(0, 0, 800, 800);
  x.fillStyle = "rgba(255,255,255,0.9)";
  x.textAlign = "center";
  x.font = "120px sans-serif";
  x.fillText("📷", 400, 390);
  x.font = "bold 44px sans-serif";
  x.fillText("사진을 넣어 주세요", 400, 490);
  placeholderUrl = c.toDataURL("image/jpeg", 0.8);
  return placeholderUrl;
}

/** 바탕 그림 (색·그라데이션, 또는 사진을 꽉 채우고 어둡게) */
async function drawBg(bg: Bg, theme: Theme, w: number, h: number, photoSrc?: string): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d")!;
  if (bg.kind === "solid") {
    x.fillStyle = colorOf(theme, bg.color);
    x.fillRect(0, 0, w, h);
  } else if (bg.kind === "gradient") {
    const a = (((bg.angle ?? 180) - 90) * Math.PI) / 180;
    const r = Math.hypot(w, h) / 2;
    const g = x.createLinearGradient(w / 2 - Math.cos(a) * r, h / 2 - Math.sin(a) * r, w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    g.addColorStop(0, colorOf(theme, bg.from));
    g.addColorStop(1, colorOf(theme, bg.to));
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  } else {
    const im = await loadImage(photoSrc || placeholder());
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * s;
    const dh = im.naturalHeight * s;
    x.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
    if (bg.dim) {
      x.fillStyle = `rgba(0,0,0,${bg.dim})`;
      x.fillRect(0, 0, w, h);
    }
  }
  return c;
}

/** 사진 칸에 꽉 차게 (칸 밖은 잘림 — 칸 안에서 끌어 위치를 맞출 수 있음) */
export function fitToSlot(f: typeof F, img: F.FabricImage, slot: NonNullable<Tk["slot"]>) {
  const s = Math.max(slot.w / img.width, slot.h / img.height);
  img.set({ originX: "center", originY: "center", left: slot.x + slot.w / 2, top: slot.y + slot.h / 2, scaleX: s, scaleY: s, angle: 0 });
  img.clipPath = slot.circle
    ? new f.Circle({ radius: Math.min(slot.w, slot.h) / 2, originX: "center", originY: "center", left: slot.x + slot.w / 2, top: slot.y + slot.h / 2, absolutePositioned: true })
    : new f.Rect({ originX: "left", originY: "top", left: slot.x, top: slot.y, width: slot.w, height: slot.h, rx: slot.r ?? 0, ry: slot.r ?? 0, absolutePositioned: true });
  img.setCoords();
}

// fabric 7 은 기본 기준점이 가운데라, 템플릿 좌표(왼쪽 위 기준)에 맞게 왼쪽 위로
const TL = { originX: "left", originY: "top" } as const;

const fill = (s: string, n?: number, index = 0, total = 1) =>
  s.replace(/\{n\}/g, String(n ?? 1).padStart(2, "0")).replace(/\{page\}/g, `${index + 1}/${total}`);

/** 템플릿 한 장을 캔버스에 그림 */
export async function buildPage(f: typeof F, input: PageInput, theme: Theme, size: { w: number; h: number }): Promise<F.StaticCanvas> {
  await Promise.all([loadFont(theme.fonts.heading), loadFont(theme.fonts.body)]);
  const c = new f.StaticCanvas(undefined, { width: size.w, height: size.h, enableRetinaScaling: false, renderOnAddRemove: false });
  const photos = [...input.photos];
  const { page } = input;
  // 바탕
  const bgCanvas = await drawBg(page.bg, theme, size.w, size.h, page.bg.kind === "photo" ? photos.shift() : undefined);
  const base = new f.FabricImage(bgCanvas, { originX: "center", originY: "center", left: size.w / 2, top: size.h / 2, selectable: false, evented: false }) as unknown as WithTk;
  base.name = "base";
  base.tk = { bg: page.bg };
  c.add(base);
  for (const el of page.els) c.add(await buildEl(f, el, theme, input, photos));
  c.renderAll();
  return c;
}

async function buildEl(f: typeof F, el: El, theme: Theme, input: PageInput, photos: string[]): Promise<F.FabricObject> {
  let o: WithTk;
  if (el.t === "text") {
    o = new f.Textbox(fill(el.text, input.n, input.index, input.total), {
      ...TL,
      left: el.x, top: el.y, width: el.w, fontSize: el.size, fontFamily: fontFamily(theme.fonts[el.font]),
      fill: colorOf(theme, el.color), fontWeight: el.weight ?? 400, textAlign: el.align ?? "left", lineHeight: el.lh ?? 1.25,
      charSpacing: el.ls ?? 0, splitByGrapheme: true, backgroundColor: el.box ? colorOf(theme, el.box) : "",
    }) as unknown as WithTk;
    o.tk = { fill: el.color, font: el.font, ...(el.box ? { box: el.box } : {}) };
  } else if (el.t === "rect") {
    o = new f.Rect({
      ...TL,
      left: el.x, top: el.y, width: el.w, height: el.h, rx: el.r ?? 0, ry: el.r ?? 0, fill: colorOf(theme, el.fill), opacity: el.opacity ?? 1,
      ...(el.stroke ? { stroke: colorOf(theme, el.stroke), strokeWidth: el.sw ?? 2 } : { strokeWidth: 0 }),
    }) as unknown as WithTk;
    o.tk = { fill: el.fill, ...(el.stroke ? { stroke: el.stroke } : {}) };
  } else if (el.t === "circle") {
    o = new f.Circle({
      ...TL,
      left: el.x - el.r, top: el.y - el.r, radius: el.r, fill: colorOf(theme, el.fill), opacity: el.opacity ?? 1,
      ...(el.stroke ? { stroke: colorOf(theme, el.stroke), strokeWidth: el.sw ?? 2 } : { strokeWidth: 0 }),
    }) as unknown as WithTk;
    o.tk = { fill: el.fill, ...(el.stroke ? { stroke: el.stroke } : {}) };
  } else if (el.t === "line") {
    o = new f.Line([el.x1, el.y1, el.x2, el.y2], { ...TL, stroke: colorOf(theme, el.color), strokeWidth: el.w, strokeLineCap: "round" }) as unknown as WithTk;
    o.tk = { stroke: el.color };
  } else {
    const src = photos.shift() || placeholder();
    const img = await f.FabricImage.fromURL(src, { crossOrigin: "anonymous" });
    const slot = { x: el.x, y: el.y, w: el.w, h: el.h, r: el.r, circle: el.circle };
    fitToSlot(f, img, slot);
    o = img as unknown as WithTk;
    o.name = "slot";
    o.tk = { slot };
  }
  return o;
}

/** 캔버스 → 바탕 그림·완성 그림·편집기 상태 (바탕 주소 자리는 __BG__) */
export async function exportPage(c: F.StaticCanvas | F.Canvas, size: { w: number; h: number }, zoom = 1) {
  const toBlob = (url: string) => fetch(url).then((r) => r.blob());
  const base = c.getObjects().find((o) => (o as WithTk).name === "base") as F.FabricImage | undefined;
  const bgEl = base?.getElement() as HTMLCanvasElement | HTMLImageElement | undefined;
  let bg: Blob;
  if (bgEl instanceof HTMLCanvasElement) bg = await new Promise<Blob>((ok) => bgEl.toBlob((b) => ok(b!), "image/jpeg", 0.92));
  else {
    const t = document.createElement("canvas");
    t.width = size.w;
    t.height = size.h;
    if (bgEl) t.getContext("2d")!.drawImage(bgEl, 0, 0, size.w, size.h);
    bg = await new Promise<Blob>((ok) => t.toBlob((b) => ok(b!), "image/jpeg", 0.92));
  }
  const img = await toBlob(c.toDataURL({ format: "jpeg", quality: 0.92, multiplier: 1 / zoom }));
  const json = c.toObject(KEEP) as { objects: Record<string, unknown>[] };
  for (const o of json.objects) if (o.name === "base") o.src = "__BG__";
  const layers = JSON.stringify({ v: 1, w: size.w, h: size.h, canvas: json });
  return { bg, img, layers };
}

/** 작은 미리보기 그림 */
export function thumbOf(c: F.StaticCanvas, width = 270) {
  return c.toDataURL({ format: "jpeg", quality: 0.82, multiplier: width / (c.getWidth() || 1080) });
}

/** 다른 테마로 다시 칠함: 토큰(tk)이 있는 것만 — 사진 바탕은 그대로 */
export async function applyTheme(f: typeof F, c: F.StaticCanvas | F.Canvas, theme: Theme, size: { w: number; h: number }) {
  await Promise.all([loadFont(theme.fonts.heading), loadFont(theme.fonts.body)]);
  for (const raw of c.getObjects()) {
    const o = raw as WithTk;
    const tk = o.tk;
    if (!tk) continue;
    if (o.name === "base" && tk.bg && tk.bg.kind !== "photo") {
      (o as unknown as F.FabricImage).setElement(await drawBg(tk.bg, theme, size.w, size.h));
      continue;
    }
    if (tk.fill) o.set({ fill: colorOf(theme, tk.fill) });
    if (tk.stroke) o.set({ stroke: colorOf(theme, tk.stroke) });
    if (tk.box) o.set({ backgroundColor: colorOf(theme, tk.box) });
    if (tk.font) {
      o.set({ fontFamily: fontFamily(theme.fonts[tk.font]) } as Partial<F.FabricObject>);
      (o as unknown as F.Textbox).initDimensions?.();
    }
  }
  c.requestRenderAll();
}
