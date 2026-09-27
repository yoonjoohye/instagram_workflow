# Instagram Auto Studio

Instagram 계정을 연결하고 내 사진과 주제를 올리면 Gemini가 카드뉴스(표지·내용·결론)와 캡션을 만들어 검수 후 게시하고, 댓글 자동 응답과 게시물 성과 대시보드를 제공하는 웹앱입니다.

- **프론트엔드**: Next.js 15 (App Router) + Tailwind CSS v4 — `src/`
- **백엔드**: FastAPI (Vercel Python 함수) — `backend/`, 엔트리포인트 `api/index.py`
- **외부 연동**: Instagram Graph API (Instagram 로그인 또는 Facebook 로그인), Google Gemini(카드뉴스 구성·사진 편집·댓글 감정 분석)

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 소개 + Instagram 계정 연결 |
| `/admin` | 대시보드 — 도달·프로필 조회·참여 계정 추이, 누가 봤나(팔로워/비팔로워), 콘텐츠 유형별 성과, 반응 상세, 보는 사람들, 댓글 반응 |
| `/admin/studio` | 내 사진으로 카드뉴스 → 캡션·해시태그·자동 응답 검수 → 게시 |
| `/admin/jobs` | 생성·게시 작업 기록 |
| `/admin/posts` | 게시물별 성과(도달·조회·좋아요·저장·공유·참여율) |
| `/admin/autoreply` | 댓글 자동 응답 — 연결 상태, 게시물별 규칙, 처리 기록 |

> Meta 는 개인정보 정책상 **프로필·게시물을 본 개별 계정을 API 로 제공하지 않습니다.** 대시보드는 도달 같은 집계 수치와, 댓글·멘션으로 식별되는 계정만 보여줍니다.

## 로컬 실행

```bash
npm install
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
cp .env.example .env   # APP_SECRET, INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET 등 채우기

npm run dev:api        # FastAPI  → http://127.0.0.1:8000
npm run dev            # Next.js  → http://localhost:3000 (/api/py/* 는 8000 으로 프록시)
```

Meta 앱의 리디렉션 URL에 `http://localhost:3000/api/py/auth/callback` 을 등록하세요 (Instagram 로그인은 HTTPS 만 허용하므로 로컬 로그인 테스트는 Facebook 로그인 방식이나 터널(ngrok 등)을 쓰세요).
Gemini 키가 없으면 카드뉴스는 기본 구성·기본 보정으로 만들어집니다.

## Vercel 배포

1. 이 저장소를 Vercel 프로젝트로 import 합니다 (Framework: Next.js).
2. **Storage → Neon(Postgres)** 을 연결합니다 → `DATABASE_URL` 자동 주입. (Vercel 에서는 SQLite 를 쓸 수 없습니다.)
3. 환경변수를 등록합니다: `APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `CRON_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `GEMINI_API_KEY`.
   `PUBLIC_BASE_URL` 을 비워두면 프로덕션 도메인(`https://<project>.vercel.app`)을 자동으로 사용합니다.
4. Meta 앱 설정 (Instagram 로그인)
   - 사용 사례 "Instagram에서 메시지 및 콘텐츠 관리" → **Instagram 로그인을 통한 API 설정**
   - "Instagram 비즈니스 로그인 설정" → 리디렉션 URL: `https://<project>.vercel.app/api/py/auth/callback`
   - 같은 화면 상단의 **Instagram 앱 ID / 시크릿 코드** → `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`
   - Webhooks 는 필요 없습니다.
5. 재배포합니다. `vercel.json` 의 cron 이 매일 03:00(UTC)에 인사이트 스냅샷을 적재하고 Instagram 토큰(60일)을 연장합니다.

> Facebook 로그인 방식을 쓰려면 `INSTAGRAM_APP_*` 대신 `META_APP_ID` / `META_APP_SECRET` 을 넣고, Facebook 로그인 for Business 의 유효한 OAuth 리디렉션 URI 에 같은 콜백 주소를 등록합니다. 이 방식은 Instagram 계정이 Facebook 페이지에 연결되어 있어야 합니다.

## 내 사진으로 카드뉴스

스튜디오 → **내 사진으로 카드뉴스**에서 사진을 최대 8장 올리고 주제를 입력하면:

1. Gemini(`GEMINI_TEXT_MODEL`)가 사진을 보고 **표지 → 내용(사진별) → 결론** 구성과 문구, 캡션(지정한 형식), 해시태그를 설계
2. 각 사진을 Gemini 이미지 모델(`GEMINI_IMAGE_MODEL`)로 AI 편집 (실패 시 기본 보정)
3. 서버가 한글 제목·본문을 Pretendard 폰트로 합성해 1080×1350 카드 생성 (AI 모델의 한글 깨짐 방지)
4. 작업함에 검수 대기로 저장 → 슬라이드별 '다시 만들기' → 게시

업로드·결과 이미지는 DB 에 보관되고 `/api/py/media/<id>.jpg` 로 제공되어 Instagram 이 가져갑니다. 슬라이드는 Vercel 함수 시간 제한(60초) 때문에 한 장씩 요청해 만듭니다.
폰트: Pretendard (SIL Open Font License, `backend/assets/fonts/LICENSE.txt`).

## 댓글 자동 응답 (팔로워 전용 링크)

스튜디오의 게시물 화면에서 설정합니다. 게시 전에 저장해 두면 게시되는 순간부터 동작합니다.

1. 키워드가 포함된 댓글 → 공개 답글 + 댓글 작성자에게 DM("이 메시지에 답장하면 링크를 드려요")
2. 사용자가 DM 에 답장 → 팔로워면 링크, 아니면 팔로우 안내 (팔로우 후 다시 답장하면 링크)

Meta 정책상 댓글 작성자에게 보내는 DM 은 댓글당 1통·텍스트만 가능하고, 팔로우 여부는 상대가 먼저 DM 을 보낸 뒤에만 조회할 수 있어서 두 단계입니다.

필요한 설정
- `WEBHOOK_VERIFY_TOKEN` 환경변수
- Meta 앱 → Webhooks: 콜백 URL `https://<project>.vercel.app/api/py/webhooks/instagram`, 인증 토큰, 구독 필드 `comments`, `messages`
- 권한 `instagram_business_manage_messages` (기능 추가 전에 로그인했다면 다시 로그인)
- **Meta 앱이 라이브 상태여야** Webhook 이 실제로 전달되고, 다른 사용자의 댓글·DM 이 들어옵니다 (앱 검수 필요).

## 댓글 감정 분석 (긍정 / 보통 / 부정)

Instagram API 는 댓글 감정 값을 주지 않아 직접 분류합니다. `GEMINI_API_KEY` 가 있으면 Gemini(`GEMINI_MODEL`)로 문맥·반어법·이모지까지 판단하고, 없거나 호출이 실패하면 한국어 키워드·이모지 규칙으로 분류합니다. 분류 결과는 댓글별로 저장해 다시 분류하지 않습니다.

- 게시물 성과 → **댓글 분석** 버튼으로 최근 게시물의 새 댓글을 분류, 게시물별 막대를 누르면 댓글 목록
- 대시보드 → 전체 긍정 비율과 분포
- 새 댓글은 Webhook 으로 들어오는 즉시, 나머지는 매일 cron 으로 분류됩니다.

## Instagram 계정 조건

- 비즈니스 또는 크리에이터 계정이어야 합니다.
- Meta 앱이 개발 모드일 때는 앱 역할에 등록된 계정만 로그인할 수 있습니다. Instagram 로그인은 **앱 역할 → Instagram 테스터**로 계정을 추가하고, Instagram 앱의 설정 → 웹사이트 권한에서 초대를 수락하세요.
