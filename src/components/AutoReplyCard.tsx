"use client";

import { useEffect, useState } from "react";
import { api, toApiError, useApi } from "@/lib/api";
import type { AutoReplyInput, AutoReplyRule } from "@/lib/types";
import { Badge, Button, Card, cx, Field, inputClass, Notice, Skeleton } from "./ui";

const FIELDS: (keyof AutoReplyInput)[] = [
  "enabled",
  "keywords",
  "public_reply",
  "dm_prompt",
  "link_url",
  "link_message",
  "not_following_message",
];

function pick(rule: AutoReplyRule): AutoReplyInput {
  return Object.fromEntries(FIELDS.map((k) => [k, rule[k]])) as AutoReplyInput;
}

/** 게시물(작업)별 댓글 자동 응답 설정. 게시 전에 저장해 두면 게시되는 순간부터 동작합니다. */
export function AutoReplyCard({ jobId, published }: { jobId: number; published: boolean }) {
  const rule = useApi<AutoReplyRule>(`/autoreply/jobs/${jobId}`);
  const [form, setForm] = useState<AutoReplyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (rule.data) setForm(pick(rule.data));
  }, [rule.data]);

  if (!form || !rule.data) {
    return (
      <Card title="댓글 자동 응답">
        {rule.error ? <Notice tone="bad">{rule.error.message}</Notice> : <Skeleton className="h-40" />}
      </Card>
    );
  }

  const set = <K extends keyof AutoReplyInput>(k: K, v: AutoReplyInput[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const dirty = !rule.data.exists || FIELDS.some((k) => form[k] !== rule.data![k]);
  const linkMode = form.link_url.trim().length > 0;
  const validLink = !linkMode || /^https?:\/\/\S+$/.test(form.link_url.trim());

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api<AutoReplyRule>(`/autoreply/jobs/${jobId}`, { method: "PUT", json: form });
      rule.setData(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  const state = !rule.data.exists
    ? { tone: "neutral" as const, label: "미설정" }
    : !rule.data.enabled
      ? { tone: "neutral" as const, label: "꺼짐" }
      : published
        ? { tone: "good" as const, label: "동작 중" }
        : { tone: "accent" as const, label: "게시 후 시작" };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          댓글 자동 응답 <Badge tone={state.tone}>{state.label}</Badge>
        </span>
      }
      subtitle="키워드 댓글에 답글을 달고, 팔로워에게만 DM으로 링크를 보냅니다."
      action={
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          사용
        </label>
      }
    >
      <div className={cx("space-y-4", !form.enabled && "opacity-50")}>
        <Field label="반응할 키워드" htmlFor="ar-keywords" hint="쉼표로 구분. 비워두면 모든 댓글에 반응합니다.">
          <input
            id="ar-keywords"
            value={form.keywords}
            onChange={(e) => set("keywords", e.target.value)}
            placeholder="링크, 가격, 정보"
            className={inputClass}
          />
        </Field>
        <Field label="공개 답글" htmlFor="ar-public" hint="댓글 아래에 달리는 답글. 비워두면 공개 답글은 달지 않습니다.">
          <input id="ar-public" value={form.public_reply} onChange={(e) => set("public_reply", e.target.value)} className={inputClass} />
        </Field>

        <div className="rounded-lg border border-line p-3">
          <Field
            label="팔로워에게 보낼 링크"
            htmlFor="ar-link"
            hint={linkMode ? "아래 순서대로 DM이 오갑니다." : "비워두면 공개 답글만 달고 DM은 보내지 않습니다."}
          >
            <input
              id="ar-link"
              type="url"
              value={form.link_url}
              onChange={(e) => set("link_url", e.target.value)}
              placeholder="https://"
              className={cx(inputClass, !validLink && "border-bad")}
            />
          </Field>

          {linkMode && (
            <ol className="mt-4 space-y-3">
              <Step n={1} title="댓글 작성자에게 DM" hint="Instagram 정책상 댓글당 1통, 텍스트만 보낼 수 있어요. 답장을 유도하세요.">
                <textarea rows={2} value={form.dm_prompt} onChange={(e) => set("dm_prompt", e.target.value)} className={cx(inputClass, "resize-y")} />
              </Step>
              <Step n={2} title="답장한 사람이 팔로워면 → 링크와 함께" hint="메시지 아래에 링크가 붙어서 전송됩니다.">
                <textarea rows={2} value={form.link_message} onChange={(e) => set("link_message", e.target.value)} className={cx(inputClass, "resize-y")} />
              </Step>
              <Step n={3} title="팔로워가 아니면 → 팔로우 안내" hint="팔로우 후 다시 메시지를 보내면 링크가 전송됩니다.">
                <textarea
                  rows={2}
                  value={form.not_following_message}
                  onChange={(e) => set("not_following_message", e.target.value)}
                  className={cx(inputClass, "resize-y")}
                />
              </Step>
            </ol>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[12px] text-fg-3">
          {published ? "저장 즉시 새 댓글부터 적용됩니다." : "게시 전에 저장해 두면 게시되는 순간부터 동작합니다."}
        </p>
        <Button onClick={save} loading={saving} disabled={!dirty || !validLink}>
          {saved ? "저장됨 ✓" : "자동 응답 저장"}
        </Button>
      </div>
      {!validLink && <p className="mt-2 text-[12px] text-bad">링크는 http:// 또는 https:// 로 시작해야 합니다.</p>}
      {error && (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[20px_1fr] gap-2">
      <span className="tnum mt-0.5 flex size-5 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-2">
        {n}
      </span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] font-medium text-fg-2">{title}</p>
        {children}
        <p className="text-[12px] text-fg-3">{hint}</p>
      </div>
    </li>
  );
}
