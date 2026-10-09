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
];

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
