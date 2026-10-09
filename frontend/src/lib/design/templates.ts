/** 기본 디자인 템플릿 (망고보드처럼 골라서 글자·사진만 바꿔 씀).
 *  좌표는 1080px 너비 기준(피드 1080×1350, 스토리 1080×1920). 색·글꼴은 테마 토큰으로만.
 *  카드뉴스는 표지 → 본문(원하는 장 수만큼 반복) → 마무리, 나머지는 한 장. */

import type { ColorToken } from "./themes";

export type Bg =
  | { kind: "solid"; color: ColorToken }
  | { kind: "gradient"; from: ColorToken; to: ColorToken; angle?: number }
  /** 사진을 꽉 채움 (dim: 위에 깔 검은 막 0~1) */
  | { kind: "photo"; dim?: number };

export type El =
  | {
      t: "text";
      text: string;
      x: number;
      y: number;
      w: number;
      size: number;
      font: "heading" | "body";
      color: ColorToken;
      weight?: number;
      align?: "left" | "center" | "right";
      lh?: number;
      /** 글자 간격 (1/1000 em) */
      ls?: number;
      /** 글자 상자 바탕 */
      box?: ColorToken;
    }
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: ColorToken; r?: number; opacity?: number; stroke?: ColorToken; sw?: number }
  | { t: "circle"; x: number; y: number; r: number; fill: ColorToken; opacity?: number; stroke?: ColorToken; sw?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; color: ColorToken; w: number }
  /** 사진 칸 (사진을 고르지 않으면 '사진을 넣어 주세요' 자리) */
  | { t: "photo"; x: number; y: number; w: number; h: number; r?: number; circle?: boolean };

export type Page = { bg: Bg; els: El[] };
export type Category = "cardnews" | "photo" | "notice" | "story";
export type Template = {
  id: string;
  name: string;
  category: Category;
  post: "feed" | "story";
  /** 카드뉴스: 표지·본문·마무리 / 그 밖: cover 한 장 */
  cover: Page;
  body?: Page;
  end?: Page;
};

const W = 1080;
const FEED_H = 1350;
const STORY_H = 1920;
// 글자 안의 {n} = 본문 번호(01, 02…), {page} = 쪽 번호(2/5)
const txt = (o: Omit<Extract<El, { t: "text" }>, "t">): El => ({ t: "text", ...o });
const rect = (o: Omit<Extract<El, { t: "rect" }>, "t">): El => ({ t: "rect", ...o });
const circle = (o: Omit<Extract<El, { t: "circle" }>, "t">): El => ({ t: "circle", ...o });
const line = (o: Omit<Extract<El, { t: "line" }>, "t">): El => ({ t: "line", ...o });
const photo = (o: Omit<Extract<El, { t: "photo" }>, "t">): El => ({ t: "photo", ...o });
const pageNo = (color: ColorToken, y = FEED_H - 90): El => txt({ text: "{page}", x: W - 260, y, w: 180, size: 30, font: "body", color, align: "right", weight: 600 });

export const TEMPLATES: Template[] = [
  // ── 카드뉴스 ───────────────────────────────────────────
  {
    id: "cn-minimal",
    name: "미니멀 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        rect({ x: 90, y: 110, w: 230, h: 64, fill: "primary", r: 32 }),
        txt({ text: "CARD NEWS", x: 90, y: 124, w: 230, size: 28, font: "body", color: "on_primary", align: "center", weight: 700, ls: 80 }),
        txt({ text: "한눈에 보는\n이번 주 소식", x: 90, y: 430, w: 900, size: 112, font: "heading", color: "text", lh: 1.15, weight: 800 }),
        line({ x1: 90, y1: 760, x2: 250, y2: 760, color: "primary", w: 10 }),
        txt({ text: "부제목을 짧게 적어 주세요", x: 90, y: 810, w: 900, size: 44, font: "body", color: "muted" }),
        txt({ text: "@myaccount", x: 90, y: FEED_H - 110, w: 600, size: 32, font: "body", color: "muted", weight: 600 }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "bg" },
      els: [
        txt({ text: "{n}", x: 90, y: 120, w: 400, size: 150, font: "heading", color: "primary", weight: 800 }),
        txt({ text: "핵심 내용을 한 줄로", x: 90, y: 360, w: 900, size: 72, font: "heading", color: "text", lh: 1.2, weight: 800 }),
        txt({
          text: "설명을 두세 문장으로 적어 주세요.\n짧고 쉬운 말로 쓰면 끝까지 읽혀요.",
          x: 90, y: 560, w: 900, size: 44, font: "body", color: "text", lh: 1.6,
        }),
        pageNo("muted"),
      ],
    },
    end: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "도움이 됐다면\n저장해 두세요!", x: 90, y: 460, w: 900, size: 100, font: "heading", color: "on_primary", lh: 1.2, align: "center", weight: 800 }),
        rect({ x: 340, y: 820, w: 400, h: 90, fill: "on_primary", r: 45 }),
        txt({ text: "@myaccount", x: 340, y: 842, w: 400, size: 40, font: "body", color: "primary", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "cn-bold",
    name: "볼드 컬러 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "gradient", from: "primary", to: "accent", angle: 160 },
      els: [
        txt({ text: "꼭 알아야 할\n5가지", x: 80, y: 360, w: 920, size: 150, font: "heading", color: "on_primary", lh: 1.1, align: "center", weight: 900 }),
        rect({ x: 390, y: 790, w: 300, h: 14, fill: "on_primary", r: 7 }),
        txt({ text: "넘겨서 확인하세요 →", x: 80, y: 860, w: 920, size: 46, font: "body", color: "on_primary", align: "center", weight: 600 }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "primary" },
      els: [
        rect({ x: 70, y: 150, w: 940, h: 1050, fill: "surface", r: 48 }),
        circle({ x: 210, y: 300, r: 80, fill: "primary" }),
        txt({ text: "{n}", x: 130, y: 258, w: 160, size: 70, font: "heading", color: "on_primary", align: "center", weight: 800 }),
        txt({ text: "포인트 제목", x: 140, y: 440, w: 800, size: 78, font: "heading", color: "text", weight: 800 }),
        txt({ text: "내용을 적어 주세요. 꼭 필요한 정보만 담으면 더 잘 읽혀요.", x: 140, y: 580, w: 800, size: 46, font: "body", color: "text", lh: 1.6 }),
        pageNo("on_primary", FEED_H - 110),
      ],
    },
    end: {
      bg: { kind: "gradient", from: "accent", to: "primary", angle: 160 },
      els: [
        txt({ text: "팔로우하고\n더 많은 정보 받기", x: 80, y: 480, w: 920, size: 96, font: "heading", color: "on_primary", lh: 1.2, align: "center", weight: 900 }),
        txt({ text: "@myaccount", x: 80, y: 800, w: 920, size: 48, font: "body", color: "on_primary", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "cn-photo",
    name: "포토 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "photo", dim: 0.35 },
      els: [
        rect({ x: 0, y: 820, w: W, h: 530, fill: "black", opacity: 0.35 }),
        txt({ text: "여행 가기 전\n꼭 챙길 것", x: 80, y: 880, w: 920, size: 110, font: "heading", color: "white", lh: 1.15, weight: 900 }),
        txt({ text: "넘겨 보세요 →", x: 80, y: 1180, w: 920, size: 40, font: "body", color: "white", weight: 600 }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "bg" },
      els: [
        photo({ x: 0, y: 0, w: W, h: 760 }),
        txt({ text: "{n}", x: 80, y: 820, w: 300, size: 64, font: "heading", color: "primary", weight: 800 }),
        txt({ text: "사진 설명 제목", x: 80, y: 910, w: 920, size: 66, font: "heading", color: "text", weight: 800 }),
        txt({ text: "사진에 대한 설명을 짧게 적어 주세요.", x: 80, y: 1010, w: 920, size: 42, font: "body", color: "muted", lh: 1.55 }),
        pageNo("muted"),
      ],
    },
    end: {
      bg: { kind: "photo", dim: 0.5 },
      els: [
        txt({ text: "저장하고\n다음에 꺼내 보세요", x: 80, y: 520, w: 920, size: 92, font: "heading", color: "white", lh: 1.2, align: "center", weight: 900 }),
        txt({ text: "@myaccount", x: 80, y: 820, w: 920, size: 44, font: "body", color: "white", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "cn-check",
    name: "체크리스트 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "surface" },
      els: [
        rect({ x: 60, y: 60, w: 960, h: 1230, fill: "bg", r: 40 }),
        txt({ text: "CHECK LIST", x: 120, y: 160, w: 840, size: 40, font: "body", color: "primary", weight: 800, ls: 120 }),
        txt({ text: "시작 전에\n확인하세요", x: 120, y: 420, w: 840, size: 120, font: "heading", color: "text", lh: 1.15, weight: 900 }),
        circle({ x: 880, y: 1130, r: 70, fill: "primary" }),
        txt({ text: "✓", x: 810, y: 1080, w: 140, size: 80, font: "body", color: "on_primary", align: "center", weight: 800 }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "surface" },
      els: [
        rect({ x: 60, y: 60, w: 960, h: 1230, fill: "bg", r: 40 }),
        txt({ text: "STEP {n}", x: 120, y: 140, w: 600, size: 40, font: "body", color: "primary", weight: 800, ls: 80 }),
        txt({ text: "체크 항목 제목", x: 120, y: 220, w: 840, size: 76, font: "heading", color: "text", weight: 800 }),
        ...[0, 1, 2].flatMap((i): El[] => [
          rect({ x: 120, y: 430 + i * 230, w: 840, h: 190, fill: "surface", r: 28 }),
          circle({ x: 200, y: 525 + i * 230, r: 34, fill: "primary" }),
          txt({ text: "✓", x: 166, y: 494 + i * 230, w: 68, size: 44, font: "body", color: "on_primary", align: "center", weight: 800 }),
          txt({ text: `확인할 내용 ${i + 1}`, x: 270, y: 500 + i * 230, w: 650, size: 44, font: "body", color: "text", weight: 600 }),
        ]),
        pageNo("muted", FEED_H - 140),
      ],
    },
    end: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "모두 체크하셨나요?", x: 80, y: 520, w: 920, size: 96, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "궁금한 점은 댓글로 남겨 주세요", x: 80, y: 700, w: 920, size: 46, font: "body", color: "on_primary", align: "center" }),
      ],
    },
  },

  // ── 사진 + 문구 ────────────────────────────────────────
  {
    id: "ph-headline",
    name: "사진 위 큰 제목",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "photo", dim: 0.15 },
      els: [
        rect({ x: 0, y: 760, w: W, h: 590, fill: "black", opacity: 0.45 }),
        rect({ x: 80, y: 830, w: 200, h: 56, fill: "primary", r: 28 }),
        txt({ text: "NEW", x: 80, y: 840, w: 200, size: 32, font: "body", color: "on_primary", align: "center", weight: 800, ls: 100 }),
        txt({ text: "오늘의 추천 메뉴", x: 80, y: 930, w: 920, size: 104, font: "heading", color: "white", weight: 900 }),
        txt({ text: "짧은 설명을 적어 주세요", x: 80, y: 1080, w: 920, size: 44, font: "body", color: "white" }),
      ],
    },
  },
  {
    id: "ph-polaroid",
    name: "폴라로이드",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "accent" },
      els: [
        rect({ x: 150, y: 140, w: 780, h: 960, fill: "white", r: 6 }),
        photo({ x: 190, y: 180, w: 700, h: 700 }),
        txt({ text: "오늘의 기록", x: 190, y: 930, w: 700, size: 64, font: "heading", color: "black", align: "center" }),
        txt({ text: "2026.10.09", x: 190, y: 1030, w: 700, size: 32, font: "body", color: "black", align: "center" }),
        txt({ text: "@myaccount", x: 80, y: FEED_H - 140, w: 920, size: 36, font: "body", color: "text", align: "center", weight: 600 }),
      ],
    },
  },
  {
    id: "ph-magazine",
    name: "매거진",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        photo({ x: 0, y: 0, w: W, h: 880 }),
        txt({ text: "ISSUE 01", x: 80, y: 930, w: 400, size: 32, font: "body", color: "primary", weight: 800, ls: 120 }),
        txt({ text: "매거진처럼 담은 하루", x: 80, y: 990, w: 920, size: 84, font: "heading", color: "text", weight: 800 }),
        line({ x1: 80, y1: 1130, x2: 1000, y2: 1130, color: "text", w: 3 }),
        txt({ text: "부제목이나 장소를 적어 주세요", x: 80, y: 1160, w: 920, size: 40, font: "body", color: "muted" }),
      ],
    },
  },
  {
    id: "ph-frame",
    name: "컬러 프레임",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "primary" },
      els: [
        photo({ x: 70, y: 70, w: 940, h: 1000, r: 36 }),
        txt({ text: "제목을 적어 주세요", x: 80, y: 1120, w: 920, size: 76, font: "heading", color: "on_primary", weight: 900 }),
        txt({ text: "#태그 #태그", x: 80, y: 1230, w: 920, size: 38, font: "body", color: "on_primary", weight: 600 }),
      ],
    },
  },

  // ── 공지 · 이벤트 · 할인 ──────────────────────────────
  {
    id: "nt-notice",
    name: "공지",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        rect({ x: 0, y: 0, w: W, h: 22, fill: "primary" }),
        txt({ text: "NOTICE", x: 90, y: 150, w: 900, size: 44, font: "body", color: "primary", weight: 800, ls: 160 }),
        txt({ text: "휴무 안내", x: 90, y: 240, w: 900, size: 130, font: "heading", color: "text", weight: 900 }),
        line({ x1: 90, y1: 450, x2: 990, y2: 450, color: "text", w: 4 }),
        txt({
          text: "안녕하세요, 고객 여러분.\n아래 기간 동안 쉬어 갑니다.\n\n기간  10월 9일(목) ~ 10월 12일(일)\n문의  카카오톡 채널",
          x: 90, y: 520, w: 900, size: 46, font: "body", color: "text", lh: 1.7,
        }),
        txt({ text: "늘 감사합니다", x: 90, y: FEED_H - 160, w: 900, size: 44, font: "heading", color: "primary", weight: 800 }),
      ],
    },
  },
  {
    id: "nt-event",
    name: "이벤트",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "gradient", from: "primary", to: "accent", angle: 135 },
      els: [
        circle({ x: 940, y: 160, r: 220, fill: "white", opacity: 0.12 }),
        circle({ x: 120, y: 1240, r: 260, fill: "white", opacity: 0.1 }),
        txt({ text: "EVENT", x: 80, y: 200, w: 920, size: 190, font: "heading", color: "on_primary", align: "center", weight: 900, ls: 40 }),
        txt({ text: "팔로우 & 댓글 이벤트", x: 80, y: 470, w: 920, size: 74, font: "heading", color: "on_primary", align: "center", weight: 800 }),
        rect({ x: 140, y: 640, w: 800, h: 300, fill: "surface", r: 36 }),
        txt({ text: "기간  10.09 – 10.20\n발표  10.22 (개별 연락)", x: 180, y: 700, w: 720, size: 48, font: "body", color: "text", lh: 1.7, align: "center", weight: 600 }),
        rect({ x: 290, y: 1030, w: 500, h: 110, fill: "text", r: 55 }),
        txt({ text: "참여하기", x: 290, y: 1058, w: 500, size: 50, font: "heading", color: "bg", align: "center", weight: 800 }),
      ],
    },
  },
  {
    id: "nt-sale",
    name: "할인",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "SALE", x: 80, y: 120, w: 920, size: 90, font: "heading", color: "on_primary", align: "center", weight: 900, ls: 300 }),
        txt({ text: "50%", x: 80, y: 260, w: 920, size: 330, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        photo({ x: 340, y: 700, w: 400, h: 400, circle: true }),
        txt({ text: "~ 10월 31일까지", x: 80, y: 1160, w: 920, size: 56, font: "body", color: "on_primary", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "nt-open",
    name: "오픈 안내",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "surface" },
      els: [
        rect({ x: 50, y: 50, w: 980, h: 1250, fill: "bg", r: 0, stroke: "primary", sw: 6 }),
        txt({ text: "GRAND OPEN", x: 80, y: 220, w: 920, size: 96, font: "heading", color: "primary", align: "center", weight: 900, ls: 60 }),
        txt({ text: "가게 이름", x: 80, y: 400, w: 920, size: 120, font: "heading", color: "text", align: "center", weight: 900 }),
        line({ x1: 440, y1: 600, x2: 640, y2: 600, color: "primary", w: 6 }),
        txt({ text: "10. 15  WED", x: 80, y: 680, w: 920, size: 110, font: "heading", color: "text", align: "center", weight: 800 }),
        txt({ text: "서울시 OO구 OO로 123\n매일 11:00 – 21:00", x: 80, y: 900, w: 920, size: 44, font: "body", color: "muted", align: "center", lh: 1.6 }),
      ],
    },
  },

  // ── 스토리 ─────────────────────────────────────────────
  {
    id: "st-notice",
    name: "스토리 공지",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "gradient", from: "bg", to: "accent", angle: 180 },
      els: [
        rect({ x: 390, y: 420, w: 300, h: 76, fill: "primary", r: 38 }),
        txt({ text: "공지", x: 390, y: 434, w: 300, size: 40, font: "body", color: "on_primary", align: "center", weight: 800 }),
        txt({ text: "오늘 하루\n쉬어 갑니다", x: 80, y: 620, w: 920, size: 130, font: "heading", color: "text", align: "center", lh: 1.15, weight: 900 }),
        txt({ text: "내일 11시에 다시 열어요 :)", x: 80, y: 1000, w: 920, size: 50, font: "body", color: "muted", align: "center" }),
      ],
    },
  },
  {
    id: "st-question",
    name: "스토리 질문",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "무엇이든\n물어보세요", x: 80, y: 480, w: 920, size: 140, font: "heading", color: "on_primary", align: "center", lh: 1.1, weight: 900 }),
        rect({ x: 160, y: 900, w: 760, h: 360, fill: "white", r: 44 }),
        txt({ text: "여기에 질문 스티커를\n붙여 주세요", x: 160, y: 1010, w: 760, size: 48, font: "body", color: "black", align: "center", lh: 1.5 }),
      ],
    },
  },
  {
    id: "st-photo",
    name: "스토리 사진 + 문구",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "photo", dim: 0.2 },
      els: [
        txt({ text: "오늘의 순간", x: 80, y: 360, w: 920, size: 120, font: "heading", color: "white", align: "center", weight: 900 }),
        txt({ text: "한 줄로 적어 주세요", x: 80, y: 520, w: 920, size: 50, font: "body", color: "white", align: "center" }),
      ],
    },
  },
  {
    id: "st-countdown",
    name: "스토리 디데이",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        txt({ text: "D-3", x: 80, y: 420, w: 920, size: 360, font: "heading", color: "primary", align: "center", weight: 900 }),
        txt({ text: "새로운 소식이 곧 공개돼요", x: 80, y: 880, w: 920, size: 64, font: "heading", color: "text", align: "center", weight: 800 }),
        rect({ x: 240, y: 1060, w: 600, h: 110, fill: "text", r: 55 }),
        txt({ text: "알림 설정하기", x: 240, y: 1090, w: 600, size: 48, font: "body", color: "bg", align: "center", weight: 700 }),
      ],
    },
  },
];

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "cardnews", label: "카드뉴스" },
  { key: "photo", label: "사진 + 문구" },
  { key: "notice", label: "공지·이벤트·할인" },
  { key: "story", label: "스토리" },
];

export const pageSize = (post: "feed" | "story") => ({ w: W, h: post === "story" ? STORY_H : FEED_H });

/** 템플릿 → 만들 장 목록 (카드뉴스는 본문 bodyCount 장) */
export function pagesOf(tpl: Template, bodyCount = 3): { page: Page; n?: number }[] {
  if (tpl.category !== "cardnews" || !tpl.body) return [{ page: tpl.cover }];
  return [
    { page: tpl.cover },
    ...Array.from({ length: bodyCount }, (_, i) => ({ page: tpl.body!, n: i + 1 })),
    ...(tpl.end ? [{ page: tpl.end }] : []),
  ];
}

/** 사진 칸 수 (바탕 사진 포함) */
export const photoSlots = (page: Page) => (page.bg.kind === "photo" ? 1 : 0) + page.els.filter((e) => e.t === "photo").length;
