"use client";

import { upload as blobUpload } from "@vercel/blob/client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { api, toApiError, useApi } from "@/lib/api";
import type { Job } from "@/lib/types";
import { IconSpark } from "@/components/icons";
import * as photoLib from "@/lib/photoLibrary";
import { PhotoLibraryPanel } from "@/components/studio/PhotoLibraryPanel";
import { Badge, Button, Card, cx, Field, inputClass, Notice, Segmented } from "@/components/ui";
import { groupOf, TEMPLATE_GROUPS, TEMPLATE_ICON, type TemplateGroup, type TemplateKey } from "@/components/studio/templates";
import { captureCover, uploadImageBlob, uploadPhoto } from "@/lib/uploads";
import { moveItem, useDragSort } from "@/lib/useDragSort";

const MAX_PHOTOS = 8;

// 올릴 수 있는 사진·동영상 수 (게시물은 최대 10장까지 Gemini가 구성)
const MAX_VIDEO_MB = 300;

// src/app/api/blob/upload/route.ts 와 같게
const MAX_REFS = 3;

type Research = { notes: string; sources: { title: string; uri: string }[]; warning: string };

type Photo = { key: string; file: File; preview: string; kind: "image" | "video"; auto?: boolean };

// auto = 폴더에서 자동으로 고름
type Step = { label: string; done: number; total: number };

export function PostForm({ onCreated }: { onCreated: (job: Job) => void }) {
  const { t, locale } = useI18n();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [refs, setRefs] = useState<Photo[]>([]);
  const [format, setFormat] = useState("");
  const refInput = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState<TemplateKey>("auto");
  const [group, setGroup] = useState<TemplateGroup>(groupOf("auto"));
  const [postType, setPostType] = useState<"feed" | "story">("feed");
  const [font, setFont] = useState("auto");
  const fonts = useApi<{ data: { key: string; label: string; preview: string }[] }>("/studio/fonts");
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [libReady, setLibReady] = useState(false);
  const [libNotice, setLibNotice] = useState<{ tone: "good" | "warn"; text: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = step !== null;

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | File[]) {
    const all = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const tooBig = all.filter((f) => f.type.startsWith("video/") && f.size > MAX_VIDEO_MB * 1024 * 1024);
    if (tooBig.length) setError(t("studio.videoTooBig", { mb: MAX_VIDEO_MB }));
    const files = all.filter((f) => !tooBig.includes(f));
    setPhotos((prev) => {
      const room = MAX_PHOTOS - prev.length;
      if (files.length > room) setError(t("studio.maxPhotos", { max: MAX_PHOTOS }));
      return [
        ...prev,
        ...files.slice(0, Math.max(0, room)).map((file) => ({
          key: `${file.name}-${file.size}-${Math.random()}`,
          file,
          preview: URL.createObjectURL(file),
          kind: file.type.startsWith("video/") ? ("video" as const) : ("image" as const),
        })),
      ];
    });
  }

  const { drag, sortProps } = useDragSort((from, to) => setPhotos((prev) => moveItem(prev, from, to)), busy);

  const move = (i: number, d: -1 | 1) =>
    setPhotos((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) =>
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, k) => k !== i);
    });

  function addRefs(list: FileList) {
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setRefs((prev) => [
      ...prev,
      ...images.slice(0, Math.max(0, MAX_REFS - prev.length)).map((file) => ({
        key: `${file.name}-${Math.random()}`,
        file,
        preview: URL.createObjectURL(file),
        kind: "image" as const,
      })),
    ]);
  }

  /** 연결한 사진 폴더에서 주제에 맞는 사진을 찾아 목록에 넣습니다 (직접 고른 사진은 그대로 두고 자동 선택만 교체). */
  async function findFromLibrary(): Promise<Photo[]> {
    if (prompt.trim().length < 2) {
      setError(t("studio.libNeedTopic"));
      return photos;
    }
    setLibNotice(undefined);
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const query = await api<photoLib.PhotoQuery>("/studio/photo-query", { method: "POST", json: { prompt: prompt.trim(), today } });
    const matches = await photoLib.search(query);
    const files = await Promise.all(matches.map((m) => photoLib.fileFor(m.path)));
    const found: Photo[] = files.map((file) => ({
      key: `auto-${file.name}-${file.size}-${Math.random()}`,
      file,
      preview: URL.createObjectURL(file),
      kind: "image",
      auto: true,
    }));
    const next = [...photos.filter((p) => !p.auto), ...found].slice(0, MAX_PHOTOS);
    photos.filter((p) => p.auto).forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos(next);
    setLibNotice(found.length ? { tone: "good", text: t("studio.libFound", { n: found.length }) } : { tone: "warn", text: t("studio.libNoneFound") });
    return next;
  }

  /** 동영상: 대표 화면 → 사진처럼 업로드, 원본은 Blob 저장소에 직접 업로드 → 서버에 등록 */
  async function uploadVideo(file: File, index: number, total: number): Promise<string> {
    setStep({ label: t("studio.stepCover"), done: index, total });
    const cover = await captureCover(file, t);
    const coverId = await uploadImageBlob(cover.image, file.name, t);
    let url: string;
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const blob = await blobUpload(`videos/${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: ({ percentage }) =>
          setStep({ label: t("studio.stepUploadVideo", { pct: Math.round(percentage) }), done: index, total }),
      });
      url = blob.url;
    } catch (err) {
      throw new Error(t("studio.videoUploadFailed", { e: err instanceof Error ? err.message : String(err) }));
    }
    const video = await api<{ id: string }>("/media/videos", {
      method: "POST",
      json: { url, cover_id: coverId, width: cover.width, height: cover.height, content_type: file.type || "video/mp4" },
    });
    return video.id;
  }

  async function uploadAll(items: Photo[]): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "video") {
        ids.push(await uploadVideo(item.file, i, items.length));
        continue;
      }
      setStep({ label: t("studio.stepUploadPhotos"), done: i, total: items.length });
      ids.push(await uploadPhoto(item.file, t));
    }
    return ids;
  }

  /** AI 없이: 고른 사진·동영상 그대로 작업 공간을 열어 직접 꾸밉니다 (Gemini 를 쓰지 않음). */
  async function startManual() {
    if (!photos.length) return setError(t("studio.manualNeedsMedia"));
    setError(undefined);
    try {
      const ids = await uploadAll(photos);
      setStep({ label: t("studio.stepFinalize"), done: 1, total: 1 });
      onCreated(await api<Job>("/studio/manual", { method: "POST", json: { upload_ids: ids, post_type: postType, prompt: prompt.trim() } }));
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setStep(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (prompt.trim().length < 2) return setError(t("studio.topicRequired"));
    setError(undefined);
    try {
      // 사진을 고르지 않았고 사진 폴더가 연결돼 있으면, 주제에 맞는 사진을 먼저 자동으로 찾습니다.
      let items = photos;
      if (!items.length && libReady) {
        setStep({ label: t("studio.stepFindPhotos"), done: 0, total: 1 });
        items = await findFromLibrary();
      }
      const ids = await uploadAll(items);
      const refIds: string[] = [];
      for (let i = 0; i < refs.length; i++) {
        setStep({ label: t("studio.stepUploadRefs"), done: i, total: refs.length });
        refIds.push(await uploadPhoto(refs[i].file, t));
      }
      setStep({ label: t("studio.stepResearch"), done: 0, total: 1 });
      const research = await api<Research>("/studio/research", {
        method: "POST",
        json: { prompt: prompt.trim(), caption_format: effFormat, style: effStyle, language: locale },
      });
      setStep({ label: t("studio.stepPlan"), done: 0, total: 1 });
      const plan = await api<{ job: Job; slides: { role: string }[]; warning: string }>("/studio/plan", {
        method: "POST",
        json: {
          upload_ids: ids,
          reference_ids: refIds,
          prompt: prompt.trim(),
          style: effStyle,
          caption_format: postType === "story" ? "" : effFormat,
          post_type: postType,
          research_notes: research.notes,
          sources: research.sources,
          font,
          language: locale,
        },
      });
      const total = plan.slides.length;
      for (let i = 0; i < total; i++) {
        const role = plan.slides[i].role;
        setStep({ label: t(role === "photo" ? "studio.stepPhoto" : "studio.stepDesigned", { n: i + 1 }), done: i, total });
        try {
          await api(`/studio/${plan.job.id}/slides/${i}`, { method: "POST", json: {} });
        } catch {
          await api(`/studio/${plan.job.id}/slides/${i}`, { method: "POST", json: {} }); // 한 번 재시도
        }
      }
      setStep({ label: t("studio.stepFinalize"), done: total, total });
      onCreated(await api<Job>(`/studio/${plan.job.id}/finalize`, { method: "POST" }));
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setStep(null);
    }
  }

  // 직접 적은 연출 방향·캡션 양식이 템플릿보다 우선
  const tplStyle = template === "auto" ? "" : t(`templates.${template}Style` as MessageKey);
  const tplFormat = template === "auto" ? "" : t(`templates.${template}Format` as MessageKey);
  const effStyle = style.trim() ? style : tplStyle;
  const effFormat = format.trim() ? format : tplFormat;

  return (
    <Card
      title={t("studio.formTitle")}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {t("studio.formSubtitle")}
          <Badge tone="accent">Gemini</Badge>
        </span>
      }
      className="h-fit"
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label={t("studio.topicLabel")} htmlFor="cn-prompt" hint={t("studio.topicHintSimple")}>
          <textarea
            id="cn-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("studio.topicPlaceholderSimple")}
            className={cx(inputClass, "resize-y text-[15px]")}
            disabled={busy}
          />
        </Field>

        {/* 컨셉: 묶음별로 골라 연출 방향·캡션 양식을 채우고, 예시 주제를 눌러 바로 쓸 수 있게 */}
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
              const on = template === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={busy}
                  onClick={() => setTemplate(key)}
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
          <div>
            <p className="mb-1 text-[12px] text-fg-3">{t("templates.examples")}</p>
            <div className="flex flex-wrap gap-1.5">
              {t(`templates.${template}Ex` as MessageKey)
                .split(" | ")
                .map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    disabled={busy}
                    onClick={() => setPrompt(ex)}
                    className={cx(
                      "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      prompt === ex ? "border-accent bg-accent/10 text-fg" : "border-line text-fg-2 hover:bg-surface-2",
                    )}
                  >
                    {ex}
                  </button>
                ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Segmented
            ariaLabel={t("studio.postTypeLabel")}
            value={postType}
            onChange={setPostType}
            options={[
              { value: "feed", label: t("studio.postTypeFeed") },
              { value: "story", label: t("studio.postTypeStory") },
            ]}
          />
          {postType === "story" && <p className="text-[12px] leading-relaxed text-fg-3">{t("studio.storyHint")}</p>}
        </div>

        <PhotoLibraryPanel
          busy={busy}
          canFind={prompt.trim().length >= 2}
          onReadyChange={setLibReady}
          onFind={async () => {
            setError(undefined);
            try {
              await findFromLibrary();
            } catch (e) {
              setError(toApiError(e).message);
            }
          }}
        />
        {libNotice && <Notice tone={libNotice.tone}>{libNotice.text}</Notice>}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cx(
            "rounded-lg border-2 border-dashed p-3 transition-colors",
            dragging ? "border-accent bg-accent/5" : "border-line-strong",
          )}
        >
          {photos.length > 0 && (
            <ol className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((p, i) => (
                <li
                  key={p.key}
                  title={p.file.name}
                  {...sortProps(i)}
                  className={cx(
                    "group relative aspect-square cursor-grab touch-manipulation overflow-hidden rounded-md bg-surface-2 transition-[opacity,box-shadow] select-none [-webkit-touch-callout:none]",
                    drag?.from === i && "opacity-40",
                    drag && drag.over === i && drag.from !== i && "ring-2 ring-accent ring-offset-2 ring-offset-surface-1",
                  )}
                >
                  {p.kind === "video" ? (
                    <video src={p.preview} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.preview} alt="" draggable={false} className="size-full object-cover" />
                  )}
                  <span className="tnum absolute top-1 left-1 rounded bg-black/60 px-1 text-[11px] text-white">
                    {i + 1}
                    {p.kind === "video" && ` · ▶ ${t("studio.videoBadge")}`}
                    {p.auto && ` · ${t("studio.libAutoBadge")}`}
                  </span>
                  {!busy && (
                    <span className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-0.5 py-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
                      <button type="button" onClick={() => move(i, -1)} className="flex h-7 min-w-7 items-center justify-center px-1.5 text-[13px] text-white" aria-label={t("studio.moveEarlier")}>
                        ←
                      </button>
                      <button type="button" onClick={() => remove(i)} className="flex h-7 min-w-7 items-center justify-center px-1.5 text-[13px] text-white" aria-label={t("common.delete")}>
                        ✕
                      </button>
                      <button type="button" onClick={() => move(i, 1)} className="flex h-7 min-w-7 items-center justify-center px-1.5 text-[13px] text-white" aria-label={t("studio.moveLater")}>
                        →
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            disabled={busy || photos.length >= MAX_PHOTOS}
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-md py-3 text-[13px] text-fg-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {photos.length ? t("studio.addPhotos", { n: photos.length, max: MAX_PHOTOS }) : t("studio.dropPhotos", { max: MAX_PHOTOS })}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <p className="-mt-3 text-[12px] text-fg-3">
          {photos.some((p) => p.kind === "video") ? t("studio.videoNote") : t("studio.photosNote")}
        </p>


        <details className="group rounded-lg border border-line px-3 py-2" open={Boolean(style.trim() || format.trim() || refs.length || font !== "auto") || undefined}>
          <summary className="cursor-pointer text-[13px] font-medium text-fg-2">{t("studio.advanced")}</summary>
          <div className="mt-4 space-y-5">
        <div className="space-y-2">
          <Field
            label={t("studio.styleLabel")}
            htmlFor="cn-style"
            hint={t("studio.styleHintAdvanced")}
          >
            <textarea
              id="cn-style"
              rows={4}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder={tplStyle || t("studio.stylePlaceholder")}
              className={cx(inputClass, "resize-y leading-relaxed")}
              disabled={busy}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {refs.map((r, i) => (
              <span key={r.key} className="group relative size-14 overflow-hidden rounded-md border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.preview} alt="" className="size-full object-cover" />
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setRefs((prev) => prev.filter((_, k) => k !== i))}
                    className={cx(
                      "absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-full bg-black/65 text-[11px] text-white",
                      // 마우스가 있으면 올렸을 때만, 터치 화면에서는 항상 보이게
                      "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
                    )}
                    aria-label={t("studio.removeRef")}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {refs.length < MAX_REFS && (
              <button
                type="button"
                disabled={busy}
                onClick={() => refInput.current?.click()}
                className="inline-flex h-14 items-center rounded-md border border-dashed border-line-strong px-3 text-[12px] text-fg-2 hover:bg-surface-2"
              >
                {t("studio.addRef", { n: refs.length, max: MAX_REFS })}
              </button>
            )}
            <input
              ref={refInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addRefs(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-[12px] text-fg-3">
            {t("studio.refNote")}
          </p>
        </div>


        <Field label={t("studio.fontLabel")} hint={t("studio.fontHint")}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setFont("auto")}
              aria-pressed={font === "auto"}
              className={cx(
                "flex h-14 items-center justify-center rounded-lg border text-[13px] font-medium",
                font === "auto" ? "border-accent bg-accent/8 text-fg" : "border-line-strong text-fg-2 hover:bg-surface-2",
              )}
            >
              {t("studio.fontAuto")}
            </button>
            {(fonts.data?.data ?? []).map((f) => (
              <button
                key={f.key}
                type="button"
                disabled={busy}
                onClick={() => setFont(f.key)}
                aria-pressed={font === f.key}
                title={f.label}
                className={cx(
                  "flex h-14 flex-col items-start justify-center overflow-hidden rounded-lg border px-2 text-left",
                  font === f.key ? "border-accent bg-accent/8" : "border-line-strong hover:bg-surface-2",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.preview} alt="" className="h-6 w-auto max-w-full object-contain object-left" loading="lazy" />
                <span className="mt-0.5 truncate text-[11px] text-fg-3">{f.label}</span>
              </button>
            ))}
          </div>
        </Field>

        {/* 스토리에는 캡션이 붙지 않아 양식이 필요 없음 */}
        {postType === "feed" && (
          <Field
            label={t("studio.formatLabel")}
            htmlFor="cn-format"
            hint={
              <>
                {t("studio.formatHint")}{" "}
                <button type="button" className="underline" onClick={() => setFormat(t("studio.formatExample"))} disabled={busy}>
                  {t("studio.formatInsertExample")}
                </button>
              </>
            }
          >
            <textarea
              id="cn-format"
              rows={5}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder={tplFormat || t("studio.formatPlaceholder")}
              className={cx(inputClass, "resize-y font-mono text-[12px]")}
              disabled={busy}
            />
          </Field>
        )}

          </div>
        </details>

        {error && <Notice tone="bad">{error}</Notice>}

        {step ? (
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
            <p className="text-[12px] text-fg-3">{t("studio.waitNote")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <Button type="submit" variant="primary" className="w-full" disabled={prompt.trim().length < 2}>
              <IconSpark width={16} height={16} /> {t("studio.submit")}
            </Button>
            <Button type="button" className="w-full" onClick={startManual} disabled={!photos.length}>
              ✏️ {t("studio.manualStart")}
            </Button>
            <p className="text-center text-[12px] text-fg-3">{photos.length ? t("studio.manualHint") : t("studio.manualNeedsMedia")}</p>
          </div>
        )}
      </form>
    </Card>
  );
}
