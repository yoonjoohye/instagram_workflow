"use client";

import type { ReactNode } from "react";
import type { AutoReplyInput, AutoReplyRule } from "@/lib/types";
import { cx, inputClass } from "./ui";

const FIELDS: (keyof AutoReplyInput)[] = [
  "public_reply_enabled",
  "public_reply",
  "dm_enabled",
  "dm_prompt",
  "link_url",
  "link_message",
  "not_following_message",
];

/** 서버 규칙 → 폼 값. 아직 규칙이 없으면 두 스위치 모두 꺼진 상태로 시작합니다. */
export function autoReplyForm(rule: AutoReplyRule): AutoReplyInput {
  const form = Object.fromEntries(FIELDS.map((k) => [k, rule[k]])) as AutoReplyInput;
  return rule.exists ? form : { ...form, public_reply_enabled: false, dm_enabled: false };
}

export const autoReplyOn = (form: AutoReplyInput) => form.public_reply_enabled || form.dm_enabled;

/** 저장이 필요한지: 새로 켰거나, 이미 있는 규칙을 바꿨을 때. */
export function autoReplyDirty(rule: AutoReplyRule, form: AutoReplyInput) {
  if (!rule.exists) return autoReplyOn(form);
  return FIELDS.some((k) => form[k] !== rule[k]);
}

export function autoReplyValid(form: AutoReplyInput) {
  const link = form.link_url.trim();
  if (form.public_reply_enabled && !form.public_reply.trim()) return false;
  if (form.dm_enabled) {
    if (link && !/^https?:\/\/\S+$/.test(link)) return false;
    if (!link && !form.link_message.trim()) return false;
    if (!form.not_following_message.trim()) return false;
  }
  return true;
}

/** 확인 창·목록에 쓰는 한 줄 요약 */
export function autoReplySummary(form: Pick<AutoReplyInput, "public_reply_enabled" | "dm_enabled">) {
  const parts = [form.public_reply_enabled && "댓글 답글", form.dm_enabled && "팔로우별 DM"].filter(Boolean);
  return parts.length ? parts.join(" + ") : "꺼짐";
}

/** 댓글 자동 응답 설정: ① 모든 댓글에 같은 답글 ② 팔로우 여부에 따라 다른 DM. 상태는 부모가 들고 있습니다. */
export function AutoReplyFields({
  form,
  onChange,
}: {
  form: AutoReplyInput;
  onChange: (next: AutoReplyInput) => void;
}) {
  const set = <K extends keyof AutoReplyInput>(k: K, v: AutoReplyInput[K]) => onChange({ ...form, [k]: v });
  const badLink = form.link_url.trim() !== "" && !/^https?:\/\/\S+$/.test(form.link_url.trim());

  return (
    <div className="space-y-3">
      <Toggle
        checked={form.public_reply_enabled}
        onChange={(v) => set("public_reply_enabled", v)}
        title="댓글에 자동 답글"
        description="어떤 댓글이든 아래 문구로 똑같이 답글을 답니다."
      >
        <input
          aria-label="답글 문구"
          value={form.public_reply}
          onChange={(e) => set("public_reply", e.target.value)}
          placeholder="댓글 감사합니다! 😊"
          className={cx(inputClass, !form.public_reply.trim() && "border-bad")}
        />
      </Toggle>

      <Toggle
        checked={form.dm_enabled}
        onChange={(v) => set("dm_enabled", v)}
        title="댓글 쓴 사람에게 DM 보내기"
        description="팔로우 여부에 따라 다른 문구를 DM으로 보냅니다."
      >
        <div className="space-y-4">
          <Section label="팔로워에게" hint="문구와 링크 중 하나 이상을 채워 주세요.">
            <textarea
              aria-label="팔로워에게 보낼 문구"
              rows={3}
              value={form.link_message}
              onChange={(e) => set("link_message", e.target.value)}
              placeholder={"팔로우해 주셔서 감사해요! 🎁\n요청하신 링크입니다 👇"}
              className={cx(inputClass, "resize-y leading-relaxed")}
            />
            <input
              aria-label="팔로워에게 보낼 링크"
              type="url"
              value={form.link_url}
              onChange={(e) => set("link_url", e.target.value)}
              placeholder="https:// (선택)"
              className={cx(inputClass, "mt-2", badLink && "border-bad")}
            />
            {badLink && <p className="mt-1 text-[12px] text-bad">링크는 http:// 또는 https:// 로 시작해야 합니다.</p>}
            <DmPreview text={form.link_message} link={form.link_url} />
          </Section>

          <Section label="팔로워가 아니면">
            <textarea
              aria-label="팔로워가 아닌 사람에게 보낼 문구"
              rows={2}
              value={form.not_following_message}
              onChange={(e) => set("not_following_message", e.target.value)}
              className={cx(inputClass, "resize-y leading-relaxed", !form.not_following_message.trim() && "border-bad")}
            />
          </Section>

          <details className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-fg-2">팔로우 여부를 아직 모를 때 보내는 안내 DM</summary>
            <p className="mt-2 text-[12px] leading-relaxed text-fg-3">
              Instagram 정책상 팔로우 여부는 상대가 우리 계정에 DM을 보낸 적이 있어야 확인할 수 있어요. 처음 보는 사람에게는 이 안내를
              먼저 보내고, 답장이 오면 위의 팔로워/비팔로워 문구를 보냅니다.
            </p>
            <textarea
              aria-label="안내 DM 문구"
              rows={2}
              value={form.dm_prompt}
              onChange={(e) => set("dm_prompt", e.target.value)}
              className={cx(inputClass, "mt-2 resize-y")}
            />
          </details>
        </div>
      </Toggle>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  title,
  description,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("rounded-lg border", checked ? "border-accent/40 bg-accent/4" : "border-line")}>
      <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">{title}</span>
          <span className="block text-[12px] text-fg-3">{description}</span>
        </span>
        <span className="relative inline-flex shrink-0 items-center">
          <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
          <span className="h-5 w-9 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
          <span className="absolute left-0.5 size-4 rounded-full bg-surface-1 shadow transition-transform peer-checked:translate-x-4" />
        </span>
      </label>
      {checked && <div className="border-t border-line px-3 pt-3 pb-3">{children}</div>}
    </div>
  );
}

function Section({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-fg-2">
        {label}
        {hint && <span className="ml-1.5 text-[12px] font-normal text-fg-3">{hint}</span>}
      </p>
      {children}
    </div>
  );
}

/** Instagram DM 말풍선 모양 미리보기 — 문구 다음 줄에 링크가 붙어 전송됩니다. */
function DmPreview({ text, link }: { text: string; link: string }) {
  const t = text.trim();
  const l = link.trim();
  if (!t && !l) return null;
  return (
    <div className="mt-2 max-w-[85%] rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
      {t && <span>{t}</span>}
      {t && l && "\n"}
      {l && <span className="break-all text-accent underline">{l}</span>}
    </div>
  );
}
