"use client";

/** 디자인 템플릿 고르기 (망고보드처럼): 종류별 템플릿을 고른 테마로 미리 보고, 사진을 넣어 바로 작업 공간을 만듭니다.
 *  만든 장은 사진 편집기에서 글자·사진 칸을 그대로 고칠 수 있고, 🎨 테마 탭에서 다른 테마로 다시 칠할 수 있어요. */

import type * as F from "fabric";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ThemeEditor } from "@/components/design/ThemeEditor";
import { Button, cx, Notice, Spinner } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { api, toApiError, useApi } from "@/lib/api";
import { applyTheme, buildPage, exportPage, thumbOf } from "@/lib/design/render";
import { CATEGORIES, fillPages, pageSize, pagesOf, photoSlots, TEMPLATE_KEYWORDS, TEMPLATES, type Category, type Template, type TextFill } from "@/lib/design/templates";
import { BUILTIN_THEMES, THEME_KEYWORDS, type Theme } from "@/lib/design/themes";
import { loadFont } from "@/lib/fonts";
import { uploadPhoto } from "@/lib/uploads";
import type { Job, TemplatePerf } from "@/lib/types";

/** 내 템플릿 또는 모두의 템플릿 (community: 다른 회원이 공개한 것 — 장은 /community 에서, 만들면 사용 수 +1) */
type Mine = {
  id: string;
  name: string;
  post_type: "feed" | "story";
  pages: number;
  thumb_url: string;
  community?: boolean;
  author?: { name: string };
  /** 이 템플릿으로 실제 게시한 글의 평균 성과 */
  perf?: TemplatePerf | null;
};
/** 템플릿 성과: 내 평균과 비교(mine, 'builtin:id'·'design:id') · 기본 템플릿 전체 평균(builtin) */
type Perf = { mine: Record<string, { posts: number; saved_x: number | null; reach_x: number | null; rate: number }>; builtin: Record<string, TemplatePerf> };
/** 글 → 카드뉴스 결과 (+ 캡션·해시태그, ai: AI 로 다듬었는지) */
type Outline = TextFill & { caption: string; hashtags: string[]; ai: boolean };
type Cat = "all" | Category | "mine" | "community";

const loadFabric = () => import("fabric");
const themeLabel = (t: ReturnType<typeof useT>, th: Theme) => (th.mine ? th.name : t(`design.th_${th.id}` as MessageKey));

/** 템플릿 표지를 그 테마로 작게 그림 (같은 조합은 다시 그리지 않음) */
const thumbCache = new Map<string, string>();
async function thumbFor(f: typeof F, tpl: Template, theme: Theme, photos: string[] = [], page = 0, bodyCount = 3, fill: TextFill | null = null): Promise<string> {
  const pages = fillPages(pagesOf(tpl, bodyCount), fill);
  const key = `${tpl.id}|${page}|${JSON.stringify(theme)}|${photos.join(",")}|${fill ? JSON.stringify(pages[page].page) : ""}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const { page: p, n } = pages[page];
  const c = await buildPage(f, { page: p, n, index: page, total: pages.length, photos }, theme, pageSize(tpl.post));
  const url = thumbOf(c);
  c.dispose();
  thumbCache.set(key, url);
  return url;
}

export function DesignGallery({
  story,
  initialMineId,
  initialCommunityId,
  initialSearch,
  onCreated,
  onClose,
}: {
  story: boolean;
  /** 내 템플릿 하나를 골라 둔 채로 열기 (템플릿 화면의 '이걸로 게시물 만들기') */
  initialMineId?: string;
  /** 모두의 템플릿 하나를 골라 둔 채로 열기 */
  initialCommunityId?: string;
  /** 이 검색어로 열기 (시즌 캘린더에서) */
  initialSearch?: string;
  onCreated: (job: Job) => void;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [cat, setCat] = useState<Cat>(initialMineId ? "mine" : initialCommunityId ? "community" : story ? "story" : "all");
  const myThemes = useApi<{ data: { id: string; name: string; colors: Theme["colors"]; fonts: Theme["fonts"] }[] }>("/studio/themes");
  const mine = useApi<{ data: Mine[] }>(cat === "mine" ? "/studio/templates" : null);
  // 검색 (템플릿 이름·종류·관련 낱말, 테마 이름·색·분위기, 모두의 템플릿은 서버에서)
  const [search, setSearch] = useState(initialSearch ?? "");
  const [query, setQuery] = useState((initialSearch ?? "").trim().toLowerCase());
  const perf = useApi<Perf>("/studio/templates/performance");
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim().toLowerCase()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const words = query.split(/\s+/).filter(Boolean);
  const hits = (hay: string) => !words.length || words.every((w) => hay.toLowerCase().includes(w.replace(/^#/, "")));
  const community = useApi<{ data: (Mine & { author: { name: string } })[] }>(
    cat === "community" ? `/community/templates?sort=popular${query ? `&q=${encodeURIComponent(query)}` : ""}` : null,
  );
  const listed: Mine[] =
    cat === "community" ? (community.data?.data ?? []).map((x) => ({ ...x, community: true })) : (mine.data?.data ?? []).filter((m) => hits(m.name));
  const listLoading = cat === "community" ? community.loading : mine.loading;
  const themes: Theme[] = useMemo(() => [...(myThemes.data?.data ?? []).map((x) => ({ ...x, mine: true })), ...BUILTIN_THEMES], [myThemes.data]);
  const [themeId, setThemeId] = useState<string | null>(initialMineId || initialCommunityId ? null : BUILTIN_THEMES[0].id);
  const theme = themes.find((x) => x.id === themeId) ?? null;
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Template | null>(null);
  const [pickedMine, setPickedMine] = useState<Mine | null>(null);
  const [bodyCount, setBodyCount] = useState(3);
  const [files, setFiles] = useState<File[]>([]);
  const [pagePreviews, setPagePreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string>();
  const [editingTheme, setEditingTheme] = useState(false);
  // 내 피드 색으로 만든 테마 (저장 전 — 테마 편집 창에서 이름을 정해 저장)
  const [feedTheme, setFeedTheme] = useState<Theme | null>(null);
  const [readingFeed, setReadingFeed] = useState(false);
  // 글 → 카드뉴스
  const [fillText, setFillText] = useState("");
  const [fill, setFill] = useState<Outline | null>(null);
  const [filling, setFilling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = initialMineId || initialCommunityId;
    const m = id && listed.find((x) => x.id === id);
    if (m && !pickedMine) setPickedMine(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.data, community.data]);
  const tplName = (tpl: Template) => t(`design.tpl_${tpl.id.replace("-", "_")}` as MessageKey);
  // 테마도 같은 검색어로 (맞는 테마가 하나도 없으면 다 보여 줌 — 템플릿을 찾는 중일 수 있어서)
  const themeHits = themes.filter((th) => hits(`${th.name} ${th.mine ? "" : t(`design.th_${th.id}` as MessageKey)} ${THEME_KEYWORDS[th.id] ?? ""}`));
  const inCat = cat === "all" ? TEMPLATES : cat === "mine" || cat === "community" ? [] : TEMPLATES.filter((x) => x.category === cat);
  const tplHits = inCat.filter((tpl) => hits(`${tplName(tpl)} ${tpl.name} ${t(`design.${tpl.category}` as MessageKey)} ${TEMPLATE_KEYWORDS[tpl.id] ?? ""}`));
  // 테마 이름으로 찾은 거면(템플릿은 안 맞고 테마만 맞음) 템플릿은 다 보여 줌
  const visible = words.length && !tplHits.length && themeHits.length ? inCat : tplHits;
  const shownThemes = words.length && themeHits.length ? themes.filter((th) => themeHits.includes(th) || th.id === themeId) : themes;
  const shown = theme ?? BUILTIN_THEMES[0];

  // 화면을 연 동안 뒤 페이지가 스크롤되지 않게, Esc 로 닫기
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  });

  // 목록 미리보기: 고른 테마로 하나씩 그림
  useEffect(() => {
    let alive = true;
    (async () => {
      const f = await loadFabric();
      for (const tpl of visible) {
        if (!alive) return;
        const url = await thumbFor(f, tpl, shown);
        if (alive) setThumbs((m) => (m[`${tpl.id}|${shown.id}`] === url ? m : { ...m, [`${tpl.id}|${shown.id}`]: url }));
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, shown]);

  // 고른 템플릿: 모든 장을 고른 사진까지 넣어 미리 보기
  const photoUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)), [photoUrls]);
  useEffect(() => {
    if (!picked) return;
    let alive = true;
    setPagePreviews([]);
    (async () => {
      const f = await loadFabric();
      const pages = pagesOf(picked, bodyCount);
      const queue = [...photoUrls];
      const out: string[] = [];
      for (let i = 0; i < pages.length && alive; i++) {
        const need = photoSlots(pages[i].page);
        out.push(await thumbFor(f, picked, shown, queue.splice(0, need), i, bodyCount, fill));
        if (alive) setPagePreviews([...out]);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [picked, shown, bodyCount, photoUrls, fill]);

  const slots = picked ? pagesOf(picked, bodyCount).reduce((n, p) => n + photoSlots(p.page), 0) : 0;

  /** 만들기: 사진을 올리고 → 장마다 그려서 → 작업 공간 */
  async function create() {
    setError(undefined);
    try {
      const f = await loadFabric();
      const form = new FormData();
      const layers: string[] = [];
      let post: "feed" | "story" = "feed";
      let name = "";
      if (picked) {
        post = picked.post;
        name = t(`design.tpl_${picked.id.replace("-", "_")}` as MessageKey);
        const pages = fillPages(pagesOf(picked, bodyCount), fill);
        setBusy({ done: 0, total: pages.length + files.length });
        const urls: string[] = [];
        for (const file of files) {
          urls.push(`/api/py/media/${await uploadPhoto(file, t)}.jpg`);
          setBusy({ done: urls.length, total: pages.length + files.length });
        }
        for (let i = 0; i < pages.length; i++) {
          const { page, n } = pages[i];
          const c = await buildPage(f, { page, n, index: i, total: pages.length, photos: urls.splice(0, photoSlots(page)) }, shown, pageSize(post));
          const out = await exportPage(c, pageSize(post));
          c.dispose();
          layers.push(out.layers);
          form.append("bgs", out.bg, `bg${i}.jpg`);
          form.append("imgs", out.img, `page${i}.jpg`);
          setBusy({ done: files.length + i + 1, total: pages.length + files.length });
        }
      } else if (pickedMine) {
        post = pickedMine.post_type;
        name = pickedMine.name;
        const full = await api<{ pages: string[] }>(pickedMine.community ? `/community/templates/${pickedMine.id}` : `/studio/templates/${pickedMine.id}`);
        setBusy({ done: 0, total: full.pages.length });
        for (let i = 0; i < full.pages.length; i++) {
          const saved = JSON.parse(full.pages[i]) as { w: number; h: number; canvas: { objects?: unknown[] } };
          const size = { w: saved.w, h: saved.h };
          const fonts = new Set<string>(JSON.stringify(saved.canvas).match(/ffont-[a-z_]+/g) ?? []);
          await Promise.all([...fonts].map((x) => loadFont(x.replace("ffont-", ""))));
          const c = new f.StaticCanvas(undefined, { width: size.w, height: size.h, enableRetinaScaling: false });
          await c.loadFromJSON(saved.canvas);
          if (theme) await applyTheme(f, c, theme, size);
          c.renderAll();
          const out = await exportPage(c, size);
          c.dispose();
          layers.push(out.layers);
          form.append("bgs", out.bg, `bg${i}.jpg`);
          form.append("imgs", out.img, `page${i}.jpg`);
          setBusy({ done: i + 1, total: full.pages.length });
        }
      } else return;
      form.append("pages", JSON.stringify(layers));
      form.append("post_type", post);
      form.append("name", name);
      // 어떤 템플릿으로 만들었는지 (게시 후 성과를 템플릿별로 모음)
      form.append("template_kind", picked ? "builtin" : "design");
      form.append("template_id", picked ? picked.id : pickedMine!.id);
      if (picked && fill) {
        form.append("caption", fill.caption);
        form.append("hashtags", JSON.stringify(fill.hashtags));
      }
      const res = await fetch("/api/py/studio/designs", { method: "POST", body: form, credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || res.status);
      // 모두의 템플릿으로 만들었으면 사용 수 +1 (인기순에 반영)
      if (pickedMine?.community) void api(`/community/templates/${pickedMine.id}/use`, { method: "POST" }).catch(() => undefined);
      onCreated(data as Job);
    } catch (e) {
      setError(t("design.failed", { e: e instanceof Error ? e.message : toApiError(e).message }));
    } finally {
      setBusy(null);
    }
  }

  /** 내 피드(최근 게시물) 사진 색으로 테마 만들기 → 테마 편집 창에서 다듬어 저장 */
  async function themeFromFeed() {
    setError(undefined);
    setReadingFeed(true);
    try {
      const r = await api<{ colors: Theme["colors"] }>("/studio/themes/from-feed", { method: "POST" });
      setFeedTheme({ id: "feed", name: t("growth.fromFeedName"), mine: true, colors: r.colors, fonts: { heading: "pretendard", body: "pretendard" } });
    } catch (e) {
      setError(t("growth.fromFeedFail", { e: toApiError(e).message }));
    } finally {
      setReadingFeed(false);
    }
  }

  /** 붙여 넣은 글을 표지·본문·마무리로 나눠 템플릿 글자 자리에 넣음 */
  async function runFill() {
    setError(undefined);
    setFilling(true);
    try {
      const r = await api<Outline>("/studio/cardnews/outline", { method: "POST", json: { text: fillText, pages: bodyCount } });
      setFill(r);
      setBodyCount(Math.max(1, r.pages.length));
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setFilling(false);
    }
  }

  /** 템플릿 카드 아래 성과 한 줄 (내 평균과 비교가 되면 그것, 아니면 모두의 평균) */
  function perfLine(kind: "builtin" | "design", id: string, own?: TemplatePerf | null): string | null {
    const vs = perf.data?.mine[`${kind}:${id}`];
    if (vs?.saved_x && vs.saved_x >= 1.2) return t("growth.tplVsMine", { x: vs.saved_x });
    if (vs?.reach_x && vs.reach_x >= 1.2) return t("growth.tplVsMineReach", { x: vs.reach_x });
    const all = own ?? (kind === "builtin" ? perf.data?.builtin[id] : null);
    return all && all.posts >= 2 ? t("growth.tplPerf", { n: all.posts, rate: all.rate }) : null;
  }

  async function removeTheme(th: Theme) {
    if (!window.confirm(t("design.deleteTheme", { name: th.name }))) return;
    await api(`/studio/themes/${th.id}`, { method: "DELETE" });
    if (themeId === th.id) setThemeId(BUILTIN_THEMES[0].id);
    myThemes.reload();
  }
  async function removeMine(m: Mine) {
    if (!window.confirm(t("design.deleteTemplate", { name: m.name }))) return;
    await api(`/studio/templates/${m.id}`, { method: "DELETE" });
    if (pickedMine?.id === m.id) setPickedMine(null);
    mine.reload();
  }

  const cats: { key: Cat; label: string }[] = [
    { key: "all", label: t("design.all") },
    ...CATEGORIES.map((c) => ({ key: c.key as Cat, label: t(`design.${c.key}` as MessageKey) })),
    { key: "community", label: t("design.community") },
    { key: "mine", label: t("design.mine") },
  ];
  const chosen = picked || pickedMine;

  // 화면 맨 위에 (아래 탭 메뉴 등 다른 화면 요소에 가리지 않게)
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-surface-0" role="dialog" aria-modal="true" aria-label={t("design.title")}>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h2 className="shrink-0 text-[16px] font-semibold">{t("design.title")}</h2>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={40}
          placeholder={t("design.searchAll")}
          aria-label={t("design.searchAll")}
          className="ml-2 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[13px] sm:max-w-sm"
        />
        <button type="button" onClick={onClose} disabled={!!busy} className="rounded-md px-2 py-1.5 text-[14px] text-fg-2 hover:bg-surface-2">
          {t("design.close")}
        </button>
      </header>

      {/* 종류 */}
      <div className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5">
        {cats.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              setCat(c.key);
              setPicked(null);
              setPickedMine(null);
              if (c.key === "mine" || c.key === "community") setThemeId(null);
              else if (!themeId) setThemeId(BUILTIN_THEMES[0].id);
            }}
            className={cx("shrink-0 rounded-full border px-3 py-1.5 text-[13px]", cat === c.key ? "border-fg bg-fg text-surface-0" : "border-line text-fg-2")}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 테마 */}
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-2.5">
        <span className="shrink-0 text-[12px] text-fg-3">{t("design.theme")}</span>
        {(cat === "mine" || cat === "community") && (
          <button
            type="button"
            onClick={() => setThemeId(null)}
            className={cx("shrink-0 rounded-full border px-3 py-1 text-[12px]", themeId === null ? "border-fg" : "border-line text-fg-2")}
          >
            {t("design.keepColors")}
          </button>
        )}
        {shownThemes.map((th) => (
          <span key={th.id} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setThemeId(th.id)}
              className={cx("flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1.5 text-[12px]", themeId === th.id ? "border-fg" : "border-line text-fg-2")}
              title={themeLabel(t, th)}
            >
              <span className="flex overflow-hidden rounded-full border border-line">
                {[th.colors.bg, th.colors.primary, th.colors.accent].map((c, i) => (
                  <span key={i} className="size-3.5" style={{ background: c }} />
                ))}
              </span>
              {themeLabel(t, th)}
            </button>
            {th.mine && (
              <button
                type="button"
                onClick={() => removeTheme(th)}
                aria-label={t("design.deleteTheme", { name: th.name })}
                className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-surface-2 text-[10px] text-fg-2"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button type="button" onClick={themeFromFeed} disabled={readingFeed} className="shrink-0 rounded-full border border-accent/50 bg-accent/5 px-3 py-1 text-[12px] text-fg">
          {readingFeed ? t("growth.fromFeedBusy") : t("growth.fromFeed")}
        </button>
        <button type="button" onClick={() => setEditingTheme(true)} className="shrink-0 rounded-full border border-dashed border-line px-3 py-1 text-[12px] text-fg-2">
          {t("design.newTheme")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 템플릿 목록 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {cat === "mine" || cat === "community" ? (
            listLoading ? (
              <Spinner className="mx-auto mt-10 size-6" />
            ) : !listed.length ? (
              <div className="mt-8 space-y-3 text-center">
                <p className="text-[13px] text-fg-3">{cat === "community" ? t("design.noCommunity") : t("design.noMine")}</p>
                <Button onClick={() => router.push("/admin/templates?new=1")}>{t("design.newTemplate")}</Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {cat === "mine" && (
                  <button
                    type="button"
                    onClick={() => router.push("/admin/templates?new=1")}
                    className="flex aspect-[4/5] items-center justify-center rounded-lg border-2 border-dashed border-line text-[13px] text-fg-2 hover:border-line-strong"
                  >
                    {t("design.newTemplate")}
                  </button>
                )}
                {listed.map((m) => (
                  <div key={m.id} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setPickedMine(m);
                        setPicked(null);
                      }}
                      className={cx("block w-full overflow-hidden rounded-lg border-2 bg-surface-2", pickedMine?.id === m.id ? "border-accent" : "border-transparent")}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.thumb_url.replace(/^https?:\/\/[^/]+/, "")} alt="" className={cx("w-full object-cover", m.post_type === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} />
                    </button>
                    <div className="mt-1 flex items-center gap-1 text-[12px]">
                      <span className="flex-1 truncate">
                        {m.name}
                        {m.author && <span className="text-fg-3"> · {m.author.name}</span>}
                      </span>
                      <span className="text-fg-3">{m.pages}{t("design.pages")}</span>
                      {!m.community && (
                        <button type="button" onClick={() => removeMine(m)} className="px-1 text-fg-3 hover:text-fg" aria-label={t("design.deleteTemplate", { name: m.name })}>
                          ×
                        </button>
                      )}
                    </div>
                    {perfLine("design", m.id, m.perf) && <p className="truncate text-[11px] font-medium text-accent">📈 {perfLine("design", m.id, m.perf)}</p>}
                  </div>
                ))}
              </div>
            )
          ) : (
            !visible.length ? (
              <p className="mt-8 text-center text-[13px] text-fg-3">{t("design.noResult", { q: search.trim() })}</p>
            ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((tpl) => {
                const url = thumbs[`${tpl.id}|${shown.id}`];
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      if (picked?.id !== tpl.id) setFill(null);
                      setPicked(tpl);
                      setPickedMine(null);
                      setFiles([]);
                    }}
                    className="text-left"
                  >
                    <span
                      className={cx(
                        "block overflow-hidden rounded-lg border-2 bg-surface-2",
                        tpl.post === "story" ? "aspect-[9/16]" : "aspect-[4/5]",
                        picked?.id === tpl.id ? "border-accent" : "border-transparent",
                      )}
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center">
                          <Spinner className="size-4" />
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-[12px]">
                      {t(`design.tpl_${tpl.id.replace("-", "_")}` as MessageKey)}
                      {tpl.category === "cardnews" && <span className="text-fg-3"> · {t("design.cardnews")}</span>}
                    </span>
                    {perfLine("builtin", tpl.id) && <span className="block truncate text-[11px] font-medium text-accent">📈 {perfLine("builtin", tpl.id)}</span>}
                  </button>
                );
              })}
            </div>
            )
          )}
        </div>

        {/* 고른 템플릿 */}
        {chosen && (
          <aside className="max-h-[48dvh] shrink-0 space-y-3 overflow-y-auto border-t border-line p-4 lg:max-h-none lg:w-[380px] lg:border-t-0 lg:border-l">
            <p className="text-[14px] font-semibold">{picked ? t(`design.tpl_${picked.id.replace("-", "_")}` as MessageKey) : pickedMine?.name}</p>
            {picked && (
              <>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(pagePreviews.length ? pagePreviews : [thumbs[`${picked.id}|${shown.id}`]]).map((u, i) =>
                    u ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={u} alt="" className={cx("h-40 shrink-0 rounded-md border border-line object-cover", picked.post === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} />
                    ) : null,
                  )}
                </div>
                {picked.category === "cardnews" && (
                  <label className="flex items-center gap-3 text-[13px]">
                    <span className="shrink-0 text-fg-2">{t("design.bodyPages")}</span>
                    <input type="range" min={1} max={8} value={bodyCount} onChange={(e) => setBodyCount(Number(e.target.value))} className="flex-1 accent-[#8b5cf6]" />
                    <span className="tnum w-14 text-right">
                      {pagesOf(picked, bodyCount).length}
                      {t("design.pages")}
                    </span>
                  </label>
                )}
                {picked.category === "cardnews" && picked.body && (
                  <div className="space-y-1.5 rounded-lg border border-line p-3">
                    <p className="text-[13px] font-semibold">{t("growth.fillTitle")}</p>
                    <p className="text-[12px] leading-relaxed text-fg-3">{t("growth.fillHint")}</p>
                    <textarea
                      value={fillText}
                      onChange={(e) => setFillText(e.target.value)}
                      maxLength={6000}
                      rows={4}
                      placeholder={t("growth.fillPlaceholder")}
                      className="w-full resize-y rounded-md border border-line bg-surface-1 px-2.5 py-2 text-[13px]"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={runFill} loading={filling} disabled={filling || fillText.trim().length < 10 || !!busy}>
                        {filling ? t("growth.fillRunning") : t("growth.fillRun")}
                      </Button>
                      {fill && (
                        <button type="button" onClick={() => setFill(null)} className="text-[12px] text-fg-3 underline">
                          {t("growth.fillClear")}
                        </button>
                      )}
                    </div>
                    {fill && <p className="text-[12px] text-good">{fill.ai ? t("growth.fillDone", { n: fill.pages.length }) : t("growth.fillDoneNoAi", { n: fill.pages.length })}</p>}
                  </div>
                )}
                {slots > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => fileInput.current?.click()} disabled={!!busy}>
                        📷 {t("design.photos")}
                      </Button>
                      {files.length > 0 && <span className="text-[12px] text-fg-2">{t("design.photosPicked", { n: files.length })}</span>}
                    </div>
                    <p className="text-[12px] text-fg-3">{t("design.photosHint", { n: slots })}</p>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*,.heic,.heif"
                      multiple
                      hidden
                      onChange={(e) => {
                        setFiles(Array.from(e.target.files ?? []).slice(0, slots));
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
              </>
            )}
            {pickedMine && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pickedMine.thumb_url.replace(/^https?:\/\/[^/]+/, "")} alt="" className="h-48 rounded-md border border-line" />
            )}
            {error && <Notice tone="bad">{error}</Notice>}
            <Button variant="primary" className="w-full" onClick={create} disabled={!!busy}>
              {busy ? (
                <>
                  <Spinner className="size-4" /> {t("design.creating", { done: busy.done, total: busy.total })}
                </>
              ) : (
                t("design.create")
              )}
            </Button>
          </aside>
        )}
      </div>

      {feedTheme && (
        <ThemeEditor
          base={feedTheme}
          onClose={() => setFeedTheme(null)}
          onSaved={(saved) => {
            myThemes.reload();
            setThemeId(saved.id);
            setFeedTheme(null);
          }}
        />
      )}
      {editingTheme && (
        <ThemeEditor
          base={shown}
          onClose={() => setEditingTheme(false)}
          onSaved={(saved) => {
            myThemes.reload();
            setThemeId(saved.id);
            setEditingTheme(false);
          }}
        />
      )}
    </div>,
    document.body,
  );
}
