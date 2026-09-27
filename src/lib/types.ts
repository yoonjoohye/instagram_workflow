// 백엔드(FastAPI) 응답 형태. backend/routers/* 와 1:1 로 맞춥니다.

export type MediaKind = "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
export type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";
export type JobStatus = "draft" | "generating" | "ready" | "publishing" | "published" | "failed";

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
  media_engine: string;
  caption_engine: "claude" | "template";
  public_base_url: string;
  redirect_uri: string;
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
};

export type GenerateInput = {
  prompt: string;
  media_kind: MediaKind;
  count: number;
  aspect_ratio: AspectRatio;
  tone: string;
  language: string;
  with_music: boolean;
  style: string;
};

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

export type Visitor = {
  username: string;
  source: "comment" | "mention";
  interactions: number;
  last_text: string;
  last_media_id: string;
  last_seen_at: string | null;
  profile_url: string;
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
  enabled: boolean;
  keywords: string;
  public_reply: string;
  dm_prompt: string;
  link_url: string;
  link_message: string;
  not_following_message: string;
  post?: { prompt: string; status: JobStatus; permalink: string; thumbnail_url: string };
};

export type AutoReplyInput = Omit<AutoReplyRule, "id" | "exists" | "job_id" | "ig_media_id" | "post">;

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
