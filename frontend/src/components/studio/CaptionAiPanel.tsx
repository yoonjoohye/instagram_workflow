"use client";

/** 캡션·게시 맨 위: ✨ AI 로 쓰기. 말투·길이 → 바라는 점 → [게시글 자동 작성] (본문과 해시태그를 함께 씀).
 *  바라는 점은 적고 작성하면 입력칸에서 비우고 '바란 점' 기록(접기)에 남겨, 다음 자동 작성에도 계속 반영됩니다 (✕ 로 빼기).
 *  직접 쓰는 본문·해시태그 입력은 이 아래 (CaptionField · HashtagField). */

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { cx, inputClass, Segmented, Spinner } from "@/components/ui";
import { toApiError } from "@/lib/api";
import type { CaptionLength, CaptionTone, JobSettings } from "@/lib/types";

export type CaptionPrefs = Pick<JobSettings, "caption_tone" | "caption_length" | "caption_requests">;
export type CaptionWritten = { caption: string; hashtags: string[]; requests: string[] };

/** 작업이 있으면 그 작업의 사진까지 보고, 새로 만드는 중이면 컨셉·주제만 보고 씁니다 (부르는 쪽이 정함). */
export type CaptionAi = {
  write: (v: { instruction: string; caption: string; language: string }) => Promise<CaptionWritten>;
};

export function CaptionAiPanel({
  ai,
  caption,
  onCaption,
  hashtags,
  onHashtags,
  prefs,
  onPrefs,
  onRequests,
}: {
  ai: CaptionAi;
  caption: string;
  onCaption: (caption: string) => void;
  hashtags: string[];
  onHashtags: (tags: string[]) => void;
  prefs: CaptionPrefs;
  /** 말투·길이·바란 점을 바꿔 서버에 저장 */
  onPrefs: (patch: CaptionPrefs) => Promise<void>;
  /** 자동 작성 뒤 서버에 기록된 바란 점 */
  onRequests: (requests: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState<"caption">();
  const [error, setError] = useState<string>();
  // 되돌리기: 자동 작성 전의 본문과 해시태그
  const [prev, setPrev] = useState<{ caption: string; hashtags: string[] } | null>(null);
  const [showLog, setShowLog] = useState(false);
  const tone = prefs.caption_tone ?? "casual";
  const length = prefs.caption_length ?? "auto";
  const requests = prefs.caption_requests ?? [];

  async function writeCaption() {
    setBusy("caption");
    setError(undefined);
    try {
      const r = await ai.write({ instruction: wish.trim(), caption, language: locale });
      setPrev({ caption, hashtags });
      onCaption(r.caption);
      // 해시태그도 새 글에 맞춰 함께 (양식 안에 해시태그 칸이 있으면 본문에 들어가 빈 목록으로 옴)
      if (r.hashtags.length) onHashtags(r.hashtags);
      if (wish.trim()) {
        setWish("");
        onRequests(r.requests);
      }
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
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

  const aiButton = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium disabled:opacity-60";
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface-2/60 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[13px] font-semibold text-fg">✨ {t("studio.captionAi")}</span>
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

      <input
        value={wish}
        onChange={(e) => setWish(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && !busy && (e.preventDefault(), writeCaption())}
        placeholder={t("studio.rewritePh")}
        aria-label={t("studio.rewritePh")}
        maxLength={500}
        disabled={!!busy}
        className={cx(inputClass, "h-9 text-[13px]")}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={writeCaption} disabled={!!busy} className={cx(aiButton, "bg-accent text-on-accent hover:opacity-90")}>
          {busy === "caption" ? <Spinner className="size-3.5" /> : "✨"} {busy === "caption" ? t("studio.rewriting") : t("studio.captionAutoFull")}
        </button>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-fg-3">
          {prev && (
            <button
              type="button"
              onClick={() => {
                onCaption(prev.caption);
                onHashtags(prev.hashtags);
                setPrev(null);
              }}
              className="underline-offset-2 hover:text-fg hover:underline"
            >
              ↩ {t("studio.hashtagUndo")}
            </button>
          )}
        </div>
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
      {error && <p className="text-[12px] text-bad">{error}</p>}
    </section>
  );
}
