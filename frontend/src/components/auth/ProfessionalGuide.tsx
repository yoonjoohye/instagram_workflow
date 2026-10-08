"use client";

/** 인스타 개인 계정 → 프로페셔널(크리에이터·비즈니스) 계정 전환 안내. 무료이고 팔로워·게시물은 그대로입니다. */

import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";

const STEPS: MessageKey[] = ["auth.proStep1", "auth.proStep2", "auth.proStep3", "auth.proStep4"];

export function ProfessionalGuide({ open = false }: { open?: boolean }) {
  const t = useT();
  return (
    <details open={open || undefined} className="rounded-lg border border-line px-3 py-2 text-left">
      <summary className="cursor-pointer text-[13px] font-medium text-fg-2">{t("auth.proTitle")}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-fg-2">
        {STEPS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-fg-3">{t("auth.proNote")}</p>
    </details>
  );
}
