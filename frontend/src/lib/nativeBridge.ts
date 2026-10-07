"use client";
/** 휴대폰 앱(Expo WebView) 안에서 열렸을 때 앱 기능(사진첩·로그인·사진 저장)을 부르는 다리.
 *  앱이 페이지보다 먼저 window.__NATIVE_APP__ 를 심어 둡니다. 웹 브라우저에서는 모두 비활성. */

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type NativeWindow = Window & {
  __NATIVE_APP__?: { platform: "ios" | "android"; version: string };
  ReactNativeWebView?: { postMessage: (msg: string) => void };
  __nativeBridge?: { reply: (msg: { id: number; result?: unknown; error?: string }) => void };
};

const w = () => (typeof window === "undefined" ? undefined : (window as NativeWindow));

export const isNativeApp = () => Boolean(w()?.__NATIVE_APP__ && w()?.ReactNativeWebView);
export const nativePlatform = () => w()?.__NATIVE_APP__?.platform;

let seq = 0;
const pending = new Map<number, Pending>();

function ensureReceiver() {
  const win = w();
  if (!win || win.__nativeBridge) return;
  win.__nativeBridge = {
    reply: ({ id, result, error }) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    },
  };
}

/** 앱에 요청하고 답을 기다립니다 */
export function callNative<T>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 120_000): Promise<T> {
  const win = w();
  if (!win?.ReactNativeWebView) return Promise.reject(new Error("not in app"));
  ensureReceiver();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("app timeout"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v as T)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    // 요청 번호(id)와 종류(type)가 payload 의 같은 이름 값에 덮이지 않게 뒤에 둡니다.
    win.ReactNativeWebView!.postMessage(JSON.stringify({ ...payload, id, type }));
  });
}

export function base64ToBlob(b64: string, type = "image/jpeg"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
