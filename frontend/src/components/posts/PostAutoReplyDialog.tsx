"use client";

import { useEffect, useState } from "react";
import { AutoReplyFields, autoReplyDirty, autoReplyForm, autoReplyValid } from "@/components/AutoReplyCard";
import { Button, Dialog, Notice, Skeleton } from "@/components/ui";
import { useT } from "@/i18n/client";
import { api, toApiError, useApi } from "@/lib/api";
import type { AutoReplyInput, AutoReplyRule, IgPost } from "@/lib/types";

export function PostAutoReplyDialog({
  post,
  onClose,
  onSaved,
}: {
  post: IgPost;
  onClose: () => void;
  onSaved: (rule: AutoReplyRule) => void;
}) {
  const t = useT();
  const rule = useApi<AutoReplyRule>(`/autoreply/media/${post.id}`);
  const [form, setForm] = useState<AutoReplyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // 기존 게시물에서 여는 건 '설정하려는' 의도이므로 새 규칙도 켜진 상태로 시작합니다.
    // 기존 게시물에서 여는 건 '설정하려는' 의도이므로 새 규칙은 답글을 켠 상태로 시작합니다.
    if (rule.data) setForm(rule.data.exists ? autoReplyForm(rule.data) : { ...autoReplyForm(rule.data), public_reply_enabled: true });
  }, [rule.data]);

  const dirty = Boolean(rule.data && form && (!rule.data.exists || autoReplyDirty(rule.data, form)));
  const commentsOff = post.is_comment_enabled === false;

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api<AutoReplyRule>(`/autoreply/media/${post.id}`, {
        method: "PUT",
        json: {
          ...form,
          post_caption: (post.caption ?? "").slice(0, 500),
          post_thumbnail: post.thumbnail_url || post.media_url || "",
          post_permalink: post.permalink,
        },
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("posts.autoReplyTitle")}
      subtitle={
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbnail_url || post.media_url} alt="" className="size-6 rounded object-cover" />
          <span className="truncate">{post.caption?.split("\n")[0] || t("posts.noCaption")}</span>
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-fg-3">{t("posts.autoReplyFootnote")}</p>
          <div className="flex gap-2 max-sm:w-full max-sm:[&>button]:flex-1">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={save} loading={saving} disabled={!form || !dirty || !autoReplyValid(form)}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      }
    >
      {commentsOff && (
        <div className="mb-4">
          <Notice tone="warn">{t("posts.autoReplyCommentsOff")}</Notice>
        </div>
      )}
      {form ? (
        <AutoReplyFields form={form} onChange={setForm} />
      ) : rule.error ? (
        <Notice tone="bad">{rule.error.message}</Notice>
      ) : (
        <Skeleton className="h-40" />
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Dialog>
  );
}
