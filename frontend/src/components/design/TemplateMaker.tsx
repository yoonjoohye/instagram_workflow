"use client";

/** 새 템플릿 만들기: 크기·테마·바탕을 고르면 제목·부제목만 놓인 빈 캔버스를 만들어 사진 편집기(템플릿 모드)로 엽니다.
 *  편집기에서 꾸미고 '템플릿 저장'을 누르면 내 템플릿에 들어갑니다. */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button, cx } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { useApi } from "@/lib/api";
import { buildPage, exportPage, thumbOf } from "@/lib/design/render";
import { pageSize, type Bg, type El, type Page } from "@/lib/design/templates";
import { BUILTIN_THEMES, type ColorToken, type Theme } from "@/lib/design/themes";

type Style = "solid" | "primary" | "gradient" | "dots" | "grid" | "checker" | "lines" | "stripes" | "photo";
const STYLES: [Style, MessageKey][] = [
  ["solid", "design.bgSolid"],
  ["primary", "design.bgPrimary"],
  ["gradient", "design.bgGradient"],
  ["dots", "design.bgDots"],
  ["grid", "design.bgGrid"],
  ["checker", "design.bgChecker"],
  ["lines", "design.bgLines"],
  ["stripes", "design.bgStripes"],
  ["photo", "design.bgPhoto"],
];

function pageFor(style: Style, post: "feed" | "story", title: string, sub: string): Page {
  const bg: Bg =
    style === "solid"
      ? { kind: "solid", color: "bg" }
      : style === "primary"
        ? { kind: "solid", color: "primary" }
        : style === "gradient"
          ? { kind: "gradient", from: "primary", to: "accent", angle: 160 }
          : style === "photo"
            ? { kind: "photo", dim: 0.25 }
            : { kind: "pattern", pattern: style, color: "bg", ink: "primary", alpha: style === "checker" ? 0.35 : 0.2 };
  const ink: ColorToken = style === "primary" || style === "gradient" ? "on_primary" : style === "photo" ? "white" : "text";
  const { h } = pageSize(post);
  const y = h * 0.38;
  const els: El[] = [
    { t: "text", text: title, x: 90, y, w: 900, size: 104, font: "heading", color: ink, weight: 900, lh: 1.15 },
    { t: "text", text: sub, x: 90, y: y + 170, w: 900, size: 44, font: "body", color: ink === "text" ? "muted" : ink },
  ];
  return { bg, els };
}

export function TemplateMaker({
  onClose,
  onStart,
}: {
  onClose: () => void;
  /** 고른 대로 만든 빈 캔버스 (편집기 상태 — 바탕은 이 기기 안의 그림 주소) */
  onStart: (v: { post: "feed" | "story"; layers: string }) => void;
}) {
  const t = useT();
  const myThemes = useApi<{ data: Theme[] }>("/studio/themes");
  const themes = useMemo(() => [...(myThemes.data?.data ?? []).map((x) => ({ ...x, mine: true })), ...BUILTIN_THEMES], [myThemes.data]);
  const [post, setPost] = useState<"feed" | "story">("feed");
  const [themeId, setThemeId] = useState(BUILTIN_THEMES[0].id);
  const [style, setStyle] = useState<Style>("solid");
  const [thumb, setThumb] = useState("");
  const [busy, setBusy] = useState(false);
  const theme = themes.find((x) => x.id === themeId) ?? BUILTIN_THEMES[0];
  const page = pageFor(style, post, t("design.starterTitle"), t("design.starterSub"));

  useEffect(() => {
    let alive = true;
    (async () => {
      const f = await import("fabric");
      const c = await buildPage(f, { page, index: 0, total: 1, photos: [] }, theme, pageSize(post));
      const url = thumbOf(c, 300);
      c.dispose();
      if (alive) setThumb(url);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post, themeId, style, themes]);

  async function start() {
    setBusy(true);
    try {
      const f = await import("fabric");
      const size = pageSize(post);
      const c = await buildPage(f, { page, index: 0, total: 1, photos: [] }, theme, size);
      const out = await exportPage(c, size);
      c.dispose();
      onStart({ post, layers: out.layers.replace("__BG__", URL.createObjectURL(out.bg)) });
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => cx("shrink-0 rounded-full border px-3 py-1.5 text-[12px]", on ? "border-fg bg-fg text-surface-0" : "border-line text-fg-2");

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={t("design.makerTitle")}>
      <div className="max-h-[94dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-2xl bg-surface-0 p-5 sm:rounded-2xl">
        <div className="flex items-center">
          <h3 className="flex-1 text-[16px] font-semibold">{t("design.makerTitle")}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[14px] text-fg-2 hover:bg-surface-2">
            {t("design.close")}
          </button>
        </div>
        <div className="flex gap-4">
          <div className={cx("w-36 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2", post === "story" ? "aspect-[9/16]" : "aspect-[4/5]")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1.5">
              <p className="text-[12px] text-fg-3">{t("design.size")}</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setPost("feed")} className={chip(post === "feed")}>
                  {t("design.sizeFeed")}
                </button>
                <button type="button" onClick={() => setPost("story")} className={chip(post === "story")}>
                  {t("design.sizeStory")}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[12px] text-fg-3">{t("design.bgStyle")}</p>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setStyle(k)} className={chip(style === k)}>
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12px] text-fg-3">{t("design.theme")}</p>
          <div className="flex flex-wrap gap-1.5">
            {themes.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => setThemeId(th.id)}
                className={cx("flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1.5 text-[12px]", themeId === th.id ? "border-fg" : "border-line text-fg-2")}
              >
                <span className="flex overflow-hidden rounded-full border border-line">
                  {[th.colors.bg, th.colors.primary, th.colors.accent].map((c, i) => (
                    <span key={i} className="size-3.5" style={{ background: c }} />
                  ))}
                </span>
                {"mine" in th && th.mine ? th.name : t(`design.th_${th.id}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-fg-3">{t("design.makerHint")}</p>
        <Button variant="primary" className="w-full" onClick={start} loading={busy} disabled={busy}>
          {t("design.startBlank")}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
