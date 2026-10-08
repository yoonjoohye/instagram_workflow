"use client";
/** 가벼운 진동(햅틱). 슬라이더를 움직일 때 '틱', 가운데(0)에 붙을 때 '팡'.
 *  - 우리 앱(Expo) 안: 앱의 진동 기능 (앱을 새로 빌드한 뒤부터)
 *  - 안드로이드 브라우저: navigator.vibrate
 *  - 아이폰 사파리: 진동 API 가 없어, iOS 18+ 의 시스템 스위치(<input switch>)를 눌러 나는 햅틱을 씀
 *  지원하지 않는 곳에서는 조용히 아무 일도 하지 않습니다. */

import { callNative, isNativeApp } from "./nativeBridge";

/** tick: 눈금 · snap: 맞춤(가운데·끝에 붙음) · warn: 경고(인스타에서 가려지는 곳으로 넘어감) */
export type HapticKind = "tick" | "snap" | "warn";

let lastTick = 0;
let iosSwitch: HTMLLabelElement | null = null;

function iosHaptic() {
  if (typeof document === "undefined") return;
  if (!iosSwitch) {
    iosSwitch = document.createElement("label");
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

const isIOS = () => typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);

export function haptic(kind: HapticKind = "tick") {
  const now = Date.now();
  if (kind === "tick") {
    if (now - lastTick < 40) return; // 너무 잦지 않게
    lastTick = now;
  }
  try {
    if (isNativeApp()) {
      callNative("haptic", { kind }, 2000).catch(() => {});
    } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "warn" ? [0, 30, 50, 30, 50, 30] : kind === "snap" ? [0, 24] : 6);
    } else if (isIOS()) {
      iosHaptic();
      if (kind === "snap") setTimeout(iosHaptic, 60); // 두 번 → '팡'
      if (kind === "warn") [70, 140].forEach((ms) => setTimeout(iosHaptic, ms)); // 세 번 → '드르륵'
    }
  } catch {
    // 진동이 막혀 있어도 슬라이더는 그대로
  }
}
