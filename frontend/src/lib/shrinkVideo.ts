/** 올리기 전에 동영상을 인스타그램 크기로 줄입니다 (브라우저 안에서, 기기의 하드웨어 인코더로 — WebCodecs).
 *  휴대폰 영상은 4K·60fps 처럼 인스타그램이 보여 주는 것(최대 1080×1920·30fps)보다 몇 배 커서 올리는 데 오래 걸립니다.
 *  이미 작거나, 이 브라우저가 변환을 못 하거나, 줄여도 별로 작아지지 않으면 원본을 그대로 돌려줍니다. */

const LONG_SIDE = 1920;
const MAX_FPS = 30;
const VIDEO_BITRATE = 8_000_000; // 1080p·30fps 에 넉넉한 값 (인스타그램 권장 이하)
const KEEP_BITRATE = 12_000_000; // 이보다 낮고 크기·fps 도 맞으면 그대로 올림

export async function shrinkVideo(file: File, onProgress: (pct: number) => void): Promise<File> {
  if (typeof window === "undefined" || !("VideoEncoder" in window) || !("VideoDecoder" in window)) return file;
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    if (!video) return file;
    const duration = await input.computeDuration();
    const stats = await video.computePacketStats(120);
    const w = video.displayWidth;
    const h = video.displayHeight;
    const long = Math.max(w, h);
    const fps = stats.averagePacketRate || 30;
    const bitrate = duration > 0 ? (file.size * 8) / duration : Infinity;
    if (long <= LONG_SIDE && fps <= MAX_FPS + 1 && bitrate <= KEEP_BITRATE) return file;
    if (!(await mb.canEncodeVideo("avc", { width: 1080, height: 1920, bitrate: VIDEO_BITRATE }))) return file;

    const scale = Math.min(1, LONG_SIDE / long);
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { width: even(w * scale), height: even(h * scale), fit: "contain", codec: "avc", bitrate: VIDEO_BITRATE, frameRate: Math.min(fps, MAX_FPS) },
      audio: { codec: "aac", bitrate: 128_000 },
      showWarnings: false,
    });
    if (!conversion.isValid) return file;
    conversion.onProgress = (p) => onProgress(Math.round(p * 100));
    await conversion.execute();
    const buf = output.target.buffer;
    // 줄여도 크게 작아지지 않으면 화질을 지키려고 원본
    if (!buf || buf.byteLength > file.size * 0.85) return file;
    return new File([buf], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4" });
  } catch {
    return file; // 변환하지 못하는 형식·기기 — 원본을 그대로 올림
  }
}
