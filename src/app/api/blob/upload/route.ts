import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

/** 동영상·음원은 Vercel 함수의 요청 크기 제한(4.5MB)을 넘으므로, 브라우저가 Blob 저장소에 직접 올리도록
 *  짧게 쓰는 업로드 토큰만 여기서 발급합니다. 로그인한 사용자에게만. */
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const AUDIO_TYPES = ["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave"];

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // 백엔드 세션 확인 (같은 쿠키로 /auth/me 호출)
        const me = await fetch(new URL("/api/py/auth/me", request.url), {
          headers: { cookie: request.headers.get("cookie") ?? "" },
          cache: "no-store",
        });
        if (!me.ok) throw new Error("login required");
        const account = (await me.json()) as { id: number };
        const audio = pathname.startsWith("audio/");
        if (!audio && !pathname.startsWith("videos/")) throw new Error("invalid path");
        return {
          allowedContentTypes: audio ? AUDIO_TYPES : ["video/mp4", "video/quicktime", "video/x-m4v"],
          maximumSizeInBytes: audio ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES,
          addRandomSuffix: true, // 주소를 추측할 수 없게
          tokenPayload: JSON.stringify({ accountId: account.id }),
        };
      },
      // 업로드 완료는 브라우저가 백엔드에 직접 등록합니다 (/media/videos, /media/audio).
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
