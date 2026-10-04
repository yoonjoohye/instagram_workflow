"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { InstagramPreview } from "@/components/InstagramPreview";
import { PostForm } from "@/components/PostForm";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyOn, autoReplySummary, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconMusic, IconSpark } from "@/components/icons";
import { useI18n, useT } from "@/i18n/client";
import type { MessageKey, T } from "@/i18n/core";
import { rich } from "@/i18n/rich";
import { Avatar, Badge, Button, Card, cx, Field, inputClass, Notice, PageHeader, Skeleton, Spinner, StatusDot } from "@/components/ui";
import { api, toApiError, useApi } from "@/lib/api";
import { callNative, isNativeApp } from "@/lib/nativeBridge";
import { mediaSrc, composeCaption, fmtDateTime, KIND_LABEL, parseHashtags, STATUS_LABEL } from "@/lib/format";
import type { Asset, AutoReplyInput, AutoReplyRule, Job, MusicPick, Quota } from "@/lib/types";
import { statusTone } from "@/lib/status";


const CAPTION_LIMIT = 2200; // Instagram 캡션 최대 길이
const HASHTAG_LIMIT = 30; // 게시물당 해시태그 최대 개수

export default function StudioPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Studio />
    </Suspense>
  );
}

function Studio() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const jobId = params.get("job");

  const [job, setJob] = useState<Job | null>(null);
  const [loadingJob, setLoadingJob] = useState(Boolean(jobId));
  const [jobError, setJobError] = useState<string>();

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    if (job && String(job.id) === jobId) return;
    setLoadingJob(true);
    api<Job>(`/workflow/jobs/${jobId}`)
      .then(setJob)
      .catch((e) => setJobError(toApiError(e).message))
      .finally(() => setLoadingJob(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const onCreated = (j: Job) => {
    setJob(j);
    router.replace(`/admin/studio?job=${j.id}`, { scroll: false });
    // 휴대폰·태블릿에서는 검수 화면이 입력 폼 아래에 있으므로 그쪽으로 내려 줍니다.
    if (!window.matchMedia("(min-width: 1024px)").matches) {
      setTimeout(() => document.getElementById("review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  };

  return (
    <>
      <PageHeader
        title={t("studio.title")}
        description={t("studio.description")}
        action={
          job && (
            <Button variant="secondary" size="sm" onClick={() => router.push("/admin/studio")}>
              {t("studio.newPost")}
            </Button>
          )
        }
      />
      {jobError && (
        <div className="mb-6">
          <Notice tone="bad" title={t("studio.jobLoadFailed")}>
            {jobError}
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PostForm onCreated={onCreated} />
        <div id="review" className="min-w-0 scroll-mt-20">
          {loadingJob ? <Skeleton className="h-[520px] rounded-xl" /> : <Review job={job} onChange={setJob} />}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────── 검수 + 발행

function Review({ job, onChange }: { job: Job | null; onChange: (j: Job) => void }) {
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
      const published = await api<Job>("/workflow/publish", {
        method: "POST",
        json: { job_id: job!.id, share_to_feed: shareToFeed },
      });
      onChange(published);
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
            (job.provider.startsWith("studio") || job.provider.startsWith("cardnews")) && !locked
              ? async (i, instruction, fromCurrent) => {
                  await api(`/cardnews/${job.id}/slides/${i}`, {
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

    </div>
  );
}

/** 인스타 음악 추천·선택. API 로는 붙일 수 없어 게시 후 인스타 앱에서 추가하도록 안내합니다. */
function MusicCard({ job, locked, onChange }: { job: Job; locked: boolean; onChange: (j: Job) => void }) {
  const { t, locale } = useI18n();
  const music = job.music ?? { suggestions: [], selected: null };
  const [hint, setHint] = useState("");
  const [custom, setCustom] = useState({ title: "", artist: "" });
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const selected = music.selected;
  const same = (a: MusicPick | null, b: MusicPick | null) => !!a && !!b && a.title === b.title && a.artist === b.artist;
  const label = (m: MusicPick) => (m.artist ? `${m.title} - ${m.artist}` : m.title);
  const listenUrl = (m: MusicPick) => `https://www.youtube.com/results?search_query=${encodeURIComponent(label(m))}`;

  async function run(key: string, fn: () => Promise<Job>) {
    setBusy(key);
    setError(undefined);
    try {
      onChange(await fn());
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }
  const pick = (m: MusicPick | null) =>
    run("pick", () => api<Job>(`/cardnews/${job.id}/music`, { method: "PUT", json: { selected: m } }));
  const resuggest = () =>
    run("suggest", () => api<Job>(`/cardnews/${job.id}/music/suggest`, { method: "POST", json: { hint, language: locale } }));

  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(label(selected));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 권한이 없으면 무시 */
    }
  }

  return (
    <Card title={t("studio.musicTitle")} subtitle={t("studio.musicSubtitle")}>
      <div className="space-y-4">
        {/* 선택한 곡 */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5">
          <span className="text-lg" aria-hidden>
            ♪
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-fg-3">{t("studio.musicSelected")}</p>
            <p className="truncate text-[14px] font-semibold">{selected ? label(selected) : t("studio.musicNone")}</p>
            {selected?.section && <p className="text-[12px] text-fg-3">{t("studio.musicSection", { s: selected.section })}</p>}
          </div>
          {selected && (
            <div className="flex items-center gap-1">
              <a
                href={listenUrl(selected)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-fg-2 hover:bg-surface-2"
              >
                {t("studio.musicListen")} <IconExternal width={12} height={12} />
              </a>
              <Button size="sm" variant="ghost" onClick={copy}>
                {copied ? t("studio.musicCopied") : t("studio.musicCopy")}
              </Button>
            </div>
          )}
        </div>

        {/* 추천 목록 */}
        {music.suggestions.length === 0 ? (
          <p className="text-[12px] text-fg-3">{t("studio.musicEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {music.suggestions.map((m) => {
              const on = same(m, selected);
              return (
                <li key={label(m)} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      {m.title} <span className="font-normal text-fg-3">· {m.artist}</span>
                    </p>
                    {m.reason && <p className="mt-0.5 text-[12px] text-fg-2">{m.reason}</p>}
                    {m.section && <p className="text-[11px] text-fg-3">{t("studio.musicSection", { s: m.section })}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <a
                      href={listenUrl(m)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${t("studio.musicListen")}: ${label(m)}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg"
                    >
                      ▶
                    </a>
                    <Button size="sm" variant={on ? "primary" : "secondary"} disabled={locked || on || !!busy} onClick={() => pick(m)}>
                      {on ? "✓" : t("studio.musicPick")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!locked && (
          <>
            {/* 분위기를 적어 다시 추천 */}
            <div className="flex flex-wrap gap-2">
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder={t("studio.musicHintPh")}
                className={cx(inputClass, "min-w-0 flex-1 basis-56")}
                maxLength={300}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), resuggest())}
              />
              <Button onClick={resuggest} loading={busy === "suggest"} disabled={!!busy}>
                {t("studio.musicResuggest")}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <button type="button" className="text-fg-2 underline-offset-2 hover:underline" onClick={() => setShowCustom((v) => !v)}>
                {t("studio.musicCustom")}
              </button>
              {selected && (
                <button type="button" className="text-fg-3 underline-offset-2 hover:underline" disabled={!!busy} onClick={() => pick(null)}>
                  {t("studio.musicNone")}
                </button>
              )}
            </div>
            {showCustom && (
              <div className="flex flex-wrap gap-2">
                <input
                  value={custom.title}
                  onChange={(e) => setCustom({ ...custom, title: e.target.value })}
                  placeholder={t("studio.musicTitlePh")}
                  className={cx(inputClass, "min-w-0 flex-1 basis-40")}
                  maxLength={120}
                />
                <input
                  value={custom.artist}
                  onChange={(e) => setCustom({ ...custom, artist: e.target.value })}
                  placeholder={t("studio.musicArtistPh")}
                  className={cx(inputClass, "min-w-0 flex-1 basis-32")}
                  maxLength={120}
                />
                <Button
                  onClick={() => pick({ title: custom.title.trim(), artist: custom.artist.trim() })}
                  disabled={!custom.title.trim() || !!busy}
                  loading={busy === "pick"}
                >
                  {t("studio.musicApply")}
                </Button>
              </div>
            )}
          </>
        )}

        {error && <Notice tone="bad">{error}</Notice>}
        <p className="text-[12px] leading-relaxed text-fg-3">{t("studio.musicHowTo")}</p>
      </div>
    </Card>
  );
}

type RedoFn = (index: number, instruction: string, fromCurrent: boolean) => Promise<void>;

async function fetchFile(url: string, name: string, t: T): Promise<File> {
  const res = await fetch(mediaSrc(url));
  if (!res.ok) throw new Error(t("studio.fetchImageFailed", { status: res.status }));
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

/** 휴대폰에서는 공유 시트(‘이미지 저장’ → 사진 앱)로, 컴퓨터에서는 파일로 저장합니다. */
async function saveFiles(files: File[]) {
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // 사용자가 닫음
      // 공유가 막히면 아래 파일 저장으로
    }
  }
  for (const file of files) {
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    if (files.length > 1) await new Promise((r) => setTimeout(r, 300)); // 브라우저가 연속 다운로드를 막지 않게
  }
}

/** 앱 안에서는 사진첩에 바로 저장 (WebView 는 파일 다운로드를 못 함) */
async function saveInApp(urls: string[], t: T) {
  const abs = urls.map((u) => new URL(mediaSrc(u), window.location.href).href);
  await callNative("save", { urls: abs, message: t("studio.savedToPhotos") }, 300_000);
}

async function downloadImage(url: string, name: string, t: T) {
  if (isNativeApp()) return saveInApp([url], t);
  await saveFiles([await fetchFile(url, name, t)]);
}

function MediaStrip({ assets, onRedo, filePrefix = "post" }: { assets: Asset[]; onRedo?: RedoFn; filePrefix?: string }) {
  const t = useT();
  const [error, setError] = useState<string>();
  const [downloadingAll, setDownloadingAll] = useState(false);
  if (!assets.length) return <p className="py-8 text-center text-sm text-fg-3">{t("studio.noMedia")}</p>;
  const single = assets.length === 1;
  const fileName = (a: Asset, i: number) => `${filePrefix}-${i + 1}.${a.type === "video" ? "mp4" : "jpg"}`;
  const ready = assets.filter((a) => a.url);

  const downloadAll = async () => {
    setDownloadingAll(true);
    setError(undefined);
    try {
      if (isNativeApp()) {
        await saveInApp(ready.map((a) => a.url), t);
        return;
      }
      const files = await Promise.all(
        assets.map((a, i) => (a.url ? fetchFile(a.url, fileName(a, i), t) : null)),
      );
      await saveFiles(files.filter((f): f is File => f !== null));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <>
      {error && <p className="mb-2 text-[12px] text-bad">{error}</p>}
      {!single && ready.length > 1 && (
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={downloadAll} disabled={downloadingAll}>
            {downloadingAll ? <Spinner className="size-3" /> : "↓"} {t("studio.downloadAll", { n: ready.length })}
          </Button>
        </div>
      )}
      <div className={cx("flex items-start gap-3", !single && "snap-x overflow-x-auto pb-2")}>
        {assets.map((a, i) => (
          <MediaItem
            key={`${a.url}-${i}`}
            asset={a}
            index={i}
            total={assets.length}
            single={single}
            fileName={fileName(a, i)}
            onRedo={onRedo}
            onError={setError}
          />
        ))}
      </div>
    </>
  );
}

function MediaItem({
  asset: a,
  index: i,
  total,
  single,
  fileName,
  onRedo,
  onError,
}: {
  asset: Asset;
  index: number;
  total: number;
  single: boolean;
  fileName: string;
  onRedo?: RedoFn;
  onError: (message?: string) => void;
}) {
  const t = useT();
  const canEditCurrent = a.type === "image" && Boolean(a.url);
  const lastPrompt = typeof a.meta?.prompt === "string" ? a.meta.prompt : "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fromCurrent, setFromCurrent] = useState(canEditCurrent);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editError, setEditError] = useState<string>();
  const failed = typeof a.meta?.engine === "string" && a.meta.engine.startsWith("basic");

  const apply = async () => {
    if (!onRedo) return;
    setBusy(true);
    setEditError(undefined);
    try {
      await onRedo(i, text.trim(), fromCurrent && canEditCurrent);
      setText("");
      setOpen(false);
    } catch (e) {
      setEditError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    onError(undefined);
    try {
      await downloadImage(a.url, fileName, t);
    } catch (e) {
      onError(toApiError(e).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <figure
      className={cx(
        "shrink-0 snap-start overflow-hidden rounded-lg border border-line bg-surface-2",
        single ? "mx-auto w-full max-w-sm" : "w-64",
      )}
    >
      <div className="relative">
        {a.type === "video" ? (
          <video src={mediaSrc(a.url)} poster={mediaSrc(a.thumbnail_url) || undefined} controls playsInline className="block max-h-[520px] w-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(a.url)} alt={t("studio.imageAlt", { n: i + 1 })} className="block max-h-[520px] w-full object-contain" />
        )}
        {!single && (
          <figcaption className="tnum absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            {i + 1}/{total}
            {typeof a.meta?.role === "string" && ` · ${ROLE_LABEL[a.meta.role] ? t(ROLE_LABEL[a.meta.role]) : ""}`}
          </figcaption>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[12px] text-white">
            <Spinner className="mr-1.5 size-4" /> {t("studio.generating")}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line bg-surface-1 px-2 py-1.5">
        <button
          type="button"
          onClick={download}
          disabled={!a.url || downloading}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
        >
          {downloading ? <Spinner className="size-3" /> : "↓"} {t("studio.download")}
        </button>
        {onRedo && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            aria-expanded={open}
            className={cx(
              "ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50",
              open ? "text-accent" : "text-fg-2",
            )}
          >
            ✎ {t("studio.editImage")}
          </button>
        )}
      </div>
      {failed && !busy && (
        <p className="border-t border-line bg-surface-1 px-2 py-1 text-[11px] text-warn">{t("studio.fallbackImage")}</p>
      )}

      {onRedo && open && (
        <div className="space-y-2 border-t border-line bg-surface-1 p-2">
          {lastPrompt && <p className="line-clamp-2 text-[11px] text-fg-3">{t("studio.lastRequest", { prompt: lastPrompt })}</p>}
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={
              fromCurrent && canEditCurrent
                ? t("studio.editPlaceholderCurrent")
                : t("studio.editPlaceholderRedo")
            }
            className={cx(inputClass, "resize-y text-[12px]")}
            disabled={busy}
          />
          <div className="flex rounded-md border border-line p-0.5 text-[11px]" role="radiogroup" aria-label={t("studio.editMode")}>
            {[
              { v: true, label: t("studio.modeCurrent"), disabled: !canEditCurrent },
              { v: false, label: t("studio.modeRedo"), disabled: false },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={fromCurrent === o.v}
                disabled={o.disabled || busy}
                onClick={() => setFromCurrent(o.v)}
                className={cx(
                  "flex-1 rounded px-1.5 py-1 font-medium disabled:opacity-40",
                  fromCurrent === o.v ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-surface-2",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {editError && (
            <p role="alert" className="rounded-md bg-bad/10 px-2 py-1.5 text-[11px] leading-relaxed text-bad">
              {editError}
            </p>
          )}
          <Button size="sm" className="w-full" onClick={apply} disabled={busy || (fromCurrent && canEditCurrent && !text.trim())}>
            {busy ? <Spinner className="size-3" /> : "↻"} {fromCurrent && canEditCurrent ? t("studio.applyEdit") : t("studio.redo")}
          </Button>
        </div>
      )}
    </figure>
  );
}

const ROLE_LABEL: Record<string, MessageKey> = {
  designed: "studio.roleDesigned",
  photo: "studio.rolePhoto",
  video: "studio.videoBadge",
  overlay: "studio.roleOverlay",
  panel: "studio.rolePanel",
  center: "studio.roleCenter",
};

function AudioTrack({ asset }: { asset: Asset }) {
  const t = useT();
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <IconMusic /> {t("studio.bgm")}
      </p>
      {asset.meta?.prompt && <p className="mt-0.5 text-[12px] text-fg-3">{asset.meta.prompt}</p>}
      <audio src={asset.url} controls className="mt-2 w-full" preload="none" />
      {asset.meta?.note && <p className="mt-2 text-[12px] leading-relaxed text-fg-3">{asset.meta.note}</p>}
    </div>
  );
}
