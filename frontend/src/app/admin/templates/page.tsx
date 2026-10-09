"use client";

/** 템플릿: 내가 만든 디자인 틀 모아 보기 · 새로 만들기 · 고치기 · 지우기 · 이걸로 게시물 만들기 */

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { DesignGallery } from "@/components/design/DesignGallery";
import { TemplateMaker } from "@/components/design/TemplateMaker";
import type { TemplateMode } from "@/components/editor/ImageEditor";
import { Button, cx, Empty, PageHeader, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError, useApi } from "@/lib/api";
import type { Asset } from "@/lib/types";

const ImageEditor = dynamic(() => import("@/components/editor/ImageEditor").then((m) => m.ImageEditor), { ssr: false });

type Mine = { id: string; name: string; post_type: "feed" | "story"; pages: number; thumb_url: string };
type Session = { mode: TemplateMode; layers: string };

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
  const list = useApi<{ data: Mine[] }>("/studio/templates");
  const [making, setMaking] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  // 디자인 템플릿 고르기 화면의 '새 템플릿 만들기'에서 왔으면 바로 열기
  useEffect(() => {
    if (params.get("new") === "1") setMaking(true);
  }, [params]);

  async function edit(m: Mine) {
    setError(undefined);
    try {
      const full = await api<{ pages: string[] }>(`/studio/templates/${m.id}`);
      setSession({ mode: { id: m.id, name: m.name, post: m.post_type }, layers: full.pages[0] });
    } catch (e) {
      setError(toApiError(e).message);
    }
  }
  async function remove(m: Mine) {
    if (!window.confirm(t("design.deleteTemplate", { name: m.name }))) return;
    await api(`/studio/templates/${m.id}`, { method: "DELETE" });
    list.reload();
  }

  // 편집기에 넘길 '장': 게시물 작업이 없어 편집기 상태만 담음
  const asset = session ? ({ type: "image", url: "", thumbnail_url: "", meta: { edit: { base_id: "", layers: session.layers } } } as unknown as Asset) : null;

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
      {error && <p className="mb-4 text-[13px] text-bad">{error}</p>}
      {list.loading && !list.data ? (
        <Skeleton className="h-64" />
      ) : !list.data?.data.length ? (
        <Empty title={t("design.emptyMine")}>
          <Button className="mt-3" onClick={() => setMaking(true)}>
            {t("design.newTemplate")}
          </Button>
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {list.data.data.map((m) => (
            <div key={m.id} className="space-y-2">
              <button type="button" onClick={() => setUsing(m.id)} className="block w-full overflow-hidden rounded-lg border border-line bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumb_url.replace(/^https?:\/\/[^/]+/, "")} alt="" className={cx("w-full object-cover", m.post_type === "story" ? "aspect-[9/16]" : "aspect-[4/5]")} />
              </button>
              <p className="truncate text-[13px] font-medium">
                {m.name}
                {m.pages > 1 && <span className="text-fg-3"> · {m.pages}{t("design.pages")}</span>}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="primary" onClick={() => setUsing(m.id)}>
                  {t("design.use")}
                </Button>
                {m.pages === 1 && (
                  <Button size="sm" onClick={() => edit(m)}>
                    {t("design.edit")}
                  </Button>
                )}
                <Button size="sm" onClick={() => remove(m)}>
                  {t("design.remove")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

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
          onSaved={() => list.reload()}
        />
      )}
      {using && (
        <DesignGallery
          story={false}
          initialMineId={using}
          onClose={() => setUsing(null)}
          onCreated={(job) => router.push(`/admin/studio?job=${job.id}`)}
        />
      )}
    </div>
  );
}
