/** 배경 지우기(누끼): 워커에서 AI 로 피사체만 남긴 투명 PNG 를 돌려줍니다.
 *  onDownload: 처음 한 번 모델을 내려받는 진행률(0~100). */

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (b: Blob) => void; reject: (e: Error) => void }>();
let onDownload: ((p: number) => void) | null = null;

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./cutout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "download") return onDownload?.(msg.progress);
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error));
      else w.resolve(msg.blob);
    };
  }
  return worker;
}

export function removeBackground(blob: Blob, download?: (percent: number) => void): Promise<Blob> {
  onDownload = download ?? null;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    get().postMessage({ id, blob });
  });
}

/** 투명 PNG 를 배경(색 · 흐린 원본) 위에 얹어 JPEG 로. 크기는 원본 그대로. */
export async function composite(cutout: Blob, background: { color: string } | { blurOf: Blob }, size?: { w: number; h: number }): Promise<Blob> {
  const fg = await createImageBitmap(cutout);
  const w = size?.w ?? fg.width, h = size?.h ?? fg.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if ("color" in background) {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, w, h);
  } else {
    // 흐린 원본: 작게 줄였다 키워 흐리게 (어느 브라우저에서나)
    const bg = await createImageBitmap(background.blurOf);
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(w / 24));
    small.height = Math.max(1, Math.round(h / 24));
    small.getContext("2d")!.drawImage(bg, 0, 0, small.width, small.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(fg, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.92));
}
