"use client";

import { useSearchParams } from "next/navigation";
import { Notice } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

type Status = { code: string; status: "completed" | "not_found"; requested_at: string };

/** Meta 삭제 콜백이 돌려준 확인 URL(?code=…)로 들어오면 처리 상태를 보여줍니다. */
export function DeletionStatus() {
  const code = useSearchParams().get("code");
  const status = useApi<Status>(code ? `/auth/data-deletion/status?code=${encodeURIComponent(code)}` : null);
  if (!code) return null;
  if (status.loading) return <Notice title="삭제 요청 확인 중…" />;
  if (status.error) return <Notice tone="bad" title="확인 코드를 찾을 수 없습니다">{status.error.message}</Notice>;
  return (
    <Notice tone="good" title={`삭제 요청이 처리되었습니다 (확인 코드 ${status.data?.code})`}>
      {status.data?.status === "completed"
        ? `요청 시각 ${fmtDateTime(status.data.requested_at)} — 해당 계정의 데이터를 모두 삭제했습니다.`
        : "요청을 받았으며, 서비스에 저장된 데이터가 없어 삭제할 항목이 없었습니다."}
    </Notice>
  );
}
