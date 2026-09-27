# Instagram Auto Studio

Instagram 계정을 연결하고 프롬프트를 입력하면 사진·영상·배경음악·캡션을 생성해 게시하고, 게시물이 얼마나 노출됐는지 대시보드로 보여주는 웹앱입니다.

- **프론트엔드**: Next.js 15 (App Router) + Tailwind CSS v4 — `src/`
- **백엔드**: FastAPI (Vercel Python 함수) — `backend/`, 엔트리포인트 `api/index.py`
- **외부 연동**: Instagram Graph API (Instagram 로그인 또는 Facebook 로그인), Higgsfield(미디어 생성), Claude API(캡션)

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 소개 + Instagram 계정 연결 |
| `/admin` | 대시보드 — 도달·프로필 조회·참여 계정 추이, 게시물별 도달, 반응한 계정, 팔로워 분포 |
| `/admin/studio` | 프롬프트 → 생성 → 캡션·해시태그 검수 → 게시 |
| `/admin/jobs` | 생성·게시 작업 기록 |
| `/admin/posts` | 게시물별 성과(도달·조회·좋아요·저장·공유·참여율) |
| `/admin/visitors` | 댓글·멘션을 남긴 계정 |

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
Higgsfield·Anthropic 키가 없으면 목업 미디어와 템플릿 캡션으로 동작합니다.

## Vercel 배포

1. 이 저장소를 Vercel 프로젝트로 import 합니다 (Framework: Next.js).
2. **Storage → Neon(Postgres)** 을 연결합니다 → `DATABASE_URL` 자동 주입. (Vercel 에서는 SQLite 를 쓸 수 없습니다.)
3. 환경변수를 등록합니다: `APP_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `CRON_SECRET`, (선택) `HIGGSFIELD_*`, `ANTHROPIC_API_KEY`.
   `PUBLIC_BASE_URL` 을 비워두면 프로덕션 도메인(`https://<project>.vercel.app`)을 자동으로 사용합니다.
4. Meta 앱 설정 (Instagram 로그인)
   - 사용 사례 "Instagram에서 메시지 및 콘텐츠 관리" → **Instagram 로그인을 통한 API 설정**
   - "Instagram 비즈니스 로그인 설정" → 리디렉션 URL: `https://<project>.vercel.app/api/py/auth/callback`
   - 같은 화면 상단의 **Instagram 앱 ID / 시크릿 코드** → `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`
   - Webhooks 는 필요 없습니다.
5. 재배포합니다. `vercel.json` 의 cron 이 매일 03:00(UTC)에 인사이트 스냅샷을 적재하고 Instagram 토큰(60일)을 연장합니다.

> Facebook 로그인 방식을 쓰려면 `INSTAGRAM_APP_*` 대신 `META_APP_ID` / `META_APP_SECRET` 을 넣고, Facebook 로그인 for Business 의 유효한 OAuth 리디렉션 URI 에 같은 콜백 주소를 등록합니다. 이 방식은 Instagram 계정이 Facebook 페이지에 연결되어 있어야 합니다.

## Instagram 계정 조건

- 비즈니스 또는 크리에이터 계정이어야 합니다.
- Meta 앱이 개발 모드일 때는 앱 역할에 등록된 계정만 로그인할 수 있습니다. Instagram 로그인은 **앱 역할 → Instagram 테스터**로 계정을 추가하고, Instagram 앱의 설정 → 웹사이트 권한에서 초대를 수락하세요.
