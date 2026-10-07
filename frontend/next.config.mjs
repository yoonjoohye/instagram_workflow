import path from "node:path";
import nextEnv from "@next/env";

// 환경변수는 저장소 맨 위의 .env / .env.local 하나를 백엔드와 함께 씁니다 (Vercel 에서는 대시보드 값이 우선).
// Next 가 frontend/ 의 env 를 먼저 읽어 두므로 forceReload 로 다시 읽습니다 (frontend/ 에는 .env 를 두지 않음).
nextEnv.loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // 로컬 rewrite 프록시 기본 타임아웃(30초)이면 영상 생성·발행 대기 중에 끊깁니다.
  experimental: { proxyTimeout: 180_000 },
  // 로컬에서 실제 Instagram 로그인을 테스트할 때 쓰는 HTTPS 터널(cloudflared) 주소 허용
  allowedDevOrigins: ["*.trycloudflare.com"],
  // 개발 모드 표시(N 버튼)가 휴대폰 하단 탭바를 가리지 않게
  devIndicators: false,
  // 공유 미리보기 이미지가 읽는 파일을 배포에 포함
  outputFileTracingIncludes: {
    "/opengraph-image": ["./src/app/_og/**", "./public/logo.png"],
    "/twitter-image": ["./src/app/_og/**", "./public/logo.png"],
  },
  async rewrites() {
    // 프로덕션(Vercel)에서는 vercel.json 의 rewrite 가 처리합니다.
    // 로컬에서는 별도로 띄운 uvicorn(8000) 으로 넘깁니다.
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/api/py/:path*", destination: "http://127.0.0.1:8000/:path*" }];
  },
};

export default nextConfig;
