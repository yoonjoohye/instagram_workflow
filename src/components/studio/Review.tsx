"use client";

/** 작업 공간: 왼쪽에서 사진·동영상(직접 편집 / AI로 수정)·음악·캡션·자동 응답을 고치고,
 *  오른쪽에 고정된 미리보기로 올라갈 모습을 바로 확인한 뒤 임시저장 / 게시합니다. */

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyOn, autoReplySummary, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconSpark } from "@/components/icons";
import { AudioTrack, MediaStrip } from "@/components/studio/MediaStrip";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { MusicCard } from "@/components/studio/MusicCard";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { buildSoundtrack, SoundtrackCard } from "@/components/studio/SoundtrackCard";
import { VideoEditor } from "@/components/studio/VideoEditor";
import { Badge, Button, Card, cx, Field, inputClass, Notice, Skeleton, Spinner, StatusDot } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { api, toApiError, useApi } from "@/lib/api";
import { composeCaption, fmtDateTime, KIND_LABEL, parseHashtags, STATUS_LABEL } from "@/lib/format";
import { statusTone } from "@/lib/status";
import type { Asset, AutoReplyInput, AutoReplyRule, Job, Quota } from "@/lib/types";

// 편집기(fabric.js)는 열 때만 내려받습니다.
const ImageEditor = dynamic(() => import("@/components/editor/ImageEditor").then((m) => m.ImageEditor), { ssr: false });

export const CAPTION_LIMIT = 2200; // Instagram 캡션 최대 길이
export const HASHTAG_LIMIT = 30;

export function Review({ job, onChange }: { job: Job | null; onChange: (j: Job) => void }) {
  const { t, locale } = useI18n();
  const { me } = useMe();
  const quota = useApi<Quota>("/workflow/quota");
  const [caption, setCaption] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editingVideo, setEditingVideo] = useState<number | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rewriteHint, setRewriteHint] = useState("");
  const [rewriting, setRewriting] = useState(false);
  // 댓글 자동 응답은 게시 흐름의 일부로 함께 저장합니다 (스토리는 댓글이 없어 제외).
  const supportsAutoReply = Boolean(job) && job!.media_kind !== "STORIES";
  const arRule = useApi<AutoReplyRule>(job && supportsAutoReply ? `/autoreply/jobs/${job.id}` : null);
  const [arForm, setArForm] = useState<AutoReplyInput | null>(null);

  useEffect(() => {
    setArForm(arRule.data ? autoReplyForm(arRule.data) : null);
  }, [arRule.data]);

  useEffect(() => {
    setCaption(job?.caption ?? "");
    setTagsText((job?.hashtags ?? []).map((t) => `#${t}`).join(" "));
    setError(undefined);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hashtags = useMemo(() => parseHashtags(tagsText), [tagsText]);
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
  // 음악을 넣어 만든 영상이 있으면 미리보기도 그 영상으로 (피드는 릴스 한 개, 스토리는 장마다)
  const track = job.soundtrack && !job.soundtrack.stale ? job.soundtrack : null;
  const shown: Asset[] = !track
    ? visual
    : isStory
      ? visual.map((a, i) => {
          const out = track.outputs.find((o) => o.index === i);
          return out ? { type: "video", url: out.url, thumbnail_url: out.thumbnail_url, meta: {} } : a;
        })
      : track.outputs.slice(0, 1).map((o) => ({ type: "video", url: o.url, thumbnail_url: o.thumbnail_url, meta: {} }));
  const publishKind = track && !isStory ? "REELS" : job.media_kind;
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
    if (!window.confirm(t("studio.publishConfirm", { username: me.username, kind: KIND_LABEL[publishKind], autoReply: arLine }))) return;
    // 게시 전에 캡션과 자동 응답을 먼저 저장해, 게시되는 순간부터 자동 응답이 동작하게 합니다.
    if ((dirty || arDirty) && !(await save())) return;
    setPublishing(true);
    setError(undefined);
    try {
      // 음악 넣은 영상을 만든 뒤 사진이 바뀌었다면 같은 설정으로 다시 만들고 올립니다.
      if (job!.soundtrack?.stale) {
        setRebuilding(true);
        onChange(await buildSoundtrack(job!.id, job!.soundtrack, job!.soundtrack.seconds));
        setRebuilding(false);
      }
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
      setRebuilding(false);
      quota.reload();
    }
  }

  async function rewrite() {
    setRewriting(true);
    setError(undefined);
    try {
      const r = await api<{ caption: string; hashtags: string[] }>(`/studio/${job!.id}/caption`, {
        method: "POST",
        json: { instruction: rewriteHint, caption, language: locale },
      });
      setCaption(r.caption);
      if (r.hashtags.length) setTagsText(r.hashtags.map((h) => `#${h}`).join(" "));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setRewriting(false);
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
          <StoryPreview username={me.username} avatar={me.profile_picture_url} assets={shown} />
        ) : (
          <InstagramPreview
            username={me.username}
            avatar={me.profile_picture_url}
            assets={shown}
            caption={finalCaption}
            music={track ? { title: track.name, artist: "" } : job.music?.selected}
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
            {publishKind === "REELS" && (
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
            {publishing && <p className="text-[12px] text-fg-3">{rebuilding ? t("media.rebuilding") : t("studio.videoWait")}</p>}
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

        {(!locked || job.soundtrack) && <SoundtrackCard job={job} locked={locked} onChange={onChange} />}

        {job.music && <MusicCard job={job} locked={locked} onChange={onChange} />}

        {isStory ? (
          <Notice tone="neutral">{t("studio.storyReviewNote")}</Notice>
        ) : (
          <Card title={t("studio.captionTitle")}>
            <div className="space-y-4">
              <Field
                label={t("studio.captionBody")}
                htmlFor="caption"
                hint={
                  <span className={cx(overCaption && "font-medium text-bad")}>
                    {t("studio.captionCount", { n: finalCaption.length.toLocaleString(), max: CAPTION_LIMIT.toLocaleString() })}
                  </span>
                }
              >
                <textarea
                  id="caption"
                  rows={7}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className={cx(inputClass, "resize-y leading-relaxed")}
                  disabled={locked}
                />
              </Field>
              {!locked && (
                <div className="flex flex-wrap gap-2">
                  <input
                    value={rewriteHint}
                    onChange={(e) => setRewriteHint(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), rewrite())}
                    placeholder={t("studio.rewritePh")}
                    maxLength={500}
                    className={cx(inputClass, "min-w-0 flex-1 basis-60")}
                  />
                  <Button onClick={rewrite} loading={rewriting} disabled={rewriting}>
                    ✨ {rewriting ? t("studio.rewriting") : t("studio.rewrite")}
                  </Button>
                </div>
              )}
              <Field
                label={t("studio.hashtags")}
                htmlFor="tags"
                hint={<span className={cx(overTags && "font-medium text-bad")}>{t("studio.hashtagCount", { n: hashtags.length, max: HASHTAG_LIMIT })}</span>}
              >
                <input id="tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputClass} disabled={locked} />
              </Field>

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
            music: job.music?.selected,
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
          onClose={() => setEditingVideo(null)}
          onSaved={onChange}
        />
      )}
    </div>
  );
}
