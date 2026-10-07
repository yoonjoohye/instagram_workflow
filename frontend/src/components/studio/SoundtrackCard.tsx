"use client";

/** 음악 넣어 영상으로: 사진에 음악을 입혀 피드는 릴스, 스토리는 동영상 스토리로. 빼면 다시 사진으로. */

import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { Button, Card, Notice } from "@/components/ui";
import { api, toApiError } from "@/lib/api";
import type { Job, MusicSource } from "@/lib/types";
import { emptyMusic, hasMusic, MusicPicker, useMusicLabel } from "./MusicPicker";

/** 저장된 설정으로 영상을 다시 만듭니다 (게시 전 사진이 바뀌었을 때도 사용). */
export const buildSoundtrack = (jobId: number, music: MusicSource, seconds: number) =>
  api<Job>(`/studio/${jobId}/soundtrack`, {
    method: "PUT",
    json: { track: music.track, audio_id: music.audio_id, offset: music.offset, volume: music.volume, seconds },
  });

export function SoundtrackCard({ job, locked, onChange }: { job: Job; locked: boolean; onChange: (j: Job) => void }) {
  const t = useT();
  const label = useMusicLabel();
  const story = job.media_kind === "STORIES";
  const saved = job.soundtrack;
  const [music, setMusic] = useState<MusicSource>(saved ?? emptyMusic());
  const [seconds, setSeconds] = useState(saved?.seconds ?? (story ? 5 : 3));
  const [busy, setBusy] = useState<"build" | "remove">();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setMusic(job.soundtrack ?? emptyMusic());
    setSeconds(job.soundtrack?.seconds ?? (story ? 5 : 3));
  }, [job.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const images = job.assets.filter((a) => a.type === "image").length;
  const hasVideo = job.assets.some((a) => a.type === "video");
  const changed =
    !saved ||
    saved.track !== music.track ||
    saved.audio_id !== music.audio_id ||
    saved.offset !== music.offset ||
    saved.volume !== music.volume ||
    saved.seconds !== seconds;

  async function run(kind: "build" | "remove") {
    setBusy(kind);
    setError(undefined);
    try {
      onChange(
        kind === "build"
          ? await buildSoundtrack(job.id, music, seconds)
          : await api<Job>(`/studio/${job.id}/soundtrack`, { method: "DELETE" }),
      );
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(undefined);
    }
  }

  if (!story && hasVideo) {
    return (
      <Card title={t("media.title")}>
        <p className="text-[13px] text-fg-3">{t("media.mixedVideo")}</p>
      </Card>
    );
  }

  return (
    <Card title={t("media.title")} subtitle={story ? t("media.subtitleStory") : t("media.subtitleFeed")}>
      <div className="space-y-4">
        {saved && (
          <Notice tone={saved.stale ? "warn" : "good"} title={t("media.ready", { name: label(saved) })}>
            {saved.stale
              ? t("media.stale")
              : story
                ? t("media.readyStory", { n: saved.outputs.length, s: saved.seconds })
                : t("media.readyFeed", { n: images, s: Math.round(images * saved.seconds) })}
          </Notice>
        )}

        {!locked && (
          <>
            <MusicPicker value={music} onChange={setMusic} disabled={!!busy} />
            <label className="block max-w-sm text-[12px] text-fg-2">
              <span className="flex items-center justify-between">
                {t("media.perPhoto")} <span className="tnum text-fg-3">{t("media.sec", { n: seconds })}</span>
              </span>
              <input
                type="range"
                min={2}
                max={story ? 15 : 8}
                step={0.5}
                value={seconds}
                disabled={!!busy}
                onChange={(e) => setSeconds(Number(e.target.value))}
                className="mt-1 w-full accent-[var(--accent)]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => run("build")}
                loading={busy === "build"}
                disabled={!!busy || !hasMusic(music) || (!changed && !saved?.stale)}
              >
                {busy === "build" ? t("media.building") : saved ? t("media.rebuild") : t("media.build")}
              </Button>
              {saved && (
                <Button onClick={() => run("remove")} loading={busy === "remove"} disabled={!!busy}>
                  {t("media.remove")}
                </Button>
              )}
            </div>
          </>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
        <p className="text-[12px] leading-relaxed text-fg-3">{t("media.igNote")}</p>
      </div>
    </Card>
  );
}
