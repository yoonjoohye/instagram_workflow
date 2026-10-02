import type { Metadata } from "next";
import { AdminShell } from "@/components/AdminShell";

// 로그인 뒤 화면은 검색에 나오지 않게
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
