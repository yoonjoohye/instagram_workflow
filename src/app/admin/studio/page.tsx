"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { PostForm } from "@/components/PostForm";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyOn, autoReplySummary, autoReplyValid } from "@/components/AutoReplyCard";
import { IconExternal, IconMusic, IconSpark } from "@/components/icons";
import { Avatar, Badge, Button, Card, cx, Field, inputClass, Notice, PageHeader, Skeleton, Spinner, StatusDot } from "@/components/ui";
import { api, toApiError, useApi } from "@/lib/api";
import { mediaSrc, composeCaption, fmtDateTime, KIND_LABEL, parseHashtags, STATUS_LABEL } from "@/lib/format";
import type { Asset, AutoReplyInput, AutoReplyRule, Job, Quota } from "@/lib/types";
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
        title="만들기"
        description="주제와 컨셉을 적고 사진을 올리면 Gemini가 그 컨셉대로 이미지와 캡션을 만들고, 검수 후 Instagram 에 게시합니다."
        action={
          job && (
            <Button variant="secondary" size="sm" onClick={() => router.push("/admin/studio")}>
              + 새로 만들기
            </Button>
          )
        }
      />
      {jobError && (
        <div className="mb-6">
          <Notice tone="bad" title="작업을 불러오지 못했습니다">
            {jobError}
          </Notice>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
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
        <p className="mt-3 text-sm font-medium text-fg-2">생성된 콘텐츠가 여기에 표시됩니다</p>
        <p className="mt-1 max-w-xs text-[13px] text-fg-3">
          미디어와 캡션을 확인·수정한 뒤 게시하세요. 이전 작업은{" "}
          <Link href="/admin/jobs" className="underline">
            작업함
          </Link>
          에서 열 수 있습니다.
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
    const arLine = arForm && autoReplyOn(arForm) ? `\n댓글 자동 응답: ${autoReplySummary(arForm)}` : "";
    if (!window.confirm(`@${me.username} 계정에 ${KIND_LABEL[job!.media_kind]}(으)로 지금 게시합니다.${arLine}\n계속할까요?`)) return;
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
            {KIND_LABEL[job.media_kind]} 미리보기
            <Badge tone={tone} icon={<StatusDot tone={tone} />}>
              {STATUS_LABEL[job.status]}
            </Badge>
          </span>
        }
        subtitle={`${fmtDateTime(job.created_at)} · 엔진 ${job.provider}`}
      >
        {job.status === "published" && (
          <div className="mb-4">
            <Notice tone="good" title="게시됐습니다">
              {job.permalink ? (
                <a href={job.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                  Instagram 에서 보기 <IconExternal />
                </a>
              ) : (
                "잠시 후 게시물 성과 탭에서 확인할 수 있습니다."
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
              연출 요구사항 반영 {job.requirements.length}개 — Gemini가 이해한 요청과 반영 위치
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
              Gemini가 조사에 참고한 자료 {job.sources.length}개 — 사실 확인용
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

      <Card
        title="캡션 · 게시"
        subtitle={job.media_kind === "STORIES" ? "스토리에는 캡션과 댓글 자동 응답이 적용되지 않습니다." : undefined}
      >
        <div className="space-y-4">
          <Field
            label="본문"
            htmlFor="caption"
            hint={
              <span className={cx(overCaption && "font-medium text-bad")}>
                최종 {finalCaption.length.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()}자
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
            label="해시태그"
            htmlFor="tags"
            hint={
              <span className={cx(overTags && "font-medium text-bad")}>
                {hashtags.length} / {HASHTAG_LIMIT}개 · 공백이나 쉼표로 구분
              </span>
            }
          >
            <input id="tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputClass} disabled={locked} />
          </Field>

          <details className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-fg-2">게시될 형태 미리보기</summary>
            <div className="mt-3 flex gap-3">
              <Avatar src={me.profile_picture_url} name={me.username} size={28} />
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                <span className="font-semibold">{me.username}</span> {finalCaption}
              </p>
            </div>
          </details>

          {supportsAutoReply &&
            (arForm ? (
              <div>
                <p className="mb-2 text-[13px] font-semibold">
                  댓글 자동 응답
                  <span className="ml-1.5 text-[12px] font-normal text-fg-3">
                    {job.status === "published" ? "바꾸면 새 댓글부터 적용됩니다." : "게시와 함께 설정됩니다."}
                  </span>
                </p>
                <AutoReplyFields form={arForm} onChange={setArForm} />
              </div>
            ) : arRule.error ? (
              <Notice tone="bad">자동 응답 설정을 불러오지 못했습니다: {arRule.error.message}</Notice>
            ) : (
              <Skeleton className="h-14" />
            ))}

          {locked && arDirty && (
            <div className="flex justify-end">
              <Button onClick={save} loading={saving} disabled={!arValid}>
                {saved ? "저장됨 ✓" : "자동 응답 저장"}
              </Button>
            </div>
          )}

          {!locked && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <div className="text-[12px] text-fg-3">
                {quota.data ? (
                  <>
                    24시간 발행 한도 <span className="tnum font-medium text-fg-2">{quota.data.remaining}</span> / {quota.data.total} 남음
                  </>
                ) : quota.loading ? (
                  <Spinner />
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
                {job.media_kind === "REELS" && (
                  <label className="mr-2 flex items-center gap-2 text-[13px] text-fg-2">
                    <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="accent-[var(--accent)]" />
                    피드에도 공유
                  </label>
                )}
                <Button onClick={save} disabled={!(dirty || arDirty) || !arValid || publishing} loading={saving}>
                  {saved ? "저장됨 ✓" : "저장"}
                </Button>
                <Button
                  variant="primary"
                  onClick={publish}
                  loading={publishing}
                  disabled={overCaption || overTags || !arValid || visual.length === 0 || quota.data?.remaining === 0}
                >
                  {publishing ? "게시 중…" : job.status === "failed" ? "다시 게시" : "Instagram 에 게시"}
                </Button>
              </div>
            </div>
          )}
          {publishing && (
            <p className="text-right text-[12px] text-fg-3">
              영상은 Instagram 쪽 처리가 끝날 때까지 최대 1분 정도 기다립니다.
            </p>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
        </div>
      </Card>

    </div>
  );
}

type RedoFn = (index: number, instruction: string, fromCurrent: boolean) => Promise<void>;

async function fetchFile(url: string, name: string): Promise<File> {
  const res = await fetch(mediaSrc(url));
  if (!res.ok) throw new Error(`이미지를 받지 못했습니다 (${res.status})`);
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

async function downloadImage(url: string, name: string) {
  await saveFiles([await fetchFile(url, name)]);
}

function MediaStrip({ assets, onRedo, filePrefix = "post" }: { assets: Asset[]; onRedo?: RedoFn; filePrefix?: string }) {
  const [error, setError] = useState<string>();
  const [downloadingAll, setDownloadingAll] = useState(false);
  if (!assets.length) return <p className="py-8 text-center text-sm text-fg-3">미디어가 없습니다.</p>;
  const single = assets.length === 1;
  const fileName = (a: Asset, i: number) => `${filePrefix}-${i + 1}.${a.type === "video" ? "mp4" : "jpg"}`;
  const ready = assets.filter((a) => a.url);

  const downloadAll = async () => {
    setDownloadingAll(true);
    setError(undefined);
    try {
      const files = await Promise.all(
        assets.map((a, i) => (a.url ? fetchFile(a.url, fileName(a, i)) : null)),
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
            {downloadingAll ? <Spinner className="size-3" /> : "↓"} 전체 다운로드 ({ready.length}장)
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
      await downloadImage(a.url, fileName);
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
          <img src={mediaSrc(a.url)} alt={`생성된 이미지 ${i + 1}`} className="block max-h-[520px] w-full object-contain" />
        )}
        {!single && (
          <figcaption className="tnum absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
            {i + 1}/{total}
            {typeof a.meta?.role === "string" && ` · ${ROLE_LABEL[a.meta.role] ?? ""}`}
          </figcaption>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[12px] text-white">
            <Spinner className="mr-1.5 size-4" /> 만드는 중…
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
          {downloading ? <Spinner className="size-3" /> : "↓"} 다운로드
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
            ✎ 이 이미지 수정
          </button>
        )}
      </div>
      {failed && !busy && (
        <p className="border-t border-line bg-surface-1 px-2 py-1 text-[11px] text-warn">이미지 연출 실패 — 기본 편집본이에요</p>
      )}

      {onRedo && open && (
        <div className="space-y-2 border-t border-line bg-surface-1 p-2">
          {lastPrompt && <p className="line-clamp-2 text-[11px] text-fg-3">지난 요청: {lastPrompt}</p>}
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={
              fromCurrent && canEditCurrent
                ? "예) 하늘을 더 노을빛으로, 오른쪽 사람 지우기, 필름 테두리 추가"
                : "예) 두 사진을 필름 스트립처럼 세로로 이어 붙여줘 (비우면 처음 연출대로 다시)"
            }
            className={cx(inputClass, "resize-y text-[12px]")}
            disabled={busy}
          />
          <div className="flex rounded-md border border-line p-0.5 text-[11px]" role="radiogroup" aria-label="수정 방식">
            {[
              { v: true, label: "지금 이미지에서 고치기", disabled: !canEditCurrent },
              { v: false, label: "처음부터 다시", disabled: false },
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
            {busy ? <Spinner className="size-3" /> : "↻"} {fromCurrent && canEditCurrent ? "수정 적용" : "다시 만들기"}
          </Button>
        </div>
      )}
    </figure>
  );
}

const ROLE_LABEL: Record<string, string> = { designed: "디자인", photo: "사진", overlay: "사진+글", panel: "정보", center: "강조" };

function AudioTrack({ asset }: { asset: Asset }) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <IconMusic /> 배경음악
      </p>
      {asset.meta?.prompt && <p className="mt-0.5 text-[12px] text-fg-3">{asset.meta.prompt}</p>}
      <audio src={asset.url} controls className="mt-2 w-full" preload="none" />
      {asset.meta?.note && <p className="mt-2 text-[12px] leading-relaxed text-fg-3">{asset.meta.note}</p>}
    </div>
  );
}
