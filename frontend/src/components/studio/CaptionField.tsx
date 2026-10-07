"use client";

/** 게시글(캡션) 본문 직접 쓰기: 글자 수(해시태그 포함 최종 길이) + 입력칸.
 *  AI 로 쓰기는 위의 CaptionAiPanel. */

import { useI18n } from "@/i18n/client";
import { cx, inputClass } from "@/components/ui";

export function CaptionField({
  value,
  onChange,
  count,
  max,
  disabled,
}: {
  value: string;
  onChange: (caption: string) => void;
  /** 해시태그까지 합친 최종 글자 수 */
  count: number;
  max: number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const over = count > max;
  return (
    <div>
      <label htmlFor="caption" className="mb-1.5 block text-[13px] font-medium text-fg-2">
        {t("studio.captionBody")}
        <span className={cx("tnum ml-1.5 text-[12px] font-normal", over ? "font-medium text-bad" : "text-fg-3")}>
          {count.toLocaleString()}/{max.toLocaleString()}
        </span>
      </label>
      <textarea
        id="caption"
        rows={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("studio.captionPh")}
        className={cx(inputClass, "resize-y leading-relaxed", over && "border-bad")}
        disabled={disabled}
      />
    </div>
  );
}
