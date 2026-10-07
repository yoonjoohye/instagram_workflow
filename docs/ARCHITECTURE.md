# 구조 안내

처음 보는 개발자가 "이 기능은 어디를 고치면 되나"를 바로 찾을 수 있게 정리한 문서입니다.

## 한눈에 보기

```
브라우저 / 휴대폰 앱(WebView)
   │  화면: src/ (Next.js)
   │  /api/py/*  ──(로컬: next.config 프록시 → :8000 / Vercel: vercel.json → api/index.py)──▶ backend/ (FastAPI)
   │                                                                                  ├─ routers/  요청 받기·권한·응답 모양
   │                                                                                  └─ services/ 실제 로직 (Instagram·Gemini·이미지)
   └─ 동영상 업로드는 브라우저 → Vercel Blob 직접 (src/app/api/blob/upload 가 업로드 토큰만 발급)
```

- **DB**: 로컬 SQLite(`local.db`), Vercel 은 Neon Postgres. 표 정의는 `backend/models.py`.
  마이그레이션 도구 없이 `backend/db.py` 의 `_ADDED_COLUMNS` 로 새 칸만 추가합니다 (칸을 지우지는 않음).
- **이미지**: 업로드·결과 이미지는 DB(`MediaBlob`)에 두고 `/api/py/media/<무작위 id>.jpg` 로 공개 — Instagram 이 이 주소에서 가져갑니다.
  동영상만 Vercel Blob 에 둡니다(`services/blobstore.py`).
- **Vercel 함수 60초 제한** 때문에 게시물 만들기는 여러 요청으로 나뉩니다 (조사 → 구성 → 이미지 한 장씩 → 마무리).

## 백엔드 (`backend/`)

| 파일 | 역할 |
|---|---|
| `main.py` | 앱 생성, 라우터 연결, **응답 문구 번역 미들웨어**(아래 i18n) |
| `config.py` | 환경변수 (`.env`, `.env.local`) |
| `deps.py` | 로그인한 계정 꺼내기(`current_account`), Instagram API 클라이언트 |
| `security.py` | 세션 쿠키 서명, 액세스 토큰 암호화 |
| `i18n.py` | 서버 메시지(한국어) → 요청 언어 번역표 |
| `routers/auth.py` | Instagram 로그인·콜백, 여러 계정 연결·전환, **앱 로그인 코드 교환**, 로컬 테스트 로그인, 데이터 삭제 콜백 |
| `routers/studio.py` | 게시물 만들기: 업로드, 조사, 구성, 장별 이미지, AI 없이 직접 만들기, 순서 바꾸기, 캡션 다시 쓰기·해시태그 추천, 마무리 |
| `routers/soundtrack.py` | **음악 넣기**(사진 → 릴스·동영상 스토리)·**동영상 편집**(자르기·소리·음악·대표 화면), 기본 제공 곡, 내 음원 등록 |
| `routers/workflow.py` | 만든 게시물 목록·수정·삭제, **Instagram 게시** |
| `routers/insights.py` | 대시보드·게시물 성과, 매일 cron |
| `routers/autoreply.py` · `webhooks.py` | 댓글 자동 응답 규칙 / Meta Webhook 수신 |
| `routers/sentiment.py` | 댓글 감정 분석 |
| `services/studio/` | 게시물 만들기 로직 — 흐름은 `services/studio/__init__.py` 맨 위 설명 참고 |
| `services/meta_graph.py` · `publishing.py` | Instagram Graph API 호출 / 컨테이너 생성·게시 |
| `services/media_sync.py` | 인스타에서 직접 지운 게시물을 기록에 반영 |
| `services/account_data.py` | 계정 데이터 전체 삭제 (Blob 동영상 포함) |

### 게시물 만들기 요청 흐름

```
PostForm (src/components/studio/PostForm.tsx)
 1. (사진 폴더·사진첩 연결 시) POST /studio/photo-query → 기기 안에서 사진 고르기 (src/lib/photoLibrary)
 2. POST /media/uploads (사진) · Blob 업로드 + POST /media/videos (동영상)
 3. POST /studio/research        → services/studio/research.py   (Gemini + Google 검색)
 4. POST /studio/plan            → services/studio/planning.py   (장 수·레이아웃·캡션·해시태그)
 5. POST /studio/{job}/slides/{i} (장마다) → visuals.render_visual → compose.compose
 6. POST /studio/{job}/finalize  → 검수 화면 (src/components/studio/Review.tsx)
 7. POST /workflow/publish       → services/publishing.py
```

**스토리**(`post_type: "story"`)는 같은 흐름에서 장마다 세로 9:16(1080×1920)으로 만들고(`limits.STORY_SIZE`, 위·아래 가려지는 영역에는 글을 두지 않음),
캡션·해시태그 없이 장마다 **따로** 올립니다. 여러 개를 60초 안에 다 못 올리면 `plan["story_media_ids"]` 에 올린 것을 기록하고
`status: "publishing"` 으로 돌려주며, 화면(`Review.tsx`)이 같은 요청을 다시 보내 이어서 올립니다.
스토리는 24시간 뒤 사라지므로 '인스타에서 삭제됨' 동기화에서 제외합니다.

**음악 넣기·동영상 편집**은 `services/studio/soundtrack.py` 가 ffmpeg(`imageio-ffmpeg` 패키지에 들어 있는 실행 파일)로 합니다.

- `PUT /studio/{job}/soundtrack` — 사진을 차례로 보여 주는 영상에 음악을 입힙니다. 피드는 릴스 한 개, 스토리는 장마다 영상.
  결과는 `plan["soundtrack"]` 에 두고 사진 자체(`assets`)는 그대로라서 `DELETE` 로 빼면 다시 사진으로 올라갑니다.
  만든 뒤 사진이 바뀌면 `stale` 이 되고, 화면이 게시 직전에 같은 설정으로 다시 만듭니다. 게시(`workflow.publish_job`)는 이 영상으로 바꿔 올립니다.
- `POST /studio/{job}/videos/{i}/edit` — 원본은 `meta.video_edit.source` 에 남겨 두고 **항상 원본에서** 다시 만듭니다 (`reset` 으로 원래대로).
- 만든 영상은 Vercel Blob 에 올리고 `MediaBlob(kind="render")` 로 기록합니다 (Blob 이 없으면 로컬처럼 DB 에). 다시 만들거나 지울 때 함께 정리합니다.
- Vercel 60초 안에 끝나도록 빠른 압축 설정을 쓰고, 자르기가 시간 안에 안 끝나면 다시 압축하지 않는 방식으로 대신합니다.
- 기본 제공 곡은 `backend/assets/music/*.m4a` (직접 만든 곡이라 저작권 문제 없음). 바꾸려면 `scripts/make_music.py` 를 고쳐 다시 만듭니다.

Gemini 호출은 전부 `services/studio/gemini.py` 를 거칩니다. 모델이 응답이 없거나 혼잡하면 25초 안에 다음 모델로 넘어가고, 실패한 모델은 5분간 건너뜁니다.

## 프론트엔드 (`src/`)

| 위치 | 내용 |
|---|---|
| `app/` | 페이지 (`/`, `/admin/*`, `/privacy`, `/data-deletion`), SEO 파일(`robots.ts`, `sitemap.ts`, `opengraph-image.tsx`, `llms.txt`) |
| `components/studio/` | 만들기 폼·템플릿·사진 폴더 패널·작업 공간(`Review.tsx`)·이미지 목록·음악 넣기(`SoundtrackCard`, `MusicPicker`)·동영상 편집(`VideoEditor`)·인스타 미리보기 |
| `components/editor/` | 이미지 편집기 (fabric.js — 글자·스티커·그리기·보정·자르기) |
| `components/posts/` | 게시물 성과의 상세·자동 응답 대화상자·표 부품 |
| `components/` | 공통 UI(`ui.tsx`), 차트, 레이아웃(`AdminShell.tsx`), 언어 선택 |
| `lib/api.ts` | `/api/py` 호출 + `useApi` 훅 |
| `lib/photoLibrary/` | 사진 폴더(컴퓨터)·사진첩(앱) 색인과 검색 — CLIP 모델이 브라우저 안에서 돔 (`clip.worker.ts`) |
| `lib/nativeBridge.ts` | 휴대폰 앱과 메시지 주고받기 |
| `lib/uploads.ts` | 업로드 전 사진 줄이기, 동영상 대표 화면 |
| `i18n/` | 화면 문구 (`messages/<화면>.ts`, ko·en·ja), 언어 결정(`server.ts`), `useT()` |
| `middleware.ts` | `/ko`·`/en`·`/ja` 주소와 `?lang=` 를 언어로 |

## 다국어 (i18n)

- **화면 문구**: `src/i18n/messages/<namespace>.ts` 에 ko·en·ja 를 같은 키로. 컴포넌트에서 `const t = useT(); t("studio.title")`.
  서버 컴포넌트는 `const { t } = await getT()`. 문구 안 `{name}` 은 변수, `<b>…</b>` 는 `rich()` 로 바꿉니다.
  키가 빠지거나 변수가 어긋나면 `npm run check:i18n` 이 실패합니다.
- **API 메시지**: 서버 코드는 한국어로 쓰고, `backend/i18n.py` 의 `CATALOG` 에 영어·일본어를 추가하면 응답 직전에 번역됩니다.
  `{e}` 처럼 바뀌는 부분은 틀로 맞추고 안쪽 문장도 다시 번역합니다.

## 휴대폰 앱 ↔ 웹 메시지

앱(`mobile/App.tsx`)이 페이지보다 먼저 `window.__NATIVE_APP__` 를 심고, 웹은 `callNative(type, payload)`(`src/lib/nativeBridge.ts`)로 요청합니다.
**양쪽을 함께 고쳐야 합니다.**

| type | 보내는 값 | 돌려받는 값 | 처리 |
|---|---|---|---|
| `permission` | `request: boolean` | `{ granted }` | `mobile/src/photos.ts` |
| `listPhotos` | `offset, limit` | `[{ id, filename, creationTime }]` (최근 사진부터) | 〃 |
| `thumbnails` | `ids, side` | `[{ id, b64, lat, lng }]` | 〃 |
| `photo` | `photoId` | `{ b64, filename }` (긴 변 1600px) | 〃 |
| `save` | `urls, message` | 저장한 개수 | 〃 (사진첩에 저장) |

로그인은 메시지 대신 앱이 `/api/py/auth/login` 으로 가는 이동을 가로채 시스템 로그인 창을 엽니다 → 콜백이 2분짜리 코드를 앱 주소로 돌려줌 → 앱 화면이 `/auth/app-session?code=` 로 세션을 받습니다.
돌려줄 수 있는 주소는 `instaautostudio://` 와 같은 와이파이의 Expo Go(`exp://<사설 IP>`)뿐입니다.

## 테스트

`npm run check` = 타입 검사 + 번역 점검 + `tests/`(pytest). 테스트는 임시 SQLite·가짜 키를 쓰고 Gemini·Instagram 호출을 모두 가짜로 바꿉니다
(Gemini 는 `monkeypatch.setattr(gemini, "call", …)`). 새 기능을 넣으면 `tests/` 에 흐름 테스트를 하나 추가해 주세요.

## 예전 데이터 호환 (지우지 말 것)

DB 에 남아 있는 예전 작업을 읽기 위한 코드입니다.

- `planning.slide_list` 의 `cover` 구조 — 카드뉴스 전용이던 때 만든 작업
- 장의 `photo`(하나) — 사진 여러 장 합치기 전에 만든 작업 (`routers/studio.py` 장 만들기)
- `job.plan["accent"]` — 포인트 색을 고를 수 있던 때의 작업
- 작업 `provider` 가 `cardnews/…` — 이름을 바꾸기 전에 만든 작업
- `GenerationJob.tone/language/with_music`, `AutoReplyRule.keywords` — 쓰지 않지만 DB 칸이 있어 모델에 남김
