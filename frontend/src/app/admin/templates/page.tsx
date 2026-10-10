"use client";

/** 템플릿: 모두의 템플릿(둘러보기·좋아요·보관·이걸로 만들기·가져와서 고치기·신고) · 내 템플릿(새로 만들기·고치기·공개) · 보관함.
 *  회원이 만든 템플릿을 공개하면 다른 회원이 쓰고, 고쳐서 다시 공개하며(원작자 표시) 템플릿이 계속 쌓이는 구조. */

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMe } from "@/components/AdminShell";
import { DesignGallery } from "@/components/design/DesignGallery";
import { TemplateMaker } from "@/components/design/TemplateMaker";
import type { TemplateMode } from "@/components/editor/ImageEditor";
import { Button, cx, Empty, inputClass, Notice, PageHeader, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { api, toApiError, useApi } from "@/lib/api";
import type { Asset, TemplatePerf } from "@/lib/types";

const ImageEditor = dynamic(() => import("@/components/editor/ImageEditor").then((m) => m.ImageEditor), { ssr: false });

type Base = { id: string; name: string; post_type: "feed" | "story"; pages: number; thumb_url: string };
type Mine = Base & { is_public: boolean; hidden: boolean; category: string; tags: string[]; description: string; author_name: string; uses: number; likes: number; saves: number; remix_of: string; perf?: TemplatePerf | null };
type Card = Base & {
  category: string;
  tags: string[];
  description: string;
  author: { id: number; name: string };
  uses: number;
  likes: number;
  saves: number;
  liked: boolean;
  saved: boolean;
  is_mine: boolean;
  remix_of: { id: string; name: string; author: string } | null;
  /** 이 템플릿으로 실제 게시한 글의 평균 성과 */
  perf?: TemplatePerf | null;
};
type Session = { mode: TemplateMode; layers: string };
type Tab = "community" | "mine" | "saved";
const CATS = ["cardnews", "photo", "notice", "promo", "story", "etc"] as const;
const catLabel = (t: ReturnType<typeof useT>, c: string) => t((c === "etc" ? "design.catEtc" : `design.${c}`) as MessageKey);
const thumbSrc = (u: string) => u.replace(/^https?:\/\/[^/]+/, "");

export default function TemplatesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Templates />
    </Suspense>
  );
}

function Templates() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "community";
  const author = params.get("author");
  const setParams = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(p)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`/admin/templates?${next.toString()}`, { scroll: false });
  };
  const [making, setMaking] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [using, setUsing] = useState<{ id: string; community: boolean } | null>(null);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  // 디자인 템플릿 고르기 화면의 '새 템플릿 만들기'에서 왔으면 바로 열기
  useEffect(() => {
    if (params.get("new") === "1") setMaking(true);
  }, [params]);

  async function editMine(id: string, name: string, post: "feed" | "story") {
    setError(undefined);
    try {
      const full = await api<{ pages: string[] }>(`/studio/templates/${id}`);
      setSession({ mode: { id, name, post }, layers: full.pages[0] });
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  // 편집기에 넘길 '장': 게시물 작업이 없어 편집기 상태만 담음
  const asset = session ? ({ type: "image", url: "", thumbnail_url: "", meta: { edit: { base_id: "", layers: session.layers } } } as unknown as Asset) : null;
  const tabs: [Tab, MessageKey][] = [
    ["community", "design.community"],
    ["mine", "design.mine"],
    ["saved", "design.tabSaved"],
  ];

  return (
    <div>
      <PageHeader
        title={t("design.pageTitle")}
        description={t("design.pageDesc")}
        action={
          <Button variant="primary" onClick={() => setMaking(true)}>
            {t("design.newTemplate")}
          </Button>
        }
      />
      <div className="mb-5 flex gap-1.5 border-b border-line">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setParams({ tab: k, author: null })}
            className={cx("-mb-px border-b-2 px-3 py-2 text-[14px]", tab === k ? "border-fg font-semibold" : "border-transparent text-fg-3")}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {notice && (
        <div className="mb-4">
          <Notice tone="good">{notice}</Notice>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      {tab === "community" && (
        <Community
          author={author}
          onAuthor={(id) => setParams({ author: id })}
          onUse={(id) => setUsing({ id, community: true })}
          onRemixed={(item) => {
            setNotice(t("design.remixed"));
            void editMine(item.id, item.name, item.post_type);
          }}
          onError={setError}
        />
      )}
      {tab === "mine" && (
        <MineList
          onMake={() => setMaking(true)}
          onEdit={(m) => editMine(m.id, m.name, m.post_type)}
          onUse={(id) => setUsing({ id, community: false })}
          onError={setError}
          reloadKey={session ? 1 : 0}
        />
      )}
      {tab === "saved" && <Saved onUse={(id) => setUsing({ id, community: true })} onAuthor={(id) => setParams({ tab: "community", author: id })} onError={setError} />}

      {making && (
        <TemplateMaker
          onClose={() => setMaking(false)}
          onStart={({ post, layers }) => {
            setMaking(false);
            setSession({ mode: { post }, layers });
          }}
        />
      )}
      {session && asset && (
        <ImageEditor
          jobId={0}
          index={0}
          asset={asset}
          templateMode={session.mode}
          onClose={() => setSession(null)}
          onSaved={() => setParams({ tab: "mine", author: null })}
        />
      )}
      {using && (
        <DesignGallery
          story={false}
          initialMineId={using.community ? undefined : using.id}
          initialCommunityId={using.community ? using.id : undefined}
          onClose={() => setUsing(null)}
          onCreated={(job) => router.push(`/admin/studio?job=${job.id}`)}
        />
      )}
    </div>
  );
}

/** 모두의 템플릿 둘러보기 */
function Community({
  author,
  onAuthor,
  onUse,
  onRemixed,
  onError,
}: {
  author: string | null;
  onAuthor: (id: string | null) => void;
  onUse: (id: string) => void;
  onRemixed: (item: Base) => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  const [sort, setSort] = useState<"popular" | "new" | "perf">("popular");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Card[]>([]);
  const [more, setMore] = useState(false);
  const [authorName, setAuthorName] = useState("");
  const [loading, setLoading] = useState(true);

  // 검색어는 잠깐 멈췄을 때
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [sort, cat, query, author]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams({ sort, page: String(page) });
    if (cat) p.set("category", cat);
    if (query) p.set("q", query);
    if (author) p.set("author", author);
    api<{ data: Card[]; has_more: boolean; author: { name: string } | null }>(`/community/templates?${p}`)
      .then((r) => {
        if (!alive) return;
        setItems((prev) => (page === 1 ? r.data : [...prev, ...r.data]));
        setMore(r.has_more);
        setAuthorName(r.author?.name ?? "");
      })
      .catch((e) => alive && onError(toApiError(e).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, cat, query, author, page]);

  const patch = (id: string, v: Partial<Card>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...v } : x)));
  const chip = (on: boolean) => cx("shrink-0 rounded-full border px-3 py-1 text-[12px]", on ? "border-fg bg-fg text-surface-0" : "border-line text-fg-2");

  return (
    <div className="space-y-4">
      {author ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onAuthor(null)} className="text-[13px] text-fg-2 hover:underline">
            {t("design.backToAll")}
          </button>
          <h2 className="text-[16px] font-semibold">{t("design.byAuthor", { name: authorName })}</h2>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSort("popular")} className={chip(sort === "popular")}>
            {t("design.sortPopular")}
          </button>
          <button type="button" onClick={() => setSort("new")} className={chip(sort === "new")}>
            {t("design.sortNew")}
          </button>
          <button type="button" onClick={() => setSort("perf")} className={chip(sort === "perf")} title={t("growth.perfExplain")}>
            📈 {t("growth.sortPerf")}
          </button>
          {sort === "perf" && <p className="order-last basis-full text-[11px] text-fg-3">{t("growth.perfExplain")}</p>}
          <span className="mx-1 h-4 w-px bg-line" />
          <button type="button" onClick={() => setCat("")} className={chip(cat === "")}>
            {t("design.all")}
          </button>
          {CATS.map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={chip(cat === c)}>
              {catLabel(t, c)}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} placeholder={t("design.searchPh")} className={cx(inputClass, "ml-auto w-48 py-1.5 text-[13px]")} />
        </div>
      )}
      {loading && page === 1 ? (
        <Skeleton className="h-64" />
      ) : !items.length ? (
        <Empty title={t("design.noCommunity")} />
      ) : (
        <CardGrid items={items} onUse={onUse} onAuthor={onAuthor} onRemixed={onRemixed} onPatch={patch} onError={onError} />
      )}
      {more && (
        <div className="text-center">
          <Button onClick={() => setPage((p) => p + 1)} loading={loading}>
            {t("design.more")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Saved({ onUse, onAuthor, onError }: { onUse: (id: string) => void; onAuthor: (id: string) => void; onError: (e: string) => void }) {
  const t = useT();
  const list = useApi<{ data: Card[] }>("/community/saved");
  const [items, setItems] = useState<Card[]>([]);
  useEffect(() => setItems(list.data?.data ?? []), [list.data]);
  if (list.loading && !list.data) return <Skeleton className="h-64" />;
  if (!items.length) return <Empty title={t("design.noSaved")} />;
  return (
    <CardGrid
      items={items}
      onUse={onUse}
      onAuthor={(id) => id && onAuthor(id)}
      onRemixed={() => list.reload()}
      onPatch={(id, v) => setItems((l) => l.map((x) => (x.id === id ? { ...x, ...v } : x)))}
      onError={onError}
    />
  );
}

/** 모두의 템플릿 카드들 */
function CardGrid({
  items,
  onUse,
  onAuthor,
  onRemixed,
  onPatch,
  onError,
}: {
  items: Card[];
  onUse: (id: string) => void;
  onAuthor: (id: string | null) => void;
  onRemixed: (item: Base) => void;
  onPatch: (id: string, v: Partial<Card>) => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  async function toggle(c: Card, kind: "like" | "save") {
    const on = kind === "like" ? !c.liked : !c.saved;
    // 바로 보이게 먼저 바꾸고, 실패하면 되돌림
    onPatch(c.id, kind === "like" ? { liked: on, likes: c.likes + (on ? 1 : -1) } : { saved: on, saves: c.saves + (on ? 1 : -1) });
    try {
      await api(`/community/templates/${c.id}/${kind}?on=${on}`, { method: "POST" });
    } catch (e) {
      onPatch(c.id, kind === "like" ? { liked: c.liked, likes: c.likes } : { saved: c.saved, saves: c.saves });
      onError(toApiError(e).message);
    }
  }
  async function remix(c: Card) {
    try {
      onRemixed(await api<Base>(`/community/templates/${c.id}/remix`, { method: "POST" }));
    } catch (e) {
      onError(toApiError(e).message);
    }
  }
  async function report(c: Card) {
    const reason = window.prompt(t("design.reportReason"));
    if (reason === null) return;
    try {
      await api(`/community/templates/${c.id}/report`, { method: "POST", json: { reason } });
      window.alert(t("design.reported"));
    } catch (e) {
      onError(toApiError(e).message);
    }
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((c) => (
        <div key={c.id} className="space-y-1.5">
          <button type="button" onClick={() => onUse(c.id)} className="block w-full overflow-hidden rounded-lg border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbSrc(c.thumb_url)} alt="" className={cx("w-full object-cover", c.post_type === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} />
          </button>
          <p className="truncate text-[13px] font-medium">{c.name}</p>
          <button type="button" onClick={() => onAuthor(String(c.author.id))} className="block truncate text-left text-[12px] text-fg-2 hover:underline">
            {c.author.name}
          </button>
          {c.remix_of && <p className="truncate text-[11px] text-fg-3">↻ {t("design.remixFrom", { name: c.remix_of.name, author: c.remix_of.author })}</p>}
          <p className="text-[11px] text-fg-3">{t("design.stats", { likes: c.likes, uses: c.uses })}</p>
          {c.perf && <p className="text-[11px] font-medium text-accent">📈 {t("growth.tplPerf", { n: c.perf.posts, rate: c.perf.rate })}</p>}
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="primary" onClick={() => onUse(c.id)}>
              {t("design.use")}
            </Button>
            <button
              type="button"
              onClick={() => toggle(c, "like")}
              aria-pressed={c.liked}
              aria-label={t("design.like")}
              className={cx("rounded-md border px-2 py-1 text-[13px]", c.liked ? "border-[#ff3b5c] text-[#ff3b5c]" : "border-line text-fg-2")}
            >
              {c.liked ? "♥" : "♡"}
            </button>
            <button
              type="button"
              onClick={() => toggle(c, "save")}
              aria-pressed={c.saved}
              aria-label={t("design.keep")}
              className={cx("rounded-md border px-2 py-1 text-[13px]", c.saved ? "border-accent text-accent" : "border-line text-fg-2")}
            >
              🔖
            </button>
          </div>
          <div className="flex gap-2 text-[11px] text-fg-3">
            <button type="button" onClick={() => remix(c)} className="hover:text-fg hover:underline">
              ↻ {t("design.remix")}
            </button>
            {!c.is_mine && (
              <button type="button" onClick={() => report(c)} className="hover:text-fg hover:underline">
                {t("design.report")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 내 템플릿: 새로 만들기 · 고치기 · 공개하기/취소 · 지우기 · 이걸로 게시물 만들기 */
function MineList({
  onMake,
  onEdit,
  onUse,
  onError,
  reloadKey,
}: {
  onMake: () => void;
  onEdit: (m: Mine) => void;
  onUse: (id: string) => void;
  onError: (e: string) => void;
  reloadKey: number;
}) {
  const t = useT();
  const list = useApi<{ data: Mine[] }>("/studio/templates");
  const [publishing, setPublishing] = useState<Mine | null>(null);
  // 편집기를 닫으면 새로 고침
  useEffect(() => {
    if (reloadKey === 0) list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  async function remove(m: Mine) {
    if (!window.confirm(t("design.deleteTemplate", { name: m.name }))) return;
    await api(`/studio/templates/${m.id}`, { method: "DELETE" });
    list.reload();
  }
  async function unpublish(m: Mine) {
    try {
      await api(`/studio/templates/${m.id}/unpublish`, { method: "POST" });
      list.reload();
    } catch (e) {
      onError(toApiError(e).message);
    }
  }

  if (list.loading && !list.data) return <Skeleton className="h-64" />;
  if (!list.data?.data.length)
    return (
      <Empty title={t("design.emptyMine")}>
        <Button className="mt-3" onClick={onMake}>
          {t("design.newTemplate")}
        </Button>
      </Empty>
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {list.data.data.map((m) => (
          <div key={m.id} className="space-y-1.5">
            <div className="relative">
              <button type="button" onClick={() => onUse(m.id)} className="block w-full overflow-hidden rounded-lg border border-line bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbSrc(m.thumb_url)} alt="" className={cx("w-full object-cover", m.post_type === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} />
              </button>
              {(m.is_public || m.hidden) && (
                <span className={cx("absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-semibold", m.hidden ? "bg-bad text-white" : "bg-accent text-on-accent")}>
                  {m.hidden ? t("design.hiddenBadge") : t("design.published")}
                </span>
              )}
            </div>
            <p className="truncate text-[13px] font-medium">
              {m.name}
              {m.pages > 1 && <span className="text-fg-3"> · {m.pages}{t("design.pages")}</span>}
            </p>
            {m.is_public && <p className="text-[11px] text-fg-3">{t("design.stats", { likes: m.likes, uses: m.uses })}</p>}
            {m.perf && <p className="text-[11px] font-medium text-accent">📈 {t("growth.tplPerf", { n: m.perf.posts, rate: m.perf.rate })}</p>}
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="primary" onClick={() => onUse(m.id)}>
                {t("design.use")}
              </Button>
              {m.pages === 1 && (
                <Button size="sm" onClick={() => onEdit(m)}>
                  {t("design.edit")}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-fg-3">
              {!m.hidden &&
                (m.is_public ? (
                  <button type="button" onClick={() => unpublish(m)} className="hover:text-fg hover:underline">
                    {t("design.unpublish")}
                  </button>
                ) : (
                  <button type="button" onClick={() => setPublishing(m)} className="font-semibold text-accent hover:underline">
                    🌍 {t("design.publish")}
                  </button>
                ))}
              <button type="button" onClick={() => remove(m)} className="hover:text-fg hover:underline">
                {t("design.remove")}
              </button>
            </div>
          </div>
        ))}
      </div>
      {publishing && (
        <PublishDialog
          template={publishing}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}

/** 모두에게 공개하기: 제작자 이름(기본: 인스타 아이디)·종류·태그·설명 */
function PublishDialog({ template, onClose, onDone }: { template: Mine; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { me } = useMe();
  const [authorName, setAuthorName] = useState(template.author_name || (me.username ? `@${me.username}` : ""));
  const [category, setCategory] = useState(template.category || "etc");
  const [tags, setTags] = useState((template.tags ?? []).join(", "));
  const [description, setDescription] = useState(template.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/studio/templates/${template.id}/publish`, {
        method: "POST",
        json: {
          author_name: authorName.trim(),
          category,
          tags: tags.split(/[,#\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8),
          description: description.trim(),
        },
      });
      onDone();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={t("design.publishTitle")}>
      <div className="max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-surface-0 p-5 sm:rounded-2xl">
        <div className="flex items-center">
          <h3 className="flex-1 text-[16px] font-semibold">{t("design.publishTitle")}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[14px] text-fg-2 hover:bg-surface-2">
            {t("design.close")}
          </button>
        </div>
        <div className="flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbSrc(template.thumb_url)} alt="" className="h-28 rounded-md border border-line" />
          <p className="text-[12px] leading-relaxed text-fg-3">{t("design.publishHint")}</p>
        </div>
        <label className="block space-y-1 text-[13px]">
          <span className="text-fg-2">{t("design.authorName")}</span>
          <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} maxLength={40} className={inputClass} />
        </label>
        <div className="space-y-1 text-[13px]">
          <span className="text-fg-2">{t("design.categoryLabel")}</span>
          <div className="flex flex-wrap gap-1.5">
            {CATS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cx("rounded-full border px-3 py-1 text-[12px]", category === c ? "border-fg bg-fg text-surface-0" : "border-line text-fg-2")}
              >
                {catLabel(t, c)}
              </button>
            ))}
          </div>
        </div>
        <label className="block space-y-1 text-[13px]">
          <span className="text-fg-2">{t("design.tagsLabel")}</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} placeholder={t("design.tagsPh")} className={inputClass} />
        </label>
        <label className="block space-y-1 text-[13px]">
          <span className="text-fg-2">{t("design.descLabel")}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} className={cx(inputClass, "resize-none")} />
        </label>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button variant="primary" className="w-full" onClick={submit} loading={busy} disabled={busy || !authorName.trim()}>
          {busy ? t("design.publishing") : `🌍 ${t("design.publish")}`}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
