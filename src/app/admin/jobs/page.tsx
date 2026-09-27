"use client";

import Link from "next/link";
import { useState } from "react";
import { IconExternal, IconMusic } from "@/components/icons";
import { Badge, Button, Empty, Notice, PageHeader, Segmented, Skeleton, StatusDot } from "@/components/ui";
import { api, toApiError, useApi } from "@/lib/api";
import { fmtRelative, KIND_LABEL, mediaSrc, STATUS_LABEL } from "@/lib/format";
import { statusTone } from "@/lib/status";
import type { Job, JobStatus, ListOf } from "@/lib/types";

type Filter = "all" | "ready" | "published" | "failed";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "ready", label: "검수 대기" },
  { value: "published", label: "게시됨" },
  { value: "failed", label: "실패" },
];

export default function JobsPage() {
  const jobs = useApi<ListOf<Job>>("/workflow/jobs?limit=100");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string>();

  const rows = (jobs.data?.data ?? []).filter((j) => filter === "all" || j.status === filter);
  const counts = (s: JobStatus) => (jobs.data?.data ?? []).filter((j) => j.status === s).length;

  async function remove(job: Job) {
    if (!window.confirm("이 작업을 삭제할까요? 이미 게시된 Instagram 게시물은 지워지지 않습니다.")) return;
    try {
      await api(`/workflow/jobs/${job.id}`, { method: "DELETE" });
      jobs.setData({ data: (jobs.data?.data ?? []).filter((j) => j.id !== job.id) });
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  return (
    <>
      <PageHeader
        title="작업함"
        description="프롬프트로 만든 콘텐츠의 생성·검수·게시 기록"
        action={
          <>
            <Segmented
              ariaLabel="상태 필터"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({
                value: f.value,
                label: f.value === "all" ? f.label : `${f.label} ${counts(f.value as JobStatus)}`,
              }))}
            />
            <Link
              href="/admin/studio"
              className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent hover:opacity-90"
            >
              + 새로 만들기
            </Link>
          </>
        }
      />

      {(jobs.error || error) && (
        <div className="mb-6">
          <Notice tone="bad">{jobs.error?.message ?? error}</Notice>
        </div>
      )}

      {jobs.loading && !jobs.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty title={filter === "all" ? "아직 만든 콘텐츠가 없습니다" : "해당 상태의 작업이 없습니다"}>
          <Link href="/admin/studio" className="underline">
            프롬프트로 첫 게시물 만들기
          </Link>
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((job) => (
            <JobCard key={job.id} job={job} onDelete={() => remove(job)} />
          ))}
        </ul>
      )}
    </>
  );
}

function JobCard({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const cover = job.assets.find((a) => a.type !== "audio");
  const visualCount = job.assets.filter((a) => a.type !== "audio").length;
  const hasMusic = job.assets.some((a) => a.type === "audio");
  const tone = statusTone(job.status);

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
      <Link href={`/admin/studio?job=${job.id}`} className="relative block aspect-[4/3] bg-surface-2">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(cover.thumbnail_url || cover.url)} alt="" className="size-full object-cover" loading="lazy" />
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <span className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {KIND_LABEL[job.media_kind]}
            {visualCount > 1 && ` · ${visualCount}장`}
          </span>
          {hasMusic && (
            <span className="inline-flex items-center rounded bg-black/60 px-1.5 py-0.5 text-white" title="배경음악 포함">
              <IconMusic width={12} height={12} />
            </span>
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={tone} icon={<StatusDot tone={tone} />}>
            {STATUS_LABEL[job.status]}
          </Badge>
          <span className="text-[12px] text-fg-3">{fmtRelative(job.published_at ?? job.created_at)}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-[13px] font-medium">{job.prompt}</p>
        <p className="mt-1 line-clamp-2 text-[12px] text-fg-3">{job.caption}</p>
        {job.status === "failed" && job.error && <p className="mt-2 line-clamp-2 text-[12px] text-bad">{job.error}</p>}
        <div className="mt-auto flex items-center gap-2 pt-4">
          <Link
            href={`/admin/studio?job=${job.id}`}
            className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-2"
          >
            {job.status === "published" ? "열기" : job.status === "failed" ? "다시 시도" : "검수·게시"}
          </Link>
          {job.permalink && (
            <a
              href={job.permalink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-fg-2 hover:bg-surface-2"
            >
              Instagram <IconExternal />
            </a>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onDelete} aria-label="삭제">
            삭제
          </Button>
        </div>
      </div>
    </li>
  );
}
