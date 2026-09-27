"use client";

import type { AutoReplyInput, AutoReplyRule } from "@/lib/types";
import { cx, Field, inputClass } from "./ui";

const FIELDS: (keyof AutoReplyInput)[] = [
  "enabled",
  "keywords",
  "public_reply",
  "dm_prompt",
  "link_url",
  "link_message",
  "not_following_message",
];

/** 서버 규칙 → 폼 값. 아직 규칙이 없으면 '꺼짐'으로 시작해 사용자가 게시 때 켜도록 합니다. */
export function autoReplyForm(rule: AutoReplyRule): AutoReplyInput {
  const form = Object.fromEntries(FIELDS.map((k) => [k, rule[k]])) as AutoReplyInput;
  return rule.exists ? form : { ...form, enabled: false };
}

/** 저장이 필요한지: 새로 켰거나, 이미 있는 규칙을 바꿨을 때. */
export function autoReplyDirty(rule: AutoReplyRule, form: AutoReplyInput) {
  if (!rule.exists) return form.enabled;
  return FIELDS.some((k) => form[k] !== rule[k]);
}

export function autoReplyValid(form: AutoReplyInput) {
  const link = form.link_url.trim();
  return !form.enabled || !link || /^https?:\/\/\S+$/.test(link);
}

/** 게시 카드 안에 들어가는 댓글 자동 응답 설정. 상태는 부모(게시 흐름)가 들고 있습니다. */
export function AutoReplyFields({
  form,
  onChange,
  published,
}: {
  form: AutoReplyInput;
  onChange: (next: AutoReplyInput) => void;
  published: boolean;
}) {
  const set = <K extends keyof AutoReplyInput>(k: K, v: AutoReplyInput[K]) => onChange({ ...form, [k]: v });
  const dmMode = form.link_url.trim().length > 0 || form.link_message.trim().length > 0;
  const validLink = autoReplyValid(form);

  return (
    <div className={cx("rounded-lg border", form.enabled ? "border-accent/40 bg-accent/4" : "border-line")}>
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-[13px] font-semibold">
            {published ? "댓글 자동 응답" : "게시와 함께 댓글 자동 응답 켜기"}
          </span>
          <span className="block text-[12px] text-fg-3">
            키워드 댓글에 답글을 달고, 팔로워에게만 DM으로 문구와 링크를 보냅니다.
          </span>
        </span>
      </label>

      {form.enabled && (
        <div className="space-y-4 border-t border-line px-3 pt-3 pb-4">
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

          <div className="rounded-lg border border-line bg-surface-1 p-3">
            <p className="text-[13px] font-semibold">팔로워에게만 보내는 DM</p>
            <p className="mt-0.5 text-[12px] text-fg-3">
              문구와 링크 중 하나 이상을 채우면 DM 단계가 켜집니다. 모두 비워두면 공개 답글만 답니다.
            </p>

            <div className="mt-3 space-y-3">
              <Field label="보낼 문구" htmlFor="ar-reward-text">
                <textarea
                  id="ar-reward-text"
                  rows={3}
                  value={form.link_message}
                  onChange={(e) => set("link_message", e.target.value)}
                  placeholder={"팔로우해 주셔서 감사해요! 🎁\n요청하신 링크입니다 👇"}
                  className={cx(inputClass, "resize-y leading-relaxed")}
                />
              </Field>
              <Field label="보낼 링크" htmlFor="ar-link">
                <input
                  id="ar-link"
                  type="url"
                  value={form.link_url}
                  onChange={(e) => set("link_url", e.target.value)}
                  placeholder="https://"
                  className={cx(inputClass, !validLink && "border-bad")}
                />
              </Field>
              {!validLink && <p className="text-[12px] text-bad">링크는 http:// 또는 https:// 로 시작해야 합니다.</p>}
            </div>

            {dmMode && (
              <ol className="mt-4 space-y-3 border-t border-line pt-4">
                <Step n={1} title="댓글 작성자에게 먼저 보내는 DM" hint="Instagram 정책상 댓글당 1통, 텍스트만 보낼 수 있어요. 답장을 유도하세요.">
                  <textarea rows={2} value={form.dm_prompt} onChange={(e) => set("dm_prompt", e.target.value)} className={cx(inputClass, "resize-y")} />
                </Step>
                <Step n={2} title="답장한 사람이 팔로워면 → 이렇게 전송" hint="위에 입력한 문구와 링크입니다.">
                  <DmPreview text={form.link_message} link={form.link_url} />
                </Step>
                <Step n={3} title="팔로워가 아니면 → 팔로우 안내" hint="팔로우 후 다시 메시지를 보내면 2번이 전송됩니다.">
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
      )}
    </div>
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

/** Instagram DM 말풍선 모양 미리보기 — 문구 다음 줄에 링크가 붙어 전송됩니다. */
function DmPreview({ text, link }: { text: string; link: string }) {
  const t = text.trim();
  const l = link.trim();
  return (
    <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
      {t || l ? (
        <>
          {t && <span>{t}</span>}
          {t && l && "\n"}
          {l && <span className="break-all text-accent underline">{l}</span>}
        </>
      ) : (
        <span className="text-fg-3">문구나 링크를 입력하세요</span>
      )}
    </div>
  );
}
