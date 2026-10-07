"use client";

/** 해시태그 직접 입력: 칩으로 보여 주고(× 로 빼기), 입력칸에 적고 Enter·띄어쓰기·쉼표로 추가.
 *  AI 자동 생성은 위의 CaptionAiPanel. */

import { useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { cx } from "@/components/ui";
import { parseHashtags } from "@/lib/format";

export function HashtagField({
  value,
  onChange,
  max,
  disabled,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  max: number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const over = value.length > max;

  const add = (text: string) => {
    const fresh = parseHashtags(text).filter((tag) => !value.some((v) => v.toLowerCase() === tag.toLowerCase()));
    if (fresh.length) onChange([...value, ...fresh]);
    setDraft("");
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div>
      <label htmlFor="tag-input" className="mb-1.5 block text-[13px] font-medium text-fg-2">
        {t("studio.hashtags")}
        <span className={cx("tnum ml-1.5 text-[12px] font-normal", over ? "font-medium text-bad" : "text-fg-3")}>
          {value.length}/{max}
        </span>
      </label>

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
    </div>
  );
}
