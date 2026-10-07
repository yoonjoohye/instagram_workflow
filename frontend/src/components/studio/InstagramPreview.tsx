"use client";

import { useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { mediaSrc } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { Avatar, cx } from "@/components/ui";

/** 인스타그램 피드에 올라갔을 때의 모습 — 헤더·미디어(사진/캐러셀/동영상)·버튼·캡션.
 *  피드는 세로 4:5 로 보이므로 그 비율로 잘라 보여 줍니다. */
export function InstagramPreview({
  username,
  avatar,
  assets,
  caption,
}: {
  username: string;
  avatar?: string;
  assets: Asset[];
  caption: string;
}) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const many = assets.length > 1;

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(assets.length - 1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  return (
    <article className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-line bg-surface-1 text-fg">
      {/* 헤더 */}
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]">
          <span className="block rounded-full bg-surface-1 p-[2px]">
            <Avatar src={avatar} name={username} size={30} />
          </span>
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold">
            {username} <span className="font-normal text-fg-3">· {t("format.justNow")}</span>
          </p>
        </div>
        <span aria-hidden className="px-1 text-fg-2">
          •••
        </span>
      </header>

      {/* 미디어 */}
      <div className="relative bg-black">
        <div
          ref={track}
          onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
          className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {assets.length === 0 ? (
            // 아직 사진이 없을 때: 올라갈 자리를 기본 모양으로
            <div className="flex w-full shrink-0 flex-col items-center justify-center gap-2 bg-gradient-to-br from-surface-2 to-line text-fg-3">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.8" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span className="text-[12px]">{t("studio.previewEmptyMedia")}</span>
              <span className="tnum text-[11px] opacity-70">4:5 · 1080 × 1350</span>
            </div>
          ) : (
            assets.map((a, i) => (
              <div key={`${a.url}-${i}`} className="relative h-full w-full shrink-0 snap-center">
                {a.type === "video" ? (
                  <video
                    src={mediaSrc(a.url)}
                    poster={mediaSrc(a.thumbnail_url) || undefined}
                    controls
                    playsInline
                    muted
                    loop
                    preload="metadata"
                    className="size-full object-cover"
                  />
                ) : a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaSrc(a.url)} alt="" className="size-full object-cover" draggable={false} />
                ) : (
                  <div className="size-full animate-pulse bg-white/10" />
                )}
              </div>
            ))
          )}
        </div>

        {many && (
          <>
            <span className="tnum absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-[12px] text-white">
              {index + 1}/{assets.length}
            </span>
            {index > 0 && (
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-label={t("studio.moveEarlier")}
                className="absolute top-1/2 left-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-[14px] text-black shadow"
              >
                ‹
              </button>
            )}
            {index < assets.length - 1 && (
              <button
                type="button"
                onClick={() => go(index + 1)}
                aria-label={t("studio.moveLater")}
                className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-[14px] text-black shadow"
              >
                ›
              </button>
            )}
          </>
        )}
      </div>

      {/* 버튼 줄 + 캐러셀 점 */}
      <div className="relative flex items-center gap-3.5 px-3 pt-2.5 pb-1.5 text-fg">
        <Icon d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z" />
        <Icon d="M20.7 16.3A9 9 0 1 0 17 20l3.9 1-1-3.7z" />
        <Icon d="M22 3 9.2 10.1M22 3l-6.8 18-3.9-8.2L2.9 9z" />
        {many && (
          <span className="pointer-events-none absolute inset-x-0 flex justify-center gap-1">
            {assets.map((_, i) => (
              <span key={i} className={cx("size-1.5 rounded-full", i === index ? "bg-[#0095f6]" : "bg-fg-3/40")} />
            ))}
          </span>
        )}
        <span className="ml-auto">
          <Icon d="M19 21l-7-5-7 5V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z" />
        </span>
      </div>

      {/* 캡션 */}
      <div className="px-3 pb-3 text-[13px] leading-[1.45]">
        <p className={cx("break-words whitespace-pre-wrap", !expanded && "line-clamp-2")}>
          <span className="font-semibold">{username}</span> <CaptionText text={caption} />
        </p>
        {!caption.trim() && (
          // 캡션이 아직 없을 때 들어갈 자리
          <div className="mt-1.5 space-y-1.5" aria-hidden>
            <div className="h-2.5 w-11/12 rounded-full bg-line" />
            <div className="h-2.5 w-2/3 rounded-full bg-line" />
            <div className="h-2.5 w-1/3 rounded-full bg-[#0095f6]/20" />
          </div>
        )}
        {!expanded && caption.length > 80 && (
          <button type="button" onClick={() => setExpanded(true)} className="text-fg-3">
            {t("studio.igMore")}
          </button>
        )}
      </div>
    </article>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** 해시태그·멘션은 인스타처럼 링크 색으로 */
function CaptionText({ text }: { text: string }) {
  const parts = text.split(/([#@][\p{L}\p{N}_.]+)/u);
  return (
    <>
      {parts.map((p, i) =>
        /^[#@]/.test(p) ? (
          <span key={i} className="text-[#00376b] dark:text-[#e0f1ff]">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}
