/** 시즌 캘린더: 다가오는 기념일·시즌에 맞춰 '이번에 올릴 만한 글'을 템플릿과 함께 권합니다 (한국 기준).
 *  날짜가 매년 같은 날은 월·일만, 음력·해마다 바뀌는 날(설날·추석·수능·블랙프라이데이)은 연도별로 적습니다.
 *  음력 날짜는 2028년 설날까지 들어 있어요 — 그 뒤는 해마다 이어서 적어 주세요. */

export type Season = {
  key: string;
  /** 그날 (YYYY-MM-DD, 화면의 현지 날짜) */
  date: string;
  emoji: string;
  /** 디자인 템플릿 검색어 (낱말 하나 — 여러 개면 모두 맞아야 해서 결과가 비기 쉬움) */
  search: string;
  /** 며칠 전부터 권할지 */
  lead: number;
};

type Fixed = { key: string; md: string; emoji: string; search: string; lead?: number };

const FIXED: Fixed[] = [
  { key: "newyear", md: "01-01", emoji: "🎍", search: "공지" },
  { key: "valentine", md: "02-14", emoji: "💝", search: "이벤트" },
  { key: "samiljeol", md: "03-01", emoji: "🇰🇷", search: "휴무" },
  { key: "whiteday", md: "03-14", emoji: "🍬", search: "이벤트" },
  { key: "spring", md: "04-01", emoji: "🌸", search: "신메뉴", lead: 14 },
  { key: "childrensday", md: "05-05", emoji: "🎈", search: "이벤트" },
  { key: "parentsday", md: "05-08", emoji: "💐", search: "이벤트" },
  { key: "teachersday", md: "05-15", emoji: "🍎", search: "이벤트" },
  { key: "summer", md: "07-01", emoji: "🏖", search: "휴무", lead: 14 },
  { key: "liberation", md: "08-15", emoji: "🇰🇷", search: "휴무" },
  { key: "hangul", md: "10-09", emoji: "📜", search: "카드뉴스" },
  { key: "halloween", md: "10-31", emoji: "🎃", search: "이벤트" },
  { key: "pepero", md: "11-11", emoji: "🍫", search: "이벤트" },
  { key: "christmas", md: "12-25", emoji: "🎄", search: "이벤트", lead: 21 },
  { key: "yearend", md: "12-31", emoji: "🎆", search: "카드뉴스", lead: 10 },
];

const DATED: Omit<Season, "lead">[] = [
  { key: "suneung", date: "2026-11-19", emoji: "📝", search: "이벤트" },
  { key: "blackfriday", date: "2026-11-27", emoji: "🛍", search: "할인" },
  { key: "seollal", date: "2027-02-07", emoji: "🧧", search: "휴무" },
  { key: "chuseok", date: "2027-09-15", emoji: "🌕", search: "휴무" },
  { key: "blackfriday", date: "2027-11-26", emoji: "🛍", search: "할인" },
  { key: "seollal", date: "2028-01-27", emoji: "🧧", search: "휴무" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (s: string) => new Date(`${s}T00:00:00`);

/** 오늘부터 각 날의 lead 일 전 ~ 당일까지 해당하는 날들 (가까운 순) */
export function upcoming(today = new Date(), max = 4): (Season & { days: number })[] {
  const t0 = at(ymd(today));
  const all: Season[] = [
    ...[today.getFullYear(), today.getFullYear() + 1].flatMap((y) => FIXED.map((f) => ({ key: f.key, date: `${y}-${f.md}`, emoji: f.emoji, search: f.search, lead: f.lead ?? 21 }))),
    ...DATED.map((d) => ({ ...d, lead: 21 })),
  ];
  return all
    .map((s) => ({ ...s, days: Math.round((at(s.date).getTime() - t0.getTime()) / 86400000) }))
    .filter((s) => s.days >= 0 && s.days <= s.lead)
    .sort((a, b) => a.days - b.days)
    .slice(0, max);
}
