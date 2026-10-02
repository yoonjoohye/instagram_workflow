/** 기기 사진 색인 저장소 (브라우저 IndexedDB). 사진 원본은 저장하지 않고 썸네일·메타·임베딩만. */

export type PhotoRecord = {
  path: string; // 연결한 폴더 기준 상대 경로 (키)
  name: string;
  size: number;
  lastModified: number;
  takenAt: number | null; // 촬영 시각 (EXIF), 없으면 null
  lat: number | null;
  lng: number | null;
  thumb: Blob; // 256px JPEG
  emb: Float32Array | null; // CLIP 이미지 임베딩 (정규화)
};

const DB_NAME = "photo-library";
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "path" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req.result as T) : (undefined as T));
    t.onerror = () => reject(t.error);
  });
}

export const getMeta = <T>(key: string) => tx<T | undefined>("meta", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const setMeta = (key: string, value: unknown) => tx("meta", "readwrite", (s) => void s.put(value, key));
export const allPhotos = () => tx<PhotoRecord[]>("photos", "readonly", (s) => s.getAll() as IDBRequest<PhotoRecord[]>);
export const putPhoto = (p: PhotoRecord) => tx("photos", "readwrite", (s) => void s.put(p));
export const deletePhotos = (paths: string[]) => tx("photos", "readwrite", (s) => void paths.forEach((p) => s.delete(p)));
export const clearPhotos = () => tx("photos", "readwrite", (s) => void s.clear());
