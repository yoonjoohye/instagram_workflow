/** 아직 올리는 중인 동영상: 주소는 미리 정해 두고(서버에 등록), 화면은 기기 안의 파일로 바로 보여 주며
 *  뒤에서 계속 올립니다. 적용하기·게시처럼 서버가 그 파일을 써야 할 때만 다 올라갈 때까지 기다립니다.
 *  (탭을 닫으면 올리기가 멈추므로 그동안은 나가기 전에 물어봄) */

import { useSyncExternalStore } from "react";

type Entry = { objectUrl: string; pct: number; done: boolean; error?: string; promise: Promise<void> };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (pendingUploads().length) {
    e.preventDefault();
    e.returnValue = "";
  }
}

/** 미리 정한 주소(url)에 올릴 파일을 등록하고 올리기를 시작합니다. upload 는 진행률(0~100)을 알려 줌 */
export function startBackgroundUpload(url: string, file: File, upload: (onPct: (pct: number) => void) => Promise<void>) {
  const entry: Entry = { objectUrl: URL.createObjectURL(file), pct: 0, done: false, promise: Promise.resolve() };
  entries.set(url, entry);
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onBeforeUnload);
  entry.promise = upload((pct) => {
    entry.pct = pct;
    emit();
  }).then(
    () => {
      entry.done = true;
      entry.pct = 100;
      emit();
    },
    (err: unknown) => {
      entry.error = err instanceof Error ? err.message : String(err);
      emit();
      throw err;
    },
  );
  entry.promise.catch(() => undefined); // 기다리는 쪽에서 오류를 다룸
  emit();
}

/** 화면에 쓸 주소: 아직 기기에 있는 파일이면 그 파일 (바로 재생·편집) */
export function localSrc(url: string): string | undefined {
  return entries.get(url)?.objectUrl;
}

export function pendingUploads(): { url: string; pct: number; error?: string }[] {
  return [...entries.entries()].filter(([, e]) => !e.done).map(([url, e]) => ({ url, pct: e.pct, error: e.error }));
}

/** 이 주소들이 다 올라갈 때까지 기다림 (없거나 이미 올라갔으면 바로) */
export async function waitForUploads(urls: string[]): Promise<void> {
  await Promise.all(urls.map((u) => entries.get(u)?.promise));
}

/** 올리는 중인 것들의 진행 상황 (화면 표시용) */
export function useUploads() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => 0,
  );
}
