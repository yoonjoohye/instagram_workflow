/** 필름 보정용 fabric 필터 (Camera Raw 의 기본·곡선·효과 패널과 포토샵 레이어 효과를 흉내):
 *  - FilmTone : 노출 · 어두운 영역 · 검정 계열 · 곡선(암부 들어올림 · S자)
 *  - FilmGrain: 그레인 양 · 크기 · 거칠기 (같은 사진엔 항상 같은 무늬 — 슬라이더를 움직여도 깜빡이지 않음)
 *  - FilmGlow : 뽀얀 글로우 — 흐리게 한 사본을 스크린/소프트 라이트로 겹치고 불투명도로 섞기
 *  fabric 은 WebGL 셰이더로 그리고, WebGL 이 없으면 applyTo2d(픽셀 계산)로 같은 결과를 냅니다. */

import type * as F from "fabric";

export type ToneValues = { exposure: number; shadows: number; blacks: number; lift: number; curve: number };
export type GrainValues = { amount: number; size: number; roughness: number };
export type GlowMode = "screen" | "soft";
export type GlowValues = { amount: number; radius: number; mode: GlowMode };

/** 블러 반경(px): 사진 짧은 변의 0.4% ~ 2.8% (1350px 사진이면 약 5 ~ 38px — 포토샵 권장 10~25px 포함) */
export const glowRadiusPx = (radius: number, w: number, h: number) => Math.max(2, (0.004 + radius * 0.024) * Math.min(w, h));

// 셰이더와 픽셀 계산이 같은 식을 쓰도록 계수를 한곳에
const K = { shadows: 0.3, blacks: 0.18, lift: 0.22 };

const TONE_GLSL = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uExposure;
  uniform float uShadows;
  uniform float uBlacks;
  uniform float uLift;
  uniform float uCurve;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    // 노출: 빛의 세기(선형)에서 올리고, 밝은 끝은 부드럽게 눌러 하얗게 날아가지 않게
    vec3 c = pow(pow(color.rgb, vec3(2.2)) * pow(2.0, uExposure), vec3(1.0 / 2.2));
    c = mix(c, 0.85 + 0.15 * (1.0 - exp(-(c - 0.85) / 0.15)), step(vec3(0.85), c));
    float l = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    float ws = (1.0 - l) * (1.0 - l);
    c += uShadows * ${K.shadows} * ws;
    c += uBlacks * ${K.blacks} * ws * ws;
    c = clamp(c, 0.0, 1.0);
    c = mix(c, c * c * (3.0 - 2.0 * c), uCurve);
    c = uLift * ${K.lift} + c * (1.0 - uLift * ${K.lift});
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), color.a);
  }
`;

const GRAIN_GLSL = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform float uSize;
  uniform float uRough;
  uniform vec2 uRes;
  varying vec2 vTexCoord;
  float h(vec2 p) { return fract(sin(dot(mod(p, 4096.0), vec2(12.9898, 78.233))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec2 px = floor(vTexCoord * uRes);
    // 입자 크기는 사진 해상도에 비례 (큰 사진을 줄여 봐도 입자가 보이게)
    float cell = min(uRes.x, uRes.y) * (0.0012 + uSize * 0.006);
    float g = mix(vn(px / cell), h(px), uRough) - 0.5;
    float l = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float mid = 1.0 - abs(l - 0.5);
    color.rgb += g * uAmount * 0.45 * mid;
    gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
  }
`;

// 원판 디스크 위 32곳을 고르게 찍어 평균 (해바라기 씨앗 배치) → 한 번에 부드러운 블러
const GLOW_GLSL = `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform float uRadius;
  uniform float uMode;
  uniform vec2 uRes;
  varying vec2 vTexCoord;
  vec3 softLight(vec3 a, vec3 b) {
    vec3 d = mix(sqrt(a), ((16.0 * a - 12.0) * a + 4.0) * a, step(a, vec3(0.25)));
    return mix(a - (1.0 - 2.0 * b) * a * (1.0 - a), a + (2.0 * b - 1.0) * (d - a), step(vec3(0.5), b));
  }
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 blur = vec3(0.0);
    for (int i = 0; i < 32; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 32.0) * uRadius;
      float a = fi * 2.39996323;
      blur += texture2D(uTexture, vTexCoord + vec2(cos(a), sin(a)) * r / uRes).rgb;
    }
    blur /= 32.0;
    vec3 a = color.rgb;
    vec3 screen = 1.0 - (1.0 - a) * (1.0 - blur);
    vec3 mixed = uMode < 0.5 ? screen : softLight(a, blur);
    gl_FragColor = vec4(mix(a, mixed, uAmount), color.a);
  }
`;

// ── 픽셀 계산 (WebGL 이 없을 때) ───────────────────────────────────────────
function softLight1(a: number, b: number) {
  if (b <= 0.5) return a - (1 - 2 * b) * a * (1 - a);
  const d = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
  return a + (2 * b - 1) * (d - a);
}

/** 작게 줄였다 다시 키워 흐리게 (어느 브라우저에서나 동작하는 빠른 블러) */
function blurred(imageData: ImageData, radius: number): Uint8ClampedArray {
  const { width: w, height: h } = imageData;
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  src.getContext("2d")!.putImageData(imageData, 0, 0);
  const scale = Math.max(1, radius / 2);
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(w / scale));
  small.height = Math.max(1, Math.round(h / scale));
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, 0, 0, small.width, small.height);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, w, h);
  return octx.getImageData(0, 0, w, h).data;
}
const fract = (x: number) => x - Math.floor(x);
const hash = (x: number, y: number) => fract(Math.sin((x % 4096) * 12.9898 + (y % 4096) * 78.233) * 43758.5453);
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

type Uniforms = Record<string, WebGLUniformLocation>;

/** fabric 이 불러와진 뒤에 클래스를 만듭니다 (편집기는 fabric 을 동적으로 불러옴). */
export function filmFilters(f: typeof F) {
  class FilmTone extends f.filters.BaseFilter<"FilmTone", ToneValues> {
    static type = "FilmTone";
    static defaults: ToneValues = { exposure: 0, shadows: 0, blacks: 0, lift: 0, curve: 0 };
    static uniformLocations = ["uExposure", "uShadows", "uBlacks", "uLift", "uCurve"];
    declare exposure: number;
    declare shadows: number;
    declare blacks: number;
    declare lift: number;
    declare curve: number;

    getFragmentSource() {
      return TONE_GLSL;
    }

    isNeutralState() {
      return !this.exposure && !this.shadows && !this.blacks && !this.lift && !this.curve;
    }

    sendUniformData(gl: WebGLRenderingContext, u: Uniforms) {
      gl.uniform1f(u.uExposure, this.exposure);
      gl.uniform1f(u.uShadows, this.shadows);
      gl.uniform1f(u.uBlacks, this.blacks);
      gl.uniform1f(u.uLift, this.lift);
      gl.uniform1f(u.uCurve, this.curve);
    }

    applyTo2d({ imageData: { data } }: { imageData: ImageData }) {
      const gain = 2 ** this.exposure;
      const lift = this.lift * K.lift;
      const expose = (x: number) => {
        x = Math.pow(Math.pow(x, 2.2) * gain, 1 / 2.2);
        return x < 0.85 ? x : 0.85 + 0.15 * (1 - Math.exp(-(x - 0.85) / 0.15));
      };
      for (let i = 0; i < data.length; i += 4) {
        let r = expose(data[i] / 255), g = expose(data[i + 1] / 255), b = expose(data[i + 2] / 255);
        const l = clamp01(0.299 * r + 0.587 * g + 0.114 * b);
        const ws = (1 - l) * (1 - l);
        const add = this.shadows * K.shadows * ws + this.blacks * K.blacks * ws * ws;
        const tone = (x: number) => {
          x = clamp01(x + add);
          x = x + (x * x * (3 - 2 * x) - x) * this.curve;
          return clamp01(lift + x * (1 - lift));
        };
        r = tone(r);
        g = tone(g);
        b = tone(b);
        data[i] = r * 255;
        data[i + 1] = g * 255;
        data[i + 2] = b * 255;
      }
    }
  }

  class FilmGrain extends f.filters.BaseFilter<"FilmGrain", GrainValues> {
    static type = "FilmGrain";
    static defaults: GrainValues = { amount: 0, size: 0.25, roughness: 0.3 };
    static uniformLocations = ["uAmount", "uSize", "uRough", "uRes"];
    declare amount: number;
    declare size: number;
    declare roughness: number;
    private res: [number, number] = [1, 1];

    getFragmentSource() {
      return GRAIN_GLSL;
    }

    isNeutralState() {
      return !this.amount;
    }

    // 그레인 무늬를 사진 픽셀에 맞추려고 크기를 기억해 둠 (WebGL 은 uniform 으로)
    applyTo(options: { sourceWidth: number; sourceHeight: number } & Record<string, unknown>) {
      this.res = [options.sourceWidth, options.sourceHeight];
      // @ts-expect-error fabric 의 applyTo 옵션 타입은 공개돼 있지 않음
      super.applyTo(options);
    }

    sendUniformData(gl: WebGLRenderingContext, u: Uniforms) {
      gl.uniform1f(u.uAmount, this.amount);
      gl.uniform1f(u.uSize, this.size);
      gl.uniform1f(u.uRough, this.roughness);
      gl.uniform2f(u.uRes, this.res[0], this.res[1]);
    }

    applyTo2d({ imageData }: { imageData: ImageData }) {
      const { data, width } = imageData;
      const cell = Math.min(imageData.width, imageData.height) * (0.0012 + this.size * 0.006);
      const k = this.amount * 0.45 * 255;
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const x = p % width, y = Math.floor(p / width);
        const g = vnoise(x / cell, y / cell) * (1 - this.roughness) + hash(x, y) * this.roughness - 0.5;
        const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        const d = g * k * (1 - Math.abs(l - 0.5));
        data[i] += d;
        data[i + 1] += d;
        data[i + 2] += d;
      }
    }
  }

  class FilmGlow extends f.filters.BaseFilter<"FilmGlow", GlowValues> {
    static type = "FilmGlow";
    static defaults: GlowValues = { amount: 0, radius: 0.5, mode: "screen" };
    static uniformLocations = ["uAmount", "uRadius", "uMode", "uRes"];
    declare amount: number;
    declare radius: number;
    declare mode: GlowMode;
    private res: [number, number] = [1, 1];

    getFragmentSource() {
      return GLOW_GLSL;
    }

    isNeutralState() {
      return !this.amount;
    }

    applyTo(options: { sourceWidth: number; sourceHeight: number } & Record<string, unknown>) {
      this.res = [options.sourceWidth, options.sourceHeight];
      // @ts-expect-error fabric 의 applyTo 옵션 타입은 공개돼 있지 않음
      super.applyTo(options);
    }

    sendUniformData(gl: WebGLRenderingContext, u: Uniforms) {
      gl.uniform1f(u.uAmount, this.amount);
      gl.uniform1f(u.uRadius, glowRadiusPx(this.radius, this.res[0], this.res[1]));
      gl.uniform1f(u.uMode, this.mode === "soft" ? 1 : 0);
      gl.uniform2f(u.uRes, this.res[0], this.res[1]);
    }

    applyTo2d({ imageData }: { imageData: ImageData }) {
      const { data, width, height } = imageData;
      const blur = blurred(imageData, glowRadiusPx(this.radius, width, height));
      const soft = this.mode === "soft";
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const a = data[i + c] / 255, b = blur[i + c] / 255;
          const mixed = soft ? softLight1(a, b) : 1 - (1 - a) * (1 - b);
          data[i + c] = (a + (mixed - a) * this.amount) * 255;
        }
      }
    }
  }

  return { FilmTone, FilmGrain, FilmGlow };
}
