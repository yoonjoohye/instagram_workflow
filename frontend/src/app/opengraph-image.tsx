import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// 링크를 공유했을 때 보이는 미리보기 이미지 (카카오톡·슬랙·X·페이스북 등)
export const alt = "Instagram Auto Studio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const dir = path.join(process.cwd(), "src/app/_og");
  const [font, logo] = await Promise.all([
    readFile(path.join(dir, "og-font.otf")),
    readFile(path.join(process.cwd(), "public/logo.png")),
  ]);
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #121211 0%, #1d1530 55%, #3a1638 100%)",
          color: "#fff",
          fontFamily: "Pretendard",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} width={72} height={72} style={{ borderRadius: 16 }} alt="" />
          <div style={{ fontSize: 40 }}>Instagram Auto Studio</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 64, lineHeight: 1.15 }}>AI 인스타그램 게시물 만들기</div>
          <div style={{ fontSize: 34, color: "#d9d4ff" }}>댓글 자동 응답 · 인사이트</div>
          <div style={{ fontSize: 28, color: "#a8a3b8" }}>Create · publish · auto-reply · insights</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Pretendard", data: font, weight: 800, style: "normal" }] },
  );
}
