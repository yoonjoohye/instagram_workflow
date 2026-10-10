/** 기본 디자인 템플릿 (망고보드처럼 골라서 글자·사진만 바꿔 씀).
 *  좌표는 1080px 너비 기준(피드 1080×1350, 스토리 1080×1920). 색·글꼴은 테마 토큰으로만.
 *  카드뉴스는 표지 → 본문(원하는 장 수만큼 반복) → 마무리, 나머지는 한 장. */

import type { ColorToken } from "./themes";

export type Bg =
  | { kind: "solid"; color: ColorToken }
  | { kind: "gradient"; from: ColorToken; to: ColorToken; angle?: number }
  /** 사진을 꽉 채움 (dim: 위에 깔 검은 막 0~1) */
  | { kind: "photo"; dim?: number }
  /** 무늬: 바탕색 color 위에 ink 색으로 (gap: 무늬 간격 px) */
  | { kind: "pattern"; pattern: "dots" | "grid" | "checker" | "lines" | "stripes"; color: ColorToken; ink: ColorToken; gap?: number; alpha?: number };

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
      /** 기울기 (도) */
      angle?: number;
    }
  | {
      t: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill: ColorToken | "none";
      r?: number;
      opacity?: number;
      stroke?: ColorToken;
      sw?: number;
      /** 점선 [선, 빈칸] */
      dash?: [number, number];
      angle?: number;
    }
  /** 별 (points 개 꼭짓점) */
  | { t: "star"; x: number; y: number; r: number; fill: ColorToken; points?: number; angle?: number; opacity?: number }
  | { t: "circle"; x: number; y: number; r: number; fill: ColorToken; opacity?: number; stroke?: ColorToken; sw?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; color: ColorToken; w: number; dash?: [number, number] }
  /** 사진 칸 (사진을 고르지 않으면 '사진을 넣어 주세요' 자리) */
  | { t: "photo"; x: number; y: number; w: number; h: number; r?: number; circle?: boolean };

export type Page = { bg: Bg; els: El[] };
export type Category = "cardnews" | "photo" | "notice" | "promo" | "story";
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
const star = (o: Omit<Extract<El, { t: "star" }>, "t">): El => ({ t: "star", ...o });
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

  // ════ 추가 템플릿 (국내 SNS 디자인에서 흔한 형식을 새로 디자인) ════
  // ── 카드뉴스 ──
  {
    id: "cn-qna",
    name: "Q&A 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "Q&A", x: 80, y: 260, w: 920, size: 260, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "자주 묻는 질문\n한 번에 정리했어요", x: 80, y: 640, w: 920, size: 72, font: "heading", color: "on_primary", align: "center", lh: 1.25, weight: 800 }),
        rect({ x: 390, y: 960, w: 300, h: 80, fill: "on_primary", r: 40 }),
        txt({ text: "넘겨 보기 →", x: 390, y: 980, w: 300, size: 36, font: "body", color: "primary", align: "center", weight: 700 }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "bg" },
      els: [
        rect({ x: 80, y: 150, w: 920, h: 360, fill: "primary", r: 40 }),
        txt({ text: "Q.", x: 130, y: 200, w: 200, size: 84, font: "heading", color: "on_primary", weight: 900 }),
        txt({ text: "질문을 적어 주세요?", x: 130, y: 320, w: 820, size: 60, font: "heading", color: "on_primary", weight: 800 }),
        rect({ x: 80, y: 560, w: 920, h: 560, fill: "surface", r: 40, stroke: "primary", sw: 4 }),
        txt({ text: "A.", x: 130, y: 610, w: 200, size: 84, font: "heading", color: "primary", weight: 900 }),
        txt({ text: "답을 짧고 분명하게 적어 주세요.\n필요하면 한 줄 더 덧붙여요.", x: 130, y: 740, w: 820, size: 46, font: "body", color: "text", lh: 1.6 }),
        pageNo("muted", FEED_H - 110),
      ],
    },
    end: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "더 궁금한 점은\n댓글로 물어보세요", x: 80, y: 480, w: 920, size: 96, font: "heading", color: "on_primary", align: "center", lh: 1.2, weight: 900 }),
        txt({ text: "💬", x: 80, y: 760, w: 920, size: 120, font: "body", color: "on_primary", align: "center" }),
      ],
    },
  },
  {
    id: "cn-top5",
    name: "순위 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "pattern", pattern: "dots", color: "bg", ink: "primary", gap: 54, alpha: 0.25 },
      els: [
        txt({ text: "TOP", x: 80, y: 220, w: 920, size: 120, font: "heading", color: "text", align: "center", weight: 900, ls: 200 }),
        txt({ text: "5", x: 80, y: 330, w: 920, size: 420, font: "heading", color: "primary", align: "center", weight: 900 }),
        txt({ text: "이번 달 인기 순위", x: 80, y: 860, w: 920, size: 76, font: "heading", color: "text", align: "center", weight: 800 }),
        txt({ text: "1위는 마지막 장에서 공개!", x: 80, y: 980, w: 920, size: 42, font: "body", color: "muted", align: "center" }),
      ],
    },
    body: {
      bg: { kind: "pattern", pattern: "dots", color: "bg", ink: "primary", gap: 54, alpha: 0.18 },
      els: [
        circle({ x: 540, y: 330, r: 170, fill: "primary" }),
        txt({ text: "{n}", x: 370, y: 230, w: 340, size: 170, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "위", x: 600, y: 410, w: 100, size: 44, font: "body", color: "on_primary", weight: 700 }),
        txt({ text: "순위 항목 이름", x: 80, y: 600, w: 920, size: 84, font: "heading", color: "text", align: "center", weight: 900 }),
        rect({ x: 140, y: 760, w: 800, h: 320, fill: "surface", r: 32 }),
        txt({ text: "왜 이 순위인지 짧게 설명해 주세요.", x: 190, y: 840, w: 700, size: 46, font: "body", color: "text", align: "center", lh: 1.6 }),
        pageNo("muted", FEED_H - 110),
      ],
    },
    end: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "여러분의 1위는?", x: 80, y: 520, w: 920, size: 110, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "댓글로 알려 주세요 👇", x: 80, y: 700, w: 920, size: 52, font: "body", color: "on_primary", align: "center", weight: 600 }),
      ],
    },
  },
  {
    id: "cn-quote",
    name: "인용구 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        txt({ text: "“", x: 60, y: 60, w: 400, size: 420, font: "body", color: "accent", weight: 900 }),
        txt({ text: "오늘 마음에\n남은 한 문장", x: 120, y: 520, w: 860, size: 116, font: "heading", color: "text", lh: 1.2, weight: 900 }),
        line({ x1: 120, y1: 860, x2: 320, y2: 860, color: "primary", w: 8 }),
        txt({ text: "넘겨서 읽어 보세요", x: 120, y: 900, w: 860, size: 40, font: "body", color: "muted" }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "surface" },
      els: [
        txt({ text: "“", x: 80, y: 80, w: 240, size: 260, font: "body", color: "primary", weight: 900 }),
        txt({ text: "마음에 남은 문장을\n여기에 적어 주세요.", x: 140, y: 470, w: 800, size: 72, font: "heading", color: "text", align: "center", lh: 1.5, weight: 700 }),
        txt({ text: "”", x: 760, y: 760, w: 240, size: 260, font: "body", color: "primary", align: "right", weight: 900 }),
        txt({ text: "— 출처나 사람 이름", x: 140, y: 1120, w: 800, size: 38, font: "body", color: "muted", align: "center" }),
      ],
    },
    end: {
      bg: { kind: "solid", color: "text" },
      els: [
        txt({ text: "공감되면\n저장해 두세요", x: 80, y: 500, w: 920, size: 104, font: "heading", color: "bg", align: "center", lh: 1.2, weight: 900 }),
        txt({ text: "@myaccount", x: 80, y: 820, w: 920, size: 42, font: "body", color: "accent", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "cn-chat",
    name: "대화형 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "accent" },
      els: [
        rect({ x: 120, y: 300, w: 700, h: 200, fill: "surface", r: 60 }),
        txt({ text: "이거 알고 있었어? 🤔", x: 170, y: 370, w: 620, size: 54, font: "body", color: "text", weight: 700 }),
        rect({ x: 260, y: 560, w: 700, h: 200, fill: "primary", r: 60 }),
        txt({ text: "아니?! 빨리 알려 줘", x: 310, y: 630, w: 620, size: 54, font: "body", color: "on_primary", align: "right", weight: 700 }),
        txt({ text: "대화로 보는\n오늘의 꿀팁", x: 80, y: 880, w: 920, size: 96, font: "heading", color: "text", align: "center", lh: 1.2, weight: 900 }),
      ],
    },
    body: {
      bg: { kind: "solid", color: "bg" },
      els: [
        circle({ x: 140, y: 230, r: 50, fill: "accent" }),
        rect({ x: 220, y: 180, w: 700, h: 220, fill: "surface", r: 50 }),
        txt({ text: "질문이나 말을 적어 주세요", x: 270, y: 255, w: 620, size: 48, font: "body", color: "text" }),
        circle({ x: 940, y: 530, r: 50, fill: "primary" }),
        rect({ x: 160, y: 480, w: 700, h: 300, fill: "primary", r: 50 }),
        txt({ text: "대답을 적어 주세요.\n두 줄까지 괜찮아요.", x: 210, y: 545, w: 620, size: 48, font: "body", color: "on_primary", lh: 1.5 }),
        circle({ x: 140, y: 910, r: 50, fill: "accent" }),
        rect({ x: 220, y: 860, w: 560, h: 180, fill: "surface", r: 50 }),
        txt({ text: "오 그렇구나! 👍", x: 270, y: 920, w: 480, size: 48, font: "body", color: "text" }),
        pageNo("muted", FEED_H - 110),
      ],
    },
    end: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "친구에게도\n공유해 주세요 💌", x: 80, y: 500, w: 920, size: 96, font: "heading", color: "on_primary", align: "center", lh: 1.25, weight: 900 }),
      ],
    },
  },
  {
    id: "cn-window",
    name: "레트로 윈도우 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "pattern", pattern: "checker", color: "bg", ink: "accent", gap: 90, alpha: 0.5 },
      els: [
        rect({ x: 110, y: 270, w: 880, h: 780, fill: "text", r: 18 }),
        rect({ x: 90, y: 250, w: 880, h: 780, fill: "surface", r: 18, stroke: "text", sw: 6 }),
        rect({ x: 90, y: 250, w: 880, h: 90, fill: "primary", r: 18, stroke: "text", sw: 6 }),
        circle({ x: 150, y: 295, r: 16, fill: "surface", stroke: "text", sw: 4 }),
        circle({ x: 200, y: 295, r: 16, fill: "surface", stroke: "text", sw: 4 }),
        circle({ x: 250, y: 295, r: 16, fill: "surface", stroke: "text", sw: 4 }),
        txt({ text: "notice.exe", x: 300, y: 272, w: 600, size: 40, font: "body", color: "on_primary", weight: 700 }),
        txt({ text: "레트로하게\n알려 드릴게요", x: 150, y: 460, w: 760, size: 110, font: "heading", color: "text", lh: 1.15, weight: 900 }),
        rect({ x: 150, y: 830, w: 320, h: 100, fill: "accent", r: 12, stroke: "text", sw: 5 }),
        txt({ text: "OK", x: 150, y: 852, w: 320, size: 52, font: "heading", color: "text", align: "center", weight: 900 }),
      ],
    },
    body: {
      bg: { kind: "pattern", pattern: "grid", color: "bg", ink: "text", gap: 60, alpha: 0.12 },
      els: [
        rect({ x: 110, y: 170, w: 880, h: 960, fill: "text", r: 18 }),
        rect({ x: 90, y: 150, w: 880, h: 960, fill: "surface", r: 18, stroke: "text", sw: 6 }),
        rect({ x: 90, y: 150, w: 880, h: 90, fill: "primary", r: 18, stroke: "text", sw: 6 }),
        txt({ text: "step_{n}.txt", x: 140, y: 172, w: 600, size: 40, font: "body", color: "on_primary", weight: 700 }),
        txt({ text: "제목을 적어 주세요", x: 150, y: 320, w: 760, size: 80, font: "heading", color: "text", weight: 900 }),
        txt({ text: "> 내용을 적어 주세요\n> 한 줄씩 적으면\n> 터미널처럼 보여요", x: 150, y: 480, w: 760, size: 50, font: "body", color: "text", lh: 1.7 }),
        pageNo("text", FEED_H - 100),
      ],
    },
    end: {
      bg: { kind: "pattern", pattern: "checker", color: "bg", ink: "accent", gap: 90, alpha: 0.5 },
      els: [
        rect({ x: 170, y: 470, w: 760, h: 420, fill: "text", r: 18 }),
        rect({ x: 150, y: 450, w: 760, h: 420, fill: "surface", r: 18, stroke: "text", sw: 6 }),
        txt({ text: "팔로우 하시겠습니까?", x: 190, y: 560, w: 680, size: 64, font: "heading", color: "text", align: "center", weight: 900 }),
        rect({ x: 210, y: 700, w: 280, h: 100, fill: "primary", r: 12, stroke: "text", sw: 5 }),
        txt({ text: "예", x: 210, y: 722, w: 280, size: 52, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        rect({ x: 570, y: 700, w: 280, h: 100, fill: "surface", r: 12, stroke: "text", sw: 5 }),
        txt({ text: "물론", x: 570, y: 722, w: 280, size: 52, font: "heading", color: "text", align: "center", weight: 900 }),
      ],
    },
  },
  {
    id: "cn-note",
    name: "메모장 카드뉴스",
    category: "cardnews",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "accent" },
      els: [
        rect({ x: 120, y: 160, w: 840, h: 1060, fill: "surface", r: 8, angle: -2 }),
        rect({ x: 420, y: 120, w: 240, h: 70, fill: "primary", opacity: 0.7, angle: -6 }),
        txt({ text: "MEMO", x: 180, y: 300, w: 700, size: 48, font: "body", color: "primary", weight: 800, ls: 200, angle: -2 }),
        txt({ text: "잊지 말고\n기억할 것들", x: 180, y: 420, w: 720, size: 116, font: "heading", color: "text", lh: 1.2, weight: 900, angle: -2 }),
        txt({ text: "✍️ 넘겨서 읽어 보세요", x: 190, y: 860, w: 700, size: 44, font: "body", color: "muted", angle: -2 }),
      ],
    },
    body: {
      bg: { kind: "pattern", pattern: "lines", color: "surface", ink: "primary", gap: 80, alpha: 0.25 },
      els: [
        rect({ x: 140, y: 0, w: 4, h: FEED_H, fill: "primary", opacity: 0.6 }),
        txt({ text: "{n}.", x: 190, y: 150, w: 300, size: 90, font: "heading", color: "primary", weight: 900 }),
        txt({ text: "메모 제목", x: 190, y: 290, w: 800, size: 72, font: "heading", color: "text", weight: 800 }),
        txt({ text: "줄 노트 위에 적듯이\n편하게 써 주세요.\n짧을수록 좋아요.", x: 190, y: 410, w: 800, size: 48, font: "body", color: "text", lh: 1.66 }),
        pageNo("muted", FEED_H - 110),
      ],
    },
    end: {
      bg: { kind: "solid", color: "accent" },
      els: [
        rect({ x: 200, y: 400, w: 680, h: 500, fill: "surface", r: 8, angle: 3 }),
        rect({ x: 420, y: 370, w: 240, h: 70, fill: "primary", opacity: 0.7, angle: 5 }),
        txt({ text: "오늘의 메모 끝!\n저장 잊지 마세요", x: 240, y: 560, w: 600, size: 66, font: "heading", color: "text", align: "center", lh: 1.3, weight: 900, angle: 3 }),
      ],
    },
  },

  // ── 사진 + 문구 ──
  {
    id: "ph-split",
    name: "반반 분할",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "primary" },
      els: [
        photo({ x: 0, y: 0, w: 600, h: FEED_H }),
        txt({ text: "TODAY'S\nPICK", x: 640, y: 160, w: 400, size: 46, font: "body", color: "on_primary", lh: 1.2, weight: 800, ls: 100 }),
        txt({ text: "오늘의\n추천", x: 640, y: 480, w: 420, size: 120, font: "heading", color: "on_primary", lh: 1.1, weight: 900 }),
        line({ x1: 640, y1: 800, x2: 760, y2: 800, color: "on_primary", w: 8 }),
        txt({ text: "짧은 설명을\n적어 주세요", x: 640, y: 850, w: 400, size: 42, font: "body", color: "on_primary", lh: 1.5 }),
      ],
    },
  },
  {
    id: "ph-collage",
    name: "사진 3장 콜라주",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        photo({ x: 60, y: 60, w: 960, h: 660, r: 28 }),
        photo({ x: 60, y: 750, w: 470, h: 420, r: 28 }),
        photo({ x: 550, y: 750, w: 470, h: 420, r: 28 }),
        txt({ text: "오늘의 기록 📸", x: 60, y: 1205, w: 960, size: 64, font: "heading", color: "text", weight: 900 }),
      ],
    },
  },
  {
    id: "ph-film",
    name: "필름 스트립",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "black" },
      els: [
        ...Array.from({ length: 12 }, (_, i): El => rect({ x: 30 + i * 88, y: 60, w: 50, h: 34, fill: "white", r: 6, opacity: 0.85 })),
        ...Array.from({ length: 12 }, (_, i): El => rect({ x: 30 + i * 88, y: 1060, w: 50, h: 34, fill: "white", r: 6, opacity: 0.85 })),
        photo({ x: 60, y: 140, w: 960, h: 880, r: 6 }),
        txt({ text: "FILM 2026 · ISO 400", x: 60, y: 1130, w: 960, size: 34, font: "body", color: "accent", weight: 700, ls: 120 }),
        txt({ text: "필름처럼 남긴 하루", x: 60, y: 1190, w: 960, size: 60, font: "heading", color: "white", weight: 900 }),
      ],
    },
  },
  {
    id: "ph-brutal",
    name: "브루탈 포스터",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "accent" },
      els: [
        rect({ x: 100, y: 100, w: 900, h: 760, fill: "text" }),
        photo({ x: 80, y: 80, w: 900, h: 760 }),
        rect({ x: 80, y: 80, w: 900, h: 760, fill: "none", stroke: "text", sw: 10 }),
        rect({ x: 80, y: 900, w: 720, h: 150, fill: "primary", stroke: "text", sw: 8 }),
        txt({ text: "BIG NEWS!", x: 110, y: 920, w: 680, size: 96, font: "heading", color: "on_primary", weight: 900 }),
        txt({ text: "굵고 분명하게 한 줄로 전해요", x: 80, y: 1110, w: 920, size: 50, font: "body", color: "text", weight: 800 }),
        star({ x: 930, y: 960, r: 90, fill: "surface", points: 8, angle: 12 }),
      ],
    },
  },
  {
    id: "ph-scrap",
    name: "스크랩북",
    category: "photo",
    post: "feed",
    cover: {
      bg: { kind: "pattern", pattern: "grid", color: "bg", ink: "primary", gap: 54, alpha: 0.15 },
      els: [
        rect({ x: 140, y: 130, w: 800, h: 820, fill: "white", angle: 3 }),
        photo({ x: 180, y: 170, w: 720, h: 640 }),
        rect({ x: 120, y: 120, w: 220, h: 64, fill: "accent", opacity: 0.8, angle: -20 }),
        rect({ x: 760, y: 120, w: 220, h: 64, fill: "primary", opacity: 0.7, angle: 18 }),
        txt({ text: "소중한 순간 ♡", x: 180, y: 850, w: 720, size: 60, font: "heading", color: "black", align: "center", weight: 800, angle: 3 }),
        txt({ text: "오늘 있었던 일을\n짧게 적어 주세요", x: 120, y: 1040, w: 840, size: 46, font: "body", color: "text", align: "center", lh: 1.5 }),
      ],
    },
  },

  // ── 공지 · 이벤트 · 할인 ──
  {
    id: "nt-coupon",
    name: "할인 쿠폰",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "pattern", pattern: "stripes", color: "primary", ink: "on_primary", gap: 60, alpha: 0.08 },
      els: [
        txt({ text: "COUPON", x: 80, y: 170, w: 920, size: 80, font: "heading", color: "on_primary", align: "center", weight: 900, ls: 300 }),
        rect({ x: 110, y: 330, w: 860, h: 560, fill: "surface", r: 40 }),
        rect({ x: 150, y: 370, w: 780, h: 480, fill: "none", r: 24, stroke: "primary", sw: 5, dash: [22, 14] }),
        circle({ x: 110, y: 610, r: 50, fill: "primary" }),
        circle({ x: 970, y: 610, r: 50, fill: "primary" }),
        txt({ text: "3,000원", x: 150, y: 450, w: 780, size: 150, font: "heading", color: "primary", align: "center", weight: 900 }),
        txt({ text: "할인 쿠폰", x: 150, y: 640, w: 780, size: 60, font: "heading", color: "text", align: "center", weight: 800 }),
        txt({ text: "2만원 이상 주문 시 · ~10.31", x: 150, y: 740, w: 780, size: 36, font: "body", color: "muted", align: "center" }),
        txt({ text: "이 게시물을 저장하고 보여 주세요!", x: 80, y: 980, w: 920, size: 48, font: "body", color: "on_primary", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "nt-oneplus",
    name: "1+1 이벤트",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "accent" },
      els: [
        star({ x: 540, y: 520, r: 430, fill: "primary", points: 16, angle: 8 }),
        txt({ text: "1+1", x: 80, y: 340, w: 920, size: 300, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "EVENT", x: 80, y: 660, w: 920, size: 64, font: "heading", color: "on_primary", align: "center", weight: 900, ls: 300 }),
        txt({ text: "하나 사면 하나 더!", x: 80, y: 1010, w: 920, size: 76, font: "heading", color: "text", align: "center", weight: 900 }),
        txt({ text: "10월 한 달 동안 · 매장 한정", x: 80, y: 1120, w: 920, size: 40, font: "body", color: "text", align: "center" }),
      ],
    },
  },
  {
    id: "nt-schedule",
    name: "일정 안내",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        txt({ text: "SCHEDULE", x: 90, y: 130, w: 900, size: 40, font: "body", color: "primary", weight: 800, ls: 200 }),
        txt({ text: "이번 주 일정", x: 90, y: 200, w: 900, size: 100, font: "heading", color: "text", weight: 900 }),
        line({ x1: 160, y1: 400, x2: 160, y2: 1200, color: "primary", w: 6 }),
        ...[0, 1, 2, 3].flatMap((i): El[] => [
          circle({ x: 160, y: 440 + i * 200, r: 22, fill: "primary" }),
          txt({ text: ["10.09 THU", "10.11 SAT", "10.13 MON", "10.15 WED"][i], x: 220, y: 412 + i * 200, w: 760, size: 40, font: "body", color: "primary", weight: 800 }),
          txt({ text: "일정 내용을 적어 주세요", x: 220, y: 470 + i * 200, w: 760, size: 48, font: "body", color: "text", weight: 600 }),
        ]),
      ],
    },
  },
  {
    id: "nt-maint",
    name: "변경 안내",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "surface" },
      els: [
        rect({ x: 0, y: 0, w: W, h: 300, fill: "primary" }),
        txt({ text: "⚠️ 꼭 확인해 주세요", x: 80, y: 90, w: 920, size: 44, font: "body", color: "on_primary", weight: 700 }),
        txt({ text: "영업시간 변경 안내", x: 80, y: 160, w: 920, size: 84, font: "heading", color: "on_primary", weight: 900 }),
        ...[0, 1, 2].flatMap((i): El[] => [
          rect({ x: 80, y: 380 + i * 190, w: 920, h: 160, fill: "bg", r: 24 }),
          txt({ text: ["변경 전", "변경 후", "적용일"][i], x: 120, y: 435 + i * 190, w: 260, size: 42, font: "body", color: "primary", weight: 800 }),
          txt({ text: ["11:00 – 21:00", "10:00 – 22:00", "10월 15일부터"][i], x: 380, y: 430 + i * 190, w: 580, size: 50, font: "heading", color: "text", weight: 800 }),
        ]),
        txt({ text: "이용에 참고 부탁드려요. 감사합니다 🙏", x: 80, y: 1000, w: 920, size: 42, font: "body", color: "muted", align: "center" }),
      ],
    },
  },
  {
    id: "nt-giveaway",
    name: "경품 이벤트",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "pattern", pattern: "dots", color: "primary", ink: "on_primary", gap: 60, alpha: 0.2 },
      els: [
        txt({ text: "🎁", x: 80, y: 90, w: 920, size: 170, font: "body", color: "on_primary", align: "center" }),
        txt({ text: "GIVEAWAY", x: 80, y: 310, w: 920, size: 130, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "참여 방법", x: 80, y: 500, w: 920, size: 48, font: "body", color: "on_primary", align: "center", weight: 700 }),
        ...[0, 1, 2].flatMap((i): El[] => [
          rect({ x: 120, y: 590 + i * 170, w: 840, h: 140, fill: "surface", r: 70 }),
          circle({ x: 200, y: 660 + i * 170, r: 46, fill: "primary" }),
          txt({ text: String(i + 1), x: 154, y: 632 + i * 170, w: 92, size: 48, font: "heading", color: "on_primary", align: "center", weight: 900 }),
          txt({ text: ["계정 팔로우하기", "이 게시물 좋아요", "친구 2명 태그하기"][i], x: 280, y: 636 + i * 170, w: 640, size: 48, font: "body", color: "text", weight: 700 }),
        ]),
        txt({ text: "발표 10.22 · DM 으로 연락드려요", x: 80, y: 1140, w: 920, size: 40, font: "body", color: "on_primary", align: "center" }),
      ],
    },
  },
  {
    id: "nt-news",
    name: "뉴스 헤드라인",
    category: "notice",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "surface" },
      els: [
        rect({ x: 0, y: 120, w: W, h: 110, fill: "primary" }),
        txt({ text: "BREAKING NEWS", x: 80, y: 145, w: 920, size: 56, font: "heading", color: "on_primary", weight: 900, ls: 120 }),
        txt({ text: "2026. 10. 09 · 단독", x: 80, y: 290, w: 920, size: 36, font: "body", color: "muted", weight: 600 }),
        txt({ text: "드디어 공개!\n헤드라인을 적어 주세요", x: 80, y: 360, w: 920, size: 96, font: "heading", color: "text", lh: 1.2, weight: 900 }),
        line({ x1: 80, y1: 640, x2: 1000, y2: 640, color: "text", w: 3 }),
        photo({ x: 80, y: 680, w: 920, h: 480 }),
        txt({ text: "사진 설명이나 요약 한 줄", x: 80, y: 1190, w: 920, size: 36, font: "body", color: "muted" }),
      ],
    },
  },

  // ── 메뉴 · 모집 · 후기 ──
  {
    id: "pr-menu",
    name: "메뉴판",
    category: "promo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        txt({ text: "MENU", x: 80, y: 120, w: 920, size: 120, font: "heading", color: "primary", align: "center", weight: 900, ls: 300 }),
        txt({ text: "가게 이름", x: 80, y: 280, w: 920, size: 44, font: "body", color: "muted", align: "center" }),
        ...[0, 1, 2, 3, 4].flatMap((i): El[] => [
          txt({ text: ["아메리카노", "카페라떼", "바닐라라떼", "콜드브루", "오늘의 디저트"][i], x: 120, y: 420 + i * 150, w: 560, size: 52, font: "heading", color: "text", weight: 800 }),
          line({ x1: 120, y1: 500 + i * 150, x2: 960, y2: 500 + i * 150, color: "muted", w: 3, dash: [6, 12] }),
          txt({ text: ["4,500", "5,000", "5,500", "5,000", "6,500"][i], x: 700, y: 420 + i * 150, w: 260, size: 52, font: "heading", color: "primary", align: "right", weight: 800 }),
        ]),
        txt({ text: "매일 10:00 – 21:00", x: 80, y: 1200, w: 920, size: 38, font: "body", color: "muted", align: "center" }),
      ],
    },
  },
  {
    id: "pr-newmenu",
    name: "신메뉴 출시",
    category: "promo",
    post: "feed",
    cover: {
      bg: { kind: "gradient", from: "bg", to: "accent", angle: 180 },
      els: [
        txt({ text: "NEW MENU", x: 80, y: 120, w: 920, size: 100, font: "heading", color: "primary", align: "center", weight: 900, ls: 100 }),
        photo({ x: 230, y: 300, w: 620, h: 620, circle: true }),
        star({ x: 840, y: 380, r: 120, fill: "primary", points: 12, angle: 10 }),
        txt({ text: "NEW", x: 760, y: 352, w: 160, size: 48, font: "heading", color: "on_primary", align: "center", weight: 900, angle: 10 }),
        txt({ text: "메뉴 이름", x: 80, y: 980, w: 920, size: 90, font: "heading", color: "text", align: "center", weight: 900 }),
        txt({ text: "한 줄 소개 · 6,500원", x: 80, y: 1110, w: 920, size: 44, font: "body", color: "text", align: "center" }),
      ],
    },
  },
  {
    id: "pr-recruit",
    name: "모집 공고",
    category: "promo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "primary" },
      els: [
        txt({ text: "WE'RE HIRING", x: 80, y: 130, w: 920, size: 52, font: "body", color: "on_primary", weight: 800, ls: 200 }),
        txt({ text: "함께할\n크루를 찾아요", x: 80, y: 220, w: 920, size: 120, font: "heading", color: "on_primary", lh: 1.15, weight: 900 }),
        rect({ x: 80, y: 560, w: 920, h: 540, fill: "surface", r: 36 }),
        ...[0, 1, 2, 3].flatMap((i): El[] => [
          txt({ text: ["모집", "근무", "시간", "지원"][i], x: 130, y: 610 + i * 120, w: 200, size: 42, font: "body", color: "primary", weight: 800 }),
          txt({ text: ["홀 서빙 2명", "주 3일 이상", "17:00 – 22:00", "DM 또는 프로필 링크"][i], x: 330, y: 606 + i * 120, w: 640, size: 48, font: "body", color: "text", weight: 700 }),
        ]),
        txt({ text: "~10.20 까지 · 경력 무관", x: 80, y: 1170, w: 920, size: 44, font: "body", color: "on_primary", align: "center", weight: 700 }),
      ],
    },
  },
  {
    id: "pr-review",
    name: "후기 카드",
    category: "promo",
    post: "feed",
    cover: {
      bg: { kind: "solid", color: "accent" },
      els: [
        rect({ x: 100, y: 180, w: 880, h: 990, fill: "surface", r: 48 }),
        txt({ text: "REAL REVIEW", x: 100, y: 260, w: 880, size: 40, font: "body", color: "primary", align: "center", weight: 800, ls: 200 }),
        ...[0, 1, 2, 3, 4].map((i): El => star({ x: 340 + i * 100, y: 400, r: 40, fill: "primary" })),
        txt({ text: "“정말 만족스러웠어요!\n다음에 또 올게요”", x: 160, y: 520, w: 760, size: 68, font: "heading", color: "text", align: "center", lh: 1.4, weight: 800 }),
        line({ x1: 440, y1: 820, x2: 640, y2: 820, color: "primary", w: 5 }),
        txt({ text: "손님 이름 님 · 10월 방문", x: 160, y: 860, w: 760, size: 40, font: "body", color: "muted", align: "center" }),
        txt({ text: "소중한 후기 감사합니다 🙏", x: 160, y: 1020, w: 760, size: 44, font: "body", color: "text", align: "center", weight: 700 }),
      ],
    },
  },

  // ── 스토리 ──
  {
    id: "st-poll",
    name: "스토리 투표",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "gradient", from: "primary", to: "accent", angle: 170 },
      els: [
        txt({ text: "골라 주세요!", x: 80, y: 360, w: 920, size: 120, font: "heading", color: "on_primary", align: "center", weight: 900 }),
        txt({ text: "어떤 게 더 좋아요?", x: 80, y: 520, w: 920, size: 52, font: "body", color: "on_primary", align: "center" }),
        rect({ x: 120, y: 700, w: 400, h: 520, fill: "surface", r: 40 }),
        rect({ x: 560, y: 700, w: 400, h: 520, fill: "surface", r: 40 }),
        txt({ text: "A", x: 120, y: 780, w: 400, size: 200, font: "heading", color: "primary", align: "center", weight: 900 }),
        txt({ text: "B", x: 560, y: 780, w: 400, size: 200, font: "heading", color: "primary", align: "center", weight: 900 }),
        txt({ text: "선택 1", x: 120, y: 1080, w: 400, size: 48, font: "body", color: "text", align: "center", weight: 700 }),
        txt({ text: "선택 2", x: 560, y: 1080, w: 400, size: 48, font: "body", color: "text", align: "center", weight: 700 }),
        txt({ text: "↓ 투표 스티커를 여기에 붙여 주세요", x: 80, y: 1320, w: 920, size: 40, font: "body", color: "on_primary", align: "center" }),
      ],
    },
  },
  {
    id: "st-window",
    name: "스토리 레트로 창",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "pattern", pattern: "checker", color: "bg", ink: "accent", gap: 120, alpha: 0.5 },
      els: [
        rect({ x: 110, y: 560, w: 880, h: 760, fill: "text", r: 18 }),
        rect({ x: 90, y: 540, w: 880, h: 760, fill: "surface", r: 18, stroke: "text", sw: 6 }),
        rect({ x: 90, y: 540, w: 880, h: 100, fill: "primary", r: 18, stroke: "text", sw: 6 }),
        txt({ text: "message.exe", x: 140, y: 567, w: 600, size: 44, font: "body", color: "on_primary", weight: 700 }),
        txt({ text: "새 소식이\n도착했어요!", x: 150, y: 740, w: 760, size: 110, font: "heading", color: "text", lh: 1.15, weight: 900 }),
        rect({ x: 150, y: 1100, w: 340, h: 110, fill: "accent", r: 12, stroke: "text", sw: 5 }),
        txt({ text: "확인", x: 150, y: 1125, w: 340, size: 56, font: "heading", color: "text", align: "center", weight: 900 }),
      ],
    },
  },
  {
    id: "st-chat",
    name: "스토리 대화",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "solid", color: "bg" },
      els: [
        txt({ text: "오늘의 대화 💬", x: 80, y: 300, w: 920, size: 90, font: "heading", color: "text", align: "center", weight: 900 }),
        rect({ x: 100, y: 520, w: 720, h: 200, fill: "surface", r: 60 }),
        txt({ text: "오늘 뭐 먹지? 🍜", x: 150, y: 590, w: 640, size: 56, font: "body", color: "text", weight: 700 }),
        rect({ x: 260, y: 780, w: 720, h: 200, fill: "primary", r: 60 }),
        txt({ text: "새로 나온 메뉴 어때?", x: 310, y: 850, w: 620, size: 56, font: "body", color: "on_primary", align: "right", weight: 700 }),
        rect({ x: 100, y: 1040, w: 560, h: 200, fill: "surface", r: 60 }),
        txt({ text: "좋아 좋아 👍", x: 150, y: 1110, w: 480, size: 56, font: "body", color: "text", weight: 700 }),
      ],
    },
  },
  {
    id: "st-today",
    name: "스토리 오늘의 일정",
    category: "story",
    post: "story",
    cover: {
      bg: { kind: "pattern", pattern: "grid", color: "surface", ink: "primary", gap: 60, alpha: 0.12 },
      els: [
        txt({ text: "TODAY", x: 80, y: 300, w: 920, size: 64, font: "body", color: "primary", align: "center", weight: 800, ls: 300 }),
        txt({ text: "10월 9일 목요일", x: 80, y: 400, w: 920, size: 90, font: "heading", color: "text", align: "center", weight: 900 }),
        ...[0, 1, 2, 3].flatMap((i): El[] => [
          rect({ x: 120, y: 620 + i * 230, w: 840, h: 190, fill: "bg", r: 30, stroke: "primary", sw: 3 }),
          txt({ text: ["11:00", "14:00", "17:00", "20:00"][i], x: 160, y: 680 + i * 230, w: 220, size: 52, font: "heading", color: "primary", weight: 900 }),
          txt({ text: "일정 내용", x: 400, y: 684 + i * 230, w: 520, size: 50, font: "body", color: "text", weight: 700 }),
        ]),
      ],
    },
  },
];

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "cardnews", label: "카드뉴스" },
  { key: "photo", label: "사진 + 문구" },
  { key: "notice", label: "공지·이벤트·할인" },
  { key: "promo", label: "메뉴·모집·후기" },
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

/** 글로 채우기 (글 → 카드뉴스): 표지 제목·부제목, 본문 장마다 제목·설명, 마무리 한 줄 */
export type TextFill = {
  cover: { title: string; sub: string };
  pages: { title: string; body: string }[];
  end: { title: string };
};

/** 장의 글자 자리 중 바꿔 넣을 곳: 번호·쪽수·계정·짧은 꼬리표(CARD NEWS, Q 등)는 빼고 큰 글자부터 (제목 → 설명) */
function textSlots(page: Page): number[] {
  return page.els
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.t === "text" && e.size >= 36 && !/\{n\}|\{page\}|^@/.test(e.text) && e.text.replace(/\s/g, "").length > 3)
    .sort((a, b) => (b.e as { size: number }).size - (a.e as { size: number }).size || (a.e as { y: number }).y - (b.e as { y: number }).y)
    .map(({ i }) => i);
}

function withTexts(page: Page, texts: string[]): Page {
  const slots = textSlots(page);
  const els = page.els.map((e, i) => {
    const k = slots.indexOf(i);
    const v = k >= 0 ? texts[k]?.trim() : "";
    return v && e.t === "text" ? { ...e, text: v } : e;
  });
  return { ...page, els };
}

/** pagesOf 결과에 글을 채움 (표지·본문·마무리 순서대로, 비어 있는 칸은 템플릿 글 그대로) */
export function fillPages(pages: { page: Page; n?: number }[], fill: TextFill | null): { page: Page; n?: number }[] {
  if (!fill) return pages;
  return pages.map((p, i) => {
    if (i === 0) return { ...p, page: withTexts(p.page, [fill.cover.title, fill.cover.sub]) };
    if (p.n) {
      const body = fill.pages[p.n - 1];
      return body ? { ...p, page: withTexts(p.page, [body.title, body.body]) } : p;
    }
    return { ...p, page: withTexts(p.page, [fill.end.title]) };
  });
}

/** 사진 칸 수 (바탕 사진 포함) */
export const photoSlots = (page: Page) => (page.bg.kind === "photo" ? 1 : 0) + page.els.filter((e) => e.t === "photo").length;

/** 검색용 낱말 (이름·종류 말고도 이런 말로 찾을 수 있게) */
export const TEMPLATE_KEYWORDS: Record<string, string> = {
  "cn-minimal": "카드뉴스 정보 소식 뉴스레터 깔끔 심플 미니멀 card news",
  "cn-bold": "카드뉴스 꿀팁 리스트 5가지 강조 컬러 bold",
  "cn-photo": "카드뉴스 사진 여행 후기 photo",
  "cn-check": "카드뉴스 체크리스트 준비물 단계 step checklist",
  "cn-qna": "카드뉴스 질문 답변 자주 묻는 FAQ qna 문의",
  "cn-top5": "카드뉴스 순위 랭킹 top 인기 베스트 ranking",
  "cn-quote": "카드뉴스 명언 인용 문장 글귀 quote 감성",
  "cn-chat": "카드뉴스 대화 채팅 카톡 말풍선 chat",
  "cn-window": "카드뉴스 레트로 윈도우 창 컴퓨터 y2k retro",
  "cn-note": "카드뉴스 메모 노트 다이어리 기록 memo",
  "ph-headline": "사진 제목 메뉴 추천 음식 photo",
  "ph-polaroid": "폴라로이드 사진 기록 일상 감성 polaroid",
  "ph-magazine": "매거진 잡지 화보 에디토리얼 magazine",
  "ph-frame": "프레임 테두리 사진 frame",
  "ph-split": "반반 분할 사진 추천 오늘 split",
  "ph-collage": "콜라주 사진 여러장 모음 일상 collage",
  "ph-film": "필름 사진 감성 레트로 film",
  "ph-brutal": "브루탈 포스터 강렬 뉴스 홍보 poster",
  "ph-scrap": "스크랩북 다꾸 마스킹테이프 일기 사진 scrapbook",
  "nt-notice": "공지 휴무 안내 쉬는날 notice",
  "nt-event": "이벤트 댓글 팔로우 참여 event",
  "nt-sale": "할인 세일 sale 퍼센트 특가",
  "nt-open": "오픈 개업 그랜드오픈 가게 open",
  "nt-coupon": "쿠폰 할인 혜택 coupon",
  "nt-oneplus": "1+1 원플러스원 증정 이벤트 bogo",
  "nt-schedule": "일정 스케줄 타임라인 행사 schedule",
  "nt-maint": "변경 안내 영업시간 점검 공지",
  "nt-giveaway": "경품 추첨 기브어웨이 선물 giveaway",
  "nt-news": "뉴스 속보 헤드라인 단독 news",
  "pr-menu": "메뉴판 가격 카페 음식점 메뉴 menu price",
  "pr-newmenu": "신메뉴 출시 신제품 new menu",
  "pr-recruit": "모집 채용 구인 알바 직원 hiring",
  "pr-review": "후기 리뷰 별점 고객 review",
  "st-notice": "스토리 공지 휴무 story",
  "st-question": "스토리 질문 물어보세요 q&a",
  "st-photo": "스토리 사진 순간 story photo",
  "st-countdown": "스토리 디데이 카운트다운 오픈 예고 d-day",
  "st-poll": "스토리 투표 골라 선택 poll",
  "st-window": "스토리 레트로 창 알림 y2k",
  "st-chat": "스토리 대화 채팅 카톡",
  "st-today": "스토리 오늘 일정 하루 계획",
};
