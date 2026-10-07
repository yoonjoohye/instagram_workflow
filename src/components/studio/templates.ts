/** 만들기 템플릿 (문구는 i18n/messages/templates.ts) */


/** 한 번 눌러 연출 방향·캡션 양식을 채우는 템플릿 (문구는 i18n/messages/templates.ts) */
export const TEMPLATES = ["auto", "travel", "daily", "info", "toon", "product", "event", "food"] as const;

export type TemplateKey = (typeof TEMPLATES)[number];

export const TEMPLATE_ICON: Record<TemplateKey, string> = { auto: "✨", travel: "✈️", daily: "📸", info: "📰", toon: "🎨", product: "🛍️", event: "🎉", food: "🍽️" };
