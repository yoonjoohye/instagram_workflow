"use client";

/** 작업 공간 맨 위: 피드/스토리 · 컨셉 · 주제 메모. ✨ AI 버튼들(사진 수정·새 이미지·게시글·해시태그)이 참고합니다.
 *  저장 방법은 부르는 쪽이 정합니다 (작업이 있으면 서버에, 새로 만드는 중이면 화면에만). */

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { Card, cx, inputClass, Notice, Segmented } from "@/components/ui";
import { toApiError } from "@/lib/api";
import type { JobSettings } from "@/lib/types";
import { ConceptPicker, conceptFormat, conceptStyle, isTemplateKey } from "./ConceptPicker";
import { TEMPLATE_ICON, type TemplateKey } from "./templates";

export const DEFAULT_SETTINGS: JobSettings = { post_type: "feed", topic: "", template: "auto", style: "", caption_format: "" };
export type SettingsPatch = Partial<Omit<JobSettings, "topic">> & { prompt?: string };

export function WorkspaceSettings({
  settings,
  locked,
  onSave,
  defaultOpen = false,
  resetKey,
}: {
  settings: JobSettings;
  locked: boolean;
  onSave: (patch: SettingsPatch) => Promise<void> | void;
  /** 새로 만들 때는 컨셉 고르기를 펼쳐 둠 */
  defaultOpen?: boolean;
  /** 다른 작업을 열면 주제 입력칸을 다시 채움 */
  resetKey?: string | number;
}) {
  const t = useT();
  const s = settings;
  const template: TemplateKey = isTemplateKey(s.template) ? s.template : "auto";
  const [topic, setTopic] = useState(s.topic);
  const [error, setError] = useState<string>();
  useEffect(() => setTopic(s.topic), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: SettingsPatch) {
    setError(undefined);
    try {
      await onSave(patch);
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  const summary = `${TEMPLATE_ICON[template]} ${t(`templates.${template}` as MessageKey)}${s.topic ? ` · ${s.topic}` : ""}`;

  return (
    <Card title={t("studio.workspaceSettings")} subtitle={t("studio.workspaceSettingsHint")}>
      <div className="space-y-4">
        <Segmented
          ariaLabel={t("studio.postTypeLabel")}
          value={s.post_type}
          onChange={(v) => !locked && save({ post_type: v })}
          options={[
            { value: "feed", label: t("studio.postTypeFeed") },
            { value: "story", label: t("studio.postTypeStory") },
          ]}
        />
        {s.post_type === "story" && <p className="-mt-2 text-[12px] leading-relaxed text-fg-3">{t("studio.storyHint")}</p>}
        <details className="rounded-lg border border-line px-3 py-2" open={defaultOpen || undefined}>
          <summary className="cursor-pointer truncate text-[13px] font-medium text-fg-2">{summary}</summary>
          <div className="mt-3 space-y-4">
            <ConceptPicker
              value={template}
              disabled={locked}
              onChange={(key) => save({ template: key, style: conceptStyle(t, key), caption_format: conceptFormat(t, key) })}
              topic={topic}
              onExample={(ex) => {
                setTopic(ex);
                save({ prompt: ex });
              }}
            />
            <div>
              <label htmlFor="ws-topic" className="mb-1.5 block text-[13px] font-medium text-fg-2">
                {t("studio.topicLabelOptional")}
              </label>
              <textarea
                id="ws-topic"
                rows={2}
                value={topic}
                disabled={locked}
                onChange={(e) => setTopic(e.target.value)}
                onBlur={() => topic !== s.topic && save({ prompt: topic })}
                placeholder={t("studio.topicPlaceholderSimple")}
                className={cx(inputClass, "resize-y")}
              />
              <p className="mt-1 text-[12px] text-fg-3">{t("studio.topicHintOptional")}</p>
            </div>
          </div>
        </details>
        {error && <Notice tone="bad">{error}</Notice>}
      </div>
    </Card>
  );
}
