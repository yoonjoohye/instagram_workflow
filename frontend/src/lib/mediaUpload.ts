/** 사진·동영상 올리기 (만들기 화면·작업 공간 공통).
 *  - 사진: 줄여서 서버(/media/uploads)로
 *  - 동영상: 대표 화면은 사진처럼, 영상은 인스타그램 크기로 줄인 뒤(shrinkVideo) Blob 저장소에 직접 올리고 서버에 등록
 *    (Vercel 함수 4.5MB 제한을 피하려고) */

import { upload as blobUpload } from "@vercel/blob/client";
import type { T } from "@/i18n/core";
import { api } from "@/lib/api";
import { startBackgroundUpload } from "@/lib/localMedia";
import { shrinkVideo } from "@/lib/shrinkVideo";
import { captureCover, uploadImageBlob, uploadPhoto } from "@/lib/uploads";

export const MAX_VIDEO_MB = 300;
/** 올리기 진행: pct 는 동영상을 올린 정도(0~100) */
export type UploadStep = { label: string; done: number; total: number; pct?: number };

export const isMedia = (f: File) => f.type.startsWith("image/") || f.type.startsWith("video/");
export const tooBig = (f: File) => f.type.startsWith("video/") && f.size > MAX_VIDEO_MB * 1024 * 1024;

async function uploadVideo(original: File, t: T, onStep: (s: UploadStep) => void, index: number, total: number): Promise<string> {
  onStep({ label: t("studio.stepCover"), done: index, total });
  const cover = await captureCover(original, t);
  const coverId = await uploadImageBlob(cover.image, original.name, t);
  // 빠른 길: 주소를 먼저 정해 등록하고 바로 돌아감 (편집은 기기 안의 파일로 바로), 줄이기·올리기는 뒤에서
  const ext = original.name.split(".").pop()?.toLowerCase();
  try {
    const r = await api<{ id: string; url: string; pathname: string }>("/media/videos/reserve", {
      method: "POST",
      json: { cover_id: coverId, width: cover.width, height: cover.height, ext: ext === "mov" || ext === "m4v" ? ext : "mp4" },
    });
    startBackgroundUpload(r.url, original, async (onPct) => {
      const file = await shrinkVideo(original, (pct) => onPct(Math.round(pct * 0.3)));
      await blobUpload(r.pathname, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        clientPayload: "reserved",
        contentType: file.type || "video/mp4",
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => onPct(30 + Math.round(percentage * 0.7)),
      });
    });
    return r.id;
  } catch {
    // 저장소 설정이 없는 곳(로컬 등)은 예전처럼 다 올린 뒤에
  }
  // 큰 영상은 인스타그램 크기로 줄여서 올림 (올리는 시간이 몇 배 짧아짐)
  const file = await shrinkVideo(original, (pct) => onStep({ label: t("studio.stepShrinkVideo", { pct }), done: index, total, pct }));
  let url: string;
  try {
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const blob = await blobUpload(`videos/${Date.now()}.${ext}`, file, {
      access: "public",
      handleUploadUrl: "/api/blob/upload",
      multipart: file.size > 20 * 1024 * 1024,
      onUploadProgress: ({ percentage }) =>
        onStep({ label: t("studio.stepUploadVideo", { pct: Math.round(percentage) }), done: index, total, pct: Math.round(percentage) }),
    });
    url = blob.url;
  } catch (err) {
    throw new Error(t("studio.videoUploadFailed", { e: err instanceof Error ? err.message : String(err) }));
  }
  const video = await api<{ id: string }>("/media/videos", {
    method: "POST",
    json: { url, cover_id: coverId, width: cover.width, height: cover.height, content_type: file.type || "video/mp4" },
  });
  return video.id;
}

/** 파일들을 순서대로 올리고 업로드 id 목록을 돌려줍니다. */
export async function uploadMedia(files: File[], t: T, onStep: (s: UploadStep) => void): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith("video/")) {
      ids.push(await uploadVideo(file, t, onStep, i, files.length));
      continue;
    }
    onStep({ label: t("studio.stepUploadPhotos"), done: i, total: files.length });
    ids.push(await uploadPhoto(file, t));
  }
  return ids;
}
