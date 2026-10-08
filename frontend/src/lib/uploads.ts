/** 업로드 준비: 사진은 브라우저에서 줄여 올리고(Vercel 4.5MB 요청 제한), 동영상은 대표 화면을 뽑습니다. */

import type { T } from "@/i18n/core";

/** 브라우저에서 긴 변 2048px JPEG 로 줄여 올립니다 (Vercel 4.5MB 요청 제한 대비, 업로드도 빨라짐).
 *  인스타는 가로 1080 으로 보여 주므로 9:16 세로 사진도 가로 1080 이상이 남게 2048. 서버는 다시 압축하지 않고 그대로 보관. */
export async function shrink(file: File, t: T, maxSide = 2048): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("studio.convertFailed")))), "image/jpeg", 0.92),
  );
}

export async function uploadImageBlob(image: Blob, name: string, t: T): Promise<string> {
  const body = new FormData();
  body.append("file", image, name.replace(/\.\w+$/, "") + ".jpg");
  const res = await fetch("/api/py/media/uploads", { method: "POST", body, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || t("studio.uploadFailed", { status: res.status }));
  return data.id as string;
}

export async function uploadPhoto(file: File, t: T): Promise<string> {
  return uploadImageBlob(await shrink(file, t), file.name, t);
}

/** 동영상에서 대표 화면 한 장을 JPEG 로 뽑습니다 (Gemini 가 장면을 보고 캡션을 쓰고, 릴스 커버로도 씀). */
export function captureCover(file: File, t: T): Promise<{ image: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const src = URL.createObjectURL(file);
    const fail = () => {
      URL.revokeObjectURL(src);
      reject(new Error(t("studio.videoCoverFailed")));
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onerror = fail;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 3); // 첫 프레임이 검은 화면인 경우가 많아 조금 뒤로
    };
    video.onseeked = () => {
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(src);
          if (b) resolve({ image: b, width: video.videoWidth, height: video.videoHeight });
          else fail();
        },
        "image/jpeg",
        0.88,
      );
    };
    video.src = src;
    video.load();
  });
}
