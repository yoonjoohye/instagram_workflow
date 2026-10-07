"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { NewWorkspace } from "@/components/studio/NewWorkspace";
import { useT } from "@/i18n/client";
import { Notice, PageHeader, Skeleton } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import type { Job } from "@/lib/types";
import { Review } from "@/components/studio/Review";

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

  // 사진·동영상을 넣어 작업을 만들었다면 작업 공간이 열리자마자 그 장의 편집기를 띄움
  const [autoEdit, setAutoEdit] = useState<number | null>(null);
  const onCreated = (j: Job, editIndex: number | null) => {
    setJob(j);
    setAutoEdit(editIndex);
    router.replace(`/admin/studio?job=${j.id}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <PageHeader
        title={t("studio.title")}
        description={t("studio.description")}
      />
      {jobError && (
        <div className="mb-6">
          <Notice tone="bad" title={t("studio.jobLoadFailed")}>
            {jobError}
          </Notice>
        </div>
      )}
      {jobId ? (
        // 작업 공간: 왼쪽 편집 · 오른쪽 고정 미리보기
        <div id="review" className="min-w-0 scroll-mt-20">
          {loadingJob ? <Skeleton className="h-[520px] rounded-xl" /> : <Review job={job} onChange={setJob} autoEdit={autoEdit} onAutoEditDone={() => setAutoEdit(null)} />}
        </div>
      ) : (
        // 새로 만들기도 작업 공간과 같은 화면 (빈 상태)
        <NewWorkspace onCreated={onCreated} />
      )}
    </>
  );
}
