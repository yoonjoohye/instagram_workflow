"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PostForm } from "@/components/studio/PostForm";
import { useT } from "@/i18n/client";
import { Button, Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import type { Job } from "@/lib/types";
import { Review } from "@/components/studio/Review";

// 게시물당 해시태그 최대 개수

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
