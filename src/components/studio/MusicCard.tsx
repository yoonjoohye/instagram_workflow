"use client";

import { useState } from "react";
import { IconExternal } from "@/components/icons";
import { useI18n } from "@/i18n/client";
import { Button, Card, cx, inputClass, Notice } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import type { Job, MusicPick } from "@/lib/types";

/** 인스타 음악 추천·선택. API 로는 붙일 수 없어 게시 후 인스타 앱에서 추가하도록 안내합니다. */
export function MusicCard({ job, locked, onChange }: { job: Job; locked: boolean; onChange: (j: Job) => void }) {
  const { t, locale } = useI18n();
  const music = job.music ?? { suggestions: [], selected: null };
  const [hint, setHint] = useState("");
  const [custom, setCustom] = useState({ title: "", artist: "" });
  const [showCustom, setShowCustom] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const selected = music.selected;
  const same = (a: MusicPick | null, b: MusicPick | null) => !!a && !!b && a.title === b.title && a.artist === b.artist;
  const label = (m: MusicPick) => (m.artist ? `${m.title} - ${m.artist}` : m.title);
  const listenUrl = (m: MusicPick) => `https://www.youtube.com/results?search_query=${encodeURIComponent(label(m))}`;

  async function run(key: string, fn: () => Promise<Job>) {
    setBusy(key);
    setError(undefined);
    try {
      onChange(await fn());
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }
  const pick = (m: MusicPick | null) =>
    run("pick", () => api<Job>(`/studio/${job.id}/music`, { method: "PUT", json: { selected: m } }));
  const resuggest = () =>
    run("suggest", () => api<Job>(`/studio/${job.id}/music/suggest`, { method: "POST", json: { hint, language: locale } }));

  async function copy() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(label(selected));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 권한이 없으면 무시 */
    }
  }

  return (
    <Card title={t("studio.musicTitle")} subtitle={t("studio.musicSubtitle")}>
      <div className="space-y-4">
        {/* 선택한 곡 */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5">
          <span className="text-lg" aria-hidden>
            ♪
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-fg-3">{t("studio.musicSelected")}</p>
            <p className="truncate text-[14px] font-semibold">{selected ? label(selected) : t("studio.musicNone")}</p>
            {selected?.section && <p className="text-[12px] text-fg-3">{t("studio.musicSection", { s: selected.section })}</p>}
          </div>
          {selected && (
            <div className="flex items-center gap-1">
              <a
                href={listenUrl(selected)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-fg-2 hover:bg-surface-2"
              >
                {t("studio.musicListen")} <IconExternal width={12} height={12} />
              </a>
              <Button size="sm" variant="ghost" onClick={copy}>
                {copied ? t("studio.musicCopied") : t("studio.musicCopy")}
              </Button>
            </div>
          )}
        </div>

        {/* 추천 목록 */}
        {music.suggestions.length === 0 ? (
          <p className="text-[12px] text-fg-3">{t("studio.musicEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {music.suggestions.map((m) => {
              const on = same(m, selected);
              return (
                <li key={label(m)} className="flex items-start gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">
                      {m.title} <span className="font-normal text-fg-3">· {m.artist}</span>
                    </p>
                    {m.reason && <p className="mt-0.5 text-[12px] text-fg-2">{m.reason}</p>}
                    {m.section && <p className="text-[11px] text-fg-3">{t("studio.musicSection", { s: m.section })}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <a
                      href={listenUrl(m)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${t("studio.musicListen")}: ${label(m)}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-2 hover:text-fg"
                    >
                      ▶
                    </a>
                    <Button size="sm" variant={on ? "primary" : "secondary"} disabled={locked || on || !!busy} onClick={() => pick(m)}>
                      {on ? "✓" : t("studio.musicPick")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!locked && (
          <>
            {/* 분위기를 적어 다시 추천 */}
            <div className="flex flex-wrap gap-2">
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder={t("studio.musicHintPh")}
                className={cx(inputClass, "min-w-0 flex-1 basis-56")}
                maxLength={300}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), resuggest())}
              />
              <Button onClick={resuggest} loading={busy === "suggest"} disabled={!!busy}>
                {t("studio.musicResuggest")}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <button type="button" className="text-fg-2 underline-offset-2 hover:underline" onClick={() => setShowCustom((v) => !v)}>
                {t("studio.musicCustom")}
              </button>
              {selected && (
                <button type="button" className="text-fg-3 underline-offset-2 hover:underline" disabled={!!busy} onClick={() => pick(null)}>
                  {t("studio.musicNone")}
                </button>
              )}
            </div>
            {showCustom && (
              <div className="flex flex-wrap gap-2">
                <input
                  value={custom.title}
                  onChange={(e) => setCustom({ ...custom, title: e.target.value })}
                  placeholder={t("studio.musicTitlePh")}
                  className={cx(inputClass, "min-w-0 flex-1 basis-40")}
                  maxLength={120}
                />
                <input
                  value={custom.artist}
                  onChange={(e) => setCustom({ ...custom, artist: e.target.value })}
                  placeholder={t("studio.musicArtistPh")}
                  className={cx(inputClass, "min-w-0 flex-1 basis-32")}
                  maxLength={120}
                />
                <Button
                  onClick={() => pick({ title: custom.title.trim(), artist: custom.artist.trim() })}
                  disabled={!custom.title.trim() || !!busy}
                  loading={busy === "pick"}
                >
                  {t("studio.musicApply")}
                </Button>
              </div>
            )}
          </>
        )}

        {error && <Notice tone="bad">{error}</Notice>}
        <p className="text-[12px] leading-relaxed text-fg-3">{t("studio.musicHowTo")}</p>
      </div>
    </Card>
  );
}
