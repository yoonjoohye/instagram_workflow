"use client";

import { useCallback, useEffect, useState } from "react";
import { translate } from "@/i18n/core";
import { getFormatLocale } from "./format";

// 로컬: next.config 의 rewrite 가 uvicorn(8000) 으로, Vercel: vercel.json 이 api/index.py 로 보냅니다.
export const API_BASE = "/api/py";
export const LOGIN_URL = `${API_BASE}/auth/login`;
/** 브라우저에 로그인된 인스타 계정으로 바로 넘어가지 않고 로그인 화면을 띄워 다른 계정을 연결 */
export const SWITCH_LOGIN_URL = `${LOGIN_URL}?switch=1`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type ApiInit = Omit<RequestInit, "body"> & { json?: unknown };

function detailMessage(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  // FastAPI 검증 오류: [{loc, msg, ...}]
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d)).join(", ");
  return translate(getFormatLocale(), "common.requestFailed", { status });
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError(translate(getFormatLocale(), "common.serverUnreachable"), 0);
  }
  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 본문 없는 응답
  }
  if (!res.ok) throw new ApiError(detailMessage(data, res.status), res.status);
  return data as T;
}

export function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), 0);
}

/** GET 전용 훅. path 가 null 이면 요청하지 않습니다. 재조회 중에는 이전 데이터를 유지합니다. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(Boolean(path));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(undefined);
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(toApiError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}
