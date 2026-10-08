/** 아이폰 사진(HEIC/HEIF): 사파리 말고는 브라우저가 읽지 못해서, 필요할 때만 변환기(libheif, 약 3MB)를 불러 JPEG 로 바꿉니다.
 *  윈도우·크롬은 HEIC 의 파일 종류를 비워 주기도 해서 확장자로도 알아봅니다. */

export const isHeicFile = (f: File | Blob) =>
  /image\/hei[cf]/i.test(f.type) || ("name" in f && /\.(heic|heif)$/i.test((f as File).name));

/** 이 브라우저가 바로 읽을 수 있는 이미지로 (HEIC 가 아니면 그대로) */
export async function toBrowserImage(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;
  // 사파리는 HEIC 를 그대로 읽음 — 읽히면 변환하지 않음
  try {
    (await createImageBitmap(file)).close();
    return file;
  } catch {
    // 아래에서 변환
  }
  const { heicTo } = await import("heic-to/next");
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
  return new File([jpeg], file.name.replace(/\.(heic|heif)$/i, "") + ".jpg", { type: "image/jpeg" });
}
