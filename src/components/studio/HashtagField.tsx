"use client";

/** 해시태그 입력: 칩으로 보여 주고(× 로 빼기), 입력칸에 적고 Enter·띄어쓰기·쉼표로 추가,
 *  '✨ 자동 생성'은 사진과 캡션을 보고 Gemini 가 골라 줍니다 (마음에 안 들면 되돌리기). */

import { useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { cx, Spinner } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import { parseHashtags } from "@/lib/format";

export function HashtagField({
  jobId,
  value,
  onChange,
  caption,
  max,
  disabled,
}: {
  jobId: number;
  value: string[];
  onChange: (tags: string[]) => void;
  caption: string;
  max: number;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [previous, setPrevious] = useState<string[] | null>(null);
  const over = value.length > max;

  const add = (text: string) => {
    const fresh = parseHashtags(text).filter((tag) => !value.some((v) => v.toLowerCase() === tag.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
    setDraft("");
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  async function generate() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ hashtags: string[] }>(`/studio/${jobId}/hashtags`, {
        method: "POST",
        json: { caption, language: locale },
      });
      setPrevious(value);
      onChange(r.hashtags);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor="tag-input" className="text-[13px] font-medium text-fg-2">
          {t("studio.hashtags")}
          <span className={cx("tnum ml-1.5 text-[12px] font-normal", over ? "font-medium text-bad" : "text-fg-3")}>
            {value.length}/{max}
          </span>
        </label>
        {!disabled && (
          <div className="flex items-center gap-2">
            {previous && (
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
              onClick={generate}
              disabled={busy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-60"
            >
              {busy ? <Spinner className="size-3" /> : "✨"} {busy ? t("studio.hashtagGenerating") : t("studio.hashtagGenerate")}
            </button>
          </div>
        )}
      </div>

      {/* 칩 + 입력칸이 한 상자처럼 보이게 */}
      <div
        onClick={() => input.current?.focus()}
        className={cx(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-surface-1 px-2 py-1.5 focus-within:border-accent",
          over ? "border-bad" : "border-line",
          disabled && "opacity-70",
        )}
      >
        {value.map((tag, i) => (
          <span key={`${tag}-${i}`} className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 py-0.5 pr-1 pl-2 text-[13px] text-fg">
            #{tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                aria-label={t("studio.hashtagRemove", { tag })}
                className="inline-flex size-5 items-center justify-center rounded-full text-[11px] text-fg-3 hover:bg-surface-2 hover:text-fg"
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            id="tag-input"
            ref={input}
            value={draft}
            onChange={(e) => {
              const v = e.target.value;
              // 띄어쓰기·쉼표를 치면 바로 칩으로 (붙여넣은 '#a #b' 도)
              if (/[\s,]$/.test(v) && v.trim()) add(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return; // 한글 조합 중
              if (e.key === "Enter") {
                e.preventDefault();
                if (draft.trim()) add(draft);
              } else if (e.key === "Backspace" && !draft && value.length) {
                remove(value.length - 1);
              }
            }}
            onBlur={() => draft.trim() && add(draft)}
            placeholder={value.length ? "" : t("studio.hashtagPh")}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-[13px] outline-none placeholder:text-fg-3"
          />
        )}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-bad">{error}</p>}
    </div>
  );
}
