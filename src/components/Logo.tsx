/** 서비스 로고 — 파비콘(src/app/icon.png)과 같은 이미지를 씁니다. */
export function Logo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={["shrink-0 rounded-[22%]", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    />
  );
}
