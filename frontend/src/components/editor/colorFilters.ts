/** 라이트룸식 색·세부 보정 fabric 필터 (WebGL 셰이더 + 같은 식의 픽셀 계산):
 *  - FilmColor : 색조(초록↔자주) · 컬러 그레이딩(어두운·중간·밝은 영역 색상/채도 + 균형) · HSL 8색(색상·채도·밝기)
 *  - FilmDetail: 텍스처(잔결) · 부분 대비(클래리티) — + 는 또렷하게, - 는 부드럽게 */

import type * as F from "fabric";
import { blurred } from "./filmFilters";

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type Band = (typeof HSL_BANDS)[number];
export const BAND_HUE: Record<Band, number> = { red: 0, orange: 30, yellow: 60, green: 120, aqua: 180, blue: 240, purple: 270, magenta: 300 };
// 이웃 색까지의 거리 (그 색이 영향을 미치는 범위)
const BAND_WIDTH = [30, 30, 45, 60, 60, 45, 30, 30];
export const BAND_SWATCH: Record<Band, string> = {
  red: "#ef4444", orange: "#f97316", yellow: "#eab308", green: "#22c55e", aqua: "#06b6d4", blue: "#3b82f6", purple: "#8b5cf6", magenta: "#d946ef",
};

export type ColorValues = {
  tint: number;
  /** [어두운, 중간, 밝은] 영역의 색상(0~360) · 채도(0~1) */
  gradeHue: [number, number, number];
  gradeSat: [number, number, number];
  balance: number;
  /** 8색 × (색상 -1~1 = ±30°, 채도 -1~1, 밝기 -1~1) */
  hslHue: number[];
  hslSat: number[];
  hslLum: number[];
};
export type DetailValues = { texture: number; clarity: number };

const COLOR_GLSL = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uTint;
  uniform vec3 uGradeHue;
  uniform vec3 uGradeSat;
  uniform float uBalance;
  uniform float uHslHue[8];
  uniform float uHslSat[8];
  uniform float uHslLum[8];
  varying vec2 vTexCoord;
  vec3 hue2rgb(float h) {
    h = mod(h, 360.0) / 60.0;
    return clamp(vec3(abs(h - 3.0) - 1.0, 2.0 - abs(h - 2.0), 2.0 - abs(h - 4.0)), 0.0, 1.0);
  }
  vec3 rgb2hsl(vec3 c) {
    float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
    float l = (mx + mn) * 0.5, d = mx - mn, h = 0.0, s = 0.0;
    if (d > 1e-5) {
      s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
      if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h *= 60.0;
    }
    return vec3(h, s, l);
  }
  vec3 hsl2rgb(vec3 hsl) {
    vec3 rgb = hue2rgb(hsl.x);
    float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
    return (rgb - 0.5) * c + hsl.z;
  }
  // WebGL1(GLSL ES 1.0)은 배열 초기화를 못 해서 함수로
  float bandC(int i) {
    if (i == 0) return 0.0;
    if (i == 1) return 30.0;
    if (i == 2) return 60.0;
    if (i == 3) return 120.0;
    if (i == 4) return 180.0;
    if (i == 5) return 240.0;
    if (i == 6) return 270.0;
    return 300.0;
  }
  float bandW(int i) { return i == 2 || i == 5 ? 45.0 : (i == 3 || i == 4 ? 60.0 : 30.0); }
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 c = color.rgb;
    // 색조: + 는 자주(마젠타), - 는 초록
    c += uTint * vec3(0.04, -0.08, 0.04);
    c = clamp(c, 0.0, 1.0);
    // HSL 8색
    vec3 hsl = rgb2hsl(c);
    float colorful = smoothstep(0.0, 0.15, hsl.y);
    float dh = 0.0, ds = 0.0, dl = 0.0;
    for (int i = 0; i < 8; i++) {
      float d = abs(hsl.x - bandC(i));
      d = min(d, 360.0 - d);
      float w = max(0.0, 1.0 - d / bandW(i)) * colorful;
      dh += w * uHslHue[i];
      ds += w * uHslSat[i];
      dl += w * uHslLum[i];
    }
    hsl.x += dh * 30.0;
    hsl.y = clamp(hsl.y * (1.0 + ds), 0.0, 1.0);
    hsl.z = clamp(hsl.z + dl * 0.2 * hsl.y, 0.0, 1.0);
    c = hsl2rgb(hsl);
    // 컬러 그레이딩: 밝기 영역마다 색을 살짝 더함 (균형 + 면 밝은 영역이 넓어짐)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float pivot = 0.5 - uBalance * 0.25;
    float wS = 1.0 - smoothstep(0.0, pivot, l);
    float wH = smoothstep(pivot, 1.0, l);
    float wM = clamp(1.0 - abs(l - pivot) * 2.0, 0.0, 1.0);
    c += (hue2rgb(uGradeHue.x) - 0.5) * uGradeSat.x * 0.35 * wS;
    c += (hue2rgb(uGradeHue.y) - 0.5) * uGradeSat.y * 0.35 * wM;
    c += (hue2rgb(uGradeHue.z) - 0.5) * uGradeSat.z * 0.35 * wH;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), color.a);
  }
`;

// 작은 반경(텍스처)과 큰 반경(부분 대비) 두 번 흐리게 해서 원본과의 차이를 키우거나 줄임
const DETAIL_GLSL = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uTexture2;
  uniform float uClarity;
  uniform vec2 uRes;
  varying vec2 vTexCoord;
  vec3 disk(float radius) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 16.0) * radius;
      float a = fi * 2.39996323;
      sum += texture2D(uTexture, vTexCoord + vec2(cos(a), sin(a)) * r / uRes).rgb;
    }
    return sum / 16.0;
  }
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 c = color.rgb;
    float m = min(uRes.x, uRes.y);
    if (uTexture2 != 0.0) c += (c - disk(m * 0.003)) * uTexture2 * 1.4;
    if (uClarity != 0.0) {
      float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float mid = clamp(1.0 - abs(l - 0.5) * 1.6, 0.0, 1.0);
      c += (color.rgb - disk(m * 0.02)) * uClarity * 1.1 * mid;
    }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), color.a);
  }
`;

// ── 픽셀 계산 (WebGL 이 없을 때) ───────────────────────────────────────────
/** 바로 옆 3×3 픽셀 평균 (텍스처용 아주 작은 반경 흐림) */
function box3(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += data[(yy * w + xx) * 4 + k];
            n++;
          }
        }
        out[(y * w + x) * 4 + k] = sum / n;
      }
    }
  }
  return out;
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function hue2rgb(h: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 60;
  return [clamp01(Math.abs(h - 3) - 1), clamp01(2 - Math.abs(h - 2)), clamp01(2 - Math.abs(h - 4))];
}
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-5) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const [r, g, b] = hue2rgb(h);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  return [(r - 0.5) * c + l, (g - 0.5) * c + l, (b - 0.5) * c + l];
}

type Uniforms = Record<string, WebGLUniformLocation>;

export function colorFilters(f: typeof F) {
  class FilmColor extends f.filters.BaseFilter<"FilmColor", ColorValues> {
    static type = "FilmColor";
    static defaults: ColorValues = {
      tint: 0, gradeHue: [0, 0, 0], gradeSat: [0, 0, 0], balance: 0,
      hslHue: Array(8).fill(0), hslSat: Array(8).fill(0), hslLum: Array(8).fill(0),
    };
    static uniformLocations = ["uTint", "uGradeHue", "uGradeSat", "uBalance", "uHslHue", "uHslSat", "uHslLum"];
    declare tint: number;
    declare gradeHue: [number, number, number];
    declare gradeSat: [number, number, number];
    declare balance: number;
    declare hslHue: number[];
    declare hslSat: number[];
    declare hslLum: number[];

    getFragmentSource() {
      return COLOR_GLSL;
    }

    isNeutralState() {
      const any = (a: number[]) => a.some(Boolean);
      return !this.tint && !any(this.gradeSat) && !any(this.hslHue) && !any(this.hslSat) && !any(this.hslLum);
    }

    sendUniformData(gl: WebGLRenderingContext, u: Uniforms) {
      gl.uniform1f(u.uTint, this.tint);
      gl.uniform3fv(u.uGradeHue, this.gradeHue);
      gl.uniform3fv(u.uGradeSat, this.gradeSat);
      gl.uniform1f(u.uBalance, this.balance);
      gl.uniform1fv(u.uHslHue, this.hslHue);
      gl.uniform1fv(u.uHslSat, this.hslSat);
      gl.uniform1fv(u.uHslLum, this.hslLum);
    }

    applyTo2d({ imageData: { data } }: { imageData: ImageData }) {
      const grades = [0, 1, 2].map((i) => hue2rgb(this.gradeHue[i]));
      const pivot = 0.5 - this.balance * 0.25;
      for (let i = 0; i < data.length; i += 4) {
        let r = clamp01(data[i] / 255 + this.tint * 0.04), g = clamp01(data[i + 1] / 255 - this.tint * 0.08), b = clamp01(data[i + 2] / 255 + this.tint * 0.04);
        let [h, s, l] = rgb2hsl(r, g, b);
        const colorful = smooth(0, 0.15, s);
        let dh = 0, ds = 0, dl = 0;
        for (let k = 0; k < 8; k++) {
          let d = Math.abs(h - BAND_HUE[HSL_BANDS[k]]);
          d = Math.min(d, 360 - d);
          const w = Math.max(0, 1 - d / BAND_WIDTH[k]) * colorful;
          dh += w * this.hslHue[k];
          ds += w * this.hslSat[k];
          dl += w * this.hslLum[k];
        }
        h += dh * 30;
        s = clamp01(s * (1 + ds));
        l = clamp01(l + dl * 0.2 * s);
        [r, g, b] = hsl2rgb(h, s, l);
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const w = [1 - smooth(0, pivot, lum), Math.max(0, Math.min(1, 1 - Math.abs(lum - pivot) * 2)), smooth(pivot, 1, lum)];
        for (let k = 0; k < 3; k++) {
          const amt = this.gradeSat[k] * 0.35 * w[k];
          r += (grades[k][0] - 0.5) * amt;
          g += (grades[k][1] - 0.5) * amt;
          b += (grades[k][2] - 0.5) * amt;
        }
        data[i] = clamp01(r) * 255;
        data[i + 1] = clamp01(g) * 255;
        data[i + 2] = clamp01(b) * 255;
      }
    }
  }

  class FilmDetail extends f.filters.BaseFilter<"FilmDetail", DetailValues> {
    static type = "FilmDetail";
    static defaults: DetailValues = { texture: 0, clarity: 0 };
    static uniformLocations = ["uTexture2", "uClarity", "uRes"];
    declare texture: number;
    declare clarity: number;
    private res: [number, number] = [1, 1];

    getFragmentSource() {
      return DETAIL_GLSL;
    }

    isNeutralState() {
      return !this.texture && !this.clarity;
    }

    applyTo(options: { sourceWidth: number; sourceHeight: number } & Record<string, unknown>) {
      this.res = [options.sourceWidth, options.sourceHeight];
      // @ts-expect-error fabric 의 applyTo 옵션 타입은 공개돼 있지 않음
      super.applyTo(options);
    }

    sendUniformData(gl: WebGLRenderingContext, u: Uniforms) {
      gl.uniform1f(u.uTexture2, this.texture);
      gl.uniform1f(u.uClarity, this.clarity);
      gl.uniform2f(u.uRes, this.res[0], this.res[1]);
    }

    applyTo2d({ imageData }: { imageData: ImageData }) {
      const { data, width, height } = imageData;
      const m = Math.min(width, height);
      const small = this.texture ? box3(data, width, height) : null;
      const large = this.clarity ? blurred(imageData, m * 0.02) : null;
      for (let i = 0; i < data.length; i += 4) {
        const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        const mid = clamp01(1 - Math.abs(l - 0.5) * 1.6);
        for (let k = 0; k < 3; k++) {
          const o = data[i + k];
          let v = o;
          if (small) v += (o - small[i + k]) * this.texture * 1.4;
          if (large) v += (o - large[i + k]) * this.clarity * 1.1 * mid;
          data[i + k] = v;
        }
      }
    }
  }

  return { FilmColor, FilmDetail };
}
