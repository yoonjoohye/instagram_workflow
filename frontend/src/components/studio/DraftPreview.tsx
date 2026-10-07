"use client";

/** 만들기 전 오른쪽 미리보기: 고른 사진·동영상과 주제를 바로 인스타그램 모양으로 보여 줍니다.
 *  (이미지 연출·캡션은 '게시물 만들기' 뒤에 완성되므로 여기서는 고른 그대로) */

import { useMe } from "@/components/AdminShell";
import { InstagramPreview } from "@/components/studio/InstagramPreview";
import type { Draft } from "@/components/studio/PostForm";
import { StoryPreview } from "@/components/studio/StoryPreview";
import { Card } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { Asset } from "@/lib/types";

export function DraftPreview({ draft }: { draft: Draft }) {
  const t = useT();
  const { me } = useMe();
  const assets: Asset[] = draft.media.map((m) => ({ type: m.kind, url: m.url, thumbnail_url: "", meta: {} }));
  return (
    <div className="lg:sticky lg:top-6">
      <Card title={t("studio.livePreview")} subtitle={t("studio.draftPreviewHint")}>
        <div className="mx-auto max-w-[420px]">
          {draft.postType === "story" ? (
            <StoryPreview username={me.username} avatar={me.profile_picture_url} assets={assets} />
          ) : (
            <InstagramPreview username={me.username} avatar={me.profile_picture_url} assets={assets} caption={draft.prompt.trim()} />
          )}
        </div>
        {!draft.media.length && <p className="mt-3 text-center text-[12px] text-fg-3">{t("studio.draftNoMedia")}</p>}
      </Card>
    </div>
  );
}
