"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useMe } from "@/components/AdminShell";
import { IconExternal, IconMusic, IconSpark } from "@/components/icons";
import { Avatar, Badge, Button, Card, cx, Field, inputClass, Notice, PageHeader, Segmented, Skeleton, Spinner, StatusDot } from "@/components/ui";
import { api, toApiError, useApi } from "@/lib/api";
import { composeCaption, fmtDateTime, KIND_LABEL, parseHashtags, STATUS_LABEL } from "@/lib/format";
import type { AspectRatio, Asset, GenerateInput, Job, MediaKind, Quota } from "@/lib/types";
import { statusTone } from "@/lib/status";

const KINDS: { value: MediaKind; hint: string; ratio: AspectRatio }[] = [
  { value: "IMAGE", hint: "피드 사진 1장", ratio: "4:5" },
  { value: "CAROUSEL", hint: "여러 장 슬라이드", ratio: "4:5" },
  { value: "REELS", hint: "세로 영상", ratio: "9:16" },
  { value: "STORIES", hint: "24시간 노출", ratio: "9:16" },
];

const TONES = ["친근한", "전문적인", "감성적인", "유머러스한", "미니멀한"];
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
  };

  return (
    <>
      <PageHeader
        title="만들기"
        description="프롬프트를 입력하면 사진·영상·음악·캡션을 만들고, 검수 후 Instagram 에 게시합니다."
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
        <GenerateForm onCreated={onCreated} seed={job} />
        {loadingJob ? <Skeleton className="h-[520px] rounded-xl" /> : <Review job={job} onChange={setJob} />}
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────── 생성 폼

function GenerateForm({ onCreated, seed }: { onCreated: (j: Job) => void; seed: Job | null }) {
  const engine = useApi<{ media_engine: string }>("/workflow/engine");
  const [form, setForm] = useState<GenerateInput>({
    prompt: "",
    media_kind: "IMAGE",
    count: 3,
    aspect_ratio: "4:5",
    tone: "친근한",
    language: "ko",
    with_music: false,
    style: "",
  });
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string>();

  // 기존 작업을 열면 같은 설정으로 다시 만들 수 있게 폼을 채워둡니다.
  useEffect(() => {
    if (!seed) return;
    setForm((f) => ({
      ...f,
      prompt: seed.prompt,
      media_kind: seed.media_kind,
      tone: seed.tone,
      language: seed.language,
      with_music: seed.with_music,
    }));
  }, [seed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const set = <K extends keyof GenerateInput>(k: K, v: GenerateInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pickKind = (kind: MediaKind) =>
    setForm((f) => ({ ...f, media_kind: kind, aspect_ratio: KINDS.find((k) => k.value === kind)!.ratio }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.prompt.trim().length < 2) {
      setError("프롬프트를 2자 이상 입력하세요.");
      return;
    }
    setBusy(true);
    setElapsed(0);
    setError(undefined);
    try {
      const job = await api<Job>("/workflow/generate", {
        method: "POST",
        json: { ...form, prompt: form.prompt.trim(), count: form.media_kind === "CAROUSEL" ? form.count : 1 },
      });
      onCreated(job);
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const needsVideo = form.media_kind === "REELS";

  return (
    <Card
      title="프롬프트"
      subtitle={
        engine.data && (
          <span className="inline-flex items-center gap-1.5">
            생성 엔진 <Badge tone={engine.data.media_engine === "mock" ? "warn" : "accent"}>{engine.data.media_engine}</Badge>
            {engine.data.media_engine === "mock" && "· 샘플 미디어로 동작 중"}
          </span>
        )
      }
      className="h-fit"
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="무엇을 올릴까요?" htmlFor="prompt">
          <textarea
            id="prompt"
            rows={5}
            maxLength={2000}
            value={form.prompt}
            onChange={(e) => set("prompt", e.target.value)}
            placeholder="예) 비 오는 날 창가에서 마시는 따뜻한 라떼, 아늑한 카페 분위기. 신메뉴 '흑임자 라떼' 출시 홍보"
            className={cx(inputClass, "resize-y leading-relaxed")}
            disabled={busy}
          />
        </Field>

        <Field label="게시 형식">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                disabled={busy}
                onClick={() => pickKind(k.value)}
                aria-pressed={form.media_kind === k.value}
                className={cx(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  form.media_kind === k.value
                    ? "border-accent bg-accent/8"
                    : "border-line-strong hover:bg-surface-2",
                )}
              >
                <span className="block text-[13px] font-semibold">{KIND_LABEL[k.value]}</span>
                <span className="block text-[12px] text-fg-3">{k.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="비율">
            <select
              value={form.aspect_ratio}
              onChange={(e) => set("aspect_ratio", e.target.value as AspectRatio)}
              className={inputClass}
              disabled={busy}
            >
              <option value="4:5">4:5 세로 (피드 권장)</option>
              <option value="1:1">1:1 정사각</option>
              <option value="9:16">9:16 풀스크린</option>
              <option value="16:9">16:9 가로</option>
            </select>
          </Field>
          {form.media_kind === "CAROUSEL" ? (
            <Field label="장수">
              <input
                type="number"
                min={2}
                max={10}
                value={form.count}
                onChange={(e) => set("count", Math.min(10, Math.max(2, Number(e.target.value) || 2)))}
                className={inputClass}
                disabled={busy}
              />
            </Field>
          ) : (
            <Field label="캡션 언어">
              <select value={form.language} onChange={(e) => set("language", e.target.value)} className={inputClass} disabled={busy}>
                <option value="ko">한국어</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
              </select>
            </Field>
          )}
        </div>

        {form.media_kind === "CAROUSEL" && (
          <Field label="캡션 언어">
            <select value={form.language} onChange={(e) => set("language", e.target.value)} className={inputClass} disabled={busy}>
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </Field>
        )}

        <Field label="캡션 톤">
          <div className="flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => set("tone", t)}
                className={cx(
                  "rounded-full border px-3 py-1 text-[12px] font-medium",
                  form.tone === t ? "border-accent bg-accent/10 text-fg" : "border-line-strong text-fg-2 hover:bg-surface-2",
                )}
              >
                {t}
              </button>
            ))}
            <input
              value={TONES.includes(form.tone) ? "" : form.tone}
              onChange={(e) => set("tone", e.target.value || "친근한")}
              placeholder="직접 입력"
              maxLength={64}
              className="w-24 rounded-full border border-line-strong bg-surface-1 px-3 py-1 text-[12px] focus:border-accent focus:outline-none"
              disabled={busy}
            />
          </div>
        </Field>

        <Field label="스타일 (선택)" htmlFor="style" hint="예) 필름 사진 톤, 파스텔, 미니멀 제품 촬영">
          <input
            id="style"
            value={form.style}
            maxLength={200}
            onChange={(e) => set("style", e.target.value)}
            className={inputClass}
            disabled={busy}
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-surface-2">
          <input
            type="checkbox"
            checked={form.with_music}
            onChange={(e) => set("with_music", e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--accent)]"
            disabled={busy}
          />
          <span>
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <IconMusic /> 어울리는 배경음악 생성
            </span>
            <span className="block text-[12px] text-fg-3">
              {needsVideo || form.media_kind === "STORIES"
                ? "영상에 믹싱할 음악 트랙을 함께 만듭니다."
                : "사진 게시물에는 API 로 음악을 붙일 수 없어 참고용 트랙만 생성됩니다."}
            </span>
          </span>
        </label>

        {error && <Notice tone="bad">{error}</Notice>}

        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {busy ? `생성 중… ${elapsed}초` : (
            <>
              <IconSpark width={16} height={16} /> 콘텐츠 생성
            </>
          )}
        </Button>
        {busy && (
          <p className="text-center text-[12px] text-fg-3">
            {needsVideo ? "영상 생성은 1분 이상 걸릴 수 있습니다." : "보통 10~30초 정도 걸립니다."} 창을 닫지 마세요.
          </p>
        )}
      </form>
    </Card>
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

  async function save(): Promise<Job | null> {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api<Job>(`/workflow/jobs/${job!.id}`, {
        method: "PATCH",
        json: { caption, hashtags },
      });
      onChange(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return updated;
    } catch (e) {
      setError(toApiError(e).message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!window.confirm(`@${me.username} 계정에 ${KIND_LABEL[job!.media_kind]}(으)로 지금 게시합니다. 계속할까요?`)) return;
    if (dirty && !(await save())) return;
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

        <MediaStrip assets={visual} />

        {audio.map((a, i) => (
          <AudioTrack key={i} asset={a} />
        ))}
      </Card>

      <Card title="캡션 · 해시태그" subtitle={job.media_kind === "STORIES" ? "스토리에는 캡션이 게시되지 않습니다." : undefined}>
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
              <div className="flex flex-wrap items-center gap-2">
                {job.media_kind === "REELS" && (
                  <label className="mr-2 flex items-center gap-2 text-[13px] text-fg-2">
                    <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} className="accent-[var(--accent)]" />
                    피드에도 공유
                  </label>
                )}
                <Button onClick={save} disabled={!dirty || publishing} loading={saving}>
                  {saved ? "저장됨 ✓" : "저장"}
                </Button>
                <Button
                  variant="primary"
                  onClick={publish}
                  loading={publishing}
                  disabled={overCaption || overTags || visual.length === 0 || quota.data?.remaining === 0}
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

function MediaStrip({ assets }: { assets: Asset[] }) {
  if (!assets.length) return <p className="py-8 text-center text-sm text-fg-3">미디어가 없습니다.</p>;
  const single = assets.length === 1;
  return (
    <div className={cx("flex gap-3", !single && "snap-x overflow-x-auto pb-2")}>
      {assets.map((a, i) => (
        <figure
          key={`${a.url}-${i}`}
          className={cx(
            "relative shrink-0 snap-start overflow-hidden rounded-lg border border-line bg-surface-2",
            single ? "mx-auto w-full max-w-sm" : "w-56",
          )}
        >
          {a.type === "video" ? (
            <video src={a.url} poster={a.thumbnail_url || undefined} controls playsInline className="block max-h-[520px] w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt={`생성된 이미지 ${i + 1}`} className="block max-h-[520px] w-full object-contain" />
          )}
          {!single && (
            <figcaption className="tnum absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
              {i + 1}/{assets.length}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

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
