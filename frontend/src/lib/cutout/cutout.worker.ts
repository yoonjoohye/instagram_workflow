/// <reference lib="webworker" />
/** 브라우저 안에서 도는 배경 지우기(누끼). 사진은 기기 밖으로 나가지 않습니다.
 *  모델: ormbg (Apache-2.0, ISNet 기반 — 사람·음식·물건 모두). 양자화본 약 44MB 를 처음 한 번 내려받고 브라우저가 캐시합니다.
 *  CPU(wasm)로만 돌립니다 — WebGPU 는 기기 한도(셰이더 버퍼 수)에 걸려 실패하는 기기가 많아서.
 *  결과: 원본 크기 그대로, 배경이 투명한 PNG. */
import { env, pipeline, RawImage, type BackgroundRemovalPipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/ormbg-ONNX";
env.allowLocalModels = false;

let loaded: Promise<BackgroundRemovalPipeline> | null = null;

const progress = (p: { status?: string; progress?: number; file?: string }) => {
  if (p.status === "progress" && typeof p.progress === "number" && p.file?.endsWith(".onnx")) {
    (self as unknown as Worker).postMessage({ type: "download", progress: p.progress });
  }
};

function load() {
  loaded ??= (pipeline("background-removal", MODEL, { dtype: "q8", device: "wasm", progress_callback: progress }) as Promise<BackgroundRemovalPipeline>).catch(
    (e) => {
      loaded = null;
      throw e;
    },
  );
  return loaded;
}

self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob }>) => {
  const { id, blob } = e.data;
  try {
    const remove = await load();
    const image = await RawImage.fromBlob(blob);
    const result = (await remove(image)) as RawImage | RawImage[];
    const out = Array.isArray(result) ? result[0] : result;
    const rgba = out.channels === 4 ? out : out.rgba();
    const px = new Uint8ClampedArray(rgba.data);
    // 가장자리 정리: 아주 옅게 남은 배경(그림자·탁자 얼룩)은 지우고, 거의 불투명한 곳은 또렷하게
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i];
      px[i] = a < 40 ? 0 : a > 225 ? 255 : Math.round(((a - 40) / 185) * 255);
    }
    const canvas = new OffscreenCanvas(rgba.width, rgba.height);
    canvas.getContext("2d")!.putImageData(new ImageData(px, rgba.width, rgba.height), 0, 0);
    (self as unknown as Worker).postMessage({ id, blob: await canvas.convertToBlob({ type: "image/png" }) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
