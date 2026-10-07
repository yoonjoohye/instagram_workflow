import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// AI 답변 엔진이 실시간으로 페이지를 읽고 출처로 링크하는 크롤러 (GEO 의 핵심 — 항상 허용)
const AI_SEARCH = ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-SearchBot", "Claude-User", "Applebot"];
// AI 모델 학습용 크롤러. 학습에 쓰이길 원하지 않으면 이 목록을 disallow 로 바꾸면 됩니다.
const AI_TRAINING = ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "meta-externalagent"];

const PRIVATE = ["/admin", "/api/", "/login", "/signup", "/reset-password"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: [...AI_SEARCH, ...AI_TRAINING], allow: ["/", "/llms.txt", "/llms-full.txt"], disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
