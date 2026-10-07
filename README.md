# Instagram Auto Studio

사진과 주제로 Instagram 게시물(사진·캐러셀·릴스)을 만들어 게시하고, 댓글에 자동으로 답하고, 성과를 한눈에 보는 서비스입니다.
웹(Next.js) + API(FastAPI) + 휴대폰 앱(Expo, 웹 화면을 감싸고 사진첩 기능을 더함)으로 되어 있습니다.

- 라이브: https://instagram-workflow-nine.vercel.app (Vercel)
- 구조·요청 흐름·코드 규칙은 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** 를 먼저 읽어 주세요.

| 폴더 | 내용 |
|---|---|
| `frontend/` | 웹 화면 (Next.js 15 App Router, React 19, Tailwind v4) — `src/`, `public/`, 번역 키 점검 스크립트 |
| `backend/` | API (FastAPI) — `tests/` (pytest, 외부 API 는 모두 가짜) |
| `api/index.py` | Vercel 이 API 를 실행하는 진입점 (backend 를 불러옴) |
| `mobile/` | iPhone·Android 앱 (Expo SDK 57) — [mobile/README.md](mobile/README.md) |

## 주요 기능

| 화면 | 기능 |
|---|---|
| `/` (`/ko` `/en` `/ja`) | 소개 · 사용법 · 자주 묻는 질문, Instagram 계정 연결 |
| `/admin` | 대시보드 — 도달·프로필 조회·참여 추이, 팔로워/비팔로워, 콘텐츠 유형별 성과, 연령·지역, 접속 시간대, 댓글 반응 |
| `/admin/studio` | 게시물·스토리 만들기 — 주제 + 템플릿 + 사진(폴더·사진첩에서 자동 선택 가능) → 작업 공간(직접 편집·AI 수정, 동영상 자르기·소리·대표 화면, 게시글·해시태그 AI 작성, 실시간 미리보기) → 게시 |
| `/admin/jobs` | 만든 게시물 기록 (인스타에서 지운 게시물은 '삭제됨'으로 동기화) |
| `/admin/posts` | 게시물별 성과, 댓글 허용 켜기/끄기, 게시물별 자동 응답·댓글 감정 분석 |
| `/admin/autoreply` | 댓글 자동 응답 — 연결 상태, 규칙, 처리 기록 |
| `/privacy` `/data-deletion` | 개인정보처리방침 · 데이터 삭제 안내 (Meta 앱 검수용, 3개 언어) |

화면은 한국어·영어·일본어를 지원합니다 (쿠키 → 주소의 언어 → 브라우저 언어 → 영어).

## 로컬 실행

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env      # APP_SECRET, INSTAGRAM_APP_ID/SECRET, GEMINI_API_KEY 등 채우기 (웹·API 가 함께 씀)

cd frontend && npm install
npm run dev:api           # FastAPI → http://127.0.0.1:8000 (저장소 맨 위에서 실행됨)
npm run dev               # Next.js → http://localhost:3000 (/api/py/* 는 8000 으로 프록시)
```

**로그인 없이 화면 확인**: Instagram 로그인은 HTTPS 콜백이 필요해 로컬에서는 바로 안 됩니다.
`.env` 에 `DEV_LOGIN=1` 을 넣으면 로그인 화면에 **'로컬 테스트 로그인'** 버튼이 생겨, DB 에 이미 연결된 계정으로 들어갈 수 있습니다
(이 컴퓨터의 localhost 요청에서만 동작, Vercel 에서는 항상 꺼짐). 처음 계정을 연결할 때는 터널(cloudflared 등)로 HTTPS 주소를 만들어 로그인하세요.

## 확인 (커밋 전에)

```bash
cd frontend
npm run check             # 타입 검사 + 번역 키 점검 + API 테스트 (pytest)
npm run build             # 웹 빌드
```

## 배포 (Vercel)

`main` 브랜치에 push 하면 자동 배포됩니다. 한 프로젝트 안에서 웹(`frontend/`, 주소 `/`)과 API(`api/index.py`, 주소 `/api/py`)를
따로 빌드합니다 — `vercel.json` 의 `experimentalServices`. 저장소가 private 이면 배포가 막힐 수 있습니다(커밋 작성자 권한).

| 환경변수 | 용도 |
|---|---|
| `APP_SECRET` | 세션 서명·토큰 암호화 |
| `DATABASE_URL` | Neon Postgres (Vercel Storage 연결 시 자동) |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | Instagram 로그인 (없으면 `META_APP_ID/SECRET` 로 Facebook 로그인) |
| `GEMINI_API_KEY` | 게시물 구성·이미지 연출·댓글 감정 분석 (이미지 생성은 **결제 연결된 유료 등급** 필요) |
| `BLOB_READ_WRITE_TOKEN` | 동영상·편집한 영상 저장소 (Vercel Blob 스토어 연결 시 자동) |
| `WEBHOOK_VERIFY_TOKEN` | 댓글·DM Webhook 인증 |
| `CRON_SECRET` | 매일 인사이트 적재·토큰 연장 cron 보호 |
| `GOOGLE_SITE_VERIFICATION`, `NAVER_SITE_VERIFICATION` | 서치 콘솔·서치어드바이저 소유 확인 메타 태그 |
| `NPM_CONFIG_ONNXRUNTIME_NODE_INSTALL=skip` | 브라우저용 AI 라이브러리의 서버용 부품 설치 생략 (빌드 시간 초과 방지) |

Meta 앱: Instagram 로그인 리디렉션 URL `https://<도메인>/api/py/auth/callback`,
Webhooks 콜백 `https://<도메인>/api/py/webhooks/instagram` (구독 필드 `comments`, `messages`).
앱이 개발 모드면 **앱 역할 → Instagram 테스터**로 등록된 계정만 로그인됩니다.

## 알아 둘 Instagram·Meta 제약

- 비즈니스·크리에이터(프로페셔널) 계정만 연결됩니다.
- 게시물을 본 **개별 계정 목록은 API 로 제공되지 않습니다** (집계 수치만).
- 인스타그램 음악은 API 로 **붙일 수 없습니다** (게시 후 인스타 앱에서 직접 추가).
- 댓글 작성자에게 보내는 DM 은 댓글당 1통이고, 팔로우 여부는 상대가 먼저 DM 을 보낸 뒤에만 조회됩니다 → 안내 DM 후 답장이 오면 팔로우 여부별 문구 전송.
- Webhook·다른 사용자 댓글은 **Meta 앱이 라이브(검수 통과)** 상태여야 들어옵니다.
