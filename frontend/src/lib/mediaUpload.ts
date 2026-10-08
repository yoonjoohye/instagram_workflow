/** 사진·동영상 올리기 (만들기 화면·작업 공간 공통).
 *  - 사진: 줄여서 서버(/media/uploads)로
 *  - 동영상: 대표 화면은 사진처럼, 원본은 Blob 저장소에 직접 올린 뒤 서버에 등록 (Vercel 함수 4.5MB 제한을 피하려고) */

import { upload as blobUpload } from "@vercel/blob/client";
import type { T } from "@/i18n/core";
import { api } from "@/lib/api";
import { captureCover, uploadImageBlob, uploadPhoto } from "@/lib/uploads";

export const MAX_VIDEO_MB = 300;
/** 올리기 진행: pct 는 동영상을 올린 정도(0~100) */
export type UploadStep = { label: string; done: number; total: number; pct?: number };

export const isMedia = (f: File) => f.type.startsWith("image/") || f.type.startsWith("video/");
export const tooBig = (f: File) => f.type.startsWith("video/") && f.size > MAX_VIDEO_MB * 1024 * 1024;

async function uploadVideo(file: File, t: T, onStep: (s: UploadStep) => void, index: number, total: number): Promise<string> {
  onStep({ label: t("studio.stepCover"), done: index, total });
  const cover = await captureCover(file, t);
  const coverId = await uploadImageBlob(cover.image, file.name, t);
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
