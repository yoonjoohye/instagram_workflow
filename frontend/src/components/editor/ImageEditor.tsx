"use client";

/** 이미지 편집기 — 인스타그램 편집 기능 + 그림판.
 *
 *  글자(스타일·글씨체·색·배경 상자·정렬) · 스티커(이모지·도형) · 그리기(펜·형광펜·네온·지우개, 사각형·선)
 *  · 보정(필터 + 밝기·대비·따뜻함·채도·페이드·비네트·선명하게) · 자르기(확대·이동·90° 회전·수평 맞추기·반전)
 *
 *  - 편집기 라이브러리(fabric.js)는 이 화면을 열 때만 내려받습니다.
 *  - 저장하면 합친 이미지와 편집 내용(layers)을 함께 보관해, 다시 열면 글자·스티커를 그대로 고칠 수 있습니다.
 *    편집 전 원본(base)은 따로 남아 있어 몇 번을 고쳐도 화질이 떨어지지 않습니다.
 *  - 오른쪽(넓은 화면)·미리보기 버튼(휴대폰)에 올라갈 모습을 편집할 때마다 보여 줍니다.
 */
import type { MessageKey } from "@/i18n/core";
import { applyTheme, exportPage, fitToSlot, type Tk } from "@/lib/design/render";
import { BUILTIN_THEMES, type Theme } from "@/lib/design/themes";
import { fontFamily, fontKeyOf, loadFont } from "@/lib/fonts";
import { toBrowserImage } from "@/lib/heic";
import type * as F from "fabric";
import { filmFilters } from "./filmFilters";
import { BAND_SWATCH, colorFilters, HSL_BANDS, type Band } from "./colorFilters";
import { composite, removeBackground } from "@/lib/cutout";
import { removeSolidBackground } from "@/lib/cutout/colorKey";
import { MaskEditor } from "./MaskEditor";
import { haptic } from "@/lib/haptics";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { fmtTime, Timeline, useFrames, type Track } from "@/components/studio/Timeline";
import { Button, cx, Spinner } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError, useApi } from "@/lib/api";
import { mediaSrc } from "@/lib/format";
import type { Asset } from "@/lib/types";

type Tab = "text" | "sticker" | "draw" | "adjust" | "bg" | "crop" | "theme" | `x:${string}`;
type Brush = "pen" | "marker" | "neon" | "eraser";
type Layers = { v: 1; w: number; h: number; canvas: object; adjust?: Adjust; crop?: Crop };
type HslKey = `hsl${"H" | "S" | "L"}_${Band}`;
type Adjust = Record<HslKey, number> & {
  /** 2: 프리셋을 누르면 슬라이더가 그 값으로 바뀜 (예전 1: 프리셋 값이 슬라이더에 몰래 더해짐) */
  v?: 2;
  preset: string;
  brightness: number;
  contrast: number;
  warmth: number;
  saturation: number;
  fade: number;
  vignette: number;
  sharpen: number;
  sepia: number; // 0~1 세피아(누런 옛날 사진 톤) 정도
  mono: number; // 0~1 흑백 정도
  // 라이트룸식: 흰색 계열 · 색조(틴트) · 활기 · 텍스처 · 부분 대비(클래리티) · 디헤이즈
  whites: number;
  tint: number;
  vibrance: number;
  texture: number;
  clarity: number;
  dehaze: number;
  // 컬러 그레이딩: 어두운·중간·밝은 영역의 색상(0~360)·채도(0~1) + 균형
  gradeShadowHue: number;
  gradeShadowSat: number;
  gradeMidHue: number;
  gradeMidSat: number;
  gradeHighHue: number;
  gradeHighSat: number;
  gradeBalance: number;
  // 필름 보정 (Camera Raw 의 기본·곡선·효과)
  exposure: number;
  highlights: number;
  shadows: number;
  blacks: number;
  lift: number;
  curve: number;
  grain: number;
  grainSize: number;
  grainRough: number;
  // 뽀얀 글로우: 흐린 사본을 스크린/소프트 라이트로 겹침
  glow: number;
  glowRadius: number;
  glowSoft: number; // 0 = 스크린, 1 = 소프트 라이트
};
/** zoom 1 = 틀을 꽉 채움, 1보다 작으면 사진 전체가 보이게 줄임 (빈 곳은 fill: 흐린 사진·흰색·검정) */
type Fill = "blur" | "white" | "black";
type Crop = { zoom: number; turns: number; straighten: number; flip: boolean; fill?: Fill };
type FontItem = { key: string; label: string; preview: string };
type Named = F.FabricObject & { name?: string; isEditing?: boolean; orig?: string; tStart?: number; tEnd?: number };
type Sticker = { id: string; url: string; width: number; height: number };
// 편집 기록·저장에 함께 남길 우리 속성 (orig: 배경을 바꾸기 전 원본 사진 주소)
// tk: 디자인 템플릿의 테마 토큰 (테마를 바꾸면 이걸 보고 다시 칠함)
const KEEP = ["name", "selectable", "evented", "link", "orig", "tStart", "tEnd", "tk"];
// 편집기 복사·붙여넣기 (다른 사진 편집기를 열어도 남음 — 같은 페이지 안에서)
let clipboard: F.FabricObject | null = null;
let pasteCount = 0;
// Ctrl/⌘+V: 브라우저 붙여넣기(paste) 이벤트로 받되, 사파리처럼 입력칸 밖에선 이벤트를 안 주는 브라우저를 위해 잠깐 뒤 직접 붙여 넣음
let pasteFallback: ReturnType<typeof setTimeout> | undefined;
const BG_COLORS = ["#ffffff", "#000000", "#f4ece1", "#ffd6e0", "#cfe8ff", "#d8f3dc", "#fff1b8", "#e9d5ff"];

export type EditorPreview = { kind: "feed" | "story"; assets: Asset[]; username: string; avatar?: string; caption: string };

const COLORS = ["#ffffff", "#111111", "#ff3b5c", "#ff9f1c", "#ffd60a", "#34c759", "#0a84ff", "#8b5cf6", "#ff7eb6"];
const EMOJIS = ["❤️", "✨", "🔥", "😍", "🥹", "😂", "👍", "🙌", "🎉", "📍", "✈️", "🗼", "☕", "🍰", "🌸", "🌊", "☀️", "🌙", "⭐", "💯", "👀", "📸", "🎵", "💌", "🍀", "🎂", "🍕", "🏖️"];
const SHAPES = {
  heart: "M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z",
  arrow: "M2 12h16M12 5l7 7-7 7",
  star: "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z",
} as const;
const NO_ADJUST: Adjust = {
  v: 2,
  preset: "none", brightness: 0, contrast: 0, warmth: 0, saturation: 0, fade: 0, vignette: 0, sharpen: 0, sepia: 0, mono: 0,
  exposure: 0, highlights: 0, shadows: 0, blacks: 0, lift: 0, curve: 0, grain: 0, grainSize: 0.25, grainRough: 0.3,
  glow: 0, glowRadius: 0.5, glowSoft: 0,
  whites: 0, tint: 0, vibrance: 0, texture: 0, clarity: 0, dehaze: 0,
  gradeShadowHue: 210, gradeShadowSat: 0, gradeMidHue: 35, gradeMidSat: 0, gradeHighHue: 45, gradeHighSat: 0, gradeBalance: 0,
  ...(Object.fromEntries(HSL_BANDS.flatMap((b) => (["H", "S", "L"] as const).map((x) => [`hsl${x}_${b}`, 0]))) as Record<HslKey, number>),
};
const NO_CROP: Crop = { zoom: 1, turns: 0, straighten: 0, flip: false };
// 필터: 보정 값 묶음 (사용자가 슬라이더로 더 조정 가능)
const PRESETS: Record<string, Partial<Adjust>> = {
  none: {},
  clear: { brightness: 0.06, contrast: 0.12, saturation: 0.25 },
  // 필름 카메라 감성: 사진 원래 대비는 지키고 질감(그레인·S자 곡선·살짝 띄운 암부·따뜻함)만 더함
  film: { exposure: 0.2, shadows: 0.15, lift: 0.1, curve: 0.3, grain: 0.25, warmth: 0.08, fade: 0.1 },
  dreamy: { brightness: 0.03, saturation: -0.15, warmth: 0.1, fade: 0.1, glow: 0.4 },
  fade: { fade: 0.4, saturation: -0.2 },
  warm: { warmth: 0.45, saturation: 0.08 },
  cool: { warmth: -0.45 },
  vivid: { saturation: 0.45, contrast: 0.12 },
  vintage: { sepia: 0.35, fade: 0.1 },
  mono: { mono: 1 },
  // 2000년대 디카 감성: 대비 -20, 그레인 +22(입자 작게), 따뜻함 +15(살구빛 피부), 페이드 +28, 선명도 -10(옛 렌즈), 하이라이트 -30(플래시 질감)
  // 내추럴 필름 (라이트룸 레시피: 노출 +0.3 · 대비 -8 · 하이라이트 -20 · 그림자 +15 · 활기 +8 · 클래리티 -12 · 그레인 14 …,
  // 그림자는 살짝 차갑게·피부와 빛은 따뜻하게, 주황 밝게·노랑 살짝 주황 쪽으로)
  natural: {
    exposure: 0.15, contrast: -0.04, highlights: -0.2, shadows: 0.08, whites: -0.05,
    warmth: 0.055, tint: 0.02, saturation: 0.03, vibrance: 0.08, texture: -0.08, clarity: -0.06, sharpen: -0.1,
    grain: 0.14, grainSize: 0.15, fade: 0.02,
    gradeShadowHue: 210, gradeShadowSat: 0.03, gradeMidHue: 35, gradeMidSat: 0.04, gradeHighHue: 45, gradeHighSat: 0.06, gradeBalance: 0.05,
    hslH_orange: -0.03, hslS_orange: -0.03, hslL_orange: 0.08, hslH_yellow: -0.1, hslS_yellow: -0.05, hslS_green: -0.08, hslS_blue: -0.05,
  },
  // 폴라로이드: 검정을 살짝 띄운 매트 · 크림빛 밝은 곳 · 청록빛 어두운 곳 · 낮은 채도 · 고운 입자 · 가장자리 살짝 어둡게
  // (대비는 원래에 가깝게 — 뿌옇지 않게 띄우는 건 조금만)
  polaroid: {
    exposure: 0.08, contrast: 0, highlights: -0.16, whites: -0.05, shadows: 0.08, lift: 0.06, fade: 0.06, curve: 0.12,
    warmth: 0.1, tint: 0.03, saturation: -0.14, vibrance: 0.06, clarity: -0.08, sharpen: -0.06,
    gradeShadowHue: 180, gradeShadowSat: 0.12, gradeMidHue: 40, gradeMidSat: 0.03, gradeHighHue: 50, gradeHighSat: 0.12, gradeBalance: 0.1,
    hslS_blue: -0.12, hslL_orange: 0.05, hslH_green: 0.06,
    grain: 0.16, grainSize: 0.3, vignette: 0.22,
  },
  digicam: { contrast: -0.05, grain: 0.22, grainSize: 0.08, grainRough: 0.5, warmth: 0.15, fade: 0.1, sharpen: -0.1, highlights: -0.15 },
};
/** 프리셋을 누르면: 모든 보정을 그 프리셋 값으로 (흑백·세피아 같은 켜고 끄는 효과는 프리셋 이름으로) */
function presetAdjust(key: string): Adjust {
  return { ...NO_ADJUST, ...(PRESETS[key] ?? {}), preset: key, v: 2 };
}

// 세피아·흑백이 켜고 끄기였던 시절의 저장본: 그때 모습 그대로 (세피아·흑백 100%)
// 없앤 프리셋(흑백 대비)으로 저장한 예전 보정을 그대로 다시 열기 위한 값
const RETIRED_PRESETS: Record<string, Partial<Adjust>> = { drama: { mono: 1, contrast: 0.35 } };
const LEGACY_FLAGS: Record<string, Partial<Adjust>> = { vintage: { sepia: 1 }, mono: { mono: 1 }, drama: { mono: 1 } };

/** 예전에 저장한 보정(프리셋 값이 슬라이더에 더해지던 방식)을 지금 방식으로 — 보이는 결과는 그대로 */
function normalizeAdjust(a?: Partial<Adjust>): Adjust {
  const merged = { ...NO_ADJUST, ...a } as Adjust;
  const out = { ...merged, v: 2 as const };
  if (a?.v !== 2) {
    const p = PRESETS[merged.preset] ?? RETIRED_PRESETS[merged.preset] ?? {};
    for (const [k, val] of Object.entries(p)) if (typeof val === "number") (out as Record<string, unknown>)[k] = Number(merged[k as keyof Adjust] ?? 0) + val;
  }
  if (a?.sepia === undefined && a?.mono === undefined) Object.assign(out, LEGACY_FLAGS[merged.preset] ?? {});
  return out;
}

/** 원래 색과 효과 색을 amount 만큼 섞는 색 행렬 (fabric ColorMatrix, 4×5) */
function blendMatrix(rows: number[][], amount: number): number[] {
  const a = Math.max(0, Math.min(1, amount));
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m.push((r === c ? 1 - a : 0) + rows[r][c] * a);
    m.push(0, 0);
  }
  m.push(0, 0, 0, 1, 0);
  return m;
}
const GRAY = [0.299, 0.587, 0.114];
const SEPIA = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];

/** 저장된 캔버스에서: 사진에 걸려 있던 필터(직접 만든 필터는 다시 못 읽음)와 예전 비네트 막을 뺌 — 보정은 adjust 로 다시 적용 */
function cleanCanvasJson(json: { objects?: Record<string, unknown>[] }) {
  const walk = (objs?: Record<string, unknown>[]): Record<string, unknown>[] =>
    (objs ?? [])
      .filter((o) => o.name !== "vignette")
      .map((o) => {
        const { filters: _f, resizeFilter: _r, ...rest } = o;
        return Array.isArray(rest.objects) ? { ...rest, objects: walk(rest.objects as Record<string, unknown>[]) } : rest;
      });
  return { ...json, objects: walk(json.objects) };
}

// 보정 슬라이더: [항목, 최소, 최대, 보이는 값]
type SliderKey = Exclude<keyof Adjust, "preset" | "glowSoft" | "v">;
const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
const ev = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
type GroupTitle = "editor.groupBasic" | "editor.groupColor" | "editor.groupDetail" | "editor.groupCurve" | "editor.groupEffects";
const ADJUST_GROUPS: { title: GroupTitle; sliders: [SliderKey, number, number, (v: number) => string][] }[] = [
  {
    title: "editor.groupBasic",
    sliders: [
      ["exposure", -1, 1, ev],
      ["contrast", -0.5, 0.5, pct],
      ["highlights", -1, 1, pct],
      ["shadows", -1, 1, pct],
      ["whites", -1, 1, pct],
      ["blacks", -1, 1, pct],
      ["brightness", -0.5, 0.5, pct],
    ],
  },
  {
    title: "editor.groupColor",
    sliders: [
      ["warmth", -1, 1, pct],
      ["tint", -1, 1, pct],
      ["saturation", -1, 1, pct],
      ["vibrance", -1, 1, pct],
      ["sepia", 0, 1, pct],
      ["mono", 0, 1, pct],
    ],
  },
  {
    title: "editor.groupDetail",
    sliders: [
      ["texture", -1, 1, pct],
      ["clarity", -1, 1, pct],
      ["dehaze", -1, 1, pct],
      ["sharpen", -0.5, 0.6, pct],
    ],
  },
  {
    title: "editor.groupCurve",
    sliders: [
      ["lift", 0, 1, pct],
      ["curve", 0, 1, pct],
    ],
  },
  {
    title: "editor.groupEffects",
    sliders: [
      ["fade", 0, 1, pct],
      ["vignette", 0, 1, pct],
      ["grain", 0, 1, pct],
      ["grainSize", 0, 1, pct],
      ["grainRough", 0, 1, pct],
      ["glow", 0, 1, pct],
      ["glowRadius", 0, 1, pct],
    ],
  },
];
const deg = (v: number) => `${Math.round(v)}°`;
const hueColor = (h: number) => `hsl(${Math.round(h)} 85% 55%)`;
const GRADES = [
  { label: "editor.gradeShadows", hue: "gradeShadowHue", sat: "gradeShadowSat" },
  { label: "editor.gradeMidtones", hue: "gradeMidHue", sat: "gradeMidSat" },
  { label: "editor.gradeHighlights", hue: "gradeHighHue", sat: "gradeHighSat" },
] as const;

const blobIdOf = (url: string) => url.split("/media/").pop()!.replace(/\.jpg$/, "");
const SPECIAL = new Set(["base", "vignette", "backdrop"]);

/** 동영상 꾸미기 모드: 영상을 바탕으로 글자·스티커·그리기만 하고, 하나하나 보이는 시간(tStart~tEnd, 원본 영상 기준 초)을 정합니다.
 *  저장하면 보이는 시간이 같은 것끼리 묶어 꾸민 것만 그린 투명 PNG 들과 편집기 상태를 넘깁니다. 바탕 장면은 내보내지 않음.
 *  video 가 있으면 바탕에 영상을 재생하고 아래에 타임라인을, 없으면 한 장면(baseUrl)만. */
export type OverlayPart = { png: Blob; start: number | null; end: number | null };
/** 동영상 편집기가 꾸미기 화면에 붙이는 것들 (소리·대표 화면 탭, 음악 줄, 적용하기) — 한 화면에서 다 하도록 */
export type OverlayExtras = {
  tabs: { key: string; label: string; icon: string; panel: ReactNode }[];
  tracks: Track[];
  onTrack: (id: string, start: number, end: number, how: "move" | "left" | "right") => void;
  onSelectTrack?: (id: string) => void;
  /** 재생 위치가 바뀔 때 (음악 맞추기) */
  onTime: (t: number, playing: boolean) => void;
  /** 자르기가 바뀔 때 */
  onCut: (cut: { start: number; end: number }) => void;
  /** 원본 소리 크기 (미리 듣기) */
  volume: number;
  /** 편집기 바깥에서 바꾼 것(음악·대표 화면 등)이 있는지 — 닫을 때 확인, 적용하기 켜기 */
  dirty: boolean;
  submitLabel: string;
  submittingLabel: string;
  /** 캔버스 위에 덮어 보여 줄 진행 문구 (올리는 중·만드는 중) */
  busy?: string | null;
  /** 타임라인 위 안내 (적용했어요 등) */
  notice?: ReactNode;
  headerExtra?: ReactNode;
  /** 바깥에서 재생 위치를 옮기거나 읽을 때 */
  controller: { current: { seek: (t: number) => void; time: () => number } | null };
};
export type OverlayMode = {
  title: string;
  baseUrl: string;
  layers?: string;
  /** start·end: 지금 자른 구간, duration: 원본 길이 (꾸미면서 자르기도 바꿀 수 있음) */
  video?: { src: string; start: number; end: number; duration: number };
  onSubmit: (parts: OverlayPart[], layers: string, cut?: { start: number; end: number }) => Promise<void>;
  /** 있으면 동영상 편집 전체를 이 화면에서 (적용한 뒤에도 닫지 않음) */
  extras?: OverlayExtras;
  /** 인스타에서 가려지는 곳 안내 (피드·스토리) */
  guideKind?: "feed" | "story";
};
const DEFAULT_SPAN = 3; // 새로 넣은 글자·스티커가 보이는 시간 (초)
const round1 = (x: number) => Math.round(x * 10) / 10;

/** 템플릿 만들기 모드: 게시물 작업 없이 빈 캔버스(또는 내 템플릿)를 꾸며 '내 템플릿'으로 저장 (id 가 있으면 덮어씀) */
export type TemplateMode = { id?: string; name?: string; post: "feed" | "story" };

export function ImageEditor({
  jobId,
  index,
  asset,
  preview,
  overlay,
  templateMode,
  onClose,
  onSaved,
}: {
  jobId: number;
  index: number;
  asset: Asset;
  preview?: EditorPreview;
  overlay?: OverlayMode;
  templateMode?: TemplateMode;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const t = useT();
  const fonts = useApi<{ data: FontItem[] }>("/studio/fonts");
  const holder = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const fab = useRef<typeof F | null>(null);
  const canvas = useRef<F.Canvas | null>(null);
  const size = useRef({ w: 1080, h: 1350 });
  const zoom = useRef(1);
  const history = useRef<{ stack: string[]; at: number; restoring: boolean }>({ stack: [], at: -1, restoring: false });
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<Tab>("text");
  const [selected, setSelected] = useState<Named | null>(null);
  // 동영상 꾸미기: 바탕 영상·재생 위치
  const clip = overlay?.video;
  const videoEl = useRef<HTMLVideoElement>(null);
  const [vt, setVt] = useState(clip?.start ?? 0);
  // 자른 구간 (꾸미기 화면에서도 노란 틀로 바꿀 수 있음)
  const [clipCut, setClipCut] = useState({ start: clip?.start ?? 0, end: clip?.end ?? 0 });
  const [videoDur, setVideoDur] = useState(clip?.duration ?? 0);
  const extras = overlay?.extras;
  const guideKind = preview?.kind ?? overlay?.guideKind ?? templateMode?.post;
  const cutRef = useRef(clipCut);
  cutRef.current = clipCut;
  const vtRef = useRef(vt);
  vtRef.current = vt;
  const [playing, setPlaying] = useState(false);
  const [videoOk, setVideoOk] = useState(false);
  const readyRef = useRef(false);
  const frames = useFrames(clip ? mediaSrc(clip.src) : "", 12);
  const [, force] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [brush, setBrush] = useState<{ kind: Brush; color: string; width: number }>({ kind: "pen", color: "#ffffff", width: 8 });
  const [fillShapes, setFillShapes] = useState(false);
  const [adjust, setAdjustState] = useState<Adjust>(NO_ADJUST);
  const [crop, setCropState] = useState<Crop>(NO_CROP);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [showPreview, setShowPreview] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  // AI 배경 지우기·내 스티커
  const [aiBusy, setAiBusy] = useState<{ label: string; progress?: number } | null>(null);
  const [keyTolerance, setKeyTolerance] = useState(0.3);
  const [hslMode, setHslMode] = useState<"H" | "S" | "L">("H");
  // 인스타 게시 사이즈 가이드 (화면에만 — 저장 이미지엔 안 들어감)
  const [view, setView] = useState({ w: 0, h: 0 });
  const [guides, setGuides] = useState(true);
  // 끌거나 두 손가락으로 만지는 동안: 가운데 맞춤 선(v·h), 인스타에서 가려지는 곳으로 넘어감(warn)
  const [snap, setSnap] = useState({ v: false, h: false, warn: false });
  const photoFile = useRef<HTMLInputElement>(null);
  const [hasCutout, setHasCutout] = useState(false);
  const cutout = useRef<{ png: Blob; original: Blob } | null>(null);
  const lastBg = useRef<{ color: string } | { blur: true }>({ color: "#ffffff" });
  // 누끼 다듬기(지우개·되살리기) 화면
  const [refine, setRefine] = useState<{ src: string; original: string; onApply: (png: Blob) => Promise<void> } | null>(null);
  const stickerFile = useRef<HTMLInputElement>(null);
  const stickers = useApi<{ data: Sticker[] }>("/studio/stickers");
  // 내 필터: 지금 보정 값을 이름 붙여 저장 (회원별)
  const myFilters = useApi<{ data: { id: string; name: string; values: Record<string, number> }[] }>(overlay ? null : "/studio/filters");
  const isStory = preview?.kind === "story";
  const myPosts = useApi<{ data: { id: number; status: string; permalink: string; media_kind: string; assets: Asset[] }[] }>(
    isStory ? "/workflow/jobs?limit=30" : null,
  );
  const published = (myPosts.data?.data ?? []).filter((j) => j.status === "published" && j.permalink && j.media_kind !== "STORIES");
  const adjustRef = useRef(adjust);
  const cropRef = useRef(crop);

  const meta = (asset.meta ?? {}) as { edit?: { base_id: string; layers: string } };
  const baseId = meta.edit?.base_id || blobIdOf(asset.url);
  const find = (name: string) => canvas.current?.getObjects().find((o) => (o as Named).name === name);
  const base = () => find("base") as F.FabricImage | undefined;

  // ── 미리보기: 캔버스가 다시 그려질 때마다(끄는 중·슬라이더 움직이는 중에도) 작은 이미지로 갱신 ──────
  // 선택 테두리는 위쪽 캔버스에 그려져 toDataURL 에는 들어가지 않습니다. 1초에 최대 8번.
  const capturing = useRef(false);
  const refreshPreview = useCallback(() => {
    if (!preview || capturing.current || previewTimer.current) return;
    previewTimer.current = setTimeout(() => {
      previewTimer.current = undefined;
      const c = canvas.current;
      if (!c) return;
      capturing.current = true; // toDataURL 도 그리기 이벤트를 내므로 그동안은 무시
      try {
        setPreviewUrl(c.toDataURL({ format: "jpeg", quality: 0.8, multiplier: 540 / size.current.w / zoom.current }));
      } finally {
        capturing.current = false;
      }
    }, 120);
  }, [preview]);

  // ── 기록 (되돌리기) ─────────────────────────────────────────
  const snapshot = useCallback(() => {
    const c = canvas.current;
    const h = history.current;
    if (!c || h.restoring) return;
    const json = JSON.stringify({ canvas: c.toObject(KEEP), adjust: adjustRef.current, crop: cropRef.current });
    if (h.stack[h.at] === json) return;
    h.stack = h.stack.slice(0, h.at + 1).concat(json).slice(-40);
    h.at = h.stack.length - 1;
    setDirty(h.at > 0);
    force((n) => n + 1);
    refreshPreview();
  }, [refreshPreview]);

  const restore = useCallback(
    async (to: number) => {
      const c = canvas.current;
      const h = history.current;
      if (!c || to < 0 || to >= h.stack.length) return;
      h.restoring = true;
      const state = JSON.parse(h.stack[to]);
      await c.loadFromJSON(cleanCanvasJson(state.canvas));
      state.adjust = normalizeAdjust(state.adjust);
      setPost(state.adjust);
      adjustRef.current = state.adjust;
      cropRef.current = state.crop;
      setAdjustState(state.adjust);
      setCropState(state.crop);
      h.at = to;
      h.restoring = false;
      c.requestRenderAll();
      setSelected(null);
      setDirty(to > 0);
      force((n) => n + 1);
      refreshPreview();
    },
    [refreshPreview],
  );

  // ── 화면 크기에 맞게 보이기 (저장은 원래 크기) ──────────────────
  const fit = useCallback(() => {
    const c = canvas.current;
    const el = holder.current;
    if (!c || !el) return;
    const { w, h } = size.current;
    const z = Math.min((el.clientWidth - 24) / w, (el.clientHeight - 24) / h);
    zoom.current = z;
    c.setDimensions({ width: Math.floor(w * z), height: Math.floor(h * z) });
    setView({ w: Math.floor(w * z), h: Math.floor(h * z) });
    c.setZoom(z);
    c.requestRenderAll();
  }, []);

  // ── 열기 ───────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        const f = await import("fabric");
        if (disposed || !canvasEl.current) return;
        fab.current = f;
        const c = new f.Canvas(canvasEl.current, { preserveObjectStacking: true, backgroundColor: "#000" });
        canvas.current = c;
        // 개발용: 브라우저 테스트에서 캔버스 상태를 확인 (배포 빌드에는 없음)
        if (process.env.NODE_ENV === "development") (window as unknown as { __editorCanvas?: F.Canvas }).__editorCanvas = c;

        const savedJson = overlay ? overlay.layers : meta.edit?.layers;
        const saved = savedJson ? (JSON.parse(savedJson) as Layers) : null;
        if (saved?.canvas) {
          size.current = { w: saved.w, h: saved.h };
          const families = new Set<string>(JSON.stringify(saved.canvas).match(/ffont-[a-z_]+/g) ?? []);
          await Promise.all([...families].map((ff) => loadFont(ff.replace("ffont-", ""))));
          await c.loadFromJSON(cleanCanvasJson(saved.canvas as { objects?: Record<string, unknown>[] }));
          adjustRef.current = normalizeAdjust(saved.adjust); // 예전에 저장한 편집엔 새 보정 항목이 없음
          cropRef.current = saved.crop ?? NO_CROP;
          setAdjustState(adjustRef.current);
          setCropState(cropRef.current);
          setPost(adjustRef.current);
        } else {
          const img = await f.FabricImage.fromURL(mediaSrc(overlay ? overlay.baseUrl : `/api/py/media/${baseId}.jpg`), { crossOrigin: "anonymous" });
          const long = Math.max(img.width, img.height);
          const scale = long > 1920 ? 1920 / long : 1;
          size.current = { w: Math.round(img.width * scale), h: Math.round(img.height * scale) };
          img.set({ originX: "center", originY: "center", left: size.current.w / 2, top: size.current.h / 2, scaleX: scale, scaleY: scale, selectable: false, evented: false });
          (img as Named).name = "base";
          c.add(img);
        }
        await loadFont("pretendard");
        fit();
        ro = new ResizeObserver(fit);
        if (holder.current) ro.observe(holder.current);

        c.on("selection:created", (e) => setSelected((e.selected?.[0] as Named) ?? null));
        c.on("selection:updated", (e) => setSelected((e.selected?.[0] as Named) ?? null));
        // 글자 일부를 고르거나 풀면 아래 꾸미기 버튼들의 켜짐 상태를 다시 그림
        c.on("text:selection:changed", () => force((n) => n + 1));
        c.on("text:editing:exited", () => force((n) => n + 1));
        c.on("selection:cleared", () => setSelected(null));
        // 바로 만지기: 끄는 동안 맞춤·경고, 손을 떼면 표시를 지움
        c.on("object:moving", (e) => live.current.moving(e.target as Named));
        c.on("mouse:up", () => live.current.endMove());
        c.on("after:render", ({ ctx }) => postProcess(ctx));
        c.on("after:render", refreshPreview);
        // 동영상 꾸미기: 새로 넣은 것은 지금 재생 위치부터 몇 초 동안 보이게
        if (clip) {
          c.on("object:added", ({ target }) => {
            const o = target as Named;
            if (!readyRef.current || history.current.restoring || SPECIAL.has(o.name ?? "") || o.tStart !== undefined) return;
            const k = cutRef.current;
            const s0 = Math.min(vtRef.current, Math.max(k.start, k.end - DEFAULT_SPAN));
            o.tStart = round1(s0);
            o.tEnd = round1(Math.min(k.end, s0 + DEFAULT_SPAN));
          });
          base()?.set({ visible: true }); // 영상을 못 불러오면 장면 사진이 바탕
        }
        for (const ev of ["object:added", "object:modified", "object:removed", "path:created", "text:changed"] as const) c.on(ev, () => snapshot());
        snapshot();
        readyRef.current = true;
        setReady(true);
      } catch {
        if (!disposed) setError(t("editor.loadFailed"));
      }
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      clearTimeout(previewTimer.current);
      canvas.current?.dispose();
      canvas.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 탭·붓에 따라 그리기 / 지우개 / 사진 옮기기 모드 ─────────────────
  useEffect(() => {
    const c = canvas.current;
    const f = fab.current;
    if (!c || !f) return;
    const drawing = tab === "draw" && brush.kind !== "eraser";
    c.isDrawingMode = drawing;
    if (drawing) {
      const b = new f.PencilBrush(c);
      b.width = brush.kind === "marker" ? brush.width * 2.6 : brush.width;
      b.color = brush.kind === "marker" ? hexAlpha(brush.color, 0.45) : brush.kind === "neon" ? "#ffffff" : brush.color;
      b.strokeLineCap = brush.kind === "marker" ? "square" : "round";
      if (brush.kind === "neon") b.shadow = new f.Shadow({ color: brush.color, blur: brush.width * 2.5 });
      c.freeDrawingBrush = b;
    }
    // 지우개: 문지르는 그림·글자·스티커를 지움
    let erasing = false;
    const down = () => (erasing = true);
    const up = () => (erasing = false);
    const move = (e: { target?: F.FabricObject }) => {
      const o = e.target as Named | undefined;
      if (erasing && o && !SPECIAL.has(o.name ?? "")) c.remove(o);
    };
    const eraser = tab === "draw" && brush.kind === "eraser";
    if (eraser) {
      c.selection = false;
      c.on("mouse:down", down);
      c.on("mouse:up", up);
      c.on("mouse:move", move);
      c.on("mouse:down", move);
    } else c.selection = true;
    const img = base();
    if (img) {
      // 사진은 어느 탭에서나 빈 곳을 끌어 옮길 수 있음 (그리기 중에만 고정)
      const movable = tab !== "draw" && !overlay; // 동영상 꾸미기는 바탕이 영상이라 고정
      img.set({ selectable: movable, evented: movable, hasControls: false, hasBorders: false, lockRotation: true, hoverCursor: "grab" });
      if (!movable && c.getActiveObject() === img) c.discardActiveObject();
    }
    c.requestRenderAll();
    return () => {
      c.off("mouse:down", down);
      c.off("mouse:up", up);
      c.off("mouse:move", move);
      c.off("mouse:down", move);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, brush, ready]);

  // 단축키: Ctrl/⌘+Z 되돌리기, Ctrl/⌘+Shift+Z·Ctrl+Y 다시 하기, Delete 로 지우기
  // (입력칸에 쓰는 중이거나 글자를 고치는 중이면 브라우저 기본 동작 그대로)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const obj = canvas.current?.getActiveObject() as Named | undefined;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) && el.getAttribute("type") !== "range";
      if (typing || obj?.isEditing) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && (key === "c" || key === "x") && obj && !SPECIAL.has(obj.name ?? "")) {
        e.preventDefault();
        copySelected(key === "x");
        return;
      }
      if (key === "\\" && !mod && tab === "adjust") {
        e.preventDefault();
        compare(true);
        return;
      }
      if (mod && key === "v") {
        clearTimeout(pasteFallback);
        pasteFallback = setTimeout(() => clipboard && pasteClipboard(), 80);
        return; // 기본 동작은 막지 않음 (paste 이벤트가 오면 그쪽이 처리하고 위 타이머를 취소)
      }
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        const h = history.current;
        const redo = key === "y" || e.shiftKey;
        if (redo && h.at < h.stack.length - 1) restore(h.at + 1);
        else if (!redo && h.at > 0) restore(h.at - 1);
        return;
      }
      // ⌘/Ctrl + ] 앞으로 · [ 뒤로, Shift 를 함께 누르면 맨 앞/맨 뒤 (포토샵·피그마와 같음)
      if (mod && (e.code === "BracketRight" || e.code === "BracketLeft") && obj && !SPECIAL.has(obj.name ?? "")) {
        e.preventDefault();
        const up = e.code === "BracketRight";
        arrange(up ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward");
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && obj && !SPECIAL.has(obj.name ?? "")) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const up = (e: KeyboardEvent) => e.key === "\\" && compare(false);
    const blur = () => compare(false);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });

  // Ctrl/⌘+V: 다른 곳에서 복사한 이미지가 있으면 그 이미지를, 아니면 편집기에서 복사한 것을 붙여 넣음
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if ((canvas.current?.getActiveObject() as Named | undefined)?.isEditing) return;
      clearTimeout(pasteFallback);
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        placePhoto(file);
      } else if (clipboard) {
        e.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // ── 도구 ───────────────────────────────────────────────────
  const center = () => ({ left: size.current.w / 2, top: size.current.h / 2, originX: "center" as const, originY: "center" as const });
  const add = (obj: F.FabricObject) => {
    const c = canvas.current!;
    c.add(obj);
    c.setActiveObject(obj);
    c.requestRenderAll();
  };

  async function addText() {
    const f = fab.current!;
    await loadFont("pretendard");
    add(
      new f.IText(t("editor.defaultText"), {
        ...center(),
        fontFamily: fontFamily("pretendard"),
        fontSize: Math.round(size.current.w * 0.075),
        fill: "#ffffff",
        textAlign: "center",
        shadow: new f.Shadow({ color: "rgba(0,0,0,0.45)", blur: 12, offsetX: 0, offsetY: 3 }),
      }),
    );
  }

  const isText = (o: F.FabricObject | null): o is F.IText => !!o && (o.type === "i-text" || o.type === "text" || o.type === "textbox");
  async function setTextProp(props: Partial<F.IText>, fontKey?: string) {
    const o = selected;
    if (!isText(o)) return;
    if (fontKey) await loadFont(fontKey);
    o.set(props);
    canvas.current!.requestRenderAll();
    snapshot();
    force((n) => n + 1);
  }
  // ── 글자 꾸미기: 고른 글자(일부)만, 고르지 않았으면 글자 상자 전체 ──────────────
  // 버튼을 누르는 순간 글자 고치기가 끝날 수 있어, 누르기 직전의 선택 범위를 기억해 둠
  const textRange = useRef<{ obj: F.IText; start: number; end: number } | null>(null);
  const captureRange = () => {
    const o = selected;
    if (isText(o) && (o as Named).isEditing && (o.selectionStart ?? 0) < (o.selectionEnd ?? 0)) {
      textRange.current = { obj: o, start: o.selectionStart!, end: o.selectionEnd! };
    } else if (!isText(o) || textRange.current?.obj !== o) {
      textRange.current = null;
    }
  };
  const rangeOf = (o: F.IText) => {
    if ((o as Named).isEditing && (o.selectionStart ?? 0) < (o.selectionEnd ?? 0)) return { start: o.selectionStart!, end: o.selectionEnd! };
    const r = textRange.current;
    return r && r.obj === o && r.end <= (o.text ?? "").length ? { start: r.start, end: r.end } : null;
  };

  /** 글자 하나하나에 걸 수 있는 꾸미기 (굵기·기울임·밑줄·취소선·색·글꼴·크기) */
  async function setCharStyle(props: Record<string, unknown>, fontKey?: string) {
    const o = selected;
    if (!isText(o)) return;
    if (fontKey) await loadFont(fontKey);
    const range = rangeOf(o);
    if (range) {
      o.setSelectionStyles(props, range.start, range.end);
    } else {
      // 전체에 적용: 글자마다 따로 걸어 둔 같은 꾸미기는 지우고 상자에 한 번에
      for (const k of Object.keys(props)) o.removeStyle(k as keyof F.TextStyleDeclaration);
      o.set(props as Partial<F.IText>);
    }
    o.initDimensions?.();
    canvas.current!.requestRenderAll();
    snapshot();
    force((n) => n + 1);
  }

  /** 지금 꾸미기 값 (고른 글자가 있으면 그 글자들이 모두 같을 때만) */
  function charStyleValue<K extends string>(key: K): unknown {
    const o = selected;
    if (!isText(o)) return undefined;
    const range = rangeOf(o);
    if (!range) return (o as unknown as Record<string, unknown>)[key];
    const styles = o.getSelectionStyles(range.start, range.end, true) as Record<string, unknown>[];
    const first = styles[0]?.[key];
    return styles.every((st) => st[key] === first) ? first : undefined;
  }

  /** 글자 효과 — 글꼴은 그대로 두고 그림자·네온 빛만 바꿈 (둘 중 하나 또는 없음) */
  type Glow = "none" | "shadow" | "neon";
  const glowOf = (o: F.IText): Glow => {
    const sh = o.shadow as F.Shadow | null;
    if (!sh) return "none";
    return sh.offsetX === 0 && sh.offsetY === 0 && sh.blur >= 18 ? "neon" : "shadow";
  };
  async function textGlow(glow: Glow) {
    const f = fab.current!;
    const o = selected;
    if (!isText(o)) return;
    const was = glowOf(o);
    if (was === glow) return;
    // 네온: 글자는 흰 심지, 고른 색은 바깥 빛으로. 네온을 끄면 그 빛 색을 다시 글자 색으로
    const fill = typeof o.fill === "string" ? o.fill : "#ffffff";
    const neonColor = was === "neon" ? String((o.shadow as F.Shadow).color) : fill.toLowerCase() !== "#ffffff" ? fill : "#ff3b5c";
    await setTextProp({
      shadow:
        glow === "none"
          ? null
          : glow === "neon"
            ? new f.Shadow({ color: neonColor, blur: 22, offsetX: 0, offsetY: 0 })
            : new f.Shadow({ color: "rgba(0,0,0,0.45)", blur: 12, offsetX: 0, offsetY: 3 }),
      ...(glow === "neon" ? { fill: "#ffffff" } : was === "neon" ? { fill: neonColor } : {}),
    } as Partial<F.IText>);
  }
  /** 네온 빛 색 (글자 색과 따로 고름) */
  function pickGlowColor(c: string) {
    return setTextProp({ shadow: new fab.current!.Shadow({ color: c, blur: 22, offsetX: 0, offsetY: 0 }) } as Partial<F.IText>);
  }
  /** 외곽선 켜고 끄기 (글자 뒤에 칠해서 글자 모양이 가늘어지지 않게) */
  function textOutline() {
    const o = selected;
    if (!isText(o)) return;
    const on = !!o.stroke && (o.strokeWidth ?? 0) > 0;
    // 어두운 글자엔 흰 외곽선, 밝은 글자엔 검은 외곽선
    const hex = typeof o.fill === "string" && /^#[0-9a-f]{6}$/i.test(o.fill) ? o.fill : "#ffffff";
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const dark = 0.299 * r + 0.587 * g + 0.114 * b < 110;
    setTextProp(
      on
        ? ({ stroke: null, strokeWidth: 0 } as Partial<F.IText>)
        : { stroke: dark ? "#ffffff" : "#000000", strokeWidth: Math.max(2, Math.round((o.fontSize ?? 48) * 0.08)), paintFirst: "stroke", strokeLineJoin: "round" },
    );
  }

  // ── 스토리 링크·게시물 스티커 (모양만 — 누를 수 있는 링크는 게시 후 인스타 앱에서 붙임) ─────────
  type LinkObj = Named & { link?: string };
  const storyLinks = () =>
    (canvas.current?.getObjects() ?? [])
      .filter((o) => (o as Named).name === "link-sticker" || (o as Named).name === "post-sticker")
      .map((o) => ({ kind: (o as Named).name === "post-sticker" ? "post" : "link", url: (o as LinkObj).link ?? "" }))
      .filter((l) => l.url);

  async function addLinkSticker() {
    const f = fab.current!;
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    await loadFont("pretendard");
    const label = linkLabel.trim() || url.replace(/^https?:\/\//i, "").replace(/\/$/, "").slice(0, 28);
    const fs = Math.round(size.current.w * 0.042);
    const text = new f.FabricText(`🔗 ${label.toUpperCase()}`, {
      fontFamily: fontFamily("pretendard"), fontSize: fs, fontWeight: "bold", fill: "#2563eb", originX: "center", originY: "center", left: 0, top: 0,
    });
    const h = text.height + fs * 1.1;
    const pill = new f.Rect({
      width: text.width + fs * 1.8, height: h, rx: h / 2, ry: h / 2, fill: "#ffffff", originX: "center", originY: "center", left: 0, top: 0,
      shadow: new f.Shadow({ color: "rgba(0,0,0,0.25)", blur: 12, offsetY: 3 }),
    });
    const g = new f.Group([pill, text], { ...center() }) as LinkObj;
    g.name = "link-sticker";
    g.link = url;
    add(g);
    setLinkUrl("");
    setLinkLabel("");
  }

  async function addPostSticker(job: { permalink: string; assets: Asset[] }) {
    const f = fab.current!;
    const thumb = job.assets.find((a) => a.type === "image")?.url ?? job.assets[0]?.thumbnail_url;
    if (!thumb) return;
    await loadFont("pretendard");
    const W = size.current.w * 0.44;
    const pad = W * 0.05;
    const img = await f.FabricImage.fromURL(mediaSrc(thumb), { crossOrigin: "anonymous" });
    img.scaleToWidth(W - pad * 2);
    const imgH = img.getScaledHeight();
    img.set({ left: pad, top: pad, originX: "left", originY: "top" });
    const fs = W * 0.075;
    const label = new f.FabricText(`${t("editor.postView")} ›`, {
      fontFamily: fontFamily("pretendard"), fontSize: fs, fontWeight: "bold", fill: "#111111", left: pad, top: pad * 2 + imgH, originX: "left", originY: "top",
    });
    const card = new f.Rect({
      left: 0, top: 0, originX: "left", originY: "top", width: W, height: imgH + pad * 3 + fs * 1.2, rx: pad, ry: pad, fill: "#ffffff",
      shadow: new f.Shadow({ color: "rgba(0,0,0,0.3)", blur: 16, offsetY: 4 }),
    });
    const g = new f.Group([card, img, label], { ...center() }) as LinkObj;
    g.name = "post-sticker";
    g.link = job.permalink;
    add(g);
  }

  function addEmoji(e: string) {
    const f = fab.current!;
    add(new f.FabricText(e, { ...center(), fontSize: Math.round(size.current.w * 0.16) }));
  }

  function addShape(kind: "heart" | "arrow" | "star" | "circle" | "highlight" | "rect" | "line") {
    const f = fab.current!;
    const s = size.current.w * 0.22;
    const color = brush.color;
    const stroke = { fill: fillShapes ? color : "", stroke: color, strokeWidth: s * 0.05 };
    if (kind === "circle") return add(new f.Circle({ ...center(), radius: s / 2, ...stroke }));
    if (kind === "rect") return add(new f.Rect({ ...center(), width: s * 1.3, height: s, rx: 6, ry: 6, ...stroke }));
    if (kind === "line") return add(new f.Line([0, 0, s * 1.5, 0], { ...center(), stroke: color, strokeWidth: s * 0.05, strokeLineCap: "round" }));
    if (kind === "highlight") return add(new f.Rect({ ...center(), width: s * 1.6, height: s * 0.4, fill: color, opacity: 0.4, rx: 8, ry: 8 }));
    const p = new f.Path(SHAPES[kind], {
      ...center(),
      fill: kind === "arrow" ? "" : color,
      stroke: kind === "arrow" ? color : "",
      strokeWidth: kind === "arrow" ? 2.2 : 0,
      strokeLineCap: "round",
      strokeLineJoin: "round",
    });
    p.scaleToWidth(s);
    add(p);
  }

  /** 고른 도형·그림(글자 제외)의 색을 바꿉니다. 아무것도 안 골랐으면 다음에 추가할 도형·펜 색만 바뀜. */
  function recolor(color: string) {
    setBrush((b) => ({ ...b, color }));
    const c = canvas.current;
    if (!c) return;
    const objs = c.getActiveObjects().filter((o) => !SPECIAL.has((o as Named).name ?? "") && !isText(o));
    if (!objs.length) return;
    for (const o of objs) {
      const stroke = typeof o.stroke === "string" ? o.stroke : "";
      if (stroke === "#ffffff" && o.shadow) {
        o.shadow.color = color; // 네온 펜: 하얀 심 + 색 번짐
      } else if (stroke) {
        o.set("stroke", stroke.startsWith("rgba") ? hexAlpha(color, 0.45) : color); // 형광펜은 반투명 유지
      }
      if (typeof o.fill === "string" && o.fill) o.set("fill", color);
    }
    c.requestRenderAll();
    snapshot();
    force((n) => n + 1);
  }

  /** 채우기 켜기/끄기 — 고른 동그라미·사각형에도 바로 적용 */
  function toggleFill() {
    const next = !fillShapes;
    setFillShapes(next);
    const c = canvas.current;
    if (!c) return;
    const objs = c.getActiveObjects().filter((o) => o.type === "circle" || (o.type === "rect" && (o as Named).name !== "vignette" && o.stroke));
    if (!objs.length) return;
    for (const o of objs) o.set("fill", next ? (typeof o.stroke === "string" ? o.stroke : brush.color) : "");
    c.requestRenderAll();
    snapshot();
  }

  function removeSelected() {
    const c = canvas.current!;
    for (const o of c.getActiveObjects()) if (!SPECIAL.has((o as Named).name ?? "")) c.remove(o);
    c.discardActiveObject();
    c.requestRenderAll();
  }

  /** 겹친 순서 바꾸기 — 바탕 사진(base)은 늘 맨 아래, 비네팅은 늘 맨 위에 둠 */
  function arrange(dir: "front" | "forward" | "backward" | "back") {
    const c = canvas.current;
    const o = c?.getActiveObject();
    if (!c || !o) return;
    const all = c.getObjects();
    const layers = all.filter((x) => !SPECIAL.has((x as Named).name ?? ""));
    const moving = (c.getActiveObjects().length ? c.getActiveObjects() : [o]).filter((x) => layers.includes(x));
    if (!moving.length) return;
    const rest = layers.filter((x) => !moving.includes(x));
    const first = layers.indexOf(moving[0]);
    // 움직이는 묶음이 들어갈 자리 (나머지 레이어 기준)
    let at = rest.filter((x) => layers.indexOf(x) < first).length;
    if (dir === "front") at = rest.length;
    else if (dir === "back") at = 0;
    else if (dir === "forward") at = Math.min(rest.length, at + 1);
    else at = Math.max(0, at - 1);
    const order = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    const base = [...all.filter((x) => (x as Named).name === "backdrop"), ...all.filter((x) => (x as Named).name === "base")];
    const top = all.filter((x) => (x as Named).name === "vignette");
    [...base, ...order, ...top].forEach((x, i) => c.moveObjectTo(x, i));
    c.requestRenderAll();
    snapshot();
  }

  // ── AI 배경 지우기(누끼) · 내 스티커 ─────────────────────────────────
  async function cut(blob: Blob): Promise<Blob> {
    setAiBusy({ label: t("editor.cutting") });
    try {
      return await removeBackground(blob, (p) => setAiBusy({ label: t("editor.modelDownloading"), progress: Math.round(p) }));
    } finally {
      setAiBusy(null);
    }
  }

  /** 사진(base)을 다른 이미지로 바꿈 — 자르기·보정·글자는 그대로 */
  async function setBase(url: string) {
    const img = base();
    if (!img) return;
    await img.setSrc(mediaSrc(url), { crossOrigin: "anonymous" });
    applyAdjust(adjustRef.current, true);
  }

  async function uploadJpeg(blob: Blob): Promise<string> {
    const body = new FormData();
    body.append("file", blob, "background.jpg");
    const res = await fetch("/api/py/media/uploads", { method: "POST", body, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || res.status);
    return data.url as string;
  }

  /** 사진의 배경을 지우고(처음 한 번) 흰 배경으로. 이후엔 배경색·흐린 원본으로 바꿀 수 있음 */
  async function removePhotoBackground() {
    const img = base() as Named | undefined;
    if (!img) return;
    setError(undefined);
    try {
      const orig = img.orig || (img as F.FabricImage).getSrc();
      const original = await (await fetch(mediaSrc(orig), { credentials: "include" })).blob();
      const png = await cut(original);
      cutout.current = { png, original };
      img.orig = orig;
      setHasCutout(true);
      await changeBackground({ color: "#ffffff" });
    } catch (e) {
      setError(t("editor.cutFailed", { e: toApiError(e).message }));
    }
  }

  async function changeBackground(bg: { color: string } | { blur: true }) {
    const c = cutout.current;
    if (!c) return;
    lastBg.current = bg;
    setAiBusy({ label: t("editor.applying") });
    try {
      const out = await composite(c.png, "color" in bg ? bg : { blurOf: c.original });
      await setBase(await uploadJpeg(out));
    } catch (e) {
      setError(t("editor.cutFailed", { e: toApiError(e).message }));
    } finally {
      setAiBusy(null);
    }
  }

  /** 사진(누끼) 다듬기: 지우개·되살리기 → 같은 배경으로 다시 합침 */
  function refinePhoto() {
    const c = cutout.current;
    if (!c) return;
    setRefine({
      src: URL.createObjectURL(c.png),
      original: URL.createObjectURL(c.original),
      onApply: async (png) => {
        cutout.current = { ...c, png };
        await changeBackground(lastBg.current);
      },
    });
  }

  /** 고른 사진·스티커 다듬기 */
  function refineSelected() {
    const o = canvas.current?.getActiveObject() as (F.FabricImage & Named) | undefined;
    if (!o || o.type !== "image" || SPECIAL.has(o.name ?? "")) return;
    const current = o.getSrc();
    const orig = o.orig || current;
    setRefine({
      src: mediaSrc(current),
      original: mediaSrc(orig),
      onApply: async (png) => {
        setAiBusy({ label: t("editor.applying") });
        try {
          const url = await uploadLayer(png);
          await o.setSrc(mediaSrc(url), { crossOrigin: "anonymous" });
          o.orig = orig;
          canvas.current!.requestRenderAll();
          snapshot();
        } catch (e) {
          setError(t("editor.cutFailed", { e: toApiError(e).message }));
        } finally {
          setAiBusy(null);
        }
      },
    });
  }

  async function restoreOriginalPhoto() {
    const img = base() as Named | undefined;
    if (!img?.orig) return;
    setAiBusy({ label: t("editor.applying") });
    try {
      await setBase(img.orig);
      img.orig = undefined;
      cutout.current = null;
      setHasCutout(false);
    } finally {
      setAiBusy(null);
    }
  }

  // ── 복사·붙여넣기·복제 (글자·도형·그림·스티커·사진 모두) ──────────────────
  async function copySelected(cut = false) {
    const c = canvas.current;
    const o = c?.getActiveObject() as Named | undefined;
    if (!c || !o || SPECIAL.has(o.name ?? "")) return;
    clipboard = await o.clone(KEEP);
    pasteCount = 0;
    if (cut) removeSelected();
  }

  async function pasteClipboard() {
    const c = canvas.current;
    if (!c || !clipboard) return;
    const copy = (await clipboard.clone(KEEP)) as F.FabricObject;
    pasteCount += 1;
    const shift = Math.round(size.current.w * 0.03) * pasteCount;
    copy.set({ left: (copy.left ?? 0) + shift, top: (copy.top ?? 0) + shift, evented: true, selectable: true });
    c.discardActiveObject();
    if (copy instanceof fab.current!.ActiveSelection) {
      // 여러 개를 함께 복사한 경우: 하나씩 캔버스에 넣고 다시 함께 선택
      copy.canvas = c;
      copy.forEachObject((o) => c.add(o));
      copy.setCoords();
      c.setActiveObject(copy);
      c.requestRenderAll();
    } else add(copy);
  }

  async function duplicateSelected() {
    await copySelected();
    await pasteClipboard();
  }

  // ── 디자인 템플릿: 테마 다시 입히기 · 내 템플릿으로 저장 · 사진 칸 바꾸기 ─────────────
  const myThemes = useApi<{ data: Theme[] }>(overlay ? null : "/studio/themes");
  const [tplName, setTplName] = useState("");
  const [tplSaved, setTplSaved] = useState(false);
  const slotInput = useRef<HTMLInputElement>(null);
  async function themeThisPage(th: Theme) {
    const c = canvas.current;
    if (!c || !fab.current) return;
    setAiBusy({ label: t("editor.applying") });
    try {
      await applyTheme(fab.current, c, th, size.current);
      c.requestRenderAll();
      snapshot();
    } finally {
      setAiBusy(null);
    }
  }
  /** 템플릿 만들기 모드의 저장: 이름을 정해 내 템플릿으로 (고치는 중이면 덮어씀) */
  async function saveTemplate() {
    const c = canvas.current;
    if (!c || !templateMode) return;
    const name = (tplName.trim() || templateMode.name || window.prompt(t("design.templateName"), t("design.newTemplateName")) || "").trim();
    if (!name) return;
    setSaving(true);
    setError(undefined);
    try {
      c.discardActiveObject();
      c.isDrawingMode = false;
      c.renderAll();
      const out = await exportPage(c, size.current, zoom.current);
      const thumb = await (await fetch(c.toDataURL({ format: "jpeg", quality: 0.82, multiplier: 270 / size.current.w / zoom.current }))).blob();
      const body = new FormData();
      body.append("pages", JSON.stringify([out.layers]));
      body.append("bgs", out.bg, "bg.jpg");
      body.append("thumb", thumb, "thumb.jpg");
      body.append("name", name.slice(0, 40));
      if (!templateMode.id) body.append("post_type", templateMode.post);
      const res = await fetch(`/api/py/studio/templates${templateMode.id ? `/${templateMode.id}` : ""}`, {
        method: templateMode.id ? "PUT" : "POST",
        body,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      await onSaved();
      onClose();
    } catch (e) {
      setError(t("editor.saveFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  async function saveAsTemplate() {
    const c = canvas.current;
    if (!c || !tplName.trim()) return;
    setAiBusy({ label: t("design.saving") });
    setError(undefined);
    try {
      c.discardActiveObject();
      c.renderAll();
      const out = await exportPage(c, size.current, zoom.current);
      const thumb = await (await fetch(c.toDataURL({ format: "jpeg", quality: 0.82, multiplier: 270 / size.current.w / zoom.current }))).blob();
      const body = new FormData();
      body.append("pages", JSON.stringify([out.layers]));
      body.append("bgs", out.bg, "bg.jpg");
      body.append("thumb", thumb, "thumb.jpg");
      body.append("name", tplName.trim());
      body.append("post_type", preview?.kind === "story" ? "story" : "feed");
      const res = await fetch("/api/py/studio/templates", { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      setTplSaved(true);
      setTplName("");
      setTimeout(() => setTplSaved(false), 3000);
    } catch (e) {
      setError(t("editor.saveFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setAiBusy(null);
    }
  }
  async function replaceSlotPhoto(file: File) {
    const o = canvas.current?.getActiveObject() as (F.FabricImage & { tk?: Tk }) | undefined;
    const f = fab.current;
    if (!o?.tk?.slot || !f) return;
    setAiBusy({ label: t("editor.applying") });
    try {
      const url = await uploadLayer(await toBrowserImage(file));
      await o.setSrc(mediaSrc(url), { crossOrigin: "anonymous" });
      fitToSlot(f, o, o.tk.slot);
      canvas.current!.requestRenderAll();
      snapshot();
    } catch (e) {
      setError(t("editor.stickerFailed", { e: toApiError(e).message }));
    } finally {
      setAiBusy(null);
    }
  }

  async function uploadLayer(blob: Blob): Promise<string> {
    const body = new FormData();
    body.append("file", blob, "layer.png");
    const res = await fetch("/api/py/studio/layers", { method: "POST", body, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || res.status);
    return data.url as string;
  }

  /** 사진 붙이기 (AI 없이): 올려서 저장해 두고(다시 열어도 남게) 캔버스 가운데에 */
  async function placePhoto(file: Blob) {
    setError(undefined);
    setAiBusy({ label: t("editor.applying") });
    try {
      const url = await uploadLayer(file instanceof File ? await toBrowserImage(file) : file);
      const img = await fab.current!.FabricImage.fromURL(mediaSrc(url), { crossOrigin: "anonymous" });
      img.scale((size.current.w * 0.6) / Math.max(img.width, img.height));
      img.set(center());
      add(img);
    } catch (e) {
      setError(t("editor.stickerFailed", { e: toApiError(e).message }));
    } finally {
      setAiBusy(null);
    }
  }

  /** 고른 사진(스티커·붙인 사진)의 배경 지우기 — AI 또는 단색. 언제나 원본에서 다시 하므로 여러 번 바꿔도 깨끗함 */
  async function cutSelected(mode: "ai" | "solid", tolerance = keyTolerance) {
    const o = canvas.current?.getActiveObject() as (F.FabricImage & Named) | undefined;
    if (!o || o.type !== "image" || SPECIAL.has(o.name ?? "")) return;
    setError(undefined);
    try {
      const orig = o.orig || o.getSrc();
      let png: Blob;
      if (mode === "ai") {
        png = await cut(await (await fetch(mediaSrc(orig), { credentials: "include" })).blob());
      } else {
        const el = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error("image"));
          im.src = mediaSrc(orig);
        });
        png = await removeSolidBackground(el, tolerance);
      }
      setAiBusy({ label: t("editor.applying") });
      const url = await uploadLayer(png);
      await o.setSrc(mediaSrc(url), { crossOrigin: "anonymous" });
      o.orig = orig;
      canvas.current!.requestRenderAll();
      snapshot();
    } catch (e) {
      setError(t("editor.cutFailed", { e: toApiError(e).message }));
    } finally {
      setAiBusy(null);
    }
  }

  async function restoreSelectedImage() {
    const o = canvas.current?.getActiveObject() as (F.FabricImage & Named) | undefined;
    if (!o?.orig) return;
    await o.setSrc(mediaSrc(o.orig), { crossOrigin: "anonymous" });
    o.orig = undefined;
    canvas.current!.requestRenderAll();
    snapshot();
  }

  async function placeSticker(st: Sticker) {
    const f = fab.current!;
    const img = await f.FabricImage.fromURL(mediaSrc(st.url), { crossOrigin: "anonymous" });
    img.scale((size.current.w * 0.4) / Math.max(img.width, img.height));
    img.set(center());
    add(img);
  }

  async function saveSticker(blob: Blob): Promise<Sticker> {
    const body = new FormData();
    body.append("file", blob, "sticker.png");
    const res = await fetch("/api/py/studio/stickers", { method: "POST", body, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || res.status);
    stickers.reload();
    return data as Sticker;
  }

  /** 사진으로 스티커 만들기 (배경 지우기 선택) → 저장하고 바로 붙임 */
  async function stickerFromFile(file: File) {
    setError(undefined);
    try {
      const png = await cut(await toBrowserImage(file));
      setAiBusy({ label: t("editor.applying") });
      await placeSticker(await saveSticker(png));
    } catch (e) {
      setError(t("editor.stickerFailed", { e: toApiError(e).message }));
    } finally {
      setAiBusy(null);
    }
  }

  /** 고른 글자·그림·스티커를 내 스티커로 저장 (다른 사진에서도 다시 쓰기) */
  async function saveSelectionAsSticker() {
    const o = canvas.current?.getActiveObject() as Named | undefined;
    if (!o || SPECIAL.has(o.name ?? "")) return;
    setError(undefined);
    setAiBusy({ label: t("editor.applying") });
    try {
      const blob = await (await fetch(o.toDataURL({ format: "png", multiplier: 2 }))).blob();
      await saveSticker(blob);
    } catch (e) {
      setError(t("editor.stickerFailed", { e: toApiError(e).message }));
    } finally {
      setAiBusy(null);
    }
  }

  async function deleteSticker(id: string) {
    if (!window.confirm(t("editor.stickerDeleteConfirm"))) return;
    try {
      await api(`/studio/stickers/${id}`, { method: "DELETE" });
      stickers.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  // ── 보정: 사진(base)에만 필터, 비네트는 위에 덮는 막 ─────────────────
  // 보정은 사진만이 아니라 캔버스 전체(사진·글자·스티커·도형·그림)에 한 번에 — 캔버스를 다 그린 뒤 걸러냅니다.
  // 화면·미리보기·저장(toDataURL) 모두 같은 'after:render' 를 거치므로 결과가 같습니다.
  const post = useRef<{ filters: F.filters.BaseFilter<string, object>[]; vignette: number }>({ filters: [], vignette: 0 });
  // 원본과 비교: 누르고 있는 동안 보정을 끔 (저장·편집 기록엔 영향 없음)
  const comparing = useRef(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const compare = (on: boolean) => {
    if (comparing.current === on) return;
    comparing.current = on;
    setShowOriginal(on);
    canvas.current?.requestRenderAll();
  };
  const scratch = useRef<{ src?: HTMLCanvasElement; out?: HTMLCanvasElement }>({});

  function buildFilters(a: Adjust): F.filters.BaseFilter<string, object>[] {
    const f = fab.current!;
    const v = (k: keyof Adjust) => Number(a[k] ?? 0);
    const list: F.filters.BaseFilter<string, object>[] = [];
    if (v("mono") > 0) list.push(new f.filters.ColorMatrix({ matrix: blendMatrix([GRAY, GRAY, GRAY], v("mono")) }));
    if (v("sepia") > 0) list.push(new f.filters.ColorMatrix({ matrix: blendMatrix(SEPIA, v("sepia")) }));
    if (v("brightness")) list.push(new f.filters.Brightness({ brightness: v("brightness") }));
    // 페이드: 필름 매트처럼 검정만 살짝 띄움 (밝은 곳은 그대로 → 전체가 뿌옇게 되지 않음)
    const fd = v("fade") * 0.2;
    if (fd) list.push(new f.filters.ColorMatrix({ matrix: [1 - fd, 0, 0, 0, fd, 0, 1 - fd, 0, 0, fd, 0, 0, 1 - fd, 0, fd, 0, 0, 0, 1, 0] }));
    // 대비: 낮출 때는 절반 세기 (라이트룸 -값 정도로 — 사진 원래 대비를 지킴)
    const ct = v("contrast");
    if (ct) list.push(new f.filters.Contrast({ contrast: ct < 0 ? ct * 0.5 : ct }));
    if (v("saturation")) list.push(new f.filters.Saturation({ saturation: v("saturation") }));
    if (v("vibrance")) list.push(new f.filters.Vibrance({ vibrance: v("vibrance") }));
    const w = v("warmth");
    // 따뜻함: 화이트밸런스처럼 빨강·파랑 세기만 바꿈 (색을 덮지 않아 검정은 검정 그대로)
    if (w) list.push(new f.filters.ColorMatrix({ matrix: [1 + 0.18 * w, 0, 0, 0, 0, 0, 1 + 0.04 * w, 0, 0, 0, 0, 0, 1 - 0.22 * w, 0, 0, 0, 0, 0, 1, 0] }));
    // 필름 톤: 노출 · 어두운 영역 · 검정 계열 · 곡선(암부 들어올림 · S자)
    const film = filmFilters(f);
    const tone = {
      exposure: v("exposure"), highlights: v("highlights"), shadows: v("shadows"), whites: v("whites"), blacks: v("blacks"),
      lift: v("lift"), curve: v("curve"), dehaze: v("dehaze"),
    };
    if (Object.values(tone).some(Boolean)) list.push(new film.FilmTone(tone));
    // 색조 · HSL 8색 · 컬러 그레이딩
    const cf = colorFilters(f);
    const color = {
      tint: v("tint"),
      gradeHue: [v("gradeShadowHue"), v("gradeMidHue"), v("gradeHighHue")] as [number, number, number],
      gradeSat: [v("gradeShadowSat"), v("gradeMidSat"), v("gradeHighSat")] as [number, number, number],
      balance: v("gradeBalance"),
      hslHue: HSL_BANDS.map((b) => v(`hslH_${b}`)),
      hslSat: HSL_BANDS.map((b) => v(`hslS_${b}`)),
      hslLum: HSL_BANDS.map((b) => v(`hslL_${b}`)),
    };
    if (color.tint || color.gradeSat.some(Boolean) || [...color.hslHue, ...color.hslSat, ...color.hslLum].some(Boolean)) list.push(new cf.FilmColor(color));
    // 텍스처 · 부분 대비
    if (v("texture") || v("clarity")) list.push(new cf.FilmDetail({ texture: v("texture"), clarity: v("clarity") }));
    // 선명도: + 는 또렷하게, - 는 살짝 뭉개 옛날 렌즈 느낌
    const sh = v("sharpen");
    if (sh > 0) list.push(new f.filters.Convolute({ matrix: [0, -sh, 0, -sh, 1 + 4 * sh, -sh, 0, -sh, 0] }));
    if (sh < 0) list.push(new f.filters.Blur({ blur: -sh * 0.04 }));
    // 글로우 (흐린 사본을 겹쳐 하이라이트가 번지게) → 그 위에 그레인
    if (v("glow") > 0) list.push(new film.FilmGlow({ amount: v("glow"), radius: v("glowRadius"), mode: v("glowSoft") >= 0.5 ? "soft" : "screen" }));
    // 그레인은 맨 마지막 (선명도·글로우에 깎이지 않게)
    if (v("grain") > 0) list.push(new film.FilmGrain({ amount: v("grain"), size: v("grainSize"), roughness: v("grainRough") }));
    return list;
  }

  function setPost(a: Adjust) {
    if (!fab.current) return;
    post.current = { filters: buildFilters(a), vignette: Number(a.vignette) || 0 };
    // 예전 방식으로 사진에만 걸려 있던 필터는 걷어냄 (이제 전체에 한 번만)
    const img = base();
    if (img && img.filters?.length) {
      img.filters = [];
      img.applyFilters();
    }
  }

  /** 다 그린 캔버스 전체에 보정 필터 → 그 위에 비네트 */
  function postProcess(ctx: CanvasRenderingContext2D) {
    const { filters, vignette } = post.current;
    if (!filters.length && !vignette) return;
    if (comparing.current && ctx.canvas === canvas.current?.lowerCanvasEl) return; // 화면에서만 원본 (저장은 언제나 보정 적용)
    const f = fab.current;
    const cv = ctx.canvas as HTMLCanvasElement;
    const W = cv.width, H = cv.height;
    if (!f || !W || !H) return;
    if (filters.length) {
      const sc = scratch.current;
      const src = (sc.src ??= document.createElement("canvas"));
      const out = (sc.out ??= document.createElement("canvas"));
      if (src.width !== W || src.height !== H) Object.assign(src, { width: W, height: H });
      if (out.width !== W || out.height !== H) Object.assign(out, { width: W, height: H });
      const sctx = src.getContext("2d")!;
      sctx.clearRect(0, 0, W, H);
      sctx.drawImage(cv, 0, 0);
      out.getContext("2d")!.clearRect(0, 0, W, H);
      const gl = f.getFilterBackend() as { tileSize?: number };
      // 개발용: window.__force2d = true 로 WebGL 없는 기기(픽셀 계산)도 확인
      const force2d = process.env.NODE_ENV === "development" && (window as unknown as { __force2d?: boolean }).__force2d;
      const backend = force2d || (gl.tileSize && Math.max(W, H) > gl.tileSize) ? new f.Canvas2dFilterBackend() : f.getFilterBackend();
      backend.applyFilters(filters, src, W, H, out);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(out, 0, 0);
      ctx.restore();
    }
    if (vignette > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) / 2);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, `rgba(0,0,0,${0.85 * Math.min(1, vignette)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  async function saveMyFilter() {
    const name = window.prompt(t("editor.saveFilterPrompt"))?.trim();
    if (!name) return;
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(adjustRef.current)) if (typeof v === "number" && k !== "v") values[k] = v;
    try {
      const saved = await api<{ id: string }>("/studio/filters", { method: "POST", json: { name: name.slice(0, 20), values } });
      myFilters.reload();
      applyAdjust({ ...adjustRef.current, preset: `my:${saved.id}` }, true);
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  async function deleteMyFilter(id: string) {
    if (!window.confirm(t("editor.deleteFilterConfirm"))) return;
    try {
      await api(`/studio/filters/${id}`, { method: "DELETE" });
      myFilters.reload();
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  function applyAdjust(next: Adjust, commit = false) {
    adjustRef.current = next;
    setAdjustState(next);
    setPost(next);
    const c = canvas.current;
    if (!c) return;
    // 예전 편집에 남은 비네트 막은 지움 (이제 맨 위에 그려 줌)
    const vig = find("vignette");
    if (vig) {
      history.current.restoring = true;
      c.remove(vig);
      history.current.restoring = false;
    }
    c.requestRenderAll();
    if (commit) snapshot();
    else refreshPreview();
  }

  // ── 자르기: 틀은 그대로, 사진을 확대·이동·회전 (항상 틀을 덮도록) ──────────
  function applyCrop(next: Crop, recenter = false) {
    cropRef.current = next;
    setCropState(next);
    const img = base();
    if (!img) return;
    const { w, h } = size.current;
    const angle = next.turns * 90 + next.straighten;
    const rad = (angle * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const cover = Math.max((w * cos + h * sin) / img.width, (w * sin + h * cos) / img.height);
    next = { ...next, zoom: Math.max(minZoom(next), Math.min(3, next.zoom)) };
    cropRef.current = next;
    setCropState(next);
    const s = cover * next.zoom;
    img.set({ angle, flipX: next.flip, scaleX: s, scaleY: s, originX: "center", originY: "center" });
    if (recenter) img.set({ left: w / 2, top: h / 2 });
    img.setCoords();
    clampBase(img); // 틀 밖으로 밀려나지 않게
    syncBackdrop(next);
    canvas.current!.requestRenderAll();
    refreshPreview();
  }

  /** 사진 전체가 (w×h) 안에 들어오는 확대값 (1 = 틀을 꽉 채움) */
  function containZoom(bw: number, bh: number, cr: Crop = cropRef.current) {
    const img = base();
    if (!img) return 1;
    const { w, h } = size.current;
    const rad = ((cr.turns * 90 + cr.straighten) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const cover = Math.max((w * cos + h * sin) / img.width, (w * sin + h * cos) / img.height);
    const contain = Math.min(bw / (img.width * cos + img.height * sin), bh / (img.width * sin + img.height * cos));
    return Math.min(1, contain / cover);
  }
  /** 인스타에서 실제로 보이는 영역(피드 4:5 등)에 사진 전체가 들어오는 크기 */
  function fitZoom(cr: Crop = cropRef.current) {
    const { w, h } = size.current;
    const area = visibleArea(guideKind, w, h);
    return Math.floor(Math.min(containZoom(w, h, cr), containZoom(area.w, area.h, cr)) * 1000) / 1000;
  }
  /** 가장 작게 줄일 수 있는 값 (인스타 영역에 맞춘 크기보다 조금 더 작게까지) */
  function minZoom(cr: Crop = cropRef.current) {
    return Math.max(0.3, Math.floor(fitZoom(cr) * 0.8 * 100) / 100);
  }

  /** 줄였을 때 빈 곳: 흐린 사진(같은 사진을 흐리게 깔아 둠)·흰색·검정 */
  function syncBackdrop(cr: Crop) {
    const c = canvas.current;
    const f = fab.current;
    const img = base() as (F.FabricImage & Named) | undefined;
    if (!c || !f || !img || overlay) return;
    const fill = cr.fill ?? "blur";
    const old = find("backdrop");
    const need = cr.zoom < 0.999 && fill === "blur";
    c.backgroundColor = cr.zoom < 0.999 && fill === "white" ? "#ffffff" : "#000";
    if (!need) {
      if (old) {
        history.current.restoring = true;
        c.remove(old);
        history.current.restoring = false;
      }
      return;
    }
    if (old && (old as Named).orig === img.getSrc()) return;
    // 작게 줄였다 다시 키우면 부드럽게 번짐 (브라우저마다 다른 blur 필터 대신)
    const el = img.getElement() as HTMLImageElement;
    const small = document.createElement("canvas");
    small.width = 36;
    small.height = Math.max(1, Math.round((36 * el.naturalHeight) / el.naturalWidth || 36));
    small.getContext("2d")!.drawImage(el, 0, 0, small.width, small.height);
    const big = document.createElement("canvas");
    big.width = 360;
    big.height = Math.round((360 * small.height) / small.width);
    const bx = big.getContext("2d")!;
    bx.imageSmoothingQuality = "high";
    bx.drawImage(small, 0, 0, big.width, big.height);
    bx.fillStyle = "rgba(0,0,0,0.18)";
    bx.fillRect(0, 0, big.width, big.height);
    const { w, h } = size.current;
    const bd = new f.FabricImage(big, { originX: "center", originY: "center", left: w / 2, top: h / 2, selectable: false, evented: false });
    bd.scale(Math.max(w / big.width, h / big.height));
    (bd as Named).name = "backdrop";
    (bd as Named).orig = img.getSrc();
    history.current.restoring = true;
    if (old) c.remove(old);
    c.add(bd);
    c.moveObjectTo(bd, 0);
    history.current.restoring = false;
  }

  /** 사진이 늘 틀을 다 덮도록 위치를 당김 (돌려도). 당겼으면 true — 틀 끝에 닿았다는 뜻 */
  function clampBase(img: F.FabricObject): boolean {
    const { w, h } = size.current;
    if (cropRef.current.zoom < 0.999) {
      // 줄였을 때: 사진이 틀보다 작은 쪽은 틀 안에, 큰 쪽은 틀을 덮게
      const a0 = ((img.angle ?? 0) * Math.PI) / 180;
      const iw = img.width * (img.scaleX ?? 1);
      const ih = img.height * (img.scaleY ?? 1);
      const bw = Math.abs(iw * Math.cos(a0)) + Math.abs(ih * Math.sin(a0));
      const bh = Math.abs(iw * Math.sin(a0)) + Math.abs(ih * Math.cos(a0));
      const fitIn = (v: number, size: number, b: number) =>
        b <= size ? Math.min(size - b / 2, Math.max(b / 2, v)) : Math.min(b / 2, Math.max(size - b / 2, v));
      const x0 = img.left ?? w / 2;
      const y0 = img.top ?? h / 2;
      const x = fitIn(x0, w, bw);
      const y = fitIn(y0, h, bh);
      img.set({ left: x, top: y });
      img.setCoords();
      return Math.abs(x - x0) > 1e-6 || Math.abs(y - y0) > 1e-6;
    }
    const a = ((img.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const hw = (img.width * (img.scaleX ?? 1)) / 2;
    const hh = (img.height * (img.scaleY ?? 1)) / 2;
    let cx = img.left ?? w / 2;
    let cy = img.top ?? h / 2;
    let clamped = false;
    for (let it = 0; it < 8; it++) {
      let moved = false;
      for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
        // 틀의 모서리를 사진 기준(돌리기 전) 좌표로 바꿔, 사진 밖이면 그만큼 사진을 옮김
        const dx = px - cx;
        const dy = py - cy;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        const ex = lx - Math.max(-hw, Math.min(hw, lx));
        const ey = ly - Math.max(-hh, Math.min(hh, ly));
        if (Math.abs(ex) > 1e-6 || Math.abs(ey) > 1e-6) {
          cx += ex * cos - ey * sin;
          cy += ex * sin + ey * cos;
          moved = clamped = true;
        }
      }
      if (!moved) break;
    }
    img.set({ left: cx, top: cy });
    img.setCoords();
    return clamped;
  }

  // ── 바로 만지기: 끄는 동안 가운데 맞춤(착 붙고 진동)·틀 끝 닿음(진동)·가려지는 곳 경고(진동) ─────
  const feel = useRef({ edge: false, v: false, h: false, warn: false });
  function moving(o: Named) {
    const f = fab.current;
    if (!f || !o) return;
    const { w, h } = size.current;
    const thr = 10 / (zoom.current || 1); // 화면에서 10px 안이면 붙임
    const c0 = o.getCenterPoint();
    const v = Math.abs(c0.x - w / 2) < thr;
    const hz = Math.abs(c0.y - h / 2) < thr;
    if (v || hz) o.setPositionByOrigin(new f.Point(v ? w / 2 : c0.x, hz ? h / 2 : c0.y), "center", "center");
    let edge = false;
    let warn = false;
    if (o.name === "base") {
      edge = clampBase(o);
    } else if (!SPECIAL.has(o.name ?? "")) {
      // 글자·스티커가 인스타에서 보이는 영역 밖으로 나가면 경고
      const area = visibleArea(guideKind, w, h);
      const pts = o.getCoords();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const tol = 2;
      warn = Math.min(...xs) < area.x - tol || Math.max(...xs) > area.x + area.w + tol || Math.min(...ys) < area.y - tol || Math.max(...ys) > area.y + area.h + tol;
    }
    const prev = feel.current;
    if ((v && !prev.v) || (hz && !prev.h)) haptic("snap");
    else if (edge && !prev.edge) haptic("snap");
    if (warn && !prev.warn) haptic("warn");
    feel.current = { edge, v, h: hz, warn };
    if (v !== snap.v || hz !== snap.h || warn !== snap.warn) setSnap({ v, h: hz, warn });
  }
  function endMove() {
    feel.current = { edge: false, v: false, h: false, warn: false };
    setSnap((x) => (x.v || x.h || x.warn ? { v: false, h: false, warn: false } : x));
  }

  // ── 두 손가락: 고른 글자·스티커는 크기·각도, 아무것도 안 골랐으면 사진 확대 ─────────────
  type Pinch = { d0: number; a0: number; mx: number; my: number; target: Named | null; s0: number; r0: number; cx: number; cy: number; z0: number; minHit: boolean };
  const pinch = useRef<Pinch | null>(null);
  function pinchStart(t: TouchList) {
    const c = canvas.current;
    if (!c) return;
    const [p, q] = [t[0], t[1]];
    const active = c.getActiveObject() as Named | undefined;
    const target = active && !SPECIAL.has(active.name ?? "") && !active.isEditing ? active : null;
    const ctr = target?.getCenterPoint();
    pinch.current = {
      d0: Math.hypot(q.clientX - p.clientX, q.clientY - p.clientY) || 1,
      a0: Math.atan2(q.clientY - p.clientY, q.clientX - p.clientX),
      mx: (p.clientX + q.clientX) / 2,
      my: (p.clientY + q.clientY) / 2,
      target,
      s0: target?.scaleX ?? 1,
      r0: target?.angle ?? 0,
      cx: ctr?.x ?? 0,
      cy: ctr?.y ?? 0,
      z0: cropRef.current.zoom,
      minHit: false,
    };
    // 한 손가락으로 끌던 것은 멈춤
    for (const o of c.getObjects()) o.set({ lockMovementX: true, lockMovementY: true });
  }
  function pinchMove(t: TouchList) {
    const g = pinch.current;
    const f = fab.current;
    if (!g || !f) return;
    const [p, q] = [t[0], t[1]];
    const ratio = Math.hypot(q.clientX - p.clientX, q.clientY - p.clientY) / g.d0;
    if (g.target) {
      let deg = g.r0 + ((Math.atan2(q.clientY - p.clientY, q.clientX - p.clientX) - g.a0) * 180) / Math.PI;
      const near = Math.round(deg / 90) * 90;
      const snapped = Math.abs(deg - near) < 4; // 수평·수직 근처면 붙임
      if (snapped) deg = near;
      const z = zoom.current || 1;
      g.target.set({ scaleX: g.s0 * ratio, scaleY: g.s0 * ratio, angle: deg });
      g.target.setPositionByOrigin(new f.Point(g.cx + ((p.clientX + q.clientX) / 2 - g.mx) / z, g.cy + ((p.clientY + q.clientY) / 2 - g.my) / z), "center", "center");
      g.target.setCoords();
      if (snapped && !feel.current.v) haptic("snap");
      feel.current.v = snapped;
      moving(g.target);
      canvas.current!.requestRenderAll();
    } else {
      const lo = minZoom();
      let zoomTo = Math.min(3, Math.max(lo, g.z0 * ratio));
      // 틀을 꽉 채우는 크기(1)·인스타 영역에 사진 전체가 딱 들어오는 크기에 살짝 붙으며 진동
      const marks = [1, fitZoom()];
      const near = marks.find((m) => Math.abs(zoomTo - m) < 0.025);
      if (near !== undefined) zoomTo = near;
      if (near !== undefined && !g.minHit) haptic("snap");
      g.minHit = near !== undefined;
      applyCrop({ ...cropRef.current, zoom: zoomTo });
    }
  }
  function pinchEnd() {
    const c = canvas.current;
    if (!pinch.current || !c) return;
    pinch.current = null;
    for (const o of c.getObjects()) o.set({ lockMovementX: false, lockMovementY: false });
    endMove();
    snapshot();
  }
  // 캔버스 이벤트에서 늘 최신 함수를 부르도록
  const hasAdjust = () => post.current.filters.length > 0 || post.current.vignette > 0;
  const live = useRef({ moving, endMove, pinchStart, pinchMove, pinchEnd, compare: (on: boolean) => compare(on), tab, hasAdjust });
  live.current = { moving, endMove, pinchStart, pinchMove, pinchEnd, compare: (on: boolean) => compare(on), tab, hasAdjust };
  useEffect(() => {
    const el = canvas.current?.upperCanvasEl;
    if (!ready || !el) return;
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        live.current.pinchStart(e.touches);
      }
    };
    const move = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinch.current) {
        e.preventDefault();
        live.current.pinchMove(e.touches);
      }
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) live.current.pinchEnd();
    };
    // 꾹 누르고(0.35초, 움직이지 않고) 있는 동안 보정 전 원본 — 그리기 중엔 안 함
    let hold: ReturnType<typeof setTimeout> | undefined;
    let from: { x: number; y: number } | null = null;
    const pressDown = (e: PointerEvent) => {
      if (live.current.tab === "draw" || !live.current.hasAdjust()) return;
      from = { x: e.clientX, y: e.clientY };
      hold = setTimeout(() => {
        live.current.compare(true);
        haptic("tick");
      }, 350);
    };
    const pressMove = (e: PointerEvent) => {
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 8) {
        clearTimeout(hold);
        from = null;
      }
    };
    const pressUp = () => {
      clearTimeout(hold);
      from = null;
      live.current.compare(false);
    };
    el.addEventListener("pointerdown", pressDown);
    el.addEventListener("pointermove", pressMove);
    el.addEventListener("pointerup", pressUp);
    el.addEventListener("pointercancel", pressUp);
    el.addEventListener("pointerleave", pressUp);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      clearTimeout(hold);
      el.removeEventListener("pointerdown", pressDown);
      el.removeEventListener("pointermove", pressMove);
      el.removeEventListener("pointerup", pressUp);
      el.removeEventListener("pointercancel", pressUp);
      el.removeEventListener("pointerleave", pressUp);
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [ready]);

  // 글자·스티커를 누르면 그에 맞는 도구 탭으로 (그리기 중엔 그대로)
  useEffect(() => {
    if (!selected || SPECIAL.has(selected.name ?? "") || tab === "draw") return;
    const want: Tab = isText(selected) ? "text" : "sticker";
    if (tab !== want && TABS.some((x) => x.key === want)) setTab(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ── 저장 ───────────────────────────────────────────────────
  // ── 동영상 꾸미기: 재생 위치에 맞춰 보이기 · 재생 · 타임라인 ─────────────────
  const timed = () => ((canvas.current?.getObjects() ?? []) as Named[]).filter((o) => !SPECIAL.has(o.name ?? ""));
  // 지금 재생 위치에 보일 것만 보이게 (고른 것은 시간 밖이어도 보여서 고칠 수 있게)
  useEffect(() => {
    const c = canvas.current;
    if (!clip || !c || !ready) return;
    const active = new Set(c.getActiveObjects());
    let changed = false;
    for (const o of timed()) {
      const show = o.tStart === undefined || (vt >= o.tStart - 0.01 && vt <= (o.tEnd ?? Infinity) + 0.01) || active.has(o);
      if (o.visible !== show) {
        o.visible = show;
        changed = true;
      }
    }
    if (changed) c.requestRenderAll();
  });
  // 이미 불러온 뒤에 이벤트를 붙인 경우 (빠른 캐시) 대비
  useEffect(() => {
    const v = videoEl.current;
    if (!clip || !ready || !v) return;
    if (v.readyState >= 2) setVideoOk(true);
    // 길이도 (이벤트를 붙이기 전에 이미 읽었을 수 있어서)
    if (v.readyState >= 1 && isFinite(v.duration) && v.duration > 0) {
      const d = v.duration;
      setVideoDur(d);
      setClipCut((k) => (k.end > 0 && k.end <= d ? k : { start: Math.min(k.start, d), end: d }));
    }
  }, [clip, ready]);
  // 영상이 바탕: 장면 사진은 숨기고 캔버스는 투명하게 (영상을 못 불러오면 장면 사진 그대로)
  useEffect(() => {
    const c = canvas.current;
    if (!clip || !c || !ready) return;
    base()?.set({ visible: !videoOk });
    c.backgroundColor = videoOk ? "" : "#000";
    c.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoOk, ready, history.current.at]);
  // 재생 중엔 재생 위치를 따라감 (화면이 너무 자주 다시 그려지지 않게 0.05초 단위로)
  useEffect(() => {
    if (!clip || !playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoEl.current;
      if (v) {
        const k = cutRef.current;
        if (v.currentTime >= k.end - 0.03 || v.currentTime < k.start - 0.3) v.currentTime = k.start; // 자른 구간만 반복
        if (Math.abs(v.currentTime - vtRef.current) >= 0.05) setVt(v.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clip, playing]);
  const seekTo = (s0: number) => {
    if (!clip) return;
    const x = Math.min(videoDur || clip.duration || clipCut.end, Math.max(0, s0)); // 자르기 틀을 끄는 중에도 그 위치를 보여 줌
    if (videoEl.current) videoEl.current.currentTime = x;
    setVt(x);
  };
  const togglePlay = () => {
    const v = videoEl.current;
    if (!v || !clip) return;
    if (v.paused) {
      if (v.currentTime >= clipCut.end - 0.05) v.currentTime = clipCut.start;
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };
  // 동영상 편집기에 알림: 재생 위치(음악 맞추기)·자르기, 원본 소리 크기, 바깥에서 재생 위치 옮기기
  useEffect(() => {
    extras?.onTime(vt, playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vt, playing]);
  useEffect(() => {
    if (clipCut.end > 0) extras?.onCut(clipCut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipCut.start, clipCut.end]);
  useEffect(() => {
    if (videoEl.current && extras) videoEl.current.volume = Math.min(1, extras.volume);
  }, [extras, extras?.volume, videoOk]);
  if (extras) extras.controller.current = { seek: (x: number) => seekTo(x), time: () => vtRef.current };

  function setTiming(o: Named, s0: number, e0: number, commit = true) {
    if (!clip) return;
    const a = Math.max(clipCut.start, Math.min(s0, clipCut.end - 0.3));
    o.tStart = round1(a);
    o.tEnd = round1(Math.min(clipCut.end, Math.max(e0, a + 0.3)));
    force((n) => n + 1);
    if (commit) snapshot();
  }
  const trackOf = (o: Named): Pick<Track, "label" | "icon" | "color"> => {
    if (isText(o)) return { label: (o.text ?? "").split("\n")[0].slice(0, 16) || t("editor.tabText"), icon: "Aa", color: "#7c3aed" };
    // 붓으로 그린 선은 채우기가 없음(null), 스티커 탭의 도형(하트·별·화살표…)은 채우기 값이 있음
    if (o.type === "path" && o.fill == null) return { label: t("editor.tabDraw"), icon: "✏️", color: "#059669" };
    if (o.type === "image") return { label: t("editor.tabSticker"), icon: "🖼", color: "#db2777" };
    return { label: t("editor.shape"), icon: "◆", color: "#d97706" };
  };

  async function save() {
    const c = canvas.current;
    if (!c) return;
    if (templateMode) return saveTemplate();
    setSaving(true);
    setError(undefined);
    try {
      c.discardActiveObject();
      c.isDrawingMode = false;
      c.requestRenderAll();
      if (overlay) {
        // 꾸민 것만: 바탕 장면을 숨기고 투명 배경으로, 보이는 시간이 같은 것끼리 한 장씩 내보냄
        const b = base();
        const bg = c.backgroundColor;
        b?.set({ visible: false });
        c.backgroundColor = "";
        const objs = timed();
        const groups = new Map<string, Named[]>();
        for (const o of objs) {
          const k = clip && o.tStart !== undefined ? `${o.tStart}|${o.tEnd}` : "all";
          groups.set(k, [...(groups.get(k) ?? []), o]);
        }
        const parts: OverlayPart[] = [];
        for (const group of groups.values()) {
          for (const o of objs) o.visible = group.includes(o);
          c.renderAll();
          const png = await (await fetch(c.toDataURL({ format: "png", multiplier: 1 / zoom.current }))).blob();
          const o0 = group[0];
          parts.push({ png, start: clip ? (o0.tStart ?? null) : null, end: clip ? (o0.tEnd ?? null) : null });
        }
        for (const o of objs) o.visible = true;
        b?.set({ visible: true });
        c.backgroundColor = bg;
        c.renderAll();
        const layers: Layers = { v: 1, w: size.current.w, h: size.current.h, canvas: c.toObject(KEEP), adjust: adjustRef.current, crop: cropRef.current };
        await overlay.onSubmit(parts, JSON.stringify(layers), clip ? clipCut : undefined);
        await onSaved();
        if (extras) {
          // 동영상 편집: 적용한 뒤에도 그대로 이어서 고칠 수 있게
          setDirty(false);
          return;
        }
        onClose();
        return;
      }
      const dataUrl = c.toDataURL({ format: "jpeg", quality: 0.95, multiplier: 1 / zoom.current }); // 서버는 다시 압축하지 않고 그대로 보관
      const image = await (await fetch(dataUrl)).blob();
      const layers: Layers = {
        v: 1,
        w: size.current.w,
        h: size.current.h,
        canvas: c.toObject(KEEP),
        adjust: adjustRef.current,
        crop: cropRef.current,
      };
      const body = new FormData();
      body.append("file", image, "edited.jpg");
      body.append("layers", JSON.stringify(layers));
      body.append("base_id", baseId);
      body.append("links", JSON.stringify(storyLinks()));
      const res = await fetch(`/api/py/studio/${jobId}/slides/${index}/edit`, { method: "POST", body, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      await onSaved();
      onClose();
    } catch (e) {
      setError(t("editor.saveFailed", { e: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if ((dirty || extras?.dirty) && !window.confirm(extras ? t("media.unappliedConfirm") : t("editor.discardConfirm"))) return;
    onClose();
  }

  // ── 화면 ───────────────────────────────────────────────────
  const h = history.current;
  const textSel = isText(selected) ? selected : null;
  const shapeOrTextSel = clip && selected && !SPECIAL.has(selected.name ?? "") ? selected : null;
  // 고른 도형·그림의 지금 색 (색 고르기 칸에 표시)
  const shapeSel = selected && !textSel && !SPECIAL.has(selected.name ?? "") ? selected : null;
  const paintColor = (() => {
    const v = shapeSel && ((typeof shapeSel.fill === "string" && shapeSel.fill) || (typeof shapeSel.stroke === "string" && shapeSel.stroke));
    if (!v) return brush.color;
    if (v === "#ffffff" && shapeSel?.shadow) return String(shapeSel.shadow.color);
    const m = v.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? "#" + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("") : v;
  })();
  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "text", label: t("editor.tabText"), icon: "Aa" },
    { key: "sticker", label: t("editor.tabSticker"), icon: "☺" },
    { key: "draw", label: t("editor.tabDraw"), icon: "✎" },
    { key: "adjust", label: t("editor.tabAdjust"), icon: "◐" },
    { key: "bg", label: t("editor.tabBackground"), icon: "✂" },
    { key: "crop", label: t("editor.tabCrop"), icon: "⤢" },
    { key: "theme", label: t("design.tabTheme"), icon: "🎨" },
  ]
    .filter((x) => !overlay || x.key === "text" || x.key === "sticker" || x.key === "draw")
    .concat((extras?.tabs ?? []).map((x) => ({ key: `x:${x.key}` as Tab, label: x.label, icon: x.icon }))) as { key: Tab; label: string; icon: string }[];
  const extraPanel = extras?.tabs.find((x) => `x:${x.key}` === tab)?.panel;
  const previewAssets = preview?.assets.map((a, i) => (i === index && previewUrl ? { ...a, url: previewUrl, type: "image" as const } : a)) ?? [];
  const previewPane = preview && (
    <div className="space-y-2">
      <p className="text-[12px] text-white/60">{t("editor.livePreview")}</p>
      <div className="rounded-xl bg-white p-2 text-black [color-scheme:light]">
        {preview.kind === "story" ? (
          <StoryPreview username={preview.username} avatar={preview.avatar} assets={previewAssets} />
        ) : (
          <InstagramPreview username={preview.username} avatar={preview.avatar} assets={previewAssets} caption={preview.caption} />
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0b0c] text-white" role="dialog" aria-modal="true" aria-label={overlay?.title ?? (templateMode ? t("design.makerTitle") : t("editor.title"))}>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button type="button" onClick={close} className="rounded-md px-2 py-1.5 text-[14px] text-white/80 hover:bg-white/10">
          {extras ? t("media.close") : clip ? `← ${t("editor.back")}` : t("editor.cancel")}
        </button>
        <span className="flex-1 text-center text-[14px] font-semibold">{overlay?.title ?? (templateMode ? t("design.makerTitle") : t("editor.title"))}</span>
        <button type="button" disabled={h.at <= 0} onClick={() => restore(h.at - 1)} aria-label={t("editor.undo")} className="rounded-md px-2 py-1.5 text-lg disabled:opacity-30">
          ↶
        </button>
        <button type="button" disabled={h.at >= h.stack.length - 1} onClick={() => restore(h.at + 1)} aria-label={t("editor.redo")} className="rounded-md px-2 py-1.5 text-lg disabled:opacity-30">
          ↷
        </button>
        {preview && (
          <button type="button" onClick={() => setShowPreview((v) => !v)} className="rounded-md px-2 py-1.5 text-[13px] text-white/80 hover:bg-white/10 lg:hidden">
            {t("editor.preview")}
          </button>
        )}
        {extras?.headerExtra}
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!ready || (!!extras && !dirty && !extras.dirty)}>
          {extras
            ? saving
              ? extras.submittingLabel
              : extras.submitLabel
            : saving
              ? t("editor.saving")
              : templateMode
                ? t("design.saveTemplate")
                : clip
                  ? t("editor.done")
                  : t("editor.save")}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 휴대폰: 도구 칸이 길어져도 사진 크기가 줄지 않게 높이를 고정하고 도구 칸만 스크롤.
              바깥은 체크무늬, 캔버스(인스타에 올라갈 틀)에는 테두리 — 검은 사진과 빈 곳이 헷갈리지 않게 */}
          <div
            ref={holder}
            className={cx(
              "relative flex min-h-0 flex-1 items-center justify-center bg-[repeating-conic-gradient(#18181b_0_25%,#111113_0_50%)] bg-[length:18px_18px] [&_.canvas-container]:outline [&_.canvas-container]:outline-1 [&_.canvas-container]:outline-white/35",
              // svh: 주소창이 숨었다 나타나도 그대로인 화면 높이
              clip ? "max-lg:h-[42svh]" : "max-lg:h-[54svh]",
              "max-lg:flex-none",
            )}
          >
            {clip && (
              // 바탕 영상 (캔버스는 투명해서 그 위에 글자·스티커가 겹쳐 보임)
              <video
                ref={videoEl}
                src={mediaSrc(clip.src)}
                crossOrigin="anonymous"
                playsInline
                preload="auto"
                onLoadedData={(e) => {
                  e.currentTarget.currentTime = vtRef.current;
                  setVideoOk(true);
                }}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (!isFinite(d) || d <= 0) return;
                  setVideoDur(d);
                  // 끝을 정하지 않았으면(0) 영상 끝까지
                  setClipCut((k) => (k.end > 0 && k.end <= d ? k : { start: Math.min(k.start, d), end: d }));
                }}
                onCanPlay={() => setVideoOk(true)}
                onError={() => setVideoOk(false)}
                onPause={() => setPlaying(false)}
                className={cx("absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black object-cover", !videoOk && "invisible")}
                style={{ width: view.w, height: view.h }}
              />
            )}
            <canvas ref={canvasEl} />
            <input
              ref={slotInput}
              type="file"
              accept="image/*,.heic,.heif"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void replaceSlotPhoto(file);
              }}
            />
            {ready && (guides || snap.warn) && guideKind && view.w > 0 && <SizeGuides kind={guideKind} w={view.w} h={view.h} warn={snap.warn} />}
            {/* 가운데에 맞았을 때 선 (인스타 스토리처럼) */}
            {(snap.v || snap.h) && view.w > 0 && (
              <svg aria-hidden width={view.w} height={view.h} className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                {snap.v && <line x1={view.w / 2} x2={view.w / 2} y1={0} y2={view.h} stroke="#ff2d87" strokeWidth={1.5} />}
                {snap.h && <line x1={0} x2={view.w} y1={view.h / 2} y2={view.h / 2} stroke="#ff2d87" strokeWidth={1.5} />}
              </svg>
            )}
            {ready && preview && (
              <button
                type="button"
                onClick={() => setGuides((g) => !g)}
                aria-pressed={guides}
                title={t("editor.guidesHint")}
                className={cx(
                  "absolute bottom-3 left-3 z-10 rounded-full px-3 py-1.5 text-[12px]",
                  guides ? "bg-white/90 text-black" : "bg-black/60 text-white/80",
                )}
              >
                📐 {t("editor.guides")}
              </button>
            )}
            {!ready && !error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="size-6" />
              </div>
            )}
            {extras?.busy && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 text-[13px]">{extras.busy}</div>
            )}
            {/* 사진을 꾹 누르고 있는 동안 보정 전 원본 */}
            {showOriginal && (
              <span className="pointer-events-none absolute top-3 left-3 z-10 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-black">
                ◐ {t("editor.showingOriginal")}
              </span>
            )}
            {aiBusy && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
                <div className="w-64 rounded-xl bg-[#1c1c1f] p-4 text-center text-[13px]">
                  <Spinner className="mx-auto size-5" />
                  <p className="mt-2">{aiBusy.label}</p>
                  {aiBusy.progress !== undefined && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-[#8b5cf6] transition-[width]" style={{ width: `${aiBusy.progress}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )}
            {selected && !SPECIAL.has(selected.name ?? "") && (
              <div className="absolute top-3 right-3 flex flex-wrap justify-end gap-1">
                {(selected as Named & { tk?: Tk }).tk?.slot && (
                  <button type="button" onClick={() => slotInput.current?.click()} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-black">
                    {t("design.replacePhoto")}
                  </button>
                )}
                <button type="button" onClick={duplicateSelected} className="rounded-full bg-black/60 px-3 py-1.5 text-[12px]" title="Ctrl/⌘ + C · V">
                  {t("editor.duplicate")}
                </button>
                <div className="flex overflow-hidden rounded-full bg-black/60 text-[12px]" role="group" aria-label={t("editor.arrange")}>
                  {([
                    ["back", "⤓", "editor.sendBack"],
                    ["backward", "↓", "editor.sendBackward"],
                    ["forward", "↑", "editor.bringForward"],
                    ["front", "⤒", "editor.bringFront"],
                  ] as const).map(([dir, icon, label]) => (
                    <button key={dir} type="button" onClick={() => arrange(dir)} className="px-2.5 py-1.5 hover:bg-white/15" title={`${t(label)} (⌘/Ctrl ${dir === "front" ? "⇧ ]" : dir === "forward" ? "]" : dir === "backward" ? "[" : "⇧ ["})`} aria-label={t(label)}>
                      {icon}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={removeSelected} className="rounded-full bg-[#ff3b5c] px-3 py-1.5 text-[12px] font-medium">
                  🗑 {t("editor.deleteSelected")}
                </button>
              </div>
            )}
            {showPreview && previewPane && (
              <div className="absolute inset-0 overflow-y-auto bg-black/85 p-4 lg:hidden" onClick={() => setShowPreview(false)}>
                <div className="mx-auto max-w-sm" onClick={(e) => e.stopPropagation()}>
                  {previewPane}
                </div>
              </div>
            )}
          </div>

          {clip && ready && (
            <div className="space-y-2 border-t border-white/10 px-4 pt-3 pb-2">
              {extras?.notice}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  disabled={!videoOk}
                  aria-label={playing ? t("media.pause") : t("media.play")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-[13px] text-black disabled:opacity-40"
                >
                  {playing ? "❚❚" : "▶"}
                </button>
                <span className="tnum text-[12px] text-white/70">
                  {fmtTime(vt - clipCut.start)} / {fmtTime(clipCut.end - clipCut.start)}
                </span>
                {shapeOrTextSel && (
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
                    <span className="tnum text-white/55">
                      {fmtTime((shapeOrTextSel.tStart ?? clipCut.start) - clipCut.start)}–{fmtTime((shapeOrTextSel.tEnd ?? clipCut.end) - clipCut.start)}
                    </span>
                    <Chip onClick={() => setTiming(shapeOrTextSel, vt, Math.max(shapeOrTextSel.tEnd ?? clipCut.end, vt + 0.3))}>▸ {t("media.fromHere")}</Chip>
                    <Chip onClick={() => setTiming(shapeOrTextSel, Math.min(shapeOrTextSel.tStart ?? clipCut.start, vt - 0.3), vt)}>{t("media.toHere")} ◂</Chip>
                    <Chip onClick={() => setTiming(shapeOrTextSel, clipCut.start, clipCut.end)}>{t("media.wholeClip")}</Chip>
                  </div>
                )}
              </div>
              <Timeline
                min={0}
                max={videoDur || clip.duration || clipCut.end}
                trim={clipCut}
                onTrim={(a, b) => {
                  setClipCut({ start: round1(a), end: round1(b) });
                  setDirty(true);
                }}
                time={vt}
                onSeek={seekTo}
                frames={frames}
                tracks={[
                  ...timed()
                    .map((o, i) => ({
                      id: String(i),
                      ...trackOf(o),
                      start: o.tStart ?? clipCut.start,
                      end: o.tEnd ?? clipCut.end,
                      selected: (canvas.current?.getActiveObjects() ?? []).includes(o),
                    }))
                    .reverse(),
                  ...(extras?.tracks ?? []),
                ]}
                onTrack={(id, a, b, done, how) => {
                  if (extras?.tracks.some((x) => x.id === id)) return extras.onTrack(id, a, b, how);
                  const o = timed()[Number(id)];
                  if (o) setTiming(o, a, b, done);
                }}
                onSelect={(id) => {
                  if (extras?.tracks.some((x) => x.id === id)) return extras.onSelectTrack?.(id);
                  const o = timed()[Number(id)];
                  const c = canvas.current;
                  if (!o || !c) return;
                  c.setActiveObject(o);
                  setSelected(o);
                  c.requestRenderAll();
                }}
              />
              {timed().length === 0 && !extras?.tracks.length && <p className="text-[11px] text-white/45">{t("media.timelineHint")}</p>}
            </div>
          )}

          {error && <p className="bg-[#ff3b5c]/15 px-4 py-2 text-[13px] text-[#ffb3c0]">{error}</p>}

          {/* 도구 패널 */}
          <div className="flex flex-col border-t border-white/10 bg-[#141416] px-3 pt-3 max-lg:min-h-0 max-lg:flex-1">
            {/* 도구 칸 높이를 고정해 (글자를 고르면 버튼이 늘어나도) 편집 화면 크기가 바뀌지 않게 — 넘치면 이 안에서만 스크롤 */}
            <div className="text-[13px] max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto lg:h-[min(250px,28vh)] lg:overflow-y-auto lg:pr-1">
              {tab === "text" && (
                <div className="space-y-2.5">
                  <div>
                    <button type="button" onClick={addText} className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black">
                      + {t("editor.addText")}
                    </button>
                    <p className="mt-1.5 text-[11px] text-white/50">{t("editor.textHint")}</p>
                  </div>
                  {textSel && (
                    // 누르는 순간 글자 고르기가 풀리지 않게 (슬라이더·색 고르기 칸은 그대로 동작)
                    <div
                      className="space-y-2.5"
                      onMouseDownCapture={(e) => {
                        captureRange();
                        if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault();
                      }}
                      onTouchStartCapture={captureRange}
                    >
                      <p className="text-[11px] text-white/50">
                        {rangeOf(textSel) ? `✂ ${t("editor.textPartSelected")}` : t("editor.textPartHint")}
                      </p>
                      <Row>
                        <span className="shrink-0 text-[11px] text-white/45">{t("editor.textEffect")}</span>
                        {(["none", "shadow", "neon"] as const).map((g) => (
                          <Chip key={g} on={glowOf(textSel) === g} onClick={() => textGlow(g)}>
                            {t(g === "none" ? "editor.effectNone" : g === "shadow" ? "editor.effectShadow" : "editor.styleNeon")}
                          </Chip>
                        ))}
                        <span className="mx-1 h-4 w-px shrink-0 bg-white/15" />
                        <Chip on={!!textSel.stroke && (textSel.strokeWidth ?? 0) > 0} onClick={textOutline}>
                          {t("editor.effectOutline")}
                        </Chip>
                        <Chip on={Boolean(textSel.backgroundColor)} onClick={() => setTextProp({ backgroundColor: textSel.backgroundColor ? "" : "rgba(0,0,0,0.55)" })}>
                          {t("editor.textBox")}
                        </Chip>
                      </Row>
                      <Row>
                        <span className="shrink-0 text-[11px] text-white/45">{t("editor.fontWeight")}</span>
                        {([
                          [300, "editor.weightLight"],
                          [400, "editor.weightRegular"],
                          [700, "editor.weightBold"],
                          [900, "editor.weightBlack"],
                        ] as const).map(([w, label]) => (
                          <Chip key={w} on={Number(charStyleValue("fontWeight") ?? 400) === w || (w === 700 && charStyleValue("fontWeight") === "bold")} onClick={() => setCharStyle({ fontWeight: w })}>
                            {t(label)}
                          </Chip>
                        ))}
                        <span className="mx-1 h-4 w-px shrink-0 bg-white/15" />
                        {/* 기울임·밑줄·취소선은 각각 켜고 끄기 — 여러 개 함께 */}
                        <Chip on={charStyleValue("fontStyle") === "italic"} onClick={() => setCharStyle({ fontStyle: charStyleValue("fontStyle") === "italic" ? "normal" : "italic" })}>
                          <i>{t("editor.italic")}</i>
                        </Chip>
                        <Chip on={charStyleValue("underline") === true} onClick={() => setCharStyle({ underline: charStyleValue("underline") !== true })}>
                          <u>{t("editor.underline")}</u>
                        </Chip>
                        <Chip on={charStyleValue("linethrough") === true} onClick={() => setCharStyle({ linethrough: charStyleValue("linethrough") !== true })}>
                          <s>{t("editor.strike")}</s>
                        </Chip>
                      </Row>
                      <Row>
                        <span className="shrink-0 text-[11px] text-white/45">{t("editor.align")}</span>
                        {(["left", "center", "right", "justify"] as const).map((a) => (
                          <Chip key={a} on={textSel.textAlign === a} onClick={() => setTextProp({ textAlign: a })}>
                            {t(a === "left" ? "editor.alignLeft" : a === "center" ? "editor.alignCenter" : a === "right" ? "editor.alignRight" : "editor.alignJustify")}
                          </Chip>
                        ))}
                      </Row>
                      <Slider
                        label={t("editor.fontSize")}
                        min={12}
                        max={Math.round(size.current.w * 0.3)}
                        step={1}
                        value={Number(charStyleValue("fontSize") ?? textSel.fontSize ?? 48)}
                        display={String(Math.round(Number(charStyleValue("fontSize") ?? textSel.fontSize ?? 48)))}
                        onChange={(v) => {
                          captureRange();
                          setCharStyle({ fontSize: v });
                        }}
                      />
                      {/* 네온이면 글자 색과 빛 색을 따로 */}
                      {glowOf(textSel) === "neon" && <span className="block text-[11px] text-white/45">{t("editor.textColor")}</span>}
                      <Swatches value={String(charStyleValue("fill") ?? textSel.fill)} onPick={(c) => setCharStyle({ fill: c })} customLabel={t("editor.customColor")} />
                      {glowOf(textSel) === "neon" && (
                        <>
                          <span className="block text-[11px] text-white/45">{t("editor.glowColor")}</span>
                          <Swatches value={String((textSel.shadow as F.Shadow).color)} onPick={pickGlowColor} customLabel={t("editor.customColor")} />
                        </>
                      )}
                      <Row>
                        <span className="shrink-0 text-[11px] text-white/45">{t("editor.font")}</span>
                        {(fonts.data?.data ?? []).map((fo) => (
                          <button
                            key={fo.key}
                            type="button"
                            onClick={() => setCharStyle({ fontFamily: fontFamily(fo.key) }, fo.key)}
                            className={cx("shrink-0 rounded-md bg-white px-2 py-1", fontKeyOf(String(charStyleValue("fontFamily") ?? textSel.fontFamily)) === fo.key ? "ring-2 ring-[#8b5cf6]" : "opacity-80")}
                            title={fo.label}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fo.preview} alt={fo.label} className="h-5 w-auto" />
                          </button>
                        ))}
                      </Row>
                    </div>
                  )}
                </div>
              )}

              {tab === "sticker" && (
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    {/* 고른 사진(붙인 사진·스티커)의 배경 지우기 */}
                    {selected?.type === "image" && !SPECIAL.has(selected.name ?? "") && (
                      <div className="space-y-1.5 rounded-lg border border-white/10 p-2">
                        <p className="text-[12px] font-semibold text-white/80">🖼 {t("editor.selectedPhoto")}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chip onClick={() => cutSelected("ai")}>✂ {t("editor.removeBgAi")}</Chip>
                          <Chip onClick={() => cutSelected("solid")}>🪄 {t("editor.removeBgSolid")}</Chip>
                          <Chip onClick={refineSelected}>🧽 {t("editor.refine")}</Chip>
                          {(selected as Named).orig && <Chip onClick={restoreSelectedImage}>{t("editor.restorePhoto")}</Chip>}
                        </div>
                        <Slider
                          label={t("editor.tolerance")}
                          min={0}
                          max={1}
                          step={0.05}
                          value={keyTolerance}
                          display={String(Math.round(keyTolerance * 100))}
                          onChange={setKeyTolerance}
                          onCommit={() => cutSelected("solid")}
                        />
                        <p className="text-[11px] text-white/45">{t("editor.solidHint")}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[12px] font-semibold text-white/80">⭐ {t("editor.myStickers")}</span>
                      <Chip onClick={() => photoFile.current?.click()}>🖼 {t("editor.placePhoto")}</Chip>
                      <Chip onClick={() => stickerFile.current?.click()}>✂ {t("editor.stickerFromPhoto")}</Chip>
                      {selected && !SPECIAL.has(selected.name ?? "") && <Chip onClick={saveSelectionAsSticker}>{t("editor.saveSelection")}</Chip>}
                      <input
                        ref={photoFile}
                        type="file"
                        accept="image/*,.heic,.heif"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) placePhoto(file);
                        }}
                      />
                      <input
                        ref={stickerFile}
                        type="file"
                        accept="image/*,.heic,.heif"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) stickerFromFile(file);
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-white/45">{t("editor.copyPasteHint")}</p>
                    {(stickers.data?.data.length ?? 0) > 0 ? (
                      <Row>
                        {stickers.data!.data.map((st) => (
                          <div key={st.id} className="group relative shrink-0">
                            <button
                              type="button"
                              onClick={() => placeSticker(st)}
                              aria-label={t("editor.addSticker")}
                              className="flex size-12 items-center justify-center rounded-md bg-[repeating-conic-gradient(#ffffff14_0_25%,transparent_0_50%)] bg-[length:10px_10px] ring-1 ring-white/15 hover:ring-[#8b5cf6]"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={mediaSrc(st.url)} alt="" className="max-h-10 max-w-10 object-contain" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSticker(st.id)}
                              aria-label={t("editor.deleteSticker")}
                              className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-black/80 text-[9px] text-white/80 ring-1 ring-white/30 hover:bg-[#ff3b5c]"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </Row>
                    ) : (
                      <p className="text-[11px] text-white/45">{t("editor.myStickersEmpty")}</p>
                    )}
                  </div>
                  {isStory && (
                    <div className="space-y-2 rounded-lg border border-white/10 p-2">
                      <p className="text-[12px] font-semibold text-white/80">🔗 {t("editor.storyLinks")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        <input
                          value={linkUrl}
                          onChange={(e) => setLinkUrl(e.target.value)}
                          placeholder="https://"
                          inputMode="url"
                          className="h-8 min-w-0 flex-[2_1_10rem] rounded-md border border-white/15 bg-white/5 px-2 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-[#8b5cf6]"
                        />
                        <input
                          value={linkLabel}
                          onChange={(e) => setLinkLabel(e.target.value)}
                          placeholder={t("editor.linkLabelPh")}
                          maxLength={28}
                          className="h-8 min-w-0 flex-[1_1_7rem] rounded-md border border-white/15 bg-white/5 px-2 text-[12px] text-white outline-none placeholder:text-white/35 focus:border-[#8b5cf6]"
                        />
                        <Chip onClick={addLinkSticker}>{t("editor.addLink")}</Chip>
                      </div>
                      {published.length > 0 && (
                        <Row>
                          <span className="shrink-0 text-[11px] text-white/50">{t("editor.myPosts")}</span>
                          {published.map((j) => {
                            const thumb = j.assets.find((a) => a.type === "image")?.url ?? j.assets[0]?.thumbnail_url;
                            return (
                              <button
                                key={j.id}
                                type="button"
                                onClick={() => addPostSticker(j)}
                                aria-label={t("editor.addPost")}
                                className="size-11 shrink-0 overflow-hidden rounded-md ring-1 ring-white/15 hover:ring-[#8b5cf6]"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={mediaSrc(thumb)} alt="" className="size-full object-cover" />
                              </button>
                            );
                          })}
                        </Row>
                      )}
                      <p className="text-[11px] leading-relaxed text-white/45">{t("editor.linkNote")}</p>
                    </div>
                  )}
                  <Row className="text-2xl">
                    {EMOJIS.map((e) => (
                      <button key={e} type="button" onClick={() => addEmoji(e)} className="shrink-0 rounded-md px-1.5 py-1 hover:bg-white/10">
                        {e}
                      </button>
                    ))}
                  </Row>
                  <Row>
                    {(["heart", "star", "arrow", "circle", "rect", "line", "highlight"] as const).map((k) => (
                      <Chip key={k} onClick={() => addShape(k)}>
                        {t(`editor.shape${k[0].toUpperCase()}${k.slice(1)}` as "editor.shapeHeart")}
                      </Chip>
                    ))}
                    <Chip on={fillShapes} onClick={toggleFill}>
                      {t("editor.fill")}
                    </Chip>
                  </Row>
                  <Swatches value={paintColor} onPick={recolor} customLabel={t("editor.customColor")} small />
                </div>
              )}

              {tab === "draw" && (
                <div className="space-y-2.5">
                  <Row>
                    {(["pen", "marker", "neon", "eraser"] as const).map((k) => (
                      <Chip key={k} on={brush.kind === k} onClick={() => setBrush({ ...brush, kind: k })}>
                        {t(k === "eraser" ? "editor.eraser" : (`editor.brush${k[0].toUpperCase()}${k.slice(1)}` as "editor.brushPen"))}
                      </Chip>
                    ))}
                  </Row>
                  {brush.kind === "eraser" ? (
                    <p className="text-[11px] text-white/50">{t("editor.eraserHint")}</p>
                  ) : (
                    <>
                      <Swatches value={paintColor} onPick={recolor} customLabel={t("editor.customColor")} />
                      <Slider label={t("editor.brushSize")} min={2} max={40} step={1} value={brush.width} onChange={(v) => setBrush({ ...brush, width: v })} />
                    </>
                  )}
                </div>
              )}

              {tab === "adjust" && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-white/50">◐ {t("editor.compareHint")}</p>
                  <Row>
                    {Object.keys(PRESETS).map((p) => (
                      <Chip key={p} on={adjust.preset === p} onClick={() => applyAdjust(presetAdjust(p), true)}>
                        {t(`editor.preset${p[0].toUpperCase()}${p.slice(1)}` as "editor.presetNone")}
                      </Chip>
                    ))}
                    <Chip onClick={() => applyAdjust(NO_ADJUST, true)}>{t("editor.reset")}</Chip>
                  </Row>
                  {/* 내 필터 */}
                  <Row>
                    <span className="shrink-0 text-[11px] font-semibold text-white/45">★ {t("editor.myFilters")}</span>
                    {(myFilters.data?.data ?? []).map((mf) => (
                      <span key={mf.id} className="relative shrink-0">
                        <Chip
                          on={adjust.preset === `my:${mf.id}`}
                          onClick={() => applyAdjust({ ...NO_ADJUST, ...(mf.values as Partial<Adjust>), preset: `my:${mf.id}`, v: 2 }, true)}
                        >
                          {mf.name}
                        </Chip>
                        <button
                          type="button"
                          onClick={() => deleteMyFilter(mf.id)}
                          aria-label={t("editor.deleteFilter")}
                          className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-black/80 text-[9px] text-white/80 ring-1 ring-white/30 hover:bg-[#ff3b5c]"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <Chip onClick={saveMyFilter}>+ {t("editor.saveFilter")}</Chip>
                  </Row>
                  {/* 기본 · 곡선 · 효과 (Camera Raw 패널 순서) — 많아서 패널 안에서 스크롤 */}
                  <div className="max-h-[30vh] space-y-3 overflow-y-auto pr-1 lg:max-h-[26vh]">
                    {ADJUST_GROUPS.map((g) => (
                      <Fragment key={g.title}>
                      {g.title === "editor.groupEffects" && (
                        <>
                          {/* 컬러 그레이딩: 밝기 영역마다 색 */}
                          <section>
                            <p className="mb-1 text-[11px] font-semibold tracking-wide text-white/45">{t("editor.groupGrading")}</p>
                            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                              {GRADES.map((gr) => (
                                <Fragment key={gr.label}>
                                  <Slider
                                    label={t(gr.label)}
                                    swatch={hueColor(adjust[gr.hue])}
                                    min={0}
                                    max={360}
                                    step={1}
                                    value={adjust[gr.hue]}
                                    display={deg(adjust[gr.hue])}
                                    onChange={(v) => applyAdjust({ ...adjust, [gr.hue]: v })}
                                    onCommit={snapshot}
                                  />
                                  <Slider
                                    label={t("editor.gradeSat")}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={adjust[gr.sat]}
                                    display={pct(adjust[gr.sat])}
                                    onChange={(v) => applyAdjust({ ...adjust, [gr.sat]: v })}
                                    onCommit={snapshot}
                                  />
                                </Fragment>
                              ))}
                              <Slider
                                label={t("editor.gradeBalance")}
                                min={-1}
                                max={1}
                                step={0.01}
                                value={adjust.gradeBalance}
                                display={pct(adjust.gradeBalance)}
                                onChange={(v) => applyAdjust({ ...adjust, gradeBalance: v })}
                                onCommit={snapshot}
                              />
                            </div>
                          </section>
                          {/* HSL: 8색마다 색상·채도·밝기 */}
                          <section>
                            <div className="mb-1 flex items-center gap-2">
                              <p className="text-[11px] font-semibold tracking-wide text-white/45">HSL</p>
                              {(["H", "S", "L"] as const).map((m) => (
                                <Chip key={m} on={hslMode === m} onClick={() => setHslMode(m)}>
                                  {t(m === "H" ? "editor.hslHue" : m === "S" ? "editor.hslSat" : "editor.hslLum")}
                                </Chip>
                              ))}
                            </div>
                            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                              {HSL_BANDS.map((b) => {
                                const k = `hsl${hslMode}_${b}` as HslKey;
                                return (
                                  <Slider
                                    key={k}
                                    label={t(`editor.band_${b}`)}
                                    swatch={BAND_SWATCH[b]}
                                    min={-1}
                                    max={1}
                                    step={0.01}
                                    value={adjust[k]}
                                    display={pct(adjust[k])}
                                    onChange={(v) => applyAdjust({ ...adjust, [k]: v })}
                                    onCommit={snapshot}
                                  />
                                );
                              })}
                            </div>
                          </section>
                        </>
                      )}
                      <section>
                        <p className="mb-1 text-[11px] font-semibold tracking-wide text-white/45">{t(g.title)}</p>
                        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                          {g.sliders.map(([k, min, max, show]) => (
                            <Slider
                              key={k}
                              label={t(`editor.${k}` as "editor.brightness")}
                              min={min}
                              max={max}
                              step={0.01}
                              value={adjust[k]}
                              display={show(adjust[k])}
                              onChange={(v) => applyAdjust({ ...adjust, [k]: v })}
                              onCommit={snapshot}
                            />
                          ))}
                        </div>
                        {g.title === "editor.groupEffects" && adjust.glow > 0 && (
                          <div className="mt-1.5 flex items-center gap-3 text-[12px] text-white/70">
                            <span className="w-20 shrink-0">{t("editor.glowMode")}</span>
                            <Chip on={adjust.glowSoft < 0.5} onClick={() => applyAdjust({ ...adjust, glowSoft: 0 }, true)}>
                              {t("editor.glowScreen")}
                            </Chip>
                            <Chip on={adjust.glowSoft >= 0.5} onClick={() => applyAdjust({ ...adjust, glowSoft: 1 }, true)}>
                              {t("editor.glowSoftLight")}
                            </Chip>
                          </div>
                        )}
                      </section>
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}

              {tab === "bg" && (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={removePhotoBackground}
                      disabled={!!aiBusy}
                      className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
                    >
                      ✂ {t("editor.removeBg")}
                    </button>
                    {hasCutout && <Chip onClick={refinePhoto}>🧽 {t("editor.refine")}</Chip>}
                    {(hasCutout || (base() as Named | undefined)?.orig) && <Chip onClick={restoreOriginalPhoto}>{t("editor.restorePhoto")}</Chip>}
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/50">{t("editor.removeBgHint")}</p>
                  {hasCutout && (
                    <div className="space-y-1.5">
                      <p className="text-[12px] text-white/70">{t("editor.newBackground")}</p>
                      <Row>
                        {BG_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            aria-label={c}
                            onClick={() => changeBackground({ color: c })}
                            className="size-7 shrink-0 rounded-full border border-white/30"
                            style={{ background: c }}
                          />
                        ))}
                        <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-white/30 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title={t("editor.customColor")}>
                          <input type="color" className="absolute inset-0 opacity-0" onChange={(e) => changeBackground({ color: e.target.value })} />
                        </label>
                        <Chip onClick={() => changeBackground({ blur: true })}>{t("editor.blurredOriginal")}</Chip>
                      </Row>
                    </div>
                  )}
                </div>
              )}

              {extraPanel}
              {tab === "theme" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-[12px] font-semibold text-white/80">{t("design.applyTheme")}</p>
                    <p className="text-[11px] text-white/45">{t("design.applyThemeHint")}</p>
                    <Row>
                      {[...(myThemes.data?.data ?? []).map((x) => ({ ...x, mine: true })), ...BUILTIN_THEMES].map((th) => (
                        <Chip key={th.id} onClick={() => themeThisPage(th)}>
                          <span className="mr-1.5 inline-flex overflow-hidden rounded-full align-[-2px]">
                            {[th.colors.bg, th.colors.primary, th.colors.accent].map((c, i) => (
                              <span key={i} className="size-3" style={{ background: c }} />
                            ))}
                          </span>
                          {"mine" in th ? th.name : t(`design.th_${th.id}` as MessageKey)}
                        </Chip>
                      ))}
                    </Row>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                    <input
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      maxLength={40}
                      placeholder={t("design.templateName")}
                      className="min-w-0 flex-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/35"
                    />
                    {!templateMode && (
                    <button
                      type="button"
                      onClick={saveAsTemplate}
                      disabled={!tplName.trim() || !!aiBusy}
                      className="rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-50"
                    >
                      {t("design.saveAsTemplate")}
                    </button>
                    )}
                  </div>
                  {tplSaved && <p className="text-[12px] text-emerald-300">✓ {t("design.savedTemplate")}</p>}
                </div>
              )}
              {tab === "crop" && (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/50">{t("editor.cropHint")}</p>
                  <Slider
                    label={t("editor.zoom")}
                    min={minZoom()}
                    max={3}
                    step={0.01}
                    detent={1}
                    value={crop.zoom}
                    display={`${Math.round(crop.zoom * 100)}%`}
                    onChange={(v) => applyCrop({ ...crop, zoom: v })}
                    onCommit={snapshot}
                  />
                  {/* 줄여서 생긴 빈 곳 채우기 */}
                  {crop.zoom < 0.999 && (
                    <Row>
                      <span className="shrink-0 text-[11px] text-white/45">{t("editor.fillEmpty")}</span>
                      {(["blur", "white", "black"] as const).map((fl) => (
                        <Chip key={fl} on={(crop.fill ?? "blur") === fl} onClick={() => (applyCrop({ ...crop, fill: fl }), snapshot())}>
                          {t(fl === "blur" ? "editor.fillBlur" : fl === "white" ? "editor.fillWhite" : "editor.fillBlack")}
                        </Chip>
                      ))}
                    </Row>
                  )}
                  <Slider label={t("editor.straighten")} min={-30} max={30} step={0.5} value={crop.straighten} onChange={(v) => applyCrop({ ...crop, straighten: v })} onCommit={snapshot} />
                  <Row>
                    <Chip onClick={() => (applyCrop({ ...crop, turns: (crop.turns + 1) % 4, zoom: 1 }, true), snapshot())}>⟳ {t("editor.rotate")}</Chip>
                    <Chip onClick={() => (applyCrop({ ...crop, flip: !crop.flip }), snapshot())}>⇋ {t("editor.flip")}</Chip>
                    <Chip onClick={() => (applyCrop({ ...crop, zoom: fitZoom() }, true), haptic("snap"), snapshot())}>{t("editor.fitWhole")}</Chip>
                    <Chip onClick={() => (applyCrop(NO_CROP, true), snapshot())}>{t("editor.reset")}</Chip>
                  </Row>
                </div>
              )}
            </div>

            <nav
              className="mt-2 grid shrink-0 border-t border-white/10 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
              style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
              aria-label={t("editor.title")}
            >
              {TABS.map((x) => (
                <button
                  key={x.key}
                  type="button"
                  onClick={() => setTab(x.key)}
                  aria-pressed={tab === x.key}
                  className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", tab === x.key ? "text-white" : "text-white/45")}
                >
                  <span className="text-[17px] leading-none">{x.icon}</span>
                  {x.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* 넓은 화면: 오른쪽에 올라갈 모습 */}
        {previewPane && <aside className="hidden w-[380px] shrink-0 overflow-y-auto border-l border-white/10 p-4 lg:block">{previewPane}</aside>}
      </div>
      {refine && (
        <MaskEditor
          src={refine.src}
          original={refine.original}
          onApply={refine.onApply}
          onClose={() => {
            if (refine.src.startsWith("blob:")) URL.revokeObjectURL(refine.src);
            if (refine.original.startsWith("blob:")) URL.revokeObjectURL(refine.original);
            setRefine(null);
          }}
        />
      )}
    </div>
  );
}

/** 인스타그램에서 실제로 보이는 영역 (캔버스 좌표). 피드는 4:5·1.91:1 밖이 잘리고, 스토리는 위아래 띠가 화면 요소에 가려짐 */
function visibleArea(kind: "feed" | "story" | undefined, w: number, h: number) {
  const a = w / h;
  if (kind === "feed" && (a < 0.8 - 0.005 || a > 1.91 + 0.005)) {
    const r = a < 0.8 ? 0.8 : 1.91;
    const [bw, bh] = a > r ? [h * r, h] : [w, w / r];
    return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh };
  }
  if (kind === "story") {
    const frameH = a > 9 / 16 ? w / (9 / 16) : h;
    const offset = (frameH - h) / 2;
    const top = Math.max(0, frameH * 0.14 - offset);
    const bottom = Math.max(0, frameH * 0.2 - offset);
    return { x: 0, y: top, w, h: Math.max(1, h - top - bottom) };
  }
  return { x: 0, y: 0, w, h };
}

function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 인스타그램에 실제로 보이는 영역 점선 (화면에만).
 *  피드: 4:5보다 길면 4:5만, 1.91:1보다 넓으면 그만큼만 올라가고, 프로필 그리드는 가운데 3:4.
 *  스토리: 9:16 화면 위쪽(계정·진행 바)·아래쪽(답장 칸)은 화면 요소에 가려질 수 있음. */
function SizeGuides({ kind, w, h, warn }: { kind: "feed" | "story"; w: number; h: number; warn?: boolean }) {
  const t = useT();
  const a = w / h;
  const box = (ratio: number) => (a > ratio ? { bw: h * ratio, bh: h } : { bw: w, bh: w / ratio });
  const rects: { x: number; y: number; bw: number; bh: number; label: string; strong: boolean }[] = [];
  const bands: { y: number; bh: number; label: string }[] = [];
  if (kind === "feed") {
    if (a < 0.8 - 0.005 || a > 1.91 + 0.005) {
      const { bw, bh } = box(a < 0.8 ? 0.8 : 1.91);
      rects.push({ x: (w - bw) / 2, y: (h - bh) / 2, bw, bh, label: t(a < 0.8 ? "editor.guideFeed45" : "editor.guideFeedWide"), strong: true });
    }
    if (Math.abs(a - 0.75) > 0.01) {
      const { bw, bh } = box(0.75);
      rects.push({ x: (w - bw) / 2, y: (h - bh) / 2, bw, bh, label: t("editor.guideGrid"), strong: false });
    }
  } else {
    // 사진이 9:16 이 아니면 게시할 때 9:16 화면 가운데에 얹힘 → 그 화면 기준으로 가려지는 띠
    const frameH = a > 9 / 16 ? w / (9 / 16) : h;
    const offset = (frameH - h) / 2;
    const top = frameH * 0.14 - offset;
    const bottom = frameH * 0.2 - offset;
    if (top > 2) bands.push({ y: 0, bh: Math.min(top, h), label: t("editor.guideStoryTop") });
    if (bottom > 2) bands.push({ y: h - Math.min(bottom, h), bh: Math.min(bottom, h), label: t("editor.guideStoryBottom") });
  }
  return (
    <svg
      aria-hidden
      width={w}
      height={h}
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ overflow: "visible" }}
    >
      {bands.map((b) => (
        <g key={b.label}>
          <rect x={0} y={b.y} width={w} height={b.bh} fill={warn ? "rgba(255,45,85,0.22)" : "rgba(0,0,0,0.28)"} />
          <line x1={0} x2={w} y1={b.y === 0 ? b.bh : b.y} y2={b.y === 0 ? b.bh : b.y} stroke={warn ? "#ff2d55" : "#fff"} strokeWidth={warn ? 2.5 : 1.5} strokeDasharray="5 5" />
          <text x={8} y={b.y === 0 ? b.bh - 6 : b.y + 14} fill="#fff" fontSize={11} style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 3 }}>
            {b.label}
          </text>
        </g>
      ))}
      {rects.map((r) => (
        <g key={r.label}>
          <rect
            x={r.x + 0.75}
            y={r.y + 0.75}
            width={r.bw - 1.5}
            height={r.bh - 1.5}
            fill="none"
            stroke={warn && r.strong ? "#ff2d55" : r.strong ? "#fff" : "rgba(255,255,255,0.6)"}
            strokeWidth={r.strong ? 1.5 : 1}
            strokeDasharray={r.strong ? "6 5" : "2 4"}
          />
          <text
            x={r.x + 8}
            y={r.strong ? r.y + 16 : r.y + r.bh - 8}
            fill="#fff"
            fontSize={11}
            style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.6)", strokeWidth: 3 }}
          >
            {r.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]", className)}>{children}</div>;
}

function Swatches({ value, onPick, small, customLabel }: { value: string; onPick: (c: string) => void; small?: boolean; customLabel: string }) {
  return (
    <Row>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onPick(c)}
          className={cx("shrink-0 rounded-full border border-white/30", small ? "size-6" : "size-7", value === c && "ring-2 ring-white ring-offset-2 ring-offset-[#141416]")}
          style={{ background: c }}
        />
      ))}
      <label className={cx("relative shrink-0 overflow-hidden rounded-full border border-white/30 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]", small ? "size-6" : "size-7")} title={customLabel}>
        <input type="color" value={value.startsWith("#") ? value : "#ffffff"} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={customLabel} />
      </label>
    </Row>
  );
}

function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("shrink-0 rounded-full border px-3 py-1 text-[12px]", on ? "border-white bg-white text-black" : "border-white/25 text-white/85 hover:bg-white/10")}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  display,
  swatch,
  detent,
}: {
  label: string;
  /** 이름 앞 색 점 (HSL 색·컬러 그레이딩 색상) */
  swatch?: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: () => void;
  min: number;
  max: number;
  step: number;
  /** 오른쪽에 보이는 값 (예: +0.50, -15) */
  display?: string;
  /** 살짝 붙는 값 (없으면 가운데 0) */
  detent?: number;
}) {
  // 움직일 때 '틱' 진동, 가운데(0)를 지나면 0에 살짝 붙으며 '팡'
  const range = max - min;
  const center = detent !== undefined ? detent : min < 0 && max > 0 ? 0 : null;
  const last = useRef(value);
  const change = (raw: number) => {
    let v = raw;
    if (center !== null && Math.abs(v - center) <= range * 0.025) v = center;
    const prev = last.current;
    last.current = v;
    if (v === prev) return;
    const crossed = center !== null && (v === center || (prev - center) * (v - center) < 0);
    if (crossed && prev !== center) haptic("snap");
    else if (Math.round((v - min) / (range / 20)) !== Math.round((prev - min) / (range / 20))) haptic("tick");
    onChange(v);
  };
  useEffect(() => {
    last.current = value;
  }, [value]);
  return (
    <label className="flex items-center gap-3 text-[12px] text-white/70">
      <span className="flex w-20 shrink-0 items-center gap-1.5">
        {swatch && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: swatch }} />}
        {label}
      </span>
      <span className="relative flex min-w-0 flex-1 items-center">
        {center !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-white/35"
            style={{ left: `calc(${((center - min) / range) * 100}% )` }}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => change(Number(e.target.value))}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          className="relative w-full accent-white"
        />
      </span>
      {display !== undefined && <span className="tnum w-9 shrink-0 text-right text-[11px] text-white/55">{display}</span>}
    </label>
  );
}
