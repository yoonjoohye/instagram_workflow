"use client";

/** 검수 + 게시: 미리보기·이미지 수정·음악·캡션·해시태그·댓글 자동 응답을 확인하고 Instagram 에 게시 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyOn, autoReplySummary, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconSpark } from "@/components/icons";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { Badge, Button, Card, cx, Field, inputClass, Notice, Skeleton, Spinner, StatusDot } from "@/components/ui";
import { api, toApiError, useApi } from "@/lib/api";
import { composeCaption, fmtDateTime, KIND_LABEL, parseHashtags, STATUS_LABEL } from "@/lib/format";
import type { AutoReplyInput, AutoReplyRule, Job, Quota } from "@/lib/types";
import { statusTone } from "@/lib/status";
import { AudioTrack, MediaStrip } from "@/components/studio/MediaStrip";
import { MusicCard } from "@/components/studio/MusicCard";

export const CAPTION_LIMIT = 2200;

// Instagram 캡션 최대 길이
export const HASHTAG_LIMIT = 30;

// ───────────────────────────────────────────────────────────── 검수 + 발행

export function Review({ job, onChange }: { job: Job | null; onChange: (j: Job) => void }) {
  const t = useT();
  const { me } = useMe();
  const quota = useApi<Quota>("/workflow/quota");
  const [caption, setCaption] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [shareToFeed, setShareToFeed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
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
  const dirty =
    caption !== job.caption || hashtags.join(" ") !== (job.hashtags ?? []).join(" ");
  const visual = job.assets.filter((a) => a.type !== "audio");
  const audio = job.assets.filter((a) => a.type === "audio");
  const overCaption = finalCaption.length > CAPTION_LIMIT;
  const overTags = hashtags.length > HASHTAG_LIMIT;
  const arDirty = Boolean(arRule.data && arForm && autoReplyDirty(arRule.data, arForm));
  const arValid = !arForm || autoReplyValid(arForm);

  /** 캡션과 자동 응답 중 바뀐 것만 저장합니다. 실패하면 false. */
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
      let published = await api<Job>("/workflow/publish", {
        method: "POST",
        json: { job_id: job!.id, share_to_feed: shareToFeed },
      });
      onChange(published);
      // 스토리는 한 번에 다 못 올리면(서버 시간 제한) 이어서 요청합니다.
      for (let guard = 0; published.media_kind === "STORIES" && published.status === "publishing" && guard < 10; guard++) {
        published = await api<Job>("/workflow/publish", { method: "POST", json: { job_id: job!.id } });
        onChange(published);
      }
    } catch (e) {
      setError(toApiError(e).message);
      // 실패 사유(job.error)와 상태를 다시 읽어옵니다.
      api<Job>(`/workflow/jobs/${job!.id}`).then(onChange).catch(() => {});
    } finally {
      setPublishing(false);
      quota.reload();
    }
  }

  const tone = statusTone(job.status);
  const isStory = job.media_kind === "STORIES";
  const progress = job.story_progress;

  // 스토리 카드 아래 게시 줄 (발행 한도 · 진행 · 올리기)
  const publishBar = !locked || job.status === "publishing" ? (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <div className="text-[12px] text-fg-3">
        {progress && progress.done > 0 && progress.done < progress.total
          ? t("studio.storiesPartial", { done: progress.done, total: progress.total })
          : quota.data
            ? rich(t("studio.quota", { remaining: quota.data.remaining, total: quota.data.total }), {
                b: (c) => <span className="tnum font-medium text-fg-2">{c}</span>,
              })
            : null}
      </div>
      <Button
        variant="primary"
        className="max-sm:w-full"
        onClick={publish}
        loading={publishing}
        disabled={visual.length === 0 || quota.data?.remaining === 0}
      >
        {publishing && progress
          ? t("studio.publishingStories", { done: progress.done, total: progress.total })
          : t("studio.publishStories", { n: visual.length })}
      </Button>
      {error && <div className="w-full"><Notice tone="bad">{error}</Notice></div>}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <Card
        title={
          <span className="flex items-center gap-2">
            {t("studio.previewTitle", { kind: KIND_LABEL[job.media_kind] })}
            <Badge tone={tone} icon={<StatusDot tone={tone} />}>
              {STATUS_LABEL[job.status]}
            </Badge>
          </span>
        }
        subtitle={t("studio.jobMeta", { date: fmtDateTime(job.created_at), provider: job.provider })}
      >
        {job.status === "published" && (
          <div className="mb-4">
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
        {job.error && job.status !== "published" && (
          <div className="mb-4">
            <Notice tone={job.status === "failed" ? "bad" : "warn"}>{job.error}</Notice>
          </div>
        )}

        <MediaStrip
          assets={visual}
          filePrefix={`post-${job.id}`}
          onRedo={
            // "cardnews/…" 는 이름을 바꾸기 전에 만든 작업
            (job.provider.startsWith("studio") || job.provider.startsWith("cardnews")) && !locked
              ? async (i, instruction, fromCurrent) => {
                  await api(`/studio/${job.id}/slides/${i}`, {
                    method: "POST",
                    json: { instruction: instruction || null, from_current: fromCurrent, strict: true },
                  });
                  onChange(await api<Job>(`/workflow/jobs/${job.id}`));
                }
              : undefined
          }
        />

        {!!job.requirements?.length && (
          <details open className="mt-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-fg">
              {t("studio.requirements", { n: job.requirements.length })}
            </summary>
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
            <summary className="cursor-pointer text-[13px] font-medium text-fg-2">
              {t("studio.sources", { n: job.sources.length })}
            </summary>
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

      {job.music && <MusicCard job={job} locked={locked} onChange={onChange} />}

      {isStory ? (
        <Card title={t("studio.storyPreview")} subtitle={t("studio.storyReviewNote")}>
          <StoryPreview username={me.username} avatar={me.profile_picture_url} assets={visual} />
          {publishBar}
        </Card>
      ) : (
      <Card
        title={t("studio.captionTitle")}
        subtitle={job.media_kind === "STORIES" ? t("studio.storiesNoCaption") : undefined}
      >
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
          <Field
            label={t("studio.hashtags")}
            htmlFor="tags"
            hint={
              <span className={cx(overTags && "font-medium text-bad")}>
                {t("studio.hashtagCount", { n: hashtags.length, max: HASHTAG_LIMIT })}
              </span>
            }
          >
            <input id="tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputClass} disabled={locked} />
          </Field>

          <details open className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-fg-2">{t("studio.postPreview")}</summary>
            <div className="mt-3 pb-1">
              <InstagramPreview
                username={me.username}
                avatar={me.profile_picture_url}
                assets={visual}
                caption={finalCaption}
                music={job.music?.selected}
              />
            </div>
          </details>

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

          {locked && arDirty && (
            <div className="flex justify-end">
              <Button onClick={save} loading={saving} disabled={!arValid}>
                {saved ? t("common.saved") : t("studio.saveAutoReply")}
              </Button>
            </div>
          )}

          {!locked && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div className="text-[12px] text-fg-3">
                {quota.data ? (
                  <>
                    {rich(t("studio.quota", { remaining: quota.data.remaining, total: quota.data.total }), {
                      b: (c) => <span className="tnum font-medium text-fg-2">{c}</span>,
                    })}
                  </>
                ) : quota.loading ? (
                  <Spinner />
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
                {job.media_kind === "REELS" && (
                  <label className="mr-2 flex items-center gap-2 text-[13px] text-fg-2">
                    <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="accent-[var(--accent)]" />
                    {t("studio.shareToFeed")}
                  </label>
                )}
                <Button onClick={save} disabled={!(dirty || arDirty) || !arValid || publishing} loading={saving}>
                  {saved ? t("common.saved") : t("common.save")}
                </Button>
                <Button
                  variant="primary"
                  onClick={publish}
                  loading={publishing}
                  disabled={overCaption || overTags || !arValid || visual.length === 0 || quota.data?.remaining === 0}
                >
                  {publishing ? t("studio.publishing") : job.status === "failed" || job.status === "deleted" ? t("studio.republish") : t("studio.publish")}
                </Button>
              </div>
            </div>
          )}
          {publishing && (
            <p className="text-right text-[12px] text-fg-3">
              {t("studio.videoWait")}
            </p>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      </Card>
      )}

    </div>
  );
}
