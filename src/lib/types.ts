// 백엔드(FastAPI) 응답 형태. backend/routers/* 와 1:1 로 맞춥니다.

export type MediaKind = "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
export type JobStatus = "draft" | "generating" | "ready" | "publishing" | "published" | "failed" | "deleted"; // deleted = Instagram 에서 지움

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
  granted_scopes: string[];
  token_expires_at: string | null;
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
  with_music: boolean;
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
  /** 인스타 음악 추천·선택 (사진 게시물은 게시 후 인스타 앱에서 추가) */
  music?: { suggestions: MusicPick[]; selected: MusicPick | null } | null;
};

export type MusicPick = { title: string; artist: string; reason?: string; section?: string };

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
export type LinkedAccount = {
  id: number;
  username: string;
  name: string;
  profile_picture_url: string;
  current: boolean;
};
