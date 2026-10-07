import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/auth/AuthForms";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  // 회원 화면은 검색에 노출하지 않음
  return { title: t("auth.resetTitle"), robots: { index: false } };
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
