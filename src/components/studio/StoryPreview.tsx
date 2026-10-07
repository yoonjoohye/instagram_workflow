"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { mediaSrc } from "@/lib/format";
import type { Asset } from "@/lib/types";
import { Avatar, cx } from "@/components/ui";

/** 인스타그램 스토리 모양 미리보기 — 세로 9:16, 위 진행 막대·프로필, 아래 답장 창.
 *  왼쪽·오른쪽을 눌러 이전·다음 스토리로 넘깁니다 (실제 앱과 같은 방식). */
export function StoryPreview({ username, avatar, assets }: { username: string; avatar?: string; assets: Asset[] }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const current = assets[Math.min(index, assets.length - 1)];
  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(assets.length - 1, i + d)));

  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-black text-white shadow-lg">
        {current?.type === "video" ? (
          <video
            key={current.url}
            src={mediaSrc(current.url)}
            poster={mediaSrc(current.thumbnail_url) || undefined}
            autoPlay
            muted
            playsInline
            loop
            className="absolute inset-0 size-full object-cover"
          />
        ) : current?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={current.url} src={mediaSrc(current.url)} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
        ) : (
          <div className="absolute inset-0 animate-pulse bg-white/10" />
        )}

        {/* 위: 진행 막대 + 프로필 (실제 화면에서 가려지는 영역) */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/50 to-transparent px-2.5 pt-2 pb-6">
          <div className="flex gap-1" aria-hidden>
            {assets.map((_, i) => (
              <span key={i} className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/35">
                <span className={cx("block h-full bg-white", i <= index ? "w-full" : "w-0")} />
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Avatar src={avatar} name={username} size={26} />
            <span className="text-[12px] font-semibold">{username}</span>
            <span className="text-[12px] text-white/70">{t("format.justNow")}</span>
          </div>
        </div>

        {/* 아래: 답장 창 */}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/50 to-transparent px-3 pt-6 pb-3">
          <span className="flex-1 rounded-full border border-white/60 px-3 py-1.5 text-[12px] text-white/80">{t("studio.storyReply")}</span>
          <span aria-hidden>♡</span>
          <span aria-hidden>➤</span>
        </div>

        {/* 왼쪽·오른쪽 눌러 넘기기 */}
        {assets.length > 1 && (
          <>
            <button type="button" aria-label={t("studio.moveEarlier")} onClick={() => go(-1)} className="absolute inset-y-16 left-0 w-1/3" />
            <button type="button" aria-label={t("studio.moveLater")} onClick={() => go(1)} className="absolute inset-y-16 right-0 w-2/3" />
          </>
        )}
      </div>
      <p className="tnum mt-2 text-center text-[12px] text-fg-3">
        {index + 1} / {assets.length}
      </p>
    </div>
  );
}
