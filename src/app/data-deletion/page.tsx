import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Contact, LegalPage, Section, SERVICE_NAME } from "@/components/LegalPage";
import { DeletionStatus } from "./DeletionStatus";

export const metadata: Metadata = {
  title: `데이터 삭제 안내 · ${SERVICE_NAME}`,
  description: `${SERVICE_NAME}에 저장된 데이터를 삭제하는 방법`,
};

export default function DataDeletionPage() {
  return (
    <LegalPage title="데이터 삭제 안내">
      <Suspense fallback={null}>
        <DeletionStatus />
      </Suspense>

      <p>
        {SERVICE_NAME}에 저장된 정보(계정 정보, 암호화된 액세스 토큰, 업로드한 사진·카드 이미지와 작업 기록, 인사이트 기록, 댓글·DM 자동 응답 기록, 댓글 감정 분석 결과)는
        아래 방법 중 하나로 언제든 모두 삭제할 수 있습니다. 삭제는 즉시 처리되며 되돌릴 수 없습니다. 이미 Instagram 에 게시된 게시물·답글·DM 은
        Instagram 에 남으며, Instagram 앱에서 직접 삭제할 수 있습니다.
      </p>

      <Section title="방법 1. 서비스에서 바로 삭제">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            <Link href="/admin">서비스</Link>에 Instagram 계정으로 로그인합니다.
          </li>
          <li>
            왼쪽 메뉴 아래의 <b>&lsquo;연결 해제 및 데이터 삭제&rsquo;</b>를 누르고 확인합니다.
          </li>
          <li>해당 계정과 관련된 모든 데이터가 즉시 삭제되고 로그아웃됩니다.</li>
        </ol>
      </Section>

      <Section title="방법 2. Instagram 에서 앱 연결 해제">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Instagram 앱에서 <b>설정 → 웹사이트 권한 → 앱 및 웹사이트</b>로 이동합니다.
          </li>
          <li>
            <b>{SERVICE_NAME}</b>을 선택하고 <b>삭제(연결 해제)</b>를 누릅니다.
          </li>
          <li>Meta 가 서비스에 삭제 요청을 전달하며, 서비스는 해당 계정의 데이터를 자동으로 삭제합니다.</li>
        </ol>
      </Section>

      <Section title="방법 3. 문의로 요청">
        <p>
          <Contact />로 Instagram 사용자명과 함께 삭제를 요청해 주세요. 본인 확인 후 지체 없이 삭제하고 결과를 알려드립니다.
        </p>
      </Section>

      <Section title="English">
        <p>
          You can delete all data {SERVICE_NAME} stores about your account (profile, encrypted access token, uploaded photos and card images, insight
          history, comment/DM auto-reply logs and comment sentiment results) at any time: (1) sign in and choose &ldquo;연결 해제 및 데이터
          삭제&rdquo; (Disconnect and delete data) in the sidebar; (2) remove the app in Instagram under Settings → Website permissions → Apps and
          websites — Meta notifies our data deletion callback and your data is deleted automatically, and you receive a confirmation code you can check
          on this page; or (3) contact us. Deletion is immediate and irreversible. Content already published to Instagram remains on Instagram.
        </p>
      </Section>
    </LegalPage>
  );
}
