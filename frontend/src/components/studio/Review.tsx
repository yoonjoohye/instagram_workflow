"use client";

/** 작업 공간: 왼쪽에서 사진·동영상(직접 편집 / AI로 수정)·음악·캡션·자동 응답을 고치고,
 *  오른쪽에 고정된 미리보기로 올라갈 모습을 바로 확인한 뒤 임시저장 / 게시합니다. */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyOn, autoReplySummary, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconSpark } from "@/components/icons";
import { AudioTrack, MediaStrip } from "@/components/studio/MediaStrip";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { HashtagField } from "@/components/studio/HashtagField";
import { CaptionAiPanel } from "@/components/studio/CaptionAiPanel";
import { CaptionField } from "@/components/studio/CaptionField";
import { DEFAULT_SETTINGS, WorkspaceSettings } from "@/components/studio/WorkspaceSettings";
import { uploadMedia } from "@/lib/mediaUpload";
import { VideoEditor } from "@/components/studio/VideoEditor";
import { Badge, Button, Card, cx, Notice, Skeleton, Spinner, StatusDot } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { api, toApiError, useApi } from "@/lib/api";
import { composeCaption, fmtDateTime, KIND_LABEL, STATUS_LABEL } from "@/lib/format";
import { statusTone } from "@/lib/status";
import { moveItem } from "@/lib/useDragSort";
import type { Asset, AutoReplyInput, AutoReplyRule, Job, Quota } from "@/lib/types";

// 편집기(fabric.js)는 열 때만 내려받습니다.
const ImageEditor = dynamic(() => import("@/components/editor/ImageEditor").then((m) => m.ImageEditor), { ssr: false });

export const CAPTION_LIMIT = 2200; // Instagram 캡션 최대 길이
export const HASHTAG_LIMIT = 30;

export function Review({
  job,
  onChange,
}: {
  job: Job | null;
  onChange: (j: Job) => void;
}) {
  const { t } = useI18n();
  const { me } = useMe();
  const quota = useApi<Quota>("/workflow/quota");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editingVideo, setEditingVideo] = useState<number | null>(null);
  // 댓글 자동 응답은 게시 흐름의 일부로 함께 저장합니다 (스토리는 댓글이 없어 제외).
  const supportsAutoReply = Boolean(job) && job!.media_kind !== "STORIES";
  const arRule = useApi<AutoReplyRule>(job && supportsAutoReply ? `/autoreply/jobs/${job.id}` : null);
  const [arForm, setArForm] = useState<AutoReplyInput | null>(null);

  useEffect(() => {
    setArForm(arRule.data ? autoReplyForm(arRule.data) : null);
  }, [arRule.data]);

  useEffect(() => {
    setCaption(job?.caption ?? "");
    setHashtags(job?.hashtags ?? []);
    setError(undefined);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const finalCaption = composeCaption(caption, hashtags);

  if (!job) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-line-strong p-8 text-center">
        <IconSpark className="text-fg-3" width={28} height={28} />
        <p className="mt-3 text-sm font-medium text-fg-2">{t("studio.emptyTitle")}</p>
        <p className="mt-1 max-w-xs text-[13px] text-fg-3">
          {rich(t("studio.emptyBody"), {
            link: (c) => (
              <Link href="/admin/jobs" className="underline">
                {c}
              </Link>
            ),
          })}
        </p>
      </div>
    );
  }

  const locked = job.status === "published" || job.status === "publishing";
  const isStory = job.media_kind === "STORIES";
  const original = job.provider.startsWith("original");
  const dirty = caption !== job.caption || hashtags.join(" ") !== (job.hashtags ?? []).join(" ");
  const visual = job.assets.filter((a) => a.type !== "audio");
  const audio = job.assets.filter((a) => a.type === "audio");
  const overCaption = finalCaption.length > CAPTION_LIMIT;
  const overTags = hashtags.length > HASHTAG_LIMIT;
  const arDirty = Boolean(arRule.data && arForm && autoReplyDirty(arRule.data, arForm));
  const arValid = !arForm || autoReplyValid(arForm);
  const progress = job.story_progress;
  const tone = statusTone(job.status);
  const reload = async () => onChange(await api<Job>(`/workflow/jobs/${job.id}`));

  /** 임시저장: 캡션·해시태그와 자동 응답 중 바뀐 것만 저장합니다 (이미지 편집은 편집기에서 바로 저장됨). 실패하면 false. */
  async function save(): Promise<boolean> {
    setSaving(true);
    setError(undefined);
    try {
      if (dirty && !locked) {
        onChange(await api<Job>(`/workflow/jobs/${job!.id}`, { method: "PATCH", json: { caption, hashtags } }));
      }
      if (arDirty && arForm) {
        arRule.setData(await api<AutoReplyRule>(`/autoreply/jobs/${job!.id}`, { method: "PUT", json: arForm }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (e) {
      setError(toApiError(e).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const arLine = arForm && autoReplyOn(arForm) ? t("studio.publishConfirmAutoReply", { summary: autoReplySummary(arForm, t) }) : "";
    if (!window.confirm(t("studio.publishConfirm", { username: me.username, kind: KIND_LABEL[job!.media_kind], autoReply: arLine }))) return;
    // 게시 전에 캡션과 자동 응답을 먼저 저장해, 게시되는 순간부터 자동 응답이 동작하게 합니다.
    if ((dirty || arDirty) && !(await save())) return;
    setPublishing(true);
    setError(undefined);
    try {
      let published = await api<Job>("/workflow/publish", { method: "POST", json: { job_id: job!.id, share_to_feed: shareToFeed } });
      onChange(published);
      // 스토리는 한 번에 다 못 올리면(서버 시간 제한) 이어서 요청합니다.
      for (let guard = 0; published.media_kind === "STORIES" && published.status === "publishing" && guard < 10; guard++) {
        published = await api<Job>("/workflow/publish", { method: "POST", json: { job_id: job!.id } });
        onChange(published);
      }
    } catch (e) {
      setError(toApiError(e).message);
      // 실패 사유(job.error)와 상태를 다시 읽어옵니다.
      reload().catch(() => {});
    } finally {
      setPublishing(false);
      quota.reload();
    }
  }

  // ── 오른쪽: 올라갈 모습 + 임시저장 / 게시 ───────────────────────
  const canPublish =
    !locked || (isStory && job.status === "publishing" && !!progress && progress.done < progress.total);
  const preview = (
    <div className="space-y-3">
      <Card
        title={
          <span className="flex items-center gap-2">
            {t("studio.livePreview")}
            <Badge tone={tone} icon={<StatusDot tone={tone} />}>
              {STATUS_LABEL[job.status]}
            </Badge>
          </span>
        }
        subtitle={t("studio.livePreviewHint")}
      >
        {isStory ? (
          <>
            <StoryPreview username={me.username} avatar={me.profile_picture_url} assets={visual} />
            <StoryLinks assets={visual} published={job.status === "published"} />
          </>
        ) : (
          <InstagramPreview
            username={me.username}
            avatar={me.profile_picture_url}
            assets={visual}
            caption={finalCaption}
          />
        )}

        {job.status === "published" && (
          <div className="mt-4">
            <Notice tone="good" title={t("studio.publishedTitle")}>
              {job.permalink ? (
                <a href={job.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                  {t("studio.viewOnInstagram")} <IconExternal />
                </a>
              ) : (
                t("studio.publishedLater")
              )}
            </Notice>
          </div>
        )}

        {canPublish && (
          <div className="mt-4 space-y-3 border-t border-line pt-4">
            <div className="text-[12px] text-fg-3">
              {progress && progress.done > 0 && progress.done < progress.total
                ? t("studio.storiesPartial", { done: progress.done, total: progress.total })
                : quota.data
                  ? rich(t("studio.quota", { remaining: quota.data.remaining, total: quota.data.total }), {
                      b: (c) => <span className="tnum font-medium text-fg-2">{c}</span>,
                    })
                  : quota.loading && <Spinner />}
              {(dirty || arDirty) && <span className="ml-2 font-medium text-warn">· {t("studio.unsaved")}</span>}
            </div>
            {job.media_kind === "REELS" && (
              <label className="flex items-center gap-2 text-[13px] text-fg-2">
                <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="accent-[var(--accent)]" />
                {t("studio.shareToFeed")}
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={save} disabled={!(dirty || arDirty) || !arValid || publishing} loading={saving}>
                {saved ? t("studio.draftSaved") : t("studio.saveDraft")}
              </Button>
              <Button
                variant="primary"
                onClick={publish}
                loading={publishing}
                disabled={overCaption || overTags || !arValid || visual.length === 0 || quota.data?.remaining === 0}
              >
                {isStory
                  ? publishing && progress
                    ? t("studio.publishingStories", { done: progress.done, total: progress.total })
                    : t("studio.publishStories", { n: visual.length })
                  : publishing
                    ? t("studio.publishing")
                    : job.status === "failed" || job.status === "deleted"
                      ? t("studio.republish")
                      : t("studio.publish")}
              </Button>
            </div>
            {publishing && <p className="text-[12px] text-fg-3">{t("studio.videoWait")}</p>}
          </div>
        )}
        {locked && arDirty && (
          <div className="mt-3 flex justify-end">
            <Button onClick={save} loading={saving} disabled={!arValid}>
              {saved ? t("common.saved") : t("studio.saveAutoReply")}
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </Card>
    </div>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ── 왼쪽: 편집 ── */}
      <div className="min-w-0 space-y-6">
        <WorkspaceSettings
          settings={job.settings ?? DEFAULT_SETTINGS}
          locked={locked}
          resetKey={job.id}
          onSave={async (patch) => onChange(await api<Job>(`/studio/${job.id}/settings`, { method: "PATCH", json: patch }))}
        />
        <Card
          title={t("studio.mediaTitle")}
          subtitle={`${t("studio.jobMeta", { date: fmtDateTime(job.created_at), provider: job.provider })}`}
        >
          {!locked && <p className="-mt-1 mb-3 text-[12px] text-fg-3">{t("studio.mediaHint")}</p>}
          {job.error && job.status !== "published" && (
            <div className="mb-4">
              <Notice tone={job.status === "failed" ? "bad" : "warn"}>{job.error}</Notice>
            </div>
          )}
          <MediaStrip
            assets={visual}
            filePrefix={`post-${job.id}`}
            canRedoFromScratch={!original}
            onManualEdit={!locked ? (i) => setEditing(i) : undefined}
            onVideoEdit={!locked ? (i) => setEditingVideo(i) : undefined}
            onAdd={
              !locked
                ? async (files) => {
                    const ids = await uploadMedia(files, t, () => {});
                    onChange(await api<Job>(`/studio/${job.id}/media`, { method: "POST", json: { upload_ids: ids } }));
                  }
                : undefined
            }
            onGenerate={
              !locked
                ? async (instruction) => onChange(await api<Job>(`/studio/${job.id}/media/generate`, { method: "POST", json: { instruction } }))
                : undefined
            }
            onRemove={!locked ? async (i) => onChange(await api<Job>(`/studio/${job.id}/media/${i}`, { method: "DELETE" })) : undefined}
            onReorder={
              !locked && visual.length === job.assets.length
                ? async (from, to) => {
                    const order = moveItem(job.assets.map((_, i) => i), from, to);
                    onChange({ ...job, assets: order.map((i) => job.assets[i]) }); // 바로 보이게
                    try {
                      onChange(await api<Job>(`/studio/${job.id}/reorder`, { method: "POST", json: { order } }));
                    } catch (e) {
                      setError(toApiError(e).message);
                      reload().catch(() => {});
                    }
                  }
                : undefined
            }
            onRedo={
              !locked
                ? async (i, instruction, fromCurrent) => {
                    await api(`/studio/${job.id}/slides/${i}`, {
                      method: "POST",
                      json: { instruction: instruction || null, from_current: fromCurrent, strict: true },
                    });
                    await reload();
                  }
                : undefined
            }
          />

          {!!job.requirements?.length && (
            <details className="mt-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-medium text-fg">{t("studio.requirements", { n: job.requirements.length })}</summary>
              <ul className="mt-2 space-y-1.5">
                {job.requirements.map((r, i) => (
                  <li key={i} className="text-[12px] leading-relaxed">
                    <span className="font-medium text-fg">✓ {r.requirement}</span>
                    <span className="block text-fg-3">→ {r.how}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!job.sources?.length && (
            <details className="mt-4 rounded-lg border border-line px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-medium text-fg-2">{t("studio.sources", { n: job.sources.length })}</summary>
              <ul className="mt-2 space-y-1">
                {job.sources.map((src) => (
                  <li key={src.uri} className="truncate text-[12px]">
                    <a href={src.uri} target="_blank" rel="noreferrer" className="text-fg-2 underline hover:text-fg">
                      {src.title}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {audio.map((a, i) => (
            <AudioTrack key={i} asset={a} />
          ))}
        </Card>

        {/* 휴대폰·태블릿: 미리보기를 편집 사이에 (넓은 화면은 오른쪽에 고정) */}
        <div className="lg:hidden">{preview}</div>


        {isStory ? (
          <Notice tone="neutral">{t("studio.storyReviewNote")}</Notice>
        ) : (
          <Card title={t("studio.captionTitle")}>
            <div className="space-y-4">
              {!locked && (
                <CaptionAiPanel
                  ai={{
                    write: (v) => api(`/studio/${job.id}/caption`, { method: "POST", json: v }),
                  }}
                  caption={caption}
                  onCaption={setCaption}
                  hashtags={hashtags}
                  onHashtags={setHashtags}
                  prefs={job.settings ?? DEFAULT_SETTINGS}
                  onPrefs={async (patch) => onChange(await api<Job>(`/studio/${job.id}/settings`, { method: "PATCH", json: patch }))}
                  onRequests={(requests) => onChange({ ...job, settings: { ...(job.settings ?? DEFAULT_SETTINGS), caption_requests: requests } })}
                />
              )}
              <CaptionField value={caption} onChange={setCaption} count={finalCaption.length} max={CAPTION_LIMIT} disabled={locked} />
              <HashtagField value={hashtags} onChange={setHashtags} max={HASHTAG_LIMIT} disabled={locked} />

              {supportsAutoReply &&
                (arForm ? (
                  <div>
                    <p className="mb-2 text-[13px] font-semibold">
                      {t("studio.autoReply")}
                      <span className="ml-1.5 text-[12px] font-normal text-fg-3">
                        {job.status === "published" ? t("studio.autoReplyAfterPublish") : t("studio.autoReplyWithPublish")}
                      </span>
                    </p>
                    <AutoReplyFields form={arForm} onChange={setArForm} />
                  </div>
                ) : arRule.error ? (
                  <Notice tone="bad">{t("studio.autoReplyLoadFailed", { message: arRule.error.message })}</Notice>
                ) : (
                  <Skeleton className="h-14" />
                ))}
            </div>
          </Card>
        )}
      </div>

      {/* ── 오른쪽: 고정 미리보기 (넓은 화면) ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-6">{preview}</div>
      </aside>

      {editing !== null && visual[editing] && (
        <ImageEditor
          jobId={job.id}
          index={job.assets.indexOf(visual[editing])}
          asset={visual[editing]}
          preview={{
            kind: isStory ? "story" : "feed",
            assets: visual,
            username: me.username,
            avatar: me.profile_picture_url,
            caption: finalCaption,
          }}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {editingVideo !== null && visual[editingVideo]?.type === "video" && (
        <VideoEditor
          jobId={job.id}
          index={job.assets.indexOf(visual[editingVideo])}
          asset={visual[editingVideo]}
          preview={{ kind: isStory ? "story" : "feed", assets: visual, username: me.username, avatar: me.profile_picture_url, caption: finalCaption }}
          onClose={() => setEditingVideo(null)}
          onSaved={onChange}
        />
      )}
    </div>
  );
}

/** 스토리에 넣은 링크·게시물 스티커의 주소 — 인스타 API 로는 누를 수 있는 링크를 붙일 수 없어 앱에서 붙이도록 복사 버튼 제공 */
function StoryLinks({ assets, published }: { assets: Asset[]; published: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string>();
  const items = assets.flatMap((a, i) =>
    ((a.meta?.story_links as { kind: string; url: string }[] | undefined) ?? []).map((l) => ({ ...l, n: i + 1 })),
  );
  if (!items.length) return null;
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(undefined), 1500);
    } catch {
      /* 클립보드 권한이 없으면 무시 */
    }
  };
  return (
    <div className={cx("mt-4 rounded-lg border p-3", published ? "border-accent/50 bg-accent/5" : "border-line")}>
      <p className="text-[13px] font-semibold">🔗 {t("studio.storyLinksTitle")}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-fg-3">{published ? t("studio.storyLinksAfter") : t("studio.storyLinksBefore")}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((l, i) => (
          <li key={i} className="flex items-center gap-2 text-[12px]">
            <span className="tnum shrink-0 text-fg-3">{l.n}.</span>
            <span className="shrink-0">{l.kind === "post" ? "📄" : "🔗"}</span>
            <span className="min-w-0 flex-1 truncate text-fg-2" title={l.url}>
              {l.url.replace(/^https?:\/\//, "")}
            </span>
            <button type="button" onClick={() => copy(l.url)} className="shrink-0 rounded-md px-2 py-1 font-medium text-fg-2 hover:bg-surface-2">
              {copied === l.url ? t("studio.copied") : t("studio.copy")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
