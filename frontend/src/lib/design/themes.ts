/** 디자인 테마: 색 6가지 + 글꼴 2가지. 템플릿은 색·글꼴을 직접 적지 않고 이 이름(토큰)으로만 가리켜서,
 *  테마를 바꾸면 같은 템플릿이 통째로 다시 칠해집니다. */

export type ThemeColors = {
  /** 바탕 */
  bg: string;
  /** 카드·상자 */
  surface: string;
  /** 글자 */
  text: string;
  /** 메인 색 (강조 바탕·버튼) */
  primary: string;
  /** 메인 색 위의 글자 */
  on_primary: string;
  /** 포인트 색 */
  accent: string;
};
export type ColorToken = keyof ThemeColors | "muted" | "white" | "black";
export type Theme = { id: string; name: string; colors: ThemeColors; fonts: { heading: string; body: string }; mine?: boolean };

const t = (id: string, name: string, c: ThemeColors, heading: string, body = "pretendard"): Theme => ({ id, name, colors: c, fonts: { heading, body } });

export const BUILTIN_THEMES: Theme[] = [
  t("cream", "크림", { bg: "#fff8f0", surface: "#ffffff", text: "#2b2118", primary: "#e8743b", on_primary: "#ffffff", accent: "#f4c095" }, "pretendard"),
  t("midnight", "미드나잇", { bg: "#0f172a", surface: "#1e293b", text: "#f8fafc", primary: "#38bdf8", on_primary: "#0f172a", accent: "#fbbf24" }, "black_han_sans"),
  t("mint", "민트", { bg: "#ecfdf5", surface: "#ffffff", text: "#064e3b", primary: "#10b981", on_primary: "#ffffff", accent: "#fde68a" }, "jua"),
  t("pink", "러블리", { bg: "#fff1f5", surface: "#ffffff", text: "#4a1d2f", primary: "#ff5c8a", on_primary: "#ffffff", accent: "#ffd3e0" }, "gaegu"),
  t("classic", "클래식", { bg: "#f5f1e8", surface: "#fffdf8", text: "#1f1b16", primary: "#7c2d12", on_primary: "#fdf6ec", accent: "#c8a97e" }, "nanum_myeongjo", "nanum_myeongjo"),
  t("mono", "모노", { bg: "#ffffff", surface: "#f4f4f5", text: "#111111", primary: "#111111", on_primary: "#ffffff", accent: "#d4d4d8" }, "pretendard"),
  t("vivid", "비비드", { bg: "#2563eb", surface: "#1d4ed8", text: "#ffffff", primary: "#facc15", on_primary: "#1e1b4b", accent: "#f472b6" }, "black_han_sans"),
  t("retro", "레트로", { bg: "#fdf0d5", surface: "#fffaf0", text: "#003049", primary: "#c1121f", on_primary: "#fdf0d5", accent: "#669bbc" }, "do_hyeon"),
  t("natural", "내추럴", { bg: "#ede8df", surface: "#f8f5ef", text: "#3d3a33", primary: "#6b8f71", on_primary: "#ffffff", accent: "#d9c5a0" }, "nanum_myeongjo"),
  t("neon", "네온 나이트", { bg: "#111014", surface: "#1c1b22", text: "#ffffff", primary: "#a3e635", on_primary: "#111014", accent: "#f472b6" }, "black_han_sans"),
  t("butter", "버터", { bg: "#fff6d6", surface: "#fffdf3", text: "#3b2f0b", primary: "#f5b301", on_primary: "#3b2f0b", accent: "#ffe08a" }, "jua"),
  t("lavender", "라벤더", { bg: "#f3f0ff", surface: "#ffffff", text: "#2e1065", primary: "#7c3aed", on_primary: "#ffffff", accent: "#c4b5fd" }, "pretendard"),
  t("olive", "올리브", { bg: "#f1efe3", surface: "#fbfaf3", text: "#2f3320", primary: "#5f6b2d", on_primary: "#f8f6e9", accent: "#c9c08f" }, "nanum_myeongjo"),
  t("coral", "코랄", { bg: "#fff4f0", surface: "#ffffff", text: "#3a1a14", primary: "#ff6f59", on_primary: "#ffffff", accent: "#ffc4b6" }, "black_han_sans"),
  t("babyblue", "베이비 블루", { bg: "#eef6ff", surface: "#ffffff", text: "#0b2545", primary: "#4c8dff", on_primary: "#ffffff", accent: "#b9d6ff" }, "jua"),
  t("burgundy", "버건디", { bg: "#f7efe9", surface: "#fffaf6", text: "#2b0f14", primary: "#7d1d2d", on_primary: "#f7efe9", accent: "#d9a5a0" }, "song_myung"),
  t("goldblack", "블랙 & 골드", { bg: "#0d0d0d", surface: "#1a1a1a", text: "#f5f0e1", primary: "#d4af37", on_primary: "#0d0d0d", accent: "#8a6d1e" }, "nanum_myeongjo"),
  t("y2k", "Y2K", { bg: "#e9f5ff", surface: "#ffffff", text: "#1a1a40", primary: "#ff4fd8", on_primary: "#ffffff", accent: "#7cf6ff" }, "do_hyeon"),
  t("forest", "포레스트", { bg: "#0f2a1d", surface: "#173a2a", text: "#eaf4ec", primary: "#9fd356", on_primary: "#0f2a1d", accent: "#f2c14e" }, "black_han_sans"),
  t("peach", "피치", { bg: "#fff0e6", surface: "#ffffff", text: "#4a2c1d", primary: "#ff9a76", on_primary: "#ffffff", accent: "#ffd6c2" }, "gaegu"),
];

/** 검색용 낱말 (색·분위기로 찾기) */
export const THEME_KEYWORDS: Record<string, string> = {
  cream: "크림 베이지 주황 오렌지 따뜻 밝은 cream",
  midnight: "미드나잇 남색 네이비 어두운 다크 하늘 dark navy",
  mint: "민트 초록 그린 상큼 산뜻 green",
  pink: "핑크 분홍 러블리 귀여운 pink",
  classic: "클래식 갈색 브라운 고급 명조 classic",
  mono: "모노 흑백 검정 하양 미니멀 심플 black white",
  vivid: "비비드 파랑 블루 노랑 쨍한 강렬 blue",
  retro: "레트로 빨강 레드 복고 retro",
  natural: "내추럴 초록 베이지 자연 차분 natural",
  neon: "네온 형광 어두운 다크 연두 neon",
  butter: "버터 노랑 옐로 귀여운 yellow",
  lavender: "라벤더 보라 연보라 퍼플 purple",
  olive: "올리브 카키 초록 차분 olive",
  coral: "코랄 산호 주황 핑크 분홍 coral",
  babyblue: "베이비블루 하늘 파랑 블루 산뜻 blue",
  burgundy: "버건디 와인 자주 고급 burgundy",
  goldblack: "블랙골드 금색 검정 고급 럭셔리 gold",
  y2k: "y2k 핑크 분홍 하늘 형광 레트로",
  forest: "포레스트 숲 초록 어두운 다크 green",
  peach: "피치 복숭아 살구 분홍 주황 따뜻 peach",
};

/** 토큰 → 실제 색 */
export function colorOf(theme: Theme, token: ColorToken | undefined): string {
  if (!token) return "transparent";
  if (token === "white") return "#ffffff";
  if (token === "black") return "#000000";
  if (token === "muted") return hexAlpha(theme.colors.text, 0.62);
  return theme.colors[token];
}

export function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
