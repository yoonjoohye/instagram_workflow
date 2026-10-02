import type { MetadataRoute } from "next";

/** 휴대폰 홈 화면에 추가했을 때 앱처럼 열리게 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Instagram Auto Studio",
    short_name: "Auto Studio",
    description: "Create Instagram posts from your photos and topic, auto-reply to comments and see insights.",
    start_url: "/admin",
    display: "standalone",
    background_color: "#121211",
    theme_color: "#121211",
    icons: [
      { src: "/icon.png", sizes: "256x256", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
