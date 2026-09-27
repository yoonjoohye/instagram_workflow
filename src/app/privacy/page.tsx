import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LegalPage, Section, SERVICE_NAME } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: `개인정보처리방침 · ${SERVICE_NAME}`,
  description: `${SERVICE_NAME}의 개인정보 수집·이용·보관·삭제에 관한 방침`,
};

export default function PrivacyPage() {
  return (
    <LegalPage title="개인정보처리방침">
      <p>
        {SERVICE_NAME}(이하 &lsquo;서비스&rsquo;)는 Instagram 프로페셔널(비즈니스·크리에이터) 계정 운영자가 사진과 주제로 게시물을 만들어
        게시하고, 게시물 성과를 확인하며, 댓글에 자동으로 응답할 수 있도록 돕는 도구입니다. 서비스는 이용자의 개인정보를 중요하게 여기며, 서비스 제공에 필요한
        최소한의 정보만 처리합니다.
      </p>

      <Section title="1. 처리하는 정보">
        <table>
          <thead>
            <tr>
              <th>구분</th>
              <th>항목</th>
              <th>출처</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>계정 정보</td>
              <td>Instagram 사용자 ID, 사용자명, 이름, 프로필 사진, 팔로워·팔로잉·게시물 수, 허용한 권한 목록</td>
              <td>Instagram 로그인 시 Meta</td>
            </tr>
            <tr>
              <td>인증 정보</td>
              <td>Instagram 액세스 토큰(암호화 저장), 토큰 만료 시각</td>
              <td>Meta</td>
            </tr>
            <tr>
              <td>콘텐츠</td>
              <td>
                이용자가 업로드한 사진, 이를 편집하거나 새로 생성·합성한 게시물 이미지, 입력한 주제·캡션 형식, 생성된 캡션·해시태그, 게시 결과(게시물 ID·링크)
              </td>
              <td>이용자 업로드, 서비스·Gemini 가 생성</td>
            </tr>
            <tr>
              <td>인사이트</td>
              <td>도달·조회·반응 등 집계 지표, 팔로워/비팔로워 비율, 연령·성별·지역 분포 등 집계 통계</td>
              <td>Meta (Instagram Graph API)</td>
            </tr>
            <tr>
              <td>댓글·메시지</td>
              <td>
                이용자 게시물의 댓글(작성자 사용자명, 내용, 시각), 이용자에게 DM 을 보낸 계정의 사용자명·이름·프로필 사진·팔로워 수·팔로우 여부,
                자동 응답 처리 기록
              </td>
              <td>Meta (Webhook, Instagram Graph API)</td>
            </tr>
            <tr>
              <td>분석 결과</td>
              <td>댓글별 감정 분류(긍정·보통·부정)와 분류 사유</td>
              <td>서비스가 생성</td>
            </tr>
            <tr>
              <td>세션</td>
              <td>로그인 유지를 위한 서명된 쿠키(계정 번호만 포함)</td>
              <td>서비스가 생성</td>
            </tr>
          </tbody>
        </table>
        <p>
          서비스는 게시물을 <b>조회한 개별 계정</b>이나 <b>좋아요를 누른 개별 계정</b> 정보를 수집하지 않습니다(Instagram 이 제공하지 않습니다). 결제
          정보나 비밀번호도 수집하지 않습니다.
        </p>
      </Section>

      <Section title="2. 이용 목적">
        <ul>
          <li>이용자가 입력한 주제와 올린 사진으로 게시물 이미지와 캡션을 만들고, 이용자 계정으로 게시하며 발행 한도를 확인</li>
          <li>게시를 위해 게시물 이미지를 추측할 수 없는 공개 주소로 제공 (Instagram 이 이 주소에서 이미지를 가져감)</li>
          <li>게시물·계정 성과를 대시보드로 보여주고 일자별 기록을 보관</li>
          <li>이용자가 켠 경우에 한해, 새 댓글에 고정 문구로 답글을 달고 댓글 작성자에게 DM 을 보내며 팔로우 여부에 따라 다른 안내를 전송</li>
          <li>댓글의 긍정·보통·부정 분류와 통계 제공</li>
          <li>로그인 유지, 오류 확인, 서비스 보안</li>
        </ul>
        <p>수집한 정보를 광고, 프로필링 판매, 제3자 마케팅에 사용하지 않으며 판매하지 않습니다.</p>
      </Section>

      <Section title="3. 제3자 제공 및 처리 위탁">
        <ul>
          <li>
            <b>Meta Platforms</b> — Instagram 로그인, 게시, 인사이트·댓글 조회, 답글·DM 전송 (이용자의 요청을 수행하기 위한 API 호출)
          </li>
          <li>
            <b>Google (Gemini API)</b> — 게시물 구성·주제 조사·이미지 연출을 위해 업로드한 사진·참고 이미지와 입력한 주제·참고 정보가, 댓글 감정 분류를 위해 댓글 본문과 게시물
            캡션 일부가 전송됩니다. 설정되지 않은 경우 서버 안에서 처리하며 외부로 전송하지 않습니다.
          </li>
          <li>
            <b>Vercel</b>(호스팅), <b>Neon</b>(데이터베이스) — 서비스 운영을 위한 인프라
          </li>
        </ul>
        <p>법령에 따른 요청이 있는 경우를 제외하고, 위 목적 외로 개인정보를 제3자에게 제공하지 않습니다.</p>
      </Section>

      <Section title="4. 보관 기간">
        <ul>
          <li>이용자가 연결을 해제하거나 데이터 삭제를 요청하면 해당 계정과 관련된 모든 정보를 즉시 삭제합니다.</li>
          <li>연결을 유지하는 동안에는 서비스 제공을 위해 보관하며, Meta 가 제공하지 않는 과거 인사이트 기록도 이용자가 삭제할 때까지 보관합니다.</li>
          <li>업로드한 사진과 게시물 이미지는 작업 기록과 함께 보관되며, 연결 해제·데이터 삭제 시 함께 삭제됩니다.</li>
          <li>삭제 요청 처리 확인을 위해 확인 코드와 처리 시각만 남기며, 여기에는 개인을 식별할 수 있는 정보가 포함되지 않습니다.</li>
        </ul>
      </Section>

      <Section title="5. 데이터 삭제 방법">
        <p>
          서비스 안의 <b>&lsquo;연결 해제 및 데이터 삭제&rsquo;</b>, Instagram 설정에서 앱 연결 해제, 또는 문의를 통해 언제든 삭제할 수 있습니다. 자세한 절차는{" "}
          <Link href="/data-deletion">데이터 삭제 안내</Link>를 확인해 주세요.
        </p>
      </Section>

      <Section title="6. 보안">
        <ul>
          <li>액세스 토큰은 암호화(Fernet, AES)해 저장하고, 세션 쿠키는 서명·HttpOnly·Secure 로 발급합니다.</li>
          <li>Meta 에서 오는 Webhook 은 서명(X-Hub-Signature-256)을 검증한 요청만 처리합니다.</li>
          <li>모든 통신은 HTTPS 로 암호화됩니다.</li>
        </ul>
      </Section>

      <Section title="7. 이용자의 권리">
        <p>
          이용자는 자신의 정보에 대한 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 요청은 아래 문의처로 보내 주시면 지체 없이 처리합니다.
        </p>
      </Section>

      <Section title="8. 문의처">
        <p>
          개인정보 관련 문의: <Contact />
        </p>
        <p>이 방침이 변경되면 이 페이지에 시행일과 함께 게시합니다.</p>
      </Section>

      <Section title="English summary">
        <p>
          {SERVICE_NAME} helps Instagram professional account owners create posts from their own topic and photos and publish them, view post insights, and optionally auto-reply to new
          comments. We process only what the service needs: the connected account&apos;s profile and an encrypted access token; uploaded photos, the edited or generated post images (served at unguessable public URLs so Instagram can fetch them for publishing), topics and
          generated captions; aggregate insights provided by the Instagram Graph API; comments on the user&apos;s own posts; and, when a user has messaged the
          account, that sender&apos;s username, name, profile picture, follower count and follow status, used only to send the reply the account owner
          configured. Uploaded photos and topics are sent to Google Gemini to research the topic, design the post and edit or generate its images, and comment text may be sent to Gemini for sentiment
          classification. We never receive or store the identities of people who
          viewed or liked a post, we do not sell data, and we do not use it for advertising. Users can delete all their data at any time via
          &ldquo;연결 해제 및 데이터 삭제&rdquo; in the app, by removing the app in Instagram settings (handled by our data deletion callback), or by
          contacting us — see <Link href="/data-deletion">Data Deletion Instructions</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
