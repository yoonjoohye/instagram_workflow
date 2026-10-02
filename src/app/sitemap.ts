import type { MetadataRoute } from "next";
import { LOCALES } from "@/i18n/config";
import { localizedUrl } from "@/lib/seo";

const PAGES: { path: string; priority: number; changeFrequency: "weekly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/data-deletion", priority: 0.3, changeFrequency: "yearly" },
];

/** 언어별 주소를 모두 싣고, 서로를 hreflang 으로 연결합니다. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.flatMap(({ path, priority, changeFrequency }) =>
    LOCALES.map((locale) => ({
      url: localizedUrl(path, locale),
      lastModified: now,
      changeFrequency,
      priority,
      alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, localizedUrl(path, l)])) },
    })),
  );
}
