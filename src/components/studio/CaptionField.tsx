"use client";

/** 게시글(캡션) 입력: 위에 글자 수와 '✨ 자동 작성'(사진·주제를 보고 Gemini 가 씀, 되돌리기 가능),
 *  아래 입력칸. 원하는 느낌은 필요할 때만 펼쳐서 적습니다. */

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { cx, inputClass, Spinner } from "@/components/ui";
import { api, toApiError } from "@/lib/api";

export function CaptionField({
  jobId,
  value,
  onChange,
  onHashtags,
  count,
  max,
  disabled,
}: {
  jobId: number;
  value: string;
  onChange: (caption: string) => void;
  /** 자동 작성 때 함께 나온 해시태그 (해시태그가 비어 있을 때만 채움) */
  onHashtags?: (tags: string[]) => void;
  /** 해시태그까지 합친 최종 글자 수 */
  count: number;
  max: number;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const [hint, setHint] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [previous, setPrevious] = useState<string | null>(null);
  const over = count > max;

  async function write() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ caption: string; hashtags: string[] }>(`/studio/${jobId}/caption`, {
        method: "POST",
        json: { instruction: hint, caption: value, language: locale },
      });
      setPrevious(value);
      onChange(r.caption);
      if (r.hashtags.length) onHashtags?.(r.hashtags);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor="caption" className="text-[13px] font-medium text-fg-2">
          {t("studio.captionBody")}
          <span className={cx("tnum ml-1.5 text-[12px] font-normal", over ? "font-medium text-bad" : "text-fg-3")}>
            {count.toLocaleString()}/{max.toLocaleString()}
          </span>
        </label>
        {!disabled && (
          <div className="flex items-center gap-2">
            {previous !== null && (
              <button
                type="button"
                onClick={() => {
                  onChange(previous);
                  setPrevious(null);
                }}
                className="text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline"
              >
                {t("studio.hashtagUndo")}
              </button>
            )}
            <button
              type="button"
              onClick={write}
              disabled={busy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-60"
            >
              {busy ? <Spinner className="size-3" /> : "✨"} {busy ? t("studio.rewriting") : t("studio.captionAuto")}
            </button>
          </div>
        )}
      </div>

      <textarea
        id="caption"
        rows={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("studio.captionPh")}
        className={cx(inputClass, "resize-y leading-relaxed", over && "border-bad")}
        disabled={disabled}
      />

      {!disabled &&
        (showHint ? (
          <input
            autoFocus
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.preventDefault(), write())}
            placeholder={t("studio.rewritePh")}
            maxLength={500}
            className={cx(inputClass, "mt-2 h-9 text-[13px]")}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowHint(true)}
            className="mt-1.5 text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline"
          >
            + {t("studio.captionHint")}
          </button>
        ))}
      {error && <p className="mt-1.5 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
