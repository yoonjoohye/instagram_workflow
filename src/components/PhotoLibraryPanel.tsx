"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import * as lib from "@/lib/photoLibrary";
import { Button, cx } from "./ui";

/** 사진 폴더 연결 상태·색인 진행·'주제로 사진 찾기' 버튼. 색인은 연결돼 있으면 들어올 때마다 새 사진만 이어서 합니다. */
export function PhotoLibraryPanel({
  busy,
  canFind,
  onFind,
  onReadyChange,
}: {
  busy: boolean;
  canFind: boolean;
  onFind: () => Promise<void>;
  onReadyChange: (ready: boolean) => void;
}) {
  const t = useT();
  const [st, setSt] = useState<lib.LibraryState | null>(null);
  const [progress, setProgress] = useState<lib.IndexProgress | null>(null);
  const [heic, setHeic] = useState(0);
  const [error, setError] = useState<string>();
  const [finding, setFinding] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const next = await lib.state();
    setSt(next);
    onReadyChange(next.status === "ready" && next.count > 0);
    return next;
  }, [onReadyChange]);

  const runIndex = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(undefined);
    try {
      const r = await lib.index(setProgress, ctrl.signal);
      setHeic(r.skippedHeic);
    } catch (e) {
      setError(t("studio.libError", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      if (abort.current === ctrl) setProgress(null);
      await refresh();
    }
  }, [refresh, t]);

  useEffect(() => {
    refresh().then((s) => {
      if (s.status === "ready") void runIndex();
    });
    return () => abort.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null;
  if (st.status === "unsupported") return <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-fg-3">{t("studio.libUnsupported")}</p>;

  const act = (fn: () => Promise<unknown>) => async () => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(t("studio.libError", { e: e instanceof Error ? e.message : String(e) }));
    }
  };

  const progressText =
    progress &&
    (progress.phase === "scan"
      ? t("studio.libScan", { done: progress.done, total: progress.total })
      : progress.phase === "model"
        ? t("studio.libModel", { pct: progress.done })
        : t("studio.libEmbed", { done: progress.done, total: progress.total }));

  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">📁 {t("studio.libTitle")}</span>
      </div>

      {st.status === "none" && (
        <>
          <p className="mt-1.5 text-[12px] leading-relaxed text-fg-2">{t("studio.libConnectHint")}</p>
          <Button size="sm" className="mt-2" disabled={busy} onClick={act(async () => (await lib.connect(), await refresh(), runIndex()))}>
            {t("studio.libConnect")}
          </Button>
        </>
      )}

      {st.status === "permission" && (
        <>
          <p className="mt-1.5 text-[12px] text-fg-2">{t("studio.libRegrantHint")}</p>
          <Button size="sm" className="mt-2" disabled={busy} onClick={act(async () => (await lib.regrant()) && (await refresh(), runIndex()))}>
            {t("studio.libRegrant", { name: st.name })}
          </Button>
        </>
      )}

      {st.status === "ready" && (
        <div className="mt-1.5 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-2">
            <span>
              {st.embedded < st.count
                ? t("studio.libReadyPartial", { name: st.name, count: st.count, embedded: st.embedded })
                : t("studio.libReady", { name: st.name, count: st.count })}
            </span>
            {!progress && (
              <>
                <button type="button" className="text-fg-3 hover:text-fg" disabled={busy} onClick={runIndex}>
                  {t("studio.libReindex")}
                </button>
                <button type="button" className="text-fg-3 hover:text-bad" disabled={busy} onClick={act(async () => (await lib.disconnect(), refresh()))}>
                  {t("studio.libDisconnect")}
                </button>
              </>
            )}
          </div>
          {progressText && (
            <div>
              <p className="text-[12px] text-fg-3">{progressText}</p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${progress!.total ? Math.round((progress!.done / progress!.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={busy || finding || !canFind || st.count === 0}
            loading={finding}
            onClick={async () => {
              setFinding(true);
              try {
                await onFind();
              } finally {
                setFinding(false);
              }
            }}
          >
            {finding ? t("studio.libFinding") : t("studio.libFind")}
          </Button>
        </div>
      )}

      {heic > 0 && <p className="mt-2 text-[11px] text-fg-3">{t("studio.libHeic", { n: heic })}</p>}
      {error && <p className={cx("mt-2 text-[12px] text-bad")}>{error}</p>}
    </div>
  );
}
