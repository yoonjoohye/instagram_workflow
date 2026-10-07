/** 만들기 컨셉(템플릿) — 한 번 눌러 연출 방향·캡션 양식을 채우고 예시 주제를 보여 줍니다.
 *  문구(이름·설명·연출·양식·예시)는 i18n/messages/templates.ts */

export const TEMPLATE_GROUPS = {
  personal: ["travel", "food", "cafe", "daily", "ootd", "fitness", "recipe", "celebrate"],
  business: ["product", "launch", "event", "notice", "store", "testimonial", "hiring"],
  content: ["info", "tips", "review", "toon", "quote", "intro"],
} as const;

export type TemplateGroup = keyof typeof TEMPLATE_GROUPS;
export type TemplateKey = "auto" | (typeof TEMPLATE_GROUPS)[TemplateGroup][number];

export const TEMPLATE_ICON: Record<TemplateKey, string> = {
  auto: "✨",
  travel: "✈️", food: "🍽️", cafe: "☕", daily: "📸", ootd: "👗", fitness: "💪", recipe: "🍳", celebrate: "🎂",
  product: "🛍️", launch: "🆕", event: "🎉", notice: "📢", store: "🏪", testimonial: "⭐", hiring: "🙋",
  info: "📰", tips: "💡", review: "🔍", toon: "🎨", quote: "💬", intro: "👋",
};

export const groupOf = (key: TemplateKey): TemplateGroup =>
  (Object.keys(TEMPLATE_GROUPS) as TemplateGroup[]).find((g) => (TEMPLATE_GROUPS[g] as readonly string[]).includes(key)) ?? "personal";
