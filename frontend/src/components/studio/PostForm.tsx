"use client";

/** 만들기 시작: 피드/스토리 · 컨셉 · 주제 메모(선택)를 정하고 사진·동영상을 고르면 바로 작업 공간으로.
 *  꾸미기는 작업 공간에서 사진·영상·게시글·해시태그마다 ✨ AI / ✏️ 직접 편집 버튼으로 합니다. */

import { useRef, useState } from "react";
import { PhotoLibraryPanel } from "@/components/studio/PhotoLibraryPanel";
import { Card, cx, Field, inputClass, Notice, Segmented } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";
import { isMedia, MAX_VIDEO_MB, tooBig, uploadMedia, type UploadStep } from "@/lib/mediaUpload";
import * as photoLib from "@/lib/photoLibrary";
import type { Job } from "@/lib/types";
import { ConceptPicker, conceptFormat, conceptStyle } from "./ConceptPicker";
import type { TemplateKey } from "./templates";

const MAX_MEDIA = 10; // backend/routers/studio.py 의 MAX_MEDIA 와 같게

/** 만들기 전 오른쪽 미리보기에 쓰는 지금 입력값 */
export type Draft = { media: { url: string; kind: "image" | "video" }[]; prompt: string; postType: "feed" | "story" };

export function PostForm({ onCreated, onDraft }: { onCreated: (job: Job) => void; onDraft?: (d: Draft) => void }) {
  const { t, locale } = useI18n();
  const [prompt, setPromptState] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("auto");
  const [postType, setPostTypeState] = useState<"feed" | "story">("feed");
  const [style, setStyle] = useState("");
  const [format, setFormat] = useState("");
  const [step, setStep] = useState<UploadStep | null>(null);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [libNotice, setLibNotice] = useState<{ tone: "good" | "warn"; text: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = step !== null;

  const setPrompt = (v: string) => {
    setPromptState(v);
    onDraft?.({ media: [], prompt: v, postType });
  };
  const setPostType = (v: "feed" | "story") => {
    setPostTypeState(v);
    onDraft?.({ media: [], prompt, postType: v });
  };

  // 직접 적은 연출 방향·캡션 양식이 컨셉보다 우선
  const effStyle = style.trim() || conceptStyle(t, template);
  const effFormat = format.trim() || conceptFormat(t, template);

  /** 사진·동영상을 올리고 작업을 만들어 바로 작업 공간으로 (파일이 없으면 빈 작업 → AI 로 이미지 만들기) */
  async function start(files: File[]) {
    const big = files.filter(tooBig);
    if (big.length) setError(t("studio.videoTooBig", { mb: MAX_VIDEO_MB }));
    const usable = files.filter((f) => isMedia(f) && !tooBig(f)).slice(0, MAX_MEDIA);
    if (files.length && !usable.length) return;
    if (!big.length) setError(undefined);
    try {
      const ids = await uploadMedia(usable, t, setStep);
      setStep({ label: t("studio.stepOpenWorkspace"), done: 1, total: 1 });
      onCreated(
        await api<Job>("/studio/manual", {
          method: "POST",
          json: {
            upload_ids: ids,
            post_type: postType,
            prompt: prompt.trim(),
            style: effStyle,
            caption_format: postType === "story" ? "" : effFormat,
            template,
            language: locale,
          },
        }),
      );
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setStep(null);
    }
  }

  /** 연결한 사진 폴더에서 주제에 맞는 사진을 찾아 바로 시작 */
  async function findFromLibrary() {
    if (prompt.trim().length < 2) return setError(t("studio.libNeedTopic"));
    setError(undefined);
    setLibNotice(undefined);
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      setStep({ label: t("studio.stepFindPhotos"), done: 0, total: 1 });
      const query = await api<photoLib.PhotoQuery>("/studio/photo-query", { method: "POST", json: { prompt: prompt.trim(), today } });
      const matches = await photoLib.search(query);
      const files = await Promise.all(matches.map((m) => photoLib.fileFor(m.path)));
      setStep(null);
      if (!files.length) return setLibNotice({ tone: "warn", text: t("studio.libNoneFound") });
      await start(files);
    } catch (e) {
      setStep(null);
      setError(toApiError(e).message);
    }
  }

  return (
    <Card title={t("studio.startTitle")} subtitle={t("studio.startSubtitle")} className="h-fit">
      <div className="space-y-5">
        <Segmented
          ariaLabel={t("studio.postTypeLabel")}
          value={postType}
          onChange={setPostType}
          options={[
            { value: "feed", label: t("studio.postTypeFeed") },
            { value: "story", label: t("studio.postTypeStory") },
          ]}
        />
        {postType === "story" && <p className="-mt-3 text-[12px] leading-relaxed text-fg-3">{t("studio.storyHint")}</p>}

        <ConceptPicker value={template} onChange={setTemplate} topic={prompt} onExample={setPrompt} disabled={busy} />

        <Field label={t("studio.topicLabelOptional")} htmlFor="cn-prompt" hint={t("studio.topicHintOptional")}>
          <textarea
            id="cn-prompt"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("studio.topicPlaceholderSimple")}
            className={cx(inputClass, "resize-y text-[15px]")}
            disabled={busy}
          />
        </Field>

        <details className="rounded-lg border border-line px-3 py-2" open={Boolean(style.trim() || format.trim()) || undefined}>
          <summary className="cursor-pointer text-[13px] font-medium text-fg-2">{t("studio.advancedSimple")}</summary>
          <div className="mt-3 space-y-4">
            <Field label={t("studio.styleLabel")} htmlFor="cn-style" hint={t("studio.styleHintAdvanced")}>
              <textarea
                id="cn-style"
                rows={3}
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={conceptStyle(t, template) || t("studio.stylePlaceholder")}
                className={cx(inputClass, "resize-y leading-relaxed")}
                disabled={busy}
              />
            </Field>
            {postType === "feed" && (
              <Field label={t("studio.formatLabel")} htmlFor="cn-format" hint={t("studio.formatHint")}>
                <textarea
                  id="cn-format"
                  rows={4}
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  placeholder={conceptFormat(t, template) || t("studio.formatPlaceholder")}
                  className={cx(inputClass, "resize-y font-mono text-[12px]")}
                  disabled={busy}
                />
              </Field>
            )}
          </div>
        </details>

        <PhotoLibraryPanel busy={busy} canFind={prompt.trim().length >= 2} onReadyChange={() => {}} onFind={findFromLibrary} />
        {libNotice && <Notice tone={libNotice.tone}>{libNotice.text}</Notice>}

        {/* 사진·동영상을 고르면 바로 작업 공간으로 */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) start(Array.from(e.dataTransfer.files));
          }}
          className={cx("rounded-lg border-2 border-dashed transition-colors", dragging ? "border-accent bg-accent/5" : "border-line-strong")}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-md px-3 py-6 text-center hover:bg-surface-2 disabled:opacity-60"
          >
            <span className="text-2xl" aria-hidden>
              🖼️
            </span>
            <span className="text-[14px] font-semibold">{t("studio.pickMedia")}</span>
            <span className="text-[12px] text-fg-3">{t("studio.pickMediaHint", { max: MAX_MEDIA })}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) start(files);
            }}
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => start([])}
          className="w-full rounded-lg border border-line py-2.5 text-[13px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-60"
        >
          ✨ {t("studio.startWithAi")}
        </button>

        {error && <Notice tone="bad">{error}</Notice>}
        {step && (
          <div className="space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="font-medium">{step.label}…</span>
              <span className="tnum text-fg-3">
                {step.done}/{step.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(step.done / Math.max(step.total, 1)) * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
