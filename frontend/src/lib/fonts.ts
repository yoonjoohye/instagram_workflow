/** 서버 글씨체(/api/py/studio/fonts/{key}.font)를 브라우저에 등록해 캔버스에 쓰기 (사진 편집기·디자인 템플릿 공통) */

export const faceName = (key: string) => `ffont-${key}`;
// 글씨체에 없는 이모지는 기기의 이모지 글꼴로 그립니다 (없으면 빈칸·네모로 보임)
export const fontFamily = (key: string) => `"${faceName(key)}", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
export const fontKeyOf = (family: string | undefined) => family?.match(/ffont-([a-z_]+)/)?.[1];
const loadedFonts = new Map<string, Promise<void>>();

// 같은 글씨체의 보통·굵은 파일이 따로 있는 것 (서버 FONTS 의 title·body 가 같은 글씨체의 다른 굵기)
const TWO_WEIGHTS = new Set(["pretendard", "nanum_myeongjo"]);

/** 서버 글씨체를 브라우저에 등록 (한 번만).
 *  파일마다 맡는 굵기 범위를 적어 둬서, 브라우저가 이미 굵은 글씨를 한 번 더 억지로 굵게 그리지 않게 합니다
 *  (억지로 굵게 그리면 획이 겹쳐 '눈'·'는' 같은 글자에 줄이 생김). */
export function loadFont(key: string): Promise<void> {
  if (!loadedFonts.has(key)) {
    const url = (variant: string) => `url(/api/py/studio/fonts/${key}.font${variant === "body" ? "?variant=body" : ""})`;
    const faces = TWO_WEIGHTS.has(key)
      ? [new FontFace(faceName(key), url("body"), { weight: "100 599" }), new FontFace(faceName(key), url("title"), { weight: "600 900" })]
      : [new FontFace(faceName(key), url("title"), { weight: "100 900" })];
    loadedFonts.set(
      key,
      Promise.all(faces.map((face) => face.load().then((f) => void document.fonts.add(f))))
        .then(() => undefined)
        .catch(() => undefined),
    );
  }
  return loadedFonts.get(key)!;
}
