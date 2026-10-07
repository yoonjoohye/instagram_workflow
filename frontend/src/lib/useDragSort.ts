"use client";

import { useRef, useState } from "react";

/** 끌어서 순서 바꾸기 (마우스·터치 공통).
 *  - 마우스: 누른 채 조금 움직이면 시작
 *  - 터치: 잠깐 꾹 누르면 시작 (그 전에 움직이면 평소처럼 화면 스크롤)
 *  항목에는 sortProps(i) 를 펼쳐 넣고, drag.from / drag.over 로 모양을 바꿉니다. 버튼·입력칸·동영상 위에서는 시작하지 않습니다. */
export function useDragSort(onMove: (from: number, to: number) => void, disabled = false) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const sortProps = (index: number) => ({
    "data-sort-index": index,
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button,a,input,textarea,select,video,[data-no-drag]")) return;
      const touch = e.pointerType !== "mouse";
      if (!touch) e.preventDefault(); // 이미지 기본 끌기·글자 선택 막기
      const x0 = e.clientX;
      const y0 = e.clientY;
      let active = false;
      let over = index;
      let timer = 0;

      const activate = () => {
        active = true;
        setDrag({ from: index, over: index });
        navigator.vibrate?.(10);
      };
      const move = (ev: PointerEvent) => {
        const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
        if (!active) {
          if (touch) {
            if (dist > 8) cleanup(); // 스크롤하려는 것
            return;
          }
          if (dist < 6) return;
          activate();
        }
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-sort-index]");
        if (el?.dataset.sortIndex !== undefined && Number(el.dataset.sortIndex) !== over) {
          over = Number(el.dataset.sortIndex);
          setDrag({ from: index, over });
        }
      };
      // 끄는 중에는 화면이 스크롤되지 않게
      const block = (ev: TouchEvent) => active && ev.preventDefault();
      const up = () => {
        const moved = active && over !== index;
        cleanup();
        if (moved) onMoveRef.current(index, over);
      };
      function cleanup() {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cleanup);
        window.removeEventListener("touchmove", block);
        setDrag(null);
      }
      if (touch) timer = window.setTimeout(activate, 280);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cleanup);
      window.addEventListener("touchmove", block, { passive: false });
    },
  });

  return { drag, sortProps };
}

/** 배열에서 한 항목을 다른 자리로 옮긴 새 배열 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
