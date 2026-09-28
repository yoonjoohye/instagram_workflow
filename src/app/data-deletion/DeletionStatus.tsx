"use client";

import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import { useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

type Status = { code: string; status: "completed" | "not_found"; requested_at: string };

/** Meta 삭제 콜백이 돌려준 확인 URL(?code=…)로 들어오면 처리 상태를 보여줍니다. */
export function DeletionStatus() {
  const t = useT();
  const code = useSearchParams().get("code");
  const status = useApi<Status>(code ? `/auth/data-deletion/status?code=${encodeURIComponent(code)}` : null);
  if (!code) return null;
  if (status.loading) return <Notice title={t("legal.statusChecking")} />;
  if (status.error) return <Notice tone="bad" title={t("legal.statusNotFound")}>{status.error.message}</Notice>;
  return (
    <Notice tone="good" title={t("legal.statusDone", { code: status.data?.code })}>
      {status.data?.status === "completed"
        ? t("legal.statusCompleted", { time: fmtDateTime(status.data.requested_at) })
        : t("legal.statusNothing")}
    </Notice>
  );
}
