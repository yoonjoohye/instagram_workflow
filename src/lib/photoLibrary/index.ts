"use client";
/** 기기 사진 폴더 연결 + 주제로 사진 자동 찾기.
 *
 *  - 폴더 접근: File System Access API (크롬·엣지 컴퓨터). 한 번 연결하면 폴더 핸들을 IndexedDB 에 보관합니다.
 *  - 색인: 사진마다 썸네일·촬영 날짜·GPS(EXIF)·CLIP 임베딩을 브라우저 안에서 만들어 저장. 사진은 서버로 가지 않습니다.
 *  - 검색: 서버(Gemini)가 주제를 영어 장면 묘사·장소·날짜로 바꿔 주면, 기기 안에서 점수를 매겨 고릅니다.
 */
import exifr from "exifr";
import { allPhotos, clearPhotos, deletePhotos, getMeta, putPhoto, setMeta, type PhotoRecord } from "./db";

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  queryPermission(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission(o: { mode: "read" }): Promise<PermissionState>;
};

export type LibraryState =
  | { status: "unsupported" }
  | { status: "none" } // 연결 안 됨
  | { status: "permission"; name: string } // 연결했지만 이번 방문에 권한 다시 필요
  | { status: "ready"; name: string; count: number; embedded: number };

export type IndexProgress = { phase: "scan" | "embed" | "model"; done: number; total: number };

export type PhotoQuery = {
  queries: string[];
  place: { name: string; lat: number; lng: number; radius_km: number } | null;
  date_from: string | null;
  date_to: string | null;
  count: number;
};

export type Match = { path: string; name: string; thumb: Blob; score: number; takenAt: number | null; reason: string[] };

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i; // HEIC 는 크롬이 열지 못해 건너뜁니다 (JPEG 로 내보내기 필요)
const SKIP_DIR = /^(\.|node_modules$|@eaDir$)/;
const MAX_PHOTOS = 5000;
// 특이도 계산의 기준이 되는 '평범한 사진' 묘사
const GENERIC = [
  "a photo",
  "a photo of food",
  "a photo of a meal on a table",
  "a photo of a city street",
  "a photo of a building",
  "a photo of a person",
  "a photo of a landscape",
  "a photo taken at night",
];

export const supported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

async function handle(): Promise<DirHandle | undefined> {
  return getMeta<DirHandle>("dir");
}

export async function state(): Promise<LibraryState> {
  if (!supported()) return { status: "unsupported" };
  const dir = await handle();
  if (!dir) return { status: "none" };
  if ((await dir.queryPermission({ mode: "read" })) !== "granted") return { status: "permission", name: dir.name };
  const photos = await allPhotos();
  return { status: "ready", name: dir.name, count: photos.length, embedded: photos.filter((p) => p.emb).length };
}

/** 폴더 고르기 (사용자 클릭에서 호출) */
export async function connect(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  const dir = await picker({ id: "instagram-photos", mode: "read", startIn: "pictures" });
  const prev = await handle();
  if (!prev || !(await prev.isSameEntry(dir))) await clearPhotos(); // 다른 폴더면 색인 새로
  await setMeta("dir", dir);
}

/** 다시 방문했을 때 권한 다시 받기 (사용자 클릭에서 호출) */
export async function regrant(): Promise<boolean> {
  const dir = await handle();
  return !!dir && (await dir.requestPermission({ mode: "read" })) === "granted";
}

export async function disconnect() {
  await setMeta("dir", undefined);
  await clearPhotos();
}

async function* walk(
  dir: DirHandle,
  stats: { heic: number },
  prefix = "",
): AsyncGenerator<{ path: string; file: FileSystemFileHandle }> {
  for await (const entry of dir.values()) {
    if (SKIP_DIR.test(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") yield* walk(entry as DirHandle, stats, path);
    else if (IMAGE_EXT.test(entry.name)) yield { path, file: entry as FileSystemFileHandle };
    else if (/\.heic$/i.test(entry.name)) stats.heic++;
  }
}

async function thumbnail(file: File, side = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}

// ── CLIP 워커 ────────────────────────────────────────────────────────────
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let onDownload: ((p: number) => void) | null = null;

function clip(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./clip.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "download") return onDownload?.(msg.progress);
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error));
      else w.resolve(msg.emb ?? msg.embs);
    };
  }
  return worker;
}

function ask<T>(msg: object): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    clip().postMessage({ id, ...msg });
  });
}

/** 폴더를 훑어 새 사진·바뀐 사진만 색인하고, 없어진 사진은 지웁니다. 이어서 CLIP 임베딩을 만듭니다. */
export async function index(onProgress: (p: IndexProgress) => void, signal?: AbortSignal): Promise<{ skippedHeic: number }> {
  const dir = await handle();
  if (!dir) throw new Error("no folder");
  const known = new Map((await allPhotos()).map((p) => [p.path, p]));
  const seen = new Set<string>();
  const files: { path: string; file: FileSystemFileHandle }[] = [];
  const stats = { heic: 0 }; // HEIC 는 크롬에서 열 수 없어 개수만 세어 안내
  for await (const f of walk(dir, stats)) {
    if (files.length >= MAX_PHOTOS) break;
    files.push(f);
  }
  const skippedHeic = stats.heic;

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) return { skippedHeic };
    const { path, file: fh } = files[i];
    seen.add(path);
    onProgress({ phase: "scan", done: i, total: files.length });
    const file = await fh.getFile();
    const old = known.get(path);
    if (old && old.lastModified === file.lastModified && old.size === file.size) continue;
    try {
      const [thumb, meta] = await Promise.all([
        thumbnail(file),
        exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] }).catch(() => null),
      ]);
      const taken = meta?.DateTimeOriginal ?? meta?.CreateDate;
      await putPhoto({
        path,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        takenAt: taken instanceof Date ? taken.getTime() : file.lastModified,
        lat: typeof meta?.latitude === "number" ? meta.latitude : null,
        lng: typeof meta?.longitude === "number" ? meta.longitude : null,
        thumb,
        emb: null,
      });
    } catch {
      /* 열 수 없는 파일은 건너뜀 */
    }
  }
  const gone = [...known.keys()].filter((p) => !seen.has(p));
  if (gone.length) await deletePhotos(gone);

  // CLIP 임베딩 (처음에는 모델 내려받기)
  const pending = (await allPhotos()).filter((p) => !p.emb);
  onDownload = (pct) => onProgress({ phase: "model", done: Math.round(pct), total: 100 });
  for (let i = 0; i < pending.length; i++) {
    if (signal?.aborted) break;
    onProgress({ phase: "embed", done: i, total: pending.length });
    try {
      // 256px 썸네일로 분석하면 특징이 흐려져(실측 특이도 절반) 원본에서 448px 로 다시 만들어 분석합니다.
      const source = await fileFor(pending[i].path).then((f) => thumbnail(f, 448)).catch(() => pending[i].thumb);
      const emb = await ask<Float32Array>({ type: "image", blob: source });
      await putPhoto({ ...pending[i], emb });
    } catch {
      /* 임베딩 실패한 사진은 위치·날짜로만 찾음 */
    }
  }
  onDownload = null;
  return { skippedHeic };
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function km(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** 주제에 맞는 사진 고르기. 그림 내용(CLIP) + 장소(GPS) + 시기(촬영일)로 점수를 매기고, 거의 같은 사진은 하나만. */
export async function search(q: PhotoQuery): Promise<Match[]> {
  const photos = await allPhotos();
  if (!photos.length) return [];
  const all = q.queries.length ? await ask<Float32Array[]>({ type: "text", texts: [...q.queries, ...GENERIC] }).catch(() => []) : [];
  const texts = all.slice(0, q.queries.length);
  const generic = all.slice(q.queries.length);
  const from = q.date_from ? Date.parse(q.date_from) : null;
  const to = q.date_to ? Date.parse(q.date_to) + 86_400_000 : null;

  // 그림 내용: '주제 묘사와 닮은 정도 - 평범한 사진 묘사와 닮은 정도'(특이도). CLIP 은 음식 사진이면 어떤 음식 문장에도
  // 점수가 높게 나와서, 그냥 유사도로는 츄로스를 찾을 때 갈레트·타파스까지 걸립니다. 기준(0.012, 최고점의 30%)은 실제 사진으로 맞춘 값.
  const specific = photos.map((p) => {
    if (!p.emb || !texts.length) return null;
    const sim = Math.max(...texts.map((t) => dot(p.emb!, t)));
    const base = generic.length ? Math.max(...generic.map((g) => dot(p.emb!, g))) : 0;
    return { sim, diff: sim - base };
  });
  // 가장 잘 맞는 사진의 30% 이상이어야 관련 있다고 봅니다 (에든버러를 찾는데 비슷한 돌 건물이 걸리는 것 방지).
  const bestDiff = Math.max(0, ...specific.map((c) => c?.diff ?? 0));
  const minDiff = Math.max(0.012, bestDiff * 0.3);

  const scored = photos.map((p, i) => {
    const reason: string[] = [];
    let score = 0;
    const c = specific[i];
    if (c) {
      score += c.diff;
      if (c.diff >= minDiff) reason.push("content");
    }
    if (q.place && p.lat != null && p.lng != null) {
      const d = km(q.place.lat, q.place.lng, p.lat, p.lng);
      if (d <= q.place.radius_km) {
        score += 0.08;
        reason.push("place");
      } else score -= 0.05;
    }
    if ((from || to) && p.takenAt) {
      const inRange = (!from || p.takenAt >= from) && (!to || p.takenAt < to);
      score += inRange ? 0.05 : -0.05;
      if (inRange) reason.push("date");
    }
    return { p, score, reason };
  });
  scored.sort((a, b) => b.score - a.score);

  const picked: typeof scored = [];
  for (const s of scored) {
    if (picked.length >= q.count) break;
    // 연사·비슷한 사진은 하나만
    if (s.p.emb && picked.some((x) => x.p.emb && dot(x.p.emb, s.p.emb!) > 0.94)) continue;
    // 관련 근거가 하나도 없으면(내용·장소·날짜 모두 불일치) 고르지 않음
    if (!s.reason.length) continue;
    picked.push(s);
  }
  return picked.map(({ p, score, reason }) => ({ path: p.path, name: p.name, thumb: p.thumb, score, takenAt: p.takenAt, reason }));
}

/** 고른 사진의 원본 파일 (업로드용) */
export async function fileFor(path: string): Promise<File> {
  const dir = await handle();
  if (!dir) throw new Error("no folder");
  let cur: FileSystemDirectoryHandle = dir;
  const parts = path.split("/");
  for (const part of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(part);
  return (await cur.getFileHandle(parts[parts.length - 1])).getFile();
}
