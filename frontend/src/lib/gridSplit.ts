/** 그리드 분할 (퍼즐 피드): 큰 사진 한 장을 3열 × N줄 조각으로 나눠, 프로필 격자에서 하나의 큰 사진처럼 보이게.
 *
 *  - 프로필 격자 칸은 세로 3:4 이고, 4:5 게시물은 가운데 3:4 만 보입니다.
 *  - Instagram API 는 4:5 보다 길쭉한 사진을 받지 않아서, 조각마다 4:5(1080×1350)로 만들되
 *    가운데 3:4(1012.5×1350)가 정확히 그 조각이 되게 하고 양옆 33.75px 은 이웃 조각을 조금 이어 붙입니다(게시물을 열면 자연스럽게 이어 보임).
 *  - 그래서 전체 그림 = (3열 × 3u + 양끝 0.1u) × (줄 수 × 4u), u = 337.5px. */

export const TILE_W = 1080;
export const TILE_H = 1350;
const U = TILE_H / 4; // 337.5
const BLEED = 0.1 * U; // 33.75
export const COLS = 3;

export type GridView = { zoom: number; x: number; y: number }; // x·y: -1(왼쪽·위 끝) ~ 1(오른쪽·아래 끝)

export function gridSize(rows: number) {
  return { w: COLS * 3 * U + 2 * BLEED, h: rows * 4 * U };
}

/** 사진을 전체 그림 위에 놓는 위치 (꽉 채우고 zoom 만큼 확대, x·y 로 옮김) */
export function placement(iw: number, ih: number, rows: number, view: GridView) {
  const { w, h } = gridSize(rows);
  const s = Math.max(w / iw, h / ih) * view.zoom;
  const dw = iw * s;
  const dh = ih * s;
  return { s, dw, dh, dx: ((w - dw) / 2) * (1 + view.x), dy: ((h - dh) / 2) * (1 + view.y), w, h };
}

/** 조각 사진들 (프로필에 보이는 순서: 왼쪽 위부터) */
export async function splitImage(img: CanvasImageSource & { width: number; height: number }, rows: number, view: GridView): Promise<Blob[]> {
  const p = placement(img.width, img.height, rows, view);
  const out: Blob[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const canvas = document.createElement("canvas");
      canvas.width = TILE_W;
      canvas.height = TILE_H;
      const x = canvas.getContext("2d")!;
      x.fillStyle = "#ffffff";
      x.fillRect(0, 0, TILE_W, TILE_H);
      // 이 조각이 전체 그림에서 시작하는 곳: 왼쪽 끝 = c × 3u (가운데 3u 는 조각, 양옆 0.1u 는 이웃)
      x.drawImage(img, p.dx - c * 3 * U, p.dy - r * 4 * U, p.dw, p.dh);
      out.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("tile"))), "image/jpeg", 0.92)));
    }
  }
  return out;
}

/** 미리보기: 전체 그림을 작게 그리고 조각 경계(프로필에 보이는 부분)를 표시 */
export function drawPreview(canvas: HTMLCanvasElement, img: CanvasImageSource & { width: number; height: number }, rows: number, view: GridView) {
  const p = placement(img.width, img.height, rows, view);
  const scale = canvas.width / p.w;
  canvas.height = Math.round(p.h * scale);
  const x = canvas.getContext("2d")!;
  x.setTransform(scale, 0, 0, scale, 0, 0);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, p.w, p.h);
  x.drawImage(img, p.dx, p.dy, p.dw, p.dh);
  // 프로필에서 안 보이는 양끝(이웃 조각용 여유)은 흐리게
  x.fillStyle = "rgba(0,0,0,0.45)";
  x.fillRect(0, 0, BLEED, p.h);
  x.fillRect(p.w - BLEED, 0, BLEED, p.h);
  x.strokeStyle = "rgba(255,255,255,0.9)";
  x.lineWidth = 3 / scale;
  x.setLineDash([12 / scale, 8 / scale]);
  for (let c = 1; c < COLS; c++) {
    x.beginPath();
    x.moveTo(BLEED + c * 3 * U, 0);
    x.lineTo(BLEED + c * 3 * U, p.h);
    x.stroke();
  }
  for (let r = 1; r < rows; r++) {
    x.beginPath();
    x.moveTo(BLEED, r * 4 * U);
    x.lineTo(p.w - BLEED, r * 4 * U);
    x.stroke();
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  return { scale, ...p };
}
