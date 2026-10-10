// 백엔드(FastAPI) 응답 형태. backend/routers/* 와 1:1 로 맞춥니다.

export type MediaKind = "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
export type JobStatus = "draft" | "generating" | "ready" | "scheduled" | "publishing" | "published" | "failed" | "deleted" | "expired"; // deleted = Instagram 에서 지움, expired = 스토리 24시간 끝남

export type Me = {
  id: number;
  ig_user_id: string;
  username: string;
  name: string;
  profile_picture_url: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  fb_page_name: string;
  /** instagram: Instagram 로그인으로 연동 · facebook: Facebook 페이지를 통해 연동 */
  provider: "instagram" | "facebook";
  facebook_linked: boolean;
  granted_scopes: string[];
  token_expires_at: string | null;
};

/** 서비스 회원 (이메일 로그인) */
export type SessionUser = {
  id: number;
  email: string;
  name: string;
  birth_date: string | null;
  phone: string;
  created_at: string;
  email_verified: boolean;
  /** 이메일 인증을 켠 서비스에서 아직 인증 전 → 화면이 인증부터 하게 함 */
  verify_required: boolean;
};

/** GET /auth/session — 회원 + 지금 고른 Instagram 계정(없으면 null) + 연동 상태 */
export type Session = {
  user: SessionUser;
  account: Me | null;
  accounts: LinkedAccount[];
  facebook: { name: string; pages: { id: string; name: string; ig_username: string }[]; linked_at: string } | null;
  can_link: { instagram: boolean; facebook: boolean };
};

export type Health = {
  ok: boolean;
  meta_configured: boolean;
  auth_mode: "instagram" | "facebook";
  ai_engine: "gemini" | "basic";
  public_base_url: string;
  redirect_uri: string;
  /** 로컬 개발 전용 로그인 사용 가능 (DEV_LOGIN=1 + localhost) */
  dev_login?: boolean;
  /** 회원가입 때 이메일 인증번호를 받는지 (끄면 중복 확인만) */
  signup_email_verify?: boolean;
};

export type Asset = {
  type: "image" | "video" | "audio";
  url: string;
  thumbnail_url: string;
  meta: { prompt?: string; note?: string; mock?: boolean; [k: string]: unknown };
};

export type Job = {
  id: number;
  prompt: string;
  media_kind: MediaKind;
  tone: string;
  language: string;
  status: JobStatus;
  provider: string;
  error: string;
  caption: string;
  hashtags: string[];
  assets: Asset[];
  final_caption: string;
  ig_media_id: string;
  permalink: string;
  published_at: string | null;
  created_at: string;
  sources?: { title: string; uri: string }[];
  requirements?: { requirement: string; how: string }[];
  /** 스토리: 올린 개수 / 전체 */
  story_progress?: { done: number; total: number } | null;
  /** 작업 공간의 컨셉·주제 메모 (AI 버튼들이 참고) */
  settings?: JobSettings;
  /** 예약 게시 시각 (status=scheduled) · 매주 반복 */
  scheduled_at?: string | null;
  repeat_weekly?: boolean;
  /** 매주 반복으로 만들어 둔 다음 주 초안 */
  repeat?: { of: number; suggest_at: string } | null;
  /** 게시 후 성과 (매일 갱신) */
  perf?: PostPerf | null;
  template?: { kind: "builtin" | "design"; id: string } | null;
};

export type PostPerf = { reach: number; likes: number; comments: number; saved: number; shares: number };
/** 템플릿으로 올린 게시물들의 평균 성과 (rate = 도달 대비 반응 %) */
export type TemplatePerf = PostPerf & { posts: number; rate: number };

export type CaptionTone = "casual" | "polite";
export type CaptionLength = "auto" | "short" | "medium" | "long";
export type JobSettings = {
  post_type: "feed" | "story";
  topic: string;
  template: string;
  style: string;
  caption_format: string;
  /** 캡션 자동 작성: 말투·길이·앞서 바란 점 (다음 자동 작성에도 계속 반영) */
  caption_tone?: CaptionTone;
  caption_length?: CaptionLength;
  caption_requests?: string[];
};


/** 동영상 편집 내용 (asset.meta.video_edit) — 원본(source)에서 언제든 다시 만듭니다 */
export type VideoEdit = {
  source: { url: string; thumbnail_url: string };
  start: number;
  end: number | null;
  mute: boolean;
  cover_at: number | null;
  duration: number;
  /** 원본 소리 크기 (0~1, 0 이면 끔) */
  volume?: number;
  /** 꾸미기: 보이는 시간이 같은 것끼리 묶은 투명 PNG 들 (시간은 원본 영상 기준 초, null 은 처음/끝) + 다시 꾸밀 때 불러올 편집기 상태 */
  overlays?: { id: string; url: string; start: number | null; end: number | null }[];
  overlay_layers?: string;
  /** (예전 방식) 영상 전체에 겹친 한 장 */
  overlay_id?: string;
  overlay_url?: string;
  /** 덧붙인 음악들 */
  audios?: VideoAudio[];
  /** (예전 저장본) 음악 하나 */
  audio?: VideoAudio | null;
};

/** 동영상에 덧붙인 소리: 원본 영상 at 초부터, 소리 파일의 offset 초 지점부터 length 초 동안 (null 이면 파일 끝까지) */
export type VideoAudio = { id: string; url: string; name: string; duration: number; at: number; offset: number; length: number | null; volume: number };

export type Quota = { used: number; total: number; remaining: number };

export type MetricKey =
  | "reach"
  | "profile_views"
  | "accounts_engaged"
  | "total_interactions"
  | "website_clicks";

export type Point = { date: string; value: number };

export type Overview = {
  range_days: number;
  profile: {
    username: string;
    followers_count: number;
    follows_count: number;
    media_count: number;
    profile_picture_url: string;
  };
  totals: Record<MetricKey, number | null>;
  trends: Record<MetricKey, number | null>;
  series: Record<MetricKey, Point[]>;
  note: string;
};

export type Breakdown = "country" | "city" | "age" | "gender";

export type Audience = {
  demographics: Record<Breakdown, { label: string; value: number }[]>;
  empty: boolean;
  note: string;
};

export type IgPost = {
  id: string;
  caption?: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD";
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
  is_comment_enabled?: boolean;
  auto_reply?: { id: number; enabled: boolean; public_reply_enabled: boolean; dm_enabled: boolean } | null;
  sentiment?: SentimentCounts | null;
  insights: Partial<
    Record<
      | "reach"
      | "views"
      | "likes"
      | "comments"
      | "saved"
      | "shares"
      | "total_interactions"
      | "ig_reels_avg_watch_time"
      | "replies"
      | "navigation",
      number
    >
  >;
};

export type ListOf<T> = { data: T[]; note?: string };

export type AutoReplyRule = {
  id: number | null;
  exists: boolean;
  job_id: number | null;
  ig_media_id: string;
  /** 규칙 전체 일시정지 스위치 (답글·DM 중 하나라도 켜면 저장 시 켜짐) */
  enabled: boolean;
  public_reply_enabled: boolean;
  public_reply: string;
  dm_enabled: boolean;
  dm_prompt: string;
  link_url: string;
  link_message: string;
  not_following_message: string;
  post?: { prompt: string; status: JobStatus; permalink: string; thumbnail_url: string };
};

export type AutoReplyInput = Pick<
  AutoReplyRule,
  "public_reply_enabled" | "public_reply" | "dm_enabled" | "dm_prompt" | "link_url" | "link_message" | "not_following_message"
>;

export type AutoReplyStatus = {
  auth_mode: "instagram" | "facebook";
  webhook_url: string;
  verify_token_set: boolean;
  app_secret_set: boolean;
  messages_permission: boolean;
  comments_permission: boolean;
};

export type AutoReplyLogStatus = "replied" | "dm_sent" | "awaiting_follow" | "link_sent" | "skipped" | "failed";

export type AutoReplyLog = {
  id: number;
  rule_id: number | null;
  comment_id: string;
  ig_media_id: string;
  commenter_username: string;
  comment_text: string;
  status: AutoReplyLogStatus;
  error: string;
  created_at: string;
  updated_at: string;
};

export type Sentiment = "positive" | "neutral" | "negative";
export type SentimentCounts = Record<Sentiment, number>;

export type SentimentEngine = { engine: "gemini" | "rules"; model: string; last_error: string; min_comments: number };

export type SentimentOverview = SentimentEngine & { totals: SentimentCounts };

export type SentimentSync = SentimentEngine & { posts: number; comments_seen: number; classified: number };

export type SentimentMediaSync = SentimentEngine & {
  comments_seen: number;
  comments_count: number;
  classified: number;
  skipped: boolean;
  counts: SentimentCounts;
};

export type SentimentComment = {
  comment_id: string;
  username: string;
  text: string;
  sentiment: Sentiment;
  reason: string;
  classified_by: "gemini" | "rules";
  commented_at: string | null;
};

export type KeyValue = { key: string; value: number };

export type Breakdowns = {
  range_days: number;
  reach_by_follow: KeyValue[];
  views_by_follow: KeyValue[];
  reach_by_type: KeyValue[];
  views_by_type: KeyValue[];
  interactions_by_type: KeyValue[];
  follows_unfollows: KeyValue[];
  link_taps: KeyValue[];
  interactions: Record<"likes" | "comments" | "saves" | "shares" | "replies", number | null>;
};

export type AudienceGroup = "follower" | "reached" | "engaged";

export type AudienceDetail = {
  demographics: Record<AudienceGroup, Record<Breakdown, { label: string; value: number }[]>>;
  empty: Record<AudienceGroup, boolean>;
  online_followers: number[];
  note: string;
};

export type PostDetailData = {
  id: string;
  kind: "FEED" | "REELS" | "STORY";
  metrics: Record<string, number>;
  profile_activity: KeyValue[];
  navigation: KeyValue[];
  comments: { id: string; username: string; text: string; timestamp: string; like_count: number; reply_count: number }[];
};


/** 이 브라우저에서 연결한 계정 (다시 로그인하지 않고 전환) */
export type LinkedAccount = Me & { current: boolean };
