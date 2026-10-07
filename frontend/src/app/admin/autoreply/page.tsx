"use client";

import Link from "next/link";
import { useState } from "react";
import { IconExternal, IconRefresh } from "@/components/icons";
import { Badge, Button, Card, Empty, Notice, PageHeader, Skeleton, StatusDot, type Tone } from "@/components/ui";
import { autoReplySummary } from "@/components/AutoReplyCard";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { rich } from "@/i18n/rich";
import { api, startLink, toApiError, useApi } from "@/lib/api";
import { fmtInt, fmtRelative, mediaSrc } from "@/lib/format";
import type { AutoReplyLog, AutoReplyLogStatus, AutoReplyRule, AutoReplyStatus, ListOf } from "@/lib/types";

const LOG_STATUS: Record<AutoReplyLogStatus, { label: MessageKey; tone: Tone }> = {
  replied: { label: "autoreply.statusReplied", tone: "neutral" },
  dm_sent: { label: "autoreply.statusDmSent", tone: "accent" },
  awaiting_follow: { label: "autoreply.statusAwaitingFollow", tone: "warn" },
  link_sent: { label: "autoreply.statusLinkSent", tone: "good" },
  skipped: { label: "autoreply.statusSkipped", tone: "neutral" },
  failed: { label: "autoreply.statusFailed", tone: "bad" },
};

export default function AutoReplyPage() {
  const t = useT();
  const status = useApi<AutoReplyStatus>("/autoreply/status");
  const rules = useApi<ListOf<AutoReplyRule>>("/autoreply/rules");
  const logs = useApi<ListOf<AutoReplyLog>>("/autoreply/logs?limit=100");
  const [error, setError] = useState<string>();

  async function toggle(rule: AutoReplyRule) {
    try {
      const updated = await api<AutoReplyRule>(`/autoreply/rules/${rule.id}`, {
        method: "PATCH",
        json: { enabled: !rule.enabled },
      });
      rules.setData({ data: (rules.data?.data ?? []).map((r) => (r.id === updated.id ? updated : r)) });
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  async function remove(rule: AutoReplyRule) {
    if (!window.confirm(t("autoreply.confirmDelete"))) return;
    try {
      await api(`/autoreply/rules/${rule.id}`, { method: "DELETE" });
      rules.setData({ data: (rules.data?.data ?? []).filter((r) => r.id !== rule.id) });
    } catch (e) {
      setError(toApiError(e).message);
    }
  }

  const stats = (logs.data?.data ?? []).reduce(
    (acc, l) => ({ ...acc, [l.status]: (acc[l.status] ?? 0) + 1 }),
    {} as Partial<Record<AutoReplyLogStatus, number>>,
  );

  return (
    <>
      <PageHeader
        title={t("autoreply.title")}
        description={t("autoreply.description")}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              rules.reload();
              logs.reload();
            }}
          >
            <IconRefresh /> {t("common.refresh")}
          </Button>
        }
      />

      {error && (
        <div className="mb-6">
          <Notice tone="bad" onClose={() => setError(undefined)}>
            {error}
          </Notice>
        </div>
      )}

      <SetupCard status={status.data} loading={status.loading && !status.data} />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["dm_sent", "awaiting_follow", "link_sent", "failed"] as const).map((k) => (
          <div key={k} className="rounded-xl border border-line bg-surface-1 p-4">
            <p className="flex items-center gap-1.5 text-[13px] text-fg-3">
              <StatusDot tone={LOG_STATUS[k].tone} /> {t(LOG_STATUS[k].label)}
            </p>
            <p className="pnum mt-1 text-2xl font-semibold">{fmtInt(stats[k] ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title={t("autoreply.rulesTitle")} subtitle={t("autoreply.rulesSubtitle")}>
          {rules.loading && !rules.data ? (
            <Skeleton className="h-40" />
          ) : !rules.data?.data.length ? (
            <Empty title={t("autoreply.noRulesTitle")}>
              {rich(t("autoreply.noRulesBody"), {
                link: (c) => (
                  <Link href="/admin/jobs" className="underline">
                    {c}
                  </Link>
                ),
              })}
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {rules.data.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  {r.post?.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaSrc(r.post.thumbnail_url)} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="size-11 shrink-0 rounded-md bg-surface-2" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{r.post?.prompt ?? t("autoreply.postFallback")}</p>
                    <p className="truncate text-[12px] text-fg-3">
                      {autoReplySummary(r, t)}
                      {!r.ig_media_id && ` · ${t("autoreply.notPublished")}`}
                    </p>
                  </div>
                  {/* 휴대폰에서는 버튼을 한 줄 아래로 (제목이 잘리지 않게) */}
                  <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
                    <Button size="sm" variant={r.enabled ? "secondary" : "ghost"} onClick={() => toggle(r)}>
                      {r.enabled ? t("common.on") : t("common.off")}
                    </Button>
                    <Link
                      href={r.job_id ? `/admin/studio?job=${r.job_id}` : `/admin/posts?autoreply=${r.ig_media_id}`}
                      className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-fg-2 hover:bg-surface-2"
                    >
                      {t("common.edit")}
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label={t("common.delete")}>
                      {t("common.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("autoreply.logsTitle")} subtitle={t("autoreply.logsSubtitle")}>
          {logs.loading && !logs.data ? (
            <Skeleton className="h-40" />
          ) : !logs.data?.data.length ? (
            <Empty title={t("autoreply.noLogsTitle")}>{t("autoreply.noLogsBody")}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {logs.data.data.map((l) => (
                <li key={l.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <a
                      href={`https://www.instagram.com/${l.commenter_username}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-[13px] font-medium hover:underline"
                    >
                      @{l.commenter_username || t("autoreply.unknownUser")}
                    </a>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={LOG_STATUS[l.status]?.tone ?? "neutral"} icon={<StatusDot tone={LOG_STATUS[l.status]?.tone ?? "neutral"} />}>
                        {LOG_STATUS[l.status] ? t(LOG_STATUS[l.status].label) : l.status}
                      </Badge>
                      <span className="text-[12px] text-fg-3">{fmtRelative(l.updated_at)}</span>
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-fg-2">{l.comment_text}</p>
                  {l.error && <p className="mt-0.5 text-[12px] text-bad">{l.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function SetupCard({ status, loading }: { status?: AutoReplyStatus; loading: boolean }) {
  const [subscribing, setSubscribing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string }>();
  const t = useT();

  if (loading || !status) return <Skeleton className="h-48 rounded-xl" />;

  const items: { ok: boolean; label: string; fix: React.ReactNode }[] = [
    {
      ok: status.auth_mode === "instagram",
      label: t("autoreply.checkAuthMode"),
      fix: t("autoreply.fixAuthMode"),
    },
    {
      ok: status.comments_permission,
      label: t("autoreply.checkComments"),
      fix: <button type="button" onClick={() => startLink("instagram")} className="underline">{t("autoreply.fixComments")}</button>,
    },
    {
      ok: status.messages_permission,
      label: t("autoreply.checkMessages"),
      fix: <button type="button" onClick={() => startLink("instagram")} className="underline">{t("autoreply.fixMessages")}</button>,
    },
    {
      ok: status.verify_token_set,
      label: t("autoreply.checkVerifyToken"),
      fix: t("autoreply.fixVerifyToken"),
    },
    {
      ok: status.app_secret_set,
      label: t("autoreply.checkAppSecret"),
      fix: t("autoreply.fixAppSecret"),
    },
  ];
  const allOk = items.every((i) => i.ok);

  async function subscribe() {
    setSubscribing(true);
    try {
      await api("/autoreply/subscribe", { method: "POST" });
      setResult({ ok: true, msg: t("autoreply.subscribed") });
    } catch (e) {
      setResult({ ok: false, msg: toApiError(e).message });
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t("autoreply.setupTitle")} <Badge tone={allOk ? "good" : "warn"}>{allOk ? t("autoreply.ready") : t("autoreply.needsSetup")}</Badge>
        </span>
      }
      subtitle={t("autoreply.setupSubtitle")}
      action={
        status.auth_mode === "instagram" && (
          <Button size="sm" onClick={subscribe} loading={subscribing}>
            {t("autoreply.resubscribe")}
          </Button>
        )
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2 text-[13px]">
            <span className={i.ok ? "text-good" : "text-warn"} aria-hidden>
              {i.ok ? "✓" : "!"}
            </span>
            <span className="min-w-0">
              <span className="text-fg">{i.label}</span>
              <span className="sr-only">{" "}{i.ok ? t("autoreply.srDone") : t("autoreply.srNeeded")}</span>
              {!i.ok && <span className="block text-[12px] text-fg-3">{i.fix}</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-fg-2">
        <p className="font-medium text-fg">{t("autoreply.webhookTitle")}</p>
        <p className="mt-1">
          {rich(t("autoreply.callbackUrl", { url: status.webhook_url }), {
            code: (c) => <code className="rounded bg-surface-1 px-1 break-all">{c}</code>,
          })}
        </p>
        <p>{rich(t("autoreply.webhookFields"), { code: (c) => <code>{c}</code> })}</p>
        <p className="mt-1 text-fg-3">
          {t("autoreply.webhookLiveOnly")}{" "}
          <a
            href="https://developers.facebook.com/docs/instagram-platform/webhooks"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline"
          >
            {t("autoreply.docs")} <IconExternal />
          </a>
        </p>
      </div>
      {result && (
        <div className="mt-3">
          <Notice tone={result.ok ? "good" : "bad"}>{result.msg}</Notice>
        </div>
      )}
    </Card>
  );
}
