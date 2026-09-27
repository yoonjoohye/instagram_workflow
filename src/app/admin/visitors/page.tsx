"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconExternal, IconRefresh } from "@/components/icons";
import { Avatar, Badge, Button, Card, Empty, inputClass, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { fmtInt, fmtRelative } from "@/lib/format";
import type { DmContact, ListOf, TaggedMedia, Visitor } from "@/lib/types";

type Source = "all" | "comment" | "mention";

export default function VisitorsPage() {
  // 처음엔 DB 에 쌓인 목록만 빠르게 보여주고, 동기화는 버튼(또는 비어 있을 때 자동)으로 합니다.
  const [refresh, setRefresh] = useState(false);
  const [nonce, setNonce] = useState(0);
  const visitors = useApi<ListOf<Visitor>>(`/visitors?refresh=${refresh}&_=${nonce}`);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const autoSynced = useRef(false);

  useEffect(() => {
    if (!autoSynced.current && visitors.data && visitors.data.data.length === 0 && !refresh) {
      autoSynced.current = true;
      setRefresh(true);
    }
  }, [visitors.data, refresh]);

  const sync = () => {
    setRefresh(true);
    setNonce((n) => n + 1);
  };

  const all = visitors.data?.data ?? [];
  const rows = useMemo(() => {
    const q = query.trim().replace(/^@/, "").toLowerCase();
    return all.filter(
      (v) =>
        (source === "all" || v.source === source) &&
        (!q || v.username.toLowerCase().includes(q) || v.last_text.toLowerCase().includes(q)),
    );
  }, [all, query, source]);

  const syncing = visitors.loading && refresh;

  return (
    <>
      <PageHeader
        title="반응한 계정"
        description="내 게시물에 댓글을 달거나 나를 멘션한, 식별 가능한 계정"
        action={
          <Button onClick={sync} loading={syncing}>
            {!syncing && <IconRefresh />} Instagram 에서 동기화
          </Button>
        }
      />

      <div className="mb-6">
        <Notice tone="neutral" title="프로필·게시물을 '본' 계정 목록은 확인할 수 없습니다">
          Instagram(Meta)은 개인정보 보호 정책상 조회한 개별 계정을 어떤 API 로도 공개하지 않고, 도달·조회 같은 집계 수치만
          제공합니다. 이 목록은 최근 게시물 12개의 댓글 작성자와 나를 태그·멘션한 계정으로, 실제로 흔적을 남긴 사용자입니다.
        </Notice>
      </div>

      {visitors.error && (
        <div className="mb-6">
          <Notice tone="bad" title="동기화하지 못했습니다">
            {visitors.error.message}
          </Notice>
        </div>
      )}

      <Card
        title={
          <span>
            계정 <span className="tnum text-fg-3">{fmtInt(all.length)}</span>
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="사용자명·내용 검색"
              className={`${inputClass} h-8 w-48 py-1 text-[13px]`}
            />
            <Segmented
              size="sm"
              ariaLabel="유형"
              value={source}
              onChange={setSource}
              options={[
                { value: "all", label: "전체" },
                { value: "comment", label: "댓글" },
                { value: "mention", label: "멘션" },
              ]}
            />
          </div>
        }
        bodyClassName="px-0 pb-0"
      >
        {visitors.loading && !visitors.data ? (
          <div className="space-y-2 px-5 pb-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 pb-5">
            <Empty title={all.length ? "조건에 맞는 계정이 없습니다" : syncing ? "동기화 중…" : "아직 반응한 계정이 없습니다"}>
              {!all.length && !syncing && "게시물에 댓글이 달리면 여기에 표시됩니다."}
            </Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-y border-line text-left text-fg-3">
                <tr>
                  <th className="px-5 py-2.5 font-medium">계정</th>
                  <th className="px-3 py-2.5 font-medium">유형</th>
                  <th className="px-3 py-2.5 text-right font-medium">상호작용</th>
                  <th className="px-3 py-2.5 font-medium">최근 내용</th>
                  <th className="px-5 py-2.5 text-right font-medium">최근 활동</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.username} className="border-b border-line last:border-0 hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <a href={v.profile_url} target="_blank" rel="noreferrer" className="group flex items-center gap-2.5">
                        <Avatar name={v.username} size={30} />
                        <span className="font-medium group-hover:underline">@{v.username}</span>
                        <IconExternal className="text-fg-3" />
                      </a>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={v.source === "mention" ? "accent" : "neutral"}>{v.source === "mention" ? "멘션" : "댓글"}</Badge>
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-medium">{fmtInt(v.interactions)}</td>
                    <td className="max-w-[340px] px-3 py-2.5">
                      <p className="truncate text-fg-2" title={v.last_text}>
                        {v.last_text || "—"}
                      </p>
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap text-fg-3">{fmtRelative(v.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <MentionsCard />
        <DmContactsCard />
      </div>
    </>
  );
}

function MentionsCard() {
  const mentions = useApi<ListOf<TaggedMedia>>("/mentions");
  const rows = mentions.data?.data ?? [];
  return (
    <Card title="나를 태그한 게시물" subtitle="다른 계정이 게시물에서 나를 태그한 경우">
      {mentions.loading && !mentions.data ? (
        <Skeleton className="h-24" />
      ) : mentions.error ? (
        <Notice tone="bad">{mentions.error.message}</Notice>
      ) : rows.length === 0 ? (
        <Empty title="아직 태그된 게시물이 없습니다" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              {m.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.media_url} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
              ) : (
                <span className="size-10 shrink-0 rounded-md bg-surface-2" />
              )}
              <div className="min-w-0 flex-1">
                <a href={`https://www.instagram.com/${m.username}/`} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:underline">
                  @{m.username}
                </a>
                <p className="truncate text-[12px] text-fg-3">{m.caption || "(캡션 없음)"}</p>
              </div>
              <div className="shrink-0 text-right">
                <a href={m.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-fg-2 hover:underline">
                  게시물 <IconExternal width={12} height={12} />
                </a>
                <p className="text-[11px] text-fg-3">{fmtRelative(m.timestamp)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DmContactsCard() {
  const contacts = useApi<ListOf<DmContact>>("/dm-contacts");
  const rows = contacts.data?.data ?? [];
  return (
    <Card title="DM 대화 상대" subtitle="나에게 DM을 보낸 계정 — 팔로우 여부까지 확인됩니다">
      {contacts.loading && !contacts.data ? (
        <Skeleton className="h-24" />
      ) : contacts.error ? (
        <Notice tone="bad">{contacts.error.message}</Notice>
      ) : rows.length === 0 ? (
        <Empty title="조회된 대화가 없습니다">{contacts.data?.note}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              <Avatar src={c.profile_pic} name={c.username || c.name || "?"} size={36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[13px] font-medium">
                  <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="truncate hover:underline">
                    @{c.username || "알 수 없음"}
                  </a>
                  {c.is_verified_user && <Badge tone="accent">인증</Badge>}
                </p>
                <p className="truncate text-[12px] text-fg-3">
                  {c.name} · 팔로워 {fmtInt(c.follower_count ?? null)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={c.is_user_follow_business ? "good" : "neutral"}>
                  {c.is_user_follow_business ? "나를 팔로우" : "팔로우 안 함"}
                </Badge>
                {c.is_business_follow_user && <span className="text-[11px] text-fg-3">내가 팔로우 중</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
