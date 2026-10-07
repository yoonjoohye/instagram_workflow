"use client";

/** 작업 공간 맨 위: 피드/스토리 · 컨셉 · 주제 메모. ✨ AI 버튼들(사진 수정·새 이미지·게시글·해시태그)이 참고합니다. */

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { Card, cx, inputClass, Notice, Segmented } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import type { Job, JobSettings } from "@/lib/types";
import { ConceptPicker, conceptFormat, conceptStyle, isTemplateKey } from "./ConceptPicker";
import { TEMPLATE_ICON, type TemplateKey } from "./templates";

export function WorkspaceSettings({ job, locked, onChange }: { job: Job; locked: boolean; onChange: (j: Job) => void }) {
  const t = useT();
  const s: JobSettings = job.settings ?? { post_type: "feed", topic: "", template: "auto", style: "", caption_format: "" };
  const template: TemplateKey = isTemplateKey(s.template) ? s.template : "auto";
  const [topic, setTopic] = useState(s.topic);
  const [error, setError] = useState<string>();
  useEffect(() => setTopic(s.topic), [job.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(patch: Partial<JobSettings> & { prompt?: string }) {
    setError(undefined);
    try {
      onChange(await api<Job>(`/studio/${job.id}/settings`, { method: "PATCH", json: patch }));
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
        <details className="rounded-lg border border-line px-3 py-2">
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
