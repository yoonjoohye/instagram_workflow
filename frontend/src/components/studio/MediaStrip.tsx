"use client";

/** 검수 화면의 이미지·동영상 목록: 장마다 다운로드, 프롬프트로 수정(지금 이미지에서 / 처음부터), 배경음악 */

import { useRef, useState } from "react";
import { IconMusic } from "@/components/icons";
import { useT } from "@/i18n/client";
import type { MessageKey, T } from "@/i18n/core";
import { Button, cx, inputClass, Spinner } from "@/components/ui";
import { toApiError } from "@/lib/api";
import { callNative, isNativeApp } from "@/lib/nativeBridge";
import { mediaSrc } from "@/lib/format";
import { useDragSort } from "@/lib/useDragSort";
import type { Asset } from "@/lib/types";

export type RedoFn = (index: number, instruction: string, fromCurrent: boolean) => Promise<void>;

export async function fetchFile(url: string, name: string, t: T): Promise<File> {
  const res = await fetch(mediaSrc(url));
  if (!res.ok) throw new Error(t("studio.fetchImageFailed", { status: res.status }));
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

/** 휴대폰에서는 공유 시트(‘이미지 저장’ → 사진 앱)로, 컴퓨터에서는 파일로 저장합니다. */
export async function saveFiles(files: File[]) {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // 사용자가 닫음
      // 공유가 막히면 아래 파일 저장으로
    }
  }
  for (const file of files) {
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    if (files.length > 1) await new Promise((r) => setTimeout(r, 300)); // 브라우저가 연속 다운로드를 막지 않게
  }
}

/** 앱 안에서는 사진첩에 바로 저장 (WebView 는 파일 다운로드를 못 함) */
export async function saveInApp(urls: string[], t: T) {
  const abs = urls.map((u) => new URL(mediaSrc(u), window.location.href).href);
  await callNative("save", { urls: abs, message: t("studio.savedToPhotos") }, 300_000);
}

export async function downloadImage(url: string, name: string, t: T) {
  if (isNativeApp()) return saveInApp([url], t);
  await saveFiles([await fetchFile(url, name, t)]);
}

export function MediaStrip({
  assets,
  onRedo,
  onManualEdit,
  onVideoEdit,
  onReorder,
  onAdd,
  onGenerate,
  onRemove,
  canRedoFromScratch = true,
  filePrefix = "post",
}: {
  assets: Asset[];
  /** 끌어서 순서 바꾸기 */
  onReorder?: (from: number, to: number) => void;
  /** 사진·동영상 더 넣기 */
  onAdd?: (files: File[]) => Promise<void>;
  /** AI 로 새 이미지 만들기 (요청 글) */
  onGenerate?: (instruction: string) => Promise<void>;
  /** 한 장 빼기 */
  onRemove?: (index: number) => Promise<void>;
  onRedo?: RedoFn;
  /** 이미지 편집기 열기 (글자·스티커·그리기·보정·자르기) */
  onManualEdit?: (index: number) => void;
  /** 동영상 편집 열기 (자르기·소리·음악·대표 화면) */
  onVideoEdit?: (index: number) => void;
  /** 원본 그대로 게시하는 작업은 '처음부터 다시'가 없음 */
  canRedoFromScratch?: boolean;
  filePrefix?: string;
}) {
  const t = useT();
  const [error, setError] = useState<string>();
  const [downloadingAll, setDownloadingAll] = useState(false);
  const { drag, sortProps } = useDragSort((from, to) => onReorder?.(from, to), !onReorder);
  const canAdd = Boolean(onAdd || onGenerate);
  if (!assets.length && !canAdd) return <p className="py-8 text-center text-sm text-fg-3">{t("studio.noMedia")}</p>;
  const single = assets.length === 1 && !canAdd;
  const fileName = (a: Asset, i: number) => `${filePrefix}-${i + 1}.${a.type === "video" ? "mp4" : "jpg"}`;
  const ready = assets.filter((a) => a.url);

  const downloadAll = async () => {
    setDownloadingAll(true);
    setError(undefined);
    try {
      if (isNativeApp()) {
        await saveInApp(ready.map((a) => a.url), t);
        return;
      }
      const files = await Promise.all(
        assets.map((a, i) => (a.url ? fetchFile(a.url, fileName(a, i), t) : null)),
      );
      await saveFiles(files.filter((f): f is File => f !== null));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <>
      {error && <p className="mb-2 text-[12px] text-bad">{error}</p>}
      {!single && ready.length > 1 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[12px] text-fg-3">{onReorder ? `⠿ ${t("studio.dragToReorder")}` : ""}</span>
          <Button variant="ghost" size="sm" onClick={downloadAll} disabled={downloadingAll}>
            {downloadingAll ? <Spinner className="size-3" /> : "↓"} {t("studio.downloadAll", { n: ready.length })}
          </Button>
        </div>
      )}
      <div className={cx("flex items-start gap-3", !single && "snap-x overflow-x-auto pb-2")}>
        {assets.map((a, i) => (
          <div
            key={`${a.url}-${i}`}
            {...(single ? {} : sortProps(i))}
            className={cx(
              "shrink-0 snap-start rounded-lg transition-[opacity,box-shadow]",
              onReorder && !single && "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]",
              drag?.from === i && "opacity-40",
              drag && drag.over === i && drag.from !== i && "ring-2 ring-accent ring-offset-2 ring-offset-surface-1",
            )}
          >
          <MediaItem
            asset={a}
            index={i}
            total={assets.length}
            single={single}
            fileName={fileName(a, i)}
            onRedo={onRedo}
            onManualEdit={onManualEdit}
            onVideoEdit={onVideoEdit}
            onRemove={onRemove}
            canRedoFromScratch={canRedoFromScratch}
            onError={setError}
          />
          </div>
        ))}
        {canAdd && <AddTile onAdd={onAdd} onGenerate={onGenerate} empty={!assets.length} />}
      </div>
    </>
  );
}

export function MediaItem({
  asset: a,
  index: i,
  total,
  single,
  fileName,
  onRedo,
  onManualEdit,
  onVideoEdit,
  onRemove,
  canRedoFromScratch = true,
  onError,
}: {
  asset: Asset;
  index: number;
  total: number;
  single: boolean;
  fileName: string;
  onRedo?: RedoFn;
  onManualEdit?: (index: number) => void;
  onVideoEdit?: (index: number) => void;
  onRemove?: (index: number) => Promise<void>;
  canRedoFromScratch?: boolean;
  onError: (message?: string) => void;
}) {
  const t = useT();
  const canEditCurrent = a.type === "image" && Boolean(a.url);
  const lastPrompt = typeof a.meta?.prompt === "string" ? a.meta.prompt : "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fromCurrent, setFromCurrent] = useState(canEditCurrent);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editError, setEditError] = useState<string>();
  const failed = typeof a.meta?.engine === "string" && a.meta.engine.startsWith("basic");

  const apply = async () => {
    if (!onRedo) return;
    setBusy(true);
    setEditError(undefined);
    try {
      await onRedo(i, text.trim(), fromCurrent && canEditCurrent);
      setText("");
      setOpen(false);
    } catch (e) {
      setEditError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    onError(undefined);
    try {
      await downloadImage(a.url, fileName, t);
    } catch (e) {
      onError(toApiError(e).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <figure
      className={cx(
        "shrink-0 snap-start overflow-hidden rounded-lg border border-line bg-surface-2",
        single ? "mx-auto w-full max-w-sm" : "w-64",
      )}
    >
      <div className="relative">
        {a.type === "video" ? (
          <video src={mediaSrc(a.url)} poster={mediaSrc(a.thumbnail_url) || undefined} controls playsInline className="block max-h-[520px] w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(a.url)} alt={t("studio.imageAlt", { n: i + 1 })} draggable={false} className="block max-h-[520px] w-full object-contain" />
        )}
        {!single && (
          <figcaption className="tnum absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            {i + 1}/{total}
            {typeof a.meta?.role === "string" && ` · ${ROLE_LABEL[a.meta.role] ? t(ROLE_LABEL[a.meta.role]) : ""}`}
          </figcaption>
        )}
        {onRemove && !busy && (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(t("studio.removeMediaConfirm", { n: i + 1 }))) return;
              setBusy(true);
              try {
                await onRemove(i);
              } catch (e) {
                onError(toApiError(e).message);
                setBusy(false);
              }
            }}
            aria-label={t("studio.removeMedia", { n: i + 1 })}
            className="absolute right-2 bottom-2 z-10 flex size-7 items-center justify-center rounded-full bg-black/60 text-[12px] text-white hover:bg-black/80"
          >
            ✕
          </button>
        )}
        {Boolean(a.meta?.video_edit) && (
          <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">✂️ {t("media.edited")}</span>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[12px] text-white">
            <Spinner className="mr-1.5 size-4" /> {t("studio.generating")}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line bg-surface-1 px-2 py-1.5">
        <button
          type="button"
          onClick={download}
          disabled={!a.url || downloading}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
        >
          {downloading ? <Spinner className="size-3" /> : "↓"} {t("studio.download")}
        </button>
        {onManualEdit && a.type === "image" && (
          <button
            type="button"
            onClick={() => onManualEdit(i)}
            disabled={busy}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
          >
            ✏️ {t("studio.manualEdit")}
          </button>
        )}
        {onVideoEdit && a.type === "video" && (
          <button
            type="button"
            onClick={() => onVideoEdit(i)}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2"
          >
            ✂️ {t("media.editVideo")}
          </button>
        )}
        {onRedo && a.type === "image" && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            aria-expanded={open}
            className={cx(
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50",
              !onManualEdit && "ml-auto",
              open ? "text-accent" : "text-fg-2",
            )}
          >
            ✨ {t("studio.editImage")}
          </button>
        )}
      </div>
      {failed && !busy && (
        <p className="border-t border-line bg-surface-1 px-2 py-1 text-[11px] text-warn">{t("studio.fallbackImage")}</p>
      )}

      {onRedo && open && a.type === "image" && (
        <div className="space-y-2 border-t border-line bg-surface-1 p-2">
          {lastPrompt && <p className="line-clamp-2 text-[11px] text-fg-3">{t("studio.lastRequest", { prompt: lastPrompt })}</p>}
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={
              fromCurrent && canEditCurrent
                ? t("studio.editPlaceholderCurrent")
                : t("studio.editPlaceholderRedo")
            }
            className={cx(inputClass, "resize-y text-[12px]")}
            disabled={busy}
          />
          <div className="flex rounded-md border border-line p-0.5 text-[11px]" role="radiogroup" aria-label={t("studio.editMode")}>
            {[
              { v: true, label: t("studio.modeCurrent"), disabled: !canEditCurrent },
              { v: false, label: t("studio.modeRedo"), disabled: !canRedoFromScratch },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={fromCurrent === o.v}
                disabled={o.disabled || busy}
                onClick={() => setFromCurrent(o.v)}
                className={cx(
                  "flex-1 rounded px-1.5 py-1 font-medium disabled:opacity-40",
                  fromCurrent === o.v ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-surface-2",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {editError && (
            <p role="alert" className="rounded-md bg-bad/10 px-2 py-1.5 text-[11px] leading-relaxed text-bad">
              {editError}
            </p>
          )}
          <Button size="sm" className="w-full" onClick={apply} disabled={busy || (fromCurrent && canEditCurrent && !text.trim())}>
            {busy ? <Spinner className="size-3" /> : "↻"} {fromCurrent && canEditCurrent ? t("studio.applyEdit") : t("studio.redo")}
          </Button>
        </div>
      )}
    </figure>
  );
}

export const ROLE_LABEL: Record<string, MessageKey> = {
  designed: "studio.roleDesigned",
  photo: "studio.rolePhoto",
  video: "studio.videoBadge",
  overlay: "studio.roleOverlay",
  panel: "studio.rolePanel",
  center: "studio.roleCenter",
};

export function AudioTrack({ asset }: { asset: Asset }) {
  const t = useT();
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <IconMusic /> {t("studio.bgm")}
      </p>
      {asset.meta?.prompt && <p className="mt-0.5 text-[12px] text-fg-3">{asset.meta.prompt}</p>}
      <audio src={asset.url} controls className="mt-2 w-full" preload="none" />
      {asset.meta?.note && <p className="mt-2 text-[12px] leading-relaxed text-fg-3">{asset.meta.note}</p>}
    </div>
  );
}

/** 목록 끝 칸: 사진·동영상 더 넣기 / AI 로 새 이미지 만들기 */
function AddTile({ onAdd, onGenerate, empty }: { onAdd?: (files: File[]) => Promise<void>; onGenerate?: (instruction: string) => Promise<void>; empty: boolean }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"idle" | "ai">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"add" | "ai">();
  const [error, setError] = useState<string>();

  async function run(kind: "add" | "ai", fn: () => Promise<void>) {
    setBusy(kind);
    setError(undefined);
    try {
      await fn();
      setText("");
      setMode("idle");
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className={cx("flex shrink-0 snap-start flex-col gap-2 rounded-lg border-2 border-dashed border-line-strong p-3", empty ? "w-full" : "w-64")}>
      {mode === "idle" ? (
        <>
          {onAdd && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => input.current?.click()}
              className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md py-6 text-[13px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-60"
            >
              {busy === "add" ? <Spinner /> : <span className="text-xl">＋</span>}
              {busy === "add" ? t("studio.uploading") : t("studio.addMedia")}
            </button>
          )}
          {onGenerate && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setMode("ai")}
              className="rounded-md border border-line py-2 text-[13px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-60"
            >
              ✨ {t("studio.aiNewImage")}
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*,video/mp4,video/quicktime"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length && onAdd) run("add", () => onAdd(files));
            }}
          />
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] font-semibold">✨ {t("studio.aiNewImage")}</p>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={t("studio.aiNewImagePh")}
            className={cx(inputClass, "resize-y text-[12px]")}
            disabled={!!busy}
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" className="flex-1" loading={busy === "ai"} disabled={!!busy} onClick={() => onGenerate && run("ai", () => onGenerate(text.trim()))}>
              {busy === "ai" ? t("studio.generating") : t("studio.aiMake")}
            </Button>
            <Button size="sm" disabled={!!busy} onClick={() => setMode("idle")}>
              {t("editor.cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="rounded-md bg-bad/10 px-2 py-1.5 text-[11px] leading-relaxed text-bad">{error}</p>}
    </div>
  );
}
