"use client";

/** 게시글(캡션) 입력: 위에 글자 수·되돌리기, 가운데 입력칸, 아래 ✨ AI 작성 상자.
 *  AI 상자: 말투(반말/해요체)·길이를 고르고, 바라는 점을 적어 '자동 작성'을 누르면 사진·컨셉을 보고 씁니다.
 *  적은 바라는 점은 입력칸에서 비우고 '바란 점' 기록(접기)에 남겨, 다음 자동 작성에도 계속 반영됩니다 (✕ 로 빼기). */

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { cx, inputClass, Segmented, Spinner } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import type { CaptionLength, CaptionTone, JobSettings } from "@/lib/types";

type CaptionPrefs = Pick<JobSettings, "caption_tone" | "caption_length" | "caption_requests">;

export function CaptionField({
  jobId,
  value,
  onChange,
  onHashtags,
  count,
  max,
  disabled,
  prefs,
  onPrefs,
  onRequests,
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
  prefs: CaptionPrefs;
  /** 말투·길이·바란 점을 바꿔 서버에 저장 */
  onPrefs: (patch: CaptionPrefs) => Promise<void>;
  /** 자동 작성 뒤 서버에 기록된 바란 점 */
  onRequests: (requests: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [previous, setPrevious] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const over = count > max;
  const tone = prefs.caption_tone ?? "casual";
  const length = prefs.caption_length ?? "auto";
  const requests = prefs.caption_requests ?? [];

  async function write() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ caption: string; hashtags: string[]; requests: string[] }>(`/studio/${jobId}/caption`, {
        method: "POST",
        json: { instruction: wish.trim(), caption: value, language: locale },
      });
      setPrevious(value);
      onChange(r.caption);
      if (r.hashtags.length) onHashtags?.(r.hashtags);
      if (wish.trim()) {
        setWish("");
        onRequests(r.requests);
      }
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: CaptionPrefs) {
    setError(undefined);
    try {
      await onPrefs(patch);
    } catch (e) {
      setError(toApiError(e).message);
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
        {!disabled && previous !== null && (
          <button
            type="button"
            onClick={() => {
              onChange(previous);
              setPrevious(null);
            }}
            className="text-[12px] text-fg-3 underline-offset-2 hover:text-fg hover:underline"
          >
            ↩ {t("studio.hashtagUndo")}
          </button>
        )}
      </div>

      <textarea
        id="caption"
        rows={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("studio.captionPh")}
        className={cx(inputClass, "resize-y leading-relaxed", over && "border-bad")}
        disabled={disabled || busy}
      />

      {!disabled && (
        <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface-2/60 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[12px] font-medium text-fg-2">✨ {t("studio.captionAi")}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-fg-3">{t("studio.captionTone")}</span>
              <Segmented<CaptionTone>
                size="sm"
                ariaLabel={t("studio.captionTone")}
                value={tone}
                onChange={(v) => v !== tone && save({ caption_tone: v })}
                options={[
                  { value: "casual", label: t("studio.toneCasual") },
                  { value: "polite", label: t("studio.tonePolite") },
                ]}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-fg-3">{t("studio.captionLength")}</span>
              <Segmented<CaptionLength>
                size="sm"
                ariaLabel={t("studio.captionLength")}
                value={length}
                onChange={(v) => v !== length && save({ caption_length: v })}
                options={[
                  { value: "auto", label: t("studio.lengthAuto") },
                  { value: "short", label: t("studio.lengthShort") },
                  { value: "medium", label: t("studio.lengthMedium") },
                  { value: "long", label: t("studio.lengthLong") },
                ]}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <input
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && !busy && (e.preventDefault(), write())}
              placeholder={t("studio.rewritePh")}
              aria-label={t("studio.rewritePh")}
              maxLength={500}
              disabled={busy}
              className={cx(inputClass, "h-9 min-w-0 flex-1 text-[13px]")}
            />
            <button
              type="button"
              onClick={write}
              disabled={busy}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-on-accent hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Spinner className="size-3.5" /> : "✨"} {busy ? t("studio.rewriting") : t("studio.captionAuto")}
            </button>
          </div>
          <p className="-mt-1 text-[11px] text-fg-3">{t("studio.captionAiHint")}</p>

          {requests.length > 0 && (
            <div className="border-t border-line pt-2">
              <button
                type="button"
                onClick={() => setShowLog((v) => !v)}
                aria-expanded={showLog}
                className="flex w-full items-center gap-1.5 text-left text-[12px] font-medium text-fg-2 hover:text-fg"
              >
                <span className={cx("inline-block transition-transform", showLog && "rotate-90")}>▸</span>
                {t("studio.captionRequests", { n: requests.length })}
                <span className="font-normal text-fg-3">· {t("studio.captionRequestsHint")}</span>
              </button>
              {showLog && (
                <ul className="mt-2 space-y-1">
                  {requests.map((r, i) => (
                    <li key={`${i}-${r}`} className="flex items-start gap-2 rounded-md bg-surface-1 px-2.5 py-1.5 text-[12px] text-fg-2">
                      <span className="min-w-0 flex-1 break-words">{r}</span>
                      <button
                        type="button"
                        onClick={() => save({ caption_requests: requests.filter((_, j) => j !== i) })}
                        aria-label={t("studio.captionRequestRemove")}
                        className="shrink-0 text-fg-3 hover:text-bad"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
