"use client";

/** 컨셉 고르기: 묶음(일상·가게·정보) → 컨셉 카드 → 예시 주제. 만들기 화면과 작업 공간에서 함께 씁니다. */

import { useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { cx, Segmented } from "@/components/ui";
import { groupOf, TEMPLATE_GROUPS, TEMPLATE_ICON, type TemplateGroup, type TemplateKey } from "./templates";

export const conceptStyle = (t: (k: MessageKey) => string, key: TemplateKey) => (key === "auto" ? "" : t(`templates.${key}Style` as MessageKey));
export const conceptFormat = (t: (k: MessageKey) => string, key: TemplateKey) => (key === "auto" ? "" : t(`templates.${key}Format` as MessageKey));
export const isTemplateKey = (k: string): k is TemplateKey => k === "auto" || Object.values(TEMPLATE_GROUPS).some((g) => (g as readonly string[]).includes(k));

export function ConceptPicker({
  value,
  onChange,
  topic,
  onExample,
  disabled,
}: {
  value: TemplateKey;
  onChange: (key: TemplateKey) => void;
  /** 지금 주제 메모 — 같은 예시를 강조 */
  topic?: string;
  /** 예시 주제를 누르면 주제 메모로 */
  onExample?: (example: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [group, setGroup] = useState<TemplateGroup>(groupOf(value));
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-fg-2">{t("studio.templateLabel")}</span>
        <Segmented
          size="sm"
          ariaLabel={t("studio.templateLabel")}
          value={group}
          onChange={setGroup}
          options={(Object.keys(TEMPLATE_GROUPS) as TemplateGroup[]).map((g) => ({
            value: g,
            label: t(`templates.group${g[0].toUpperCase()}${g.slice(1)}` as MessageKey),
          }))}
        />
      </div>
      <div role="radiogroup" aria-label={t("studio.templateLabel")} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {(["auto", ...TEMPLATE_GROUPS[group]] as TemplateKey[]).map((key) => {
          const on = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(key)}
              className={cx(
                "flex min-w-0 flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                on ? "border-accent bg-accent/10" : "border-line-strong hover:bg-surface-2",
              )}
            >
              <span className="w-full truncate text-[13px] font-semibold">
                {TEMPLATE_ICON[key]} {t(`templates.${key}` as MessageKey)}
              </span>
              <span className="w-full truncate text-[11px] text-fg-3">{t(`templates.${key}Desc` as MessageKey)}</span>
            </button>
          );
        })}
      </div>
      {onExample && (
        <div>
          <p className="mb-1 text-[12px] text-fg-3">{t("templates.examples")}</p>
          <div className="flex flex-wrap gap-1.5">
            {t(`templates.${value}Ex` as MessageKey)
              .split(" | ")
              .map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={disabled}
                  onClick={() => onExample(ex)}
                  className={cx(
                    "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                    topic === ex ? "border-accent bg-accent/10 text-fg" : "border-line text-fg-2 hover:bg-surface-2",
                  )}
                >
                  {ex}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
