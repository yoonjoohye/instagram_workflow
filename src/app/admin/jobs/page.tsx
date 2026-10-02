"use client";

import Link from "next/link";
import { useState } from "react";
import { IconExternal, IconMusic } from "@/components/icons";
import { Badge, Button, Empty, Notice, PageHeader, Segmented, Skeleton, StatusDot } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { api, toApiError, useApi } from "@/lib/api";
import { fmtRelative, KIND_LABEL, mediaSrc, STATUS_LABEL } from "@/lib/format";
import { statusTone } from "@/lib/status";
import type { Job, JobStatus, ListOf } from "@/lib/types";

type Filter = "all" | "ready" | "published" | "failed" | "deleted";

const FILTERS: { value: Filter; label: MessageKey }[] = [
  { value: "all", label: "jobs.filterAll" },
  { value: "ready", label: "jobs.filterReady" },
  { value: "published", label: "jobs.filterPublished" },
  { value: "failed", label: "jobs.filterFailed" },
  { value: "deleted", label: "format.status.deleted" },
];

export default function JobsPage() {
  const t = useT();
  const jobs = useApi<ListOf<Job>>("/workflow/jobs?limit=100");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string>();

  const rows = (jobs.data?.data ?? []).filter((j) => filter === "all" || j.status === filter);
  const counts = (s: JobStatus) => (jobs.data?.data ?? []).filter((j) => j.status === s).length;

  async function remove(job: Job) {
    if (!window.confirm(t("jobs.confirmDelete"))) return;
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
        title={t("jobs.title")}
        description={t("jobs.description")}
        action={
          <>
            <Segmented
              ariaLabel={t("jobs.filterAria")}
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({
                value: f.value,
                label: f.value === "all" ? t(f.label) : t("jobs.filterCount", { label: t(f.label), n: counts(f.value as JobStatus) }),
              }))}
            />
            <Link
              href="/admin/studio"
              className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent hover:opacity-90"
            >
              {t("jobs.create")}
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
        <Empty title={filter === "all" ? t("jobs.emptyAll") : t("jobs.emptyFiltered")}>
          <Link href="/admin/studio" className="underline">
            {t("jobs.createFirst")}
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
  const t = useT();
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
            {visualCount > 1 && t("jobs.imageCount", { n: visualCount })}
          </span>
          {hasMusic && (
            <span className="inline-flex items-center rounded bg-black/60 px-1.5 py-0.5 text-white" title={t("jobs.hasMusic")}>
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
            {job.status === "published" ? t("jobs.open") : job.status === "failed" || job.status === "deleted" ? t("jobs.retry") : t("jobs.review")}
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
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onDelete} aria-label={t("common.delete")}>
            {t("common.delete")}
          </Button>
        </div>
      </div>
    </li>
  );
}
