/// <reference lib="webworker" />
/** 브라우저 안에서 도는 CLIP (이미지·영어 문장 → 같은 공간의 벡터). 사진은 기기 밖으로 나가지 않습니다.
 *  모델은 처음 한 번 Hugging Face 에서 내려받고(약 150MB) 브라우저가 캐시합니다. */
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env,
  RawImage,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";

const MODEL = "Xenova/clip-vit-base-patch32";
env.allowLocalModels = false;

type Req = { id: number; type: "image"; blob: Blob } | { id: number; type: "text"; texts: string[] };

let vision: Promise<{ model: PreTrainedModel; processor: Processor }> | null = null;
let text: Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer }> | null = null;

const device = async () => ((self.navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm") as "webgpu" | "wasm";
const progress = (p: { status?: string; progress?: number; file?: string }) => {
  if (p.status === "progress" && typeof p.progress === "number") {
    (self as unknown as Worker).postMessage({ type: "download", file: p.file, progress: p.progress });
  }
};

function loadVision() {
  vision ??= (async () => {
    const opts = { dtype: "q8" as const, device: await device(), progress_callback: progress };
    const [model, processor] = await Promise.all([
      CLIPVisionModelWithProjection.from_pretrained(MODEL, opts).catch(() =>
        CLIPVisionModelWithProjection.from_pretrained(MODEL, { ...opts, device: "wasm" }),
      ),
      AutoProcessor.from_pretrained(MODEL),
    ]);
    return { model, processor };
  })();
  return vision;
}

function loadText() {
  text ??= (async () => {
    const opts = { dtype: "q8" as const, device: await device(), progress_callback: progress };
    const [model, tokenizer] = await Promise.all([
      CLIPTextModelWithProjection.from_pretrained(MODEL, opts).catch(() =>
        CLIPTextModelWithProjection.from_pretrained(MODEL, { ...opts, device: "wasm" }),
      ),
      AutoTokenizer.from_pretrained(MODEL),
    ]);
    return { model, tokenizer };
  })();
  return text;
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data;
  try {
    if (req.type === "image") {
      const { model, processor } = await loadVision();
      const image = await RawImage.fromBlob(req.blob);
      const inputs = await processor(image);
      const { image_embeds } = await model(inputs);
      const emb = normalize(new Float32Array(image_embeds.data as Float32Array));
      (self as unknown as Worker).postMessage({ id: req.id, emb }, [emb.buffer]);
    } else {
      const { model, tokenizer } = await loadText();
      const inputs = tokenizer(req.texts, { padding: true, truncation: true });
      const { text_embeds } = await model(inputs);
      const dim = text_embeds.dims[1];
      const data = text_embeds.data as Float32Array;
      const embs = req.texts.map((_, i) => normalize(new Float32Array(data.slice(i * dim, (i + 1) * dim))));
      (self as unknown as Worker).postMessage({ id: req.id, embs });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
