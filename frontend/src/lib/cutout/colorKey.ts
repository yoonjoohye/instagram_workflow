/** 단색 배경 지우기 (AI 없이): 사진 가장자리에서 가장 많은 색을 배경색으로 보고,
 *  가장자리부터 이어진 비슷한 색만 지웁니다 (가운데 피사체 안의 같은 색은 남음). 흰 벽·단색 배경 제품 사진에 잘 맞습니다.
 *  tolerance: 0~1 (클수록 더 넓게 지움). 경계는 살짝 부드럽게. */

export async function removeSolidBackground(source: CanvasImageSource & { width: number; height: number }, tolerance: number): Promise<Blob> {
  const w = Math.max(1, Math.round(Number(source.width)));
  const h = Math.max(1, Math.round(Number(source.height)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // 1) 배경색: 가장자리 픽셀을 4단계(64)로 묶어 가장 많은 색의 평균
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const visitEdge = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 128) return;
    const key = ((d[i] >> 6) << 4) | ((d[i + 1] >> 6) << 2) | (d[i + 2] >> 6);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += d[i];
    b.g += d[i + 1];
    b.b += d[i + 2];
    buckets.set(key, b);
  };
  for (let x = 0; x < w; x++) {
    visitEdge(x, 0);
    visitEdge(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    visitEdge(0, y);
    visitEdge(w - 1, y);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!top) return toBlob(canvas);
  const bg = [top.r / top.n, top.g / top.n, top.b / top.n];

  // 2) 가장자리에서 시작해 비슷한 색으로 이어진 곳만 채우기 (BFS)
  const limit = 18 + tolerance * 140; // 색 거리 (0~441)
  const soft = limit * 0.35; // 경계 부드럽게
  const dist = (i: number) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;
    if (dist(p * 4) <= limit) queue[tail++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const i = p * 4;
    const dd = dist(i);
    // 배경색에 아주 가까우면 완전히 투명, 경계 쪽은 반투명
    d[i + 3] = Math.min(d[i + 3], dd <= limit - soft ? 0 : Math.round(((dd - (limit - soft)) / soft) * 255));
    const x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  ctx.putImageData(img, 0, 0);
  return toBlob(canvas);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}
