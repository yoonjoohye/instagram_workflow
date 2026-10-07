"use client";

/** 새로 만들기: 작업 공간과 같은 화면을 빈 상태로 보여 줍니다.
 *  컨셉·주제는 화면에만 두었다가, 사진·동영상을 넣거나 AI 로 이미지를 만드는 순간 작업을 만들고 그 작업 공간으로 이어집니다. */

import { useState } from "react";
import { useMe } from "@/components/AdminShell";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { MediaStrip } from "@/components/studio/MediaStrip";
import { PhotoLibraryPanel } from "@/components/studio/PhotoLibraryPanel";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { DEFAULT_SETTINGS, WorkspaceSettings, type SettingsPatch } from "@/components/studio/WorkspaceSettings";
import { Button, Card, Notice } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { api, toApiError } from "@/lib/api";
import { isMedia, MAX_VIDEO_MB, tooBig, uploadMedia } from "@/lib/mediaUpload";
import * as photoLib from "@/lib/photoLibrary";
import type { Job, JobSettings } from "@/lib/types";

const MAX_MEDIA = 10; // backend/routers/studio.py 의 MAX_MEDIA 와 같게

/** onCreated(job, editIndex): 만든 작업과, 바로 편집기를 띄울 장 번호 */
export function NewWorkspace({ onCreated }: { onCreated: (job: Job, editIndex: number | null) => void }) {
  const { t, locale } = useI18n();
  const { me } = useMe();
  const [settings, setSettings] = useState<JobSettings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string>();
  const [libNotice, setLibNotice] = useState<{ tone: "good" | "warn"; text: string }>();
  const [finding, setFinding] = useState(false);
  const story = settings.post_type === "story";

  const saveLocal = (patch: SettingsPatch) => {
    const { prompt, ...rest } = patch;
    setSettings((s) => ({ ...s, ...rest, ...(prompt !== undefined ? { topic: prompt } : {}) }));
  };

  /** 작업 만들기 (지금까지 고른 컨셉·주제와 함께) */
  const create = (uploadIds: string[]) =>
    api<Job>("/studio/manual", {
      method: "POST",
      json: {
        upload_ids: uploadIds,
        post_type: settings.post_type,
        prompt: settings.topic.trim(),
        style: settings.style,
        caption_format: story ? "" : settings.caption_format,
        template: settings.template,
        language: locale,
      },
    });

  async function addFiles(files: File[]) {
    setError(undefined);
    if (files.some(tooBig)) setError(t("studio.videoTooBig", { mb: MAX_VIDEO_MB }));
    const usable = files.filter((f) => isMedia(f) && !tooBig(f)).slice(0, MAX_MEDIA);
    if (!usable.length) return;
    const ids = await uploadMedia(usable, t, () => {});
    onCreated(await create(ids), 0); // 첫 장을 바로 편집
  }

  async function generate(instruction: string) {
    setError(undefined);
    const job = await create([]);
    try {
      onCreated(await api<Job>(`/studio/${job.id}/media/generate`, { method: "POST", json: { instruction } }), null);
    } catch (e) {
      onCreated(job, null); // 작업은 만들어졌으니 그 화면에서 다시 시도
      throw e;
    }
  }

  /** 연결한 사진 폴더에서 주제에 맞는 사진을 찾아 바로 넣기 */
  async function findFromLibrary() {
    if (settings.topic.trim().length < 2) return setError(t("studio.libNeedTopic"));
    setError(undefined);
    setLibNotice(undefined);
    setFinding(true);
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const query = await api<photoLib.PhotoQuery>("/studio/photo-query", { method: "POST", json: { prompt: settings.topic.trim(), today } });
      const matches = await photoLib.search(query);
      const files = await Promise.all(matches.map((m) => photoLib.fileFor(m.path)));
      if (!files.length) return setLibNotice({ tone: "warn", text: t("studio.libNoneFound") });
      await addFiles(files);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setFinding(false);
    }
  }

  const preview = (
    <Card title={t("studio.livePreview")} subtitle={t("studio.livePreviewHint")}>
      {story ? (
        <StoryPreview username={me.username} avatar={me.profile_picture_url} assets={[]} />
      ) : (
        <InstagramPreview username={me.username} avatar={me.profile_picture_url} assets={[]} caption={settings.topic.trim()} />
      )}
      {/* 작업 공간과 같은 자리에 게시 버튼 (사진을 넣으면 쓸 수 있음) */}
      <div className="mt-4 space-y-3 border-t border-line pt-4">
        <div className="grid grid-cols-2 gap-2">
          <Button disabled>{t("studio.saveDraft")}</Button>
          <Button variant="primary" disabled>
            {story ? t("studio.publishStories", { n: 0 }) : t("studio.publish")}
          </Button>
        </div>
      </div>
    </Card>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-6">
        <WorkspaceSettings settings={settings} locked={false} onSave={saveLocal} defaultOpen />

        <Card title={t("studio.mediaTitle")} subtitle={t("studio.newMediaHint")}>
          <MediaStrip assets={[]} onAdd={addFiles} onGenerate={generate} />
          <div className="mt-4">
            <PhotoLibraryPanel busy={finding} canFind={settings.topic.trim().length >= 2} onReadyChange={() => {}} onFind={findFromLibrary} />
          </div>
          {libNotice && (
            <div className="mt-3">
              <Notice tone={libNotice.tone}>{libNotice.text}</Notice>
            </div>
          )}
          {error && (
            <div className="mt-3">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}
        </Card>

        {/* 휴대폰·태블릿: 미리보기를 편집 사이에 */}
        <div className="lg:hidden">{preview}</div>

        {!story && (
          <Card title={t("studio.captionTitle")}>
            <p className="text-[13px] text-fg-3">{t("studio.captionAfterMedia")}</p>
          </Card>
        )}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-6">{preview}</div>
      </aside>
    </div>
  );
}
