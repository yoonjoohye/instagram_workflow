"use client";

import { useEffect, useRef, useState } from "react";
import { api, toApiError } from "@/lib/api";
import type { Job } from "@/lib/types";
import { IconSpark } from "./icons";
import { Badge, Button, Card, cx, Field, inputClass, Notice } from "./ui";

const MAX_PHOTOS = 8; // 표지 + 사진 8장 + 결론 = 캐러셀 최대 10장
const TONES = ["친근한", "전문적인", "감성적인", "유머러스한", "정보 전달형"];
const DEFAULT_FORMAT = `[후킹 한 줄]

[핵심 내용 3~5줄, 줄마다 이모지로 시작]

[마무리 한 줄 + 저장/공유 유도]`;

type Photo = { key: string; file: File; preview: string };
type Step = { label: string; done: number; total: number };

/** 브라우저에서 긴 변 1600px JPEG 로 줄여 올립니다 (Vercel 요청 크기 제한 대비, 업로드도 빨라짐). */
async function shrink(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 변환하지 못했습니다."))), "image/jpeg", 0.88),
  );
}

async function uploadPhoto(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", await shrink(file), file.name.replace(/\.\w+$/, "") + ".jpg");
  const res = await fetch("/api/py/media/uploads", { method: "POST", body, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || `업로드 실패 (${res.status})`);
  return data.id as string;
}

export function CardNewsForm({ onCreated }: { onCreated: (job: Job) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("친근한");
  const [style, setStyle] = useState("");
  const [format, setFormat] = useState("");
  const [accent, setAccent] = useState("#6c5ce7");
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = step !== null;

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function addFiles(list: FileList | File[]) {
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => {
      const room = MAX_PHOTOS - prev.length;
      if (images.length > room) setError(`사진은 최대 ${MAX_PHOTOS}장까지 올릴 수 있어요.`);
      return [
        ...prev,
        ...images.slice(0, Math.max(0, room)).map((file) => ({
          key: `${file.name}-${file.size}-${Math.random()}`,
          file,
          preview: URL.createObjectURL(file),
        })),
      ];
    });
  }

  const move = (i: number, d: -1 | 1) =>
    setPhotos((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) =>
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, k) => k !== i);
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photos.length) return setError("사진을 1장 이상 올려 주세요.");
    if (prompt.trim().length < 2) return setError("주제를 입력해 주세요.");
    setError(undefined);
    try {
      const ids: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setStep({ label: "사진 올리는 중", done: i, total: photos.length });
        ids.push(await uploadPhoto(photos[i].file));
      }
      setStep({ label: "Gemini가 사진을 보고 구성을 짜는 중", done: 0, total: 1 });
      const plan = await api<{ job: Job; slides: { role: string }[]; warning: string }>("/cardnews/plan", {
        method: "POST",
        json: { upload_ids: ids, prompt: prompt.trim(), tone, style, caption_format: format, accent },
      });
      const total = plan.slides.length;
      for (let i = 0; i < total; i++) {
        const role = plan.slides[i].role;
        setStep({ label: role === "cover" ? "표지 만드는 중" : role === "conclusion" ? "결론 만드는 중" : "내용 슬라이드 만드는 중", done: i, total });
        try {
          await api(`/cardnews/${plan.job.id}/slides/${i}`, { method: "POST", json: {} });
        } catch {
          await api(`/cardnews/${plan.job.id}/slides/${i}`, { method: "POST", json: {} }); // 한 번 재시도
        }
      }
      setStep({ label: "마무리하는 중", done: total, total });
      onCreated(await api<Job>(`/cardnews/${plan.job.id}/finalize`, { method: "POST" }));
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setStep(null);
    }
  }

  return (
    <Card
      title="내 사진으로 카드뉴스"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          표지 → 내용 → 결론 슬라이드와 캡션을 Gemini가 만들어요
          <Badge tone="accent">Gemini</Badge>
        </span>
      }
      className="h-fit"
    >
      <form onSubmit={submit} className="space-y-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cx(
            "rounded-lg border-2 border-dashed p-3 transition-colors",
            dragging ? "border-accent bg-accent/5" : "border-line-strong",
          )}
        >
          {photos.length > 0 && (
            <ol className="mb-3 grid grid-cols-4 gap-2">
              {photos.map((p, i) => (
                <li key={p.key} className="group relative aspect-square overflow-hidden rounded-md bg-surface-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt="" className="size-full object-cover" />
                  <span className="tnum absolute top-1 left-1 rounded bg-black/60 px-1 text-[11px] text-white">{i + 1}</span>
                  {!busy && (
                    <span className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button type="button" onClick={() => move(i, -1)} className="px-1 text-[12px] text-white" aria-label="앞으로">
                        ←
                      </button>
                      <button type="button" onClick={() => remove(i)} className="px-1 text-[12px] text-white" aria-label="삭제">
                        ✕
                      </button>
                      <button type="button" onClick={() => move(i, 1)} className="px-1 text-[12px] text-white" aria-label="뒤로">
                        →
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            disabled={busy || photos.length >= MAX_PHOTOS}
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-md py-3 text-[13px] text-fg-2 hover:bg-surface-2 disabled:opacity-50"
          >
            {photos.length ? `+ 사진 추가 (${photos.length}/${MAX_PHOTOS})` : "사진을 끌어다 놓거나 눌러서 선택 (최대 8장)"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <p className="-mt-3 text-[12px] text-fg-3">올린 순서가 기본 순서예요. Gemini가 이야기 흐름에 맞게 다시 배치할 수 있어요.</p>

        <Field label="주제 · 목적" htmlFor="cn-prompt" hint="예) 성수동 카페 투어 추천 3곳 — 주말 데이트 코스로 소개">
          <textarea
            id="cn-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className={cx(inputClass, "resize-y")}
            disabled={busy}
          />
        </Field>

        <Field label="톤">
          <div className="flex flex-wrap gap-1.5">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => setTone(t)}
                className={cx(
                  "rounded-full border px-3 py-1 text-[12px] font-medium",
                  tone === t ? "border-accent bg-accent/10 text-fg" : "border-line-strong text-fg-2 hover:bg-surface-2",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <Field label="사진 AI 편집 방향" htmlFor="cn-style" hint="예) 따뜻한 필름 톤, 배경의 사람·간판 정리, 밝고 선명하게">
          <input id="cn-style" value={style} onChange={(e) => setStyle(e.target.value)} className={inputClass} disabled={busy} />
        </Field>

        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-medium text-fg-2">캡션 형식 · 포인트 색 (선택)</summary>
          <div className="mt-3 space-y-3">
            <Field label="캡션 형식" htmlFor="cn-format" hint="[ ] 안은 Gemini가 채울 자리예요. 비워두면 기본 형식을 씁니다. 해시태그는 자동으로 따로 붙어요.">
              <textarea
                id="cn-format"
                rows={6}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                placeholder={DEFAULT_FORMAT}
                className={cx(inputClass, "resize-y font-mono text-[12px]")}
                disabled={busy}
              />
            </Field>
            <label className="flex items-center gap-3 text-[13px] text-fg-2">
              포인트 색
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-line" disabled={busy} />
              <span className="tnum text-fg-3">{accent}</span>
            </label>
          </div>
        </details>

        {error && <Notice tone="bad">{error}</Notice>}

        {step ? (
          <div className="space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="font-medium">{step.label}…</span>
              <span className="tnum text-fg-3">
                {step.done}/{step.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(step.done / Math.max(step.total, 1)) * 100}%` }} />
            </div>
            <p className="text-[12px] text-fg-3">사진 AI 편집은 장당 10~30초 걸려요. 창을 닫지 마세요.</p>
          </div>
        ) : (
          <Button type="submit" variant="primary" className="w-full" disabled={!photos.length}>
            <IconSpark width={16} height={16} /> 카드뉴스 만들기
          </Button>
        )}
      </form>
    </Card>
  );
}
