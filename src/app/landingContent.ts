import type { MessageKey } from "@/i18n/core";

/** 첫 화면 '이렇게 써요' 단계 */
export const HOW = [
  { title: "landing.how1Title", body: "landing.how1Body" },
  { title: "landing.how2Title", body: "landing.how2Body" },
  { title: "landing.how3Title", body: "landing.how3Body" },
] as const satisfies readonly { title: MessageKey; body: MessageKey }[];

/** 자주 묻는 질문 — 화면과 검색엔진·AI 답변용 구조화 데이터(FAQPage)가 같은 목록을 씁니다 */
export const FAQ = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({
  q: `landing.faq${n}Q` as MessageKey,
  a: `landing.faq${n}A` as MessageKey,
}));
