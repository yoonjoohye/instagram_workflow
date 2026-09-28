"use client";

import Link from "next/link";
import { useState } from "react";
import { IconExternal, IconRefresh } from "@/components/icons";
import { Badge, Button, Card, Empty, Notice, PageHeader, Skeleton, StatusDot, type Tone } from "@/components/ui";
import { autoReplySummary } from "@/components/AutoReplyCard";
import { api, LOGIN_URL, toApiError, useApi } from "@/lib/api";
import { fmtInt, fmtRelative, mediaSrc } from "@/lib/format";
import type { AutoReplyLog, AutoReplyLogStatus, AutoReplyRule, AutoReplyStatus, ListOf } from "@/lib/types";

const LOG_STATUS: Record<AutoReplyLogStatus, { label: string; tone: Tone }> = {
  replied: { label: "공개 답글", tone: "neutral" },
  dm_sent: { label: "DM 답장 대기", tone: "accent" },
  awaiting_follow: { label: "팔로우 대기", tone: "warn" },
  link_sent: { label: "링크 전송", tone: "good" },
  skipped: { label: "건너뜀", tone: "neutral" },
  failed: { label: "실패", tone: "bad" },
};

export default function AutoReplyPage() {
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
    if (!window.confirm("이 게시물의 자동 응답 규칙을 삭제할까요?")) return;
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
        title="자동 응답"
        description="키워드 댓글에 자동으로 답하고, 팔로워에게만 DM으로 링크를 보냅니다."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              rules.reload();
              logs.reload();
            }}
          >
            <IconRefresh /> 새로고침
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
              <StatusDot tone={LOG_STATUS[k].tone} /> {LOG_STATUS[k].label}
            </p>
            <p className="pnum mt-1 text-2xl font-semibold">{fmtInt(stats[k] ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card title="게시물별 규칙" subtitle="스튜디오 게시 화면이나 게시물 성과의 '자동 응답' 버튼에서 만들고 수정합니다.">
          {rules.loading && !rules.data ? (
            <Skeleton className="h-40" />
          ) : !rules.data?.data.length ? (
            <Empty title="아직 규칙이 없습니다">
              <Link href="/admin/jobs" className="underline">
                작업함
              </Link>
              에서 게시물을 열고 &lsquo;댓글 자동 응답&rsquo;을 설정하세요.
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
                    <p className="truncate text-[13px] font-medium">{r.post?.prompt ?? "게시물"}</p>
                    <p className="truncate text-[12px] text-fg-3">
                      {autoReplySummary(r)}
                      {!r.ig_media_id && " · 게시 전"}
                    </p>
                  </div>
                  {/* 휴대폰에서는 버튼을 한 줄 아래로 (제목이 잘리지 않게) */}
                  <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
                    <Button size="sm" variant={r.enabled ? "secondary" : "ghost"} onClick={() => toggle(r)}>
                      {r.enabled ? "켜짐" : "꺼짐"}
                    </Button>
                    <Link
                      href={r.job_id ? `/admin/studio?job=${r.job_id}` : `/admin/posts?autoreply=${r.ig_media_id}`}
                      className="inline-flex h-8 items-center rounded-lg px-2 text-[13px] text-fg-2 hover:bg-surface-2"
                    >
                      수정
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => remove(r)} aria-label="삭제">
                      삭제
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="처리 기록" subtitle="최근 100건">
          {logs.loading && !logs.data ? (
            <Skeleton className="h-40" />
          ) : !logs.data?.data.length ? (
            <Empty title="아직 처리된 댓글이 없습니다">Webhook 이 연결되고 키워드 댓글이 달리면 여기에 기록됩니다.</Empty>
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
                      @{l.commenter_username || "알 수 없음"}
                    </a>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={LOG_STATUS[l.status]?.tone ?? "neutral"} icon={<StatusDot tone={LOG_STATUS[l.status]?.tone ?? "neutral"} />}>
                        {LOG_STATUS[l.status]?.label ?? l.status}
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

  if (loading || !status) return <Skeleton className="h-48 rounded-xl" />;

  const items: { ok: boolean; label: string; fix: React.ReactNode }[] = [
    {
      ok: status.auth_mode === "instagram",
      label: "Instagram 로그인 방식",
      fix: "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET 환경변수를 설정하세요.",
    },
    {
      ok: status.comments_permission,
      label: "댓글 관리 권한",
      fix: <a href={LOGIN_URL} className="underline">다시 로그인해서 권한을 허용하세요.</a>,
    },
    {
      ok: status.messages_permission,
      label: "메시지(DM) 권한 — 팔로우 확인·링크 전송",
      fix: <a href={LOGIN_URL} className="underline">다시 로그인해서 메시지 권한을 허용하세요.</a>,
    },
    {
      ok: status.verify_token_set,
      label: "Webhook 인증 토큰",
      fix: "WEBHOOK_VERIFY_TOKEN 환경변수에 임의의 문자열을 넣으세요.",
    },
    {
      ok: status.app_secret_set,
      label: "Webhook 서명 검증용 앱 시크릿",
      fix: "INSTAGRAM_APP_SECRET 을 설정하세요.",
    },
  ];
  const allOk = items.every((i) => i.ok);

  async function subscribe() {
    setSubscribing(true);
    try {
      await api("/autoreply/subscribe", { method: "POST" });
      setResult({ ok: true, msg: "댓글·메시지 이벤트 구독을 요청했습니다." });
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
          연결 상태 <Badge tone={allOk ? "good" : "warn"}>{allOk ? "준비됨" : "설정 필요"}</Badge>
        </span>
      }
      subtitle="모두 충족되고 Meta 앱이 라이브 상태여야 실제 댓글에 반응합니다."
      action={
        status.auth_mode === "instagram" && (
          <Button size="sm" onClick={subscribe} loading={subscribing}>
            이벤트 구독 다시 요청
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
              <span className="sr-only">{i.ok ? " 완료" : " 필요"}</span>
              {!i.ok && <span className="block text-[12px] text-fg-3">{i.fix}</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-fg-2">
        <p className="font-medium text-fg">Meta 앱 대시보드 → Webhooks 설정</p>
        <p className="mt-1">
          콜백 URL <code className="rounded bg-surface-1 px-1 break-all">{status.webhook_url}</code>
        </p>
        <p>인증 토큰: WEBHOOK_VERIFY_TOKEN 과 같은 값 · 구독 필드: <code>comments</code>, <code>messages</code></p>
        <p className="mt-1 text-fg-3">
          Webhook 은 앱이 라이브(공개) 상태일 때만 실제로 전달됩니다.{" "}
          <a
            href="https://developers.facebook.com/docs/instagram-platform/webhooks"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline"
          >
            문서 <IconExternal />
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
