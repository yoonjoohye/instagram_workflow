"use client";

import { useEffect, useRef, useState } from "react";
import { api, toApiError, useApi } from "@/lib/api";
import type { Job } from "@/lib/types";
import { IconSpark } from "./icons";
import { Badge, Button, Card, cx, Field, inputClass, Notice } from "./ui";

const MAX_PHOTOS = 8; // 올릴 수 있는 사진 수 (게시물은 최대 10장까지 Gemini가 구성)
const MAX_REFS = 3;
const FORMAT_PLACEHOLDER = `비워 두면 주제·연출에 맞게 알아서 써요.
예) 짧고 감성적으로, 장소 이름 넣어서
예) [후킹 2줄]
[핵심 정보 3~5줄, 줄마다 이모지로 시작]`;
const FORMAT_EXAMPLE = `[후킹 3줄]

[스탈링 뱅크 설명]
[스탈링 뱅크 개설하는 법]
[추천인 정보: 코드 ABC123, 가입하고 카드 결제하면 £5 지급]
👉 가입 링크는 프로필에 있어요

[댓글 유도 글 작성]`;

type Research = { notes: string; sources: { title: string; uri: string }[]; warning: string };

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

export function PostForm({ onCreated }: { onCreated: (job: Job) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [refs, setRefs] = useState<Photo[]>([]);
  const [format, setFormat] = useState("");
  const refInput = useRef<HTMLInputElement>(null);
  const [accent, setAccent] = useState("#6c5ce7");
  const [font, setFont] = useState("auto");
  const fonts = useApi<{ data: { key: string; label: string; preview: string }[] }>("/cardnews/fonts");
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

  function addRefs(list: FileList) {
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setRefs((prev) => [
      ...prev,
      ...images.slice(0, Math.max(0, MAX_REFS - prev.length)).map((file) => ({
        key: `${file.name}-${Math.random()}`,
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (prompt.trim().length < 2) return setError("주제를 입력해 주세요.");
    setError(undefined);
    try {
      const ids: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        setStep({ label: "사진 올리는 중", done: i, total: photos.length });
        ids.push(await uploadPhoto(photos[i].file));
      }
      const refIds: string[] = [];
      for (let i = 0; i < refs.length; i++) {
        setStep({ label: "참고 이미지 올리는 중", done: i, total: refs.length });
        refIds.push(await uploadPhoto(refs[i].file));
      }
      setStep({ label: "Gemini가 주제·연출 방향에 맞는 자료를 검색하는 중", done: 0, total: 1 });
      const research = await api<Research>("/cardnews/research", {
        method: "POST",
        json: { prompt: prompt.trim(), caption_format: format, style },
      });
      setStep({ label: "Gemini가 연출 방향대로 구성·이미지·글을 설계하는 중", done: 0, total: 1 });
      const plan = await api<{ job: Job; slides: { role: string }[]; warning: string }>("/cardnews/plan", {
        method: "POST",
        json: {
          upload_ids: ids,
          reference_ids: refIds,
          prompt: prompt.trim(),
          style,
          caption_format: format,
          research_notes: research.notes,
          sources: research.sources,
          accent,
          font,
        },
      });
      const total = plan.slides.length;
      for (let i = 0; i < total; i++) {
        const role = plan.slides[i].role;
        setStep({ label: role === "photo" ? `이미지 ${i + 1}장째 만드는 중` : `이미지 ${i + 1}장째 만들고 글 얹는 중`, done: i, total });
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
      title="사진과 주제로 게시물 만들기"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          주제·컨셉에 맞춰 Gemini가 장수·구성·이미지·캡션을 정해요. 맞는 사진이 없으면 새로 만들어요
          <Badge tone="accent">Gemini</Badge>
        </span>
      }
      className="h-fit"
    >
      <form onSubmit={submit} className="space-y-5">
        <Field label="주제 · 컨셉" htmlFor="cn-prompt" hint="무엇을, 어떤 느낌으로 올릴지 자유롭게 적어 주세요. 이 컨셉을 끝까지 유지해요.">
          <textarea
            id="cn-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={"예) 스탈링 뱅크 개설 방법을 영국 유학생 눈높이로 쉽게 정리\n예) 런던 브런치 카페 감성 기록 — 필름 사진 느낌, 글은 짧게"}
            className={cx(inputClass, "resize-y")}
            disabled={busy}
          />
        </Field>

        <div className="space-y-2">
          <Field
            label="연출 방향"
            htmlFor="cn-style"
            hint="주제와 함께 가장 우선하는 기준이에요 — 이미지와 글 모두 이대로 만들어요. 형식(인스타툰·손글씨 메모·인터뷰·이벤트 포스터 등), 장별 지시, 그림체, 글자 표현, 말투를 자세히 적을수록 정확해져요. 조사 자료는 이 내용을 뒷받침하는 데만 써요."
          >
            <textarea
              id="cn-style"
              rows={6}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder={"예) 인스타툰 웹툰 형식. 귀여운 캐릭터가 말풍선으로 설명하고 파스텔 톤으로.\n첫 장은 배경을 어둡게 하고 후킹 제목 크게.\n두 번째 장부터는 사진 위에 아이패드 손글씨로 동그라미·화살표를 그려 설명.\n말투는 친구한테 알려주듯 반말로."}
              className={cx(inputClass, "resize-y leading-relaxed")}
              disabled={busy}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {refs.map((r, i) => (
              <span key={r.key} className="group relative size-14 overflow-hidden rounded-md border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.preview} alt="" className="size-full object-cover" />
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setRefs((prev) => prev.filter((_, k) => k !== i))}
                    className="absolute inset-0 hidden items-center justify-center bg-black/55 text-[12px] text-white group-hover:flex"
                    aria-label="참고 이미지 삭제"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
            {refs.length < MAX_REFS && (
              <button
                type="button"
                disabled={busy}
                onClick={() => refInput.current?.click()}
                className="inline-flex h-14 items-center rounded-md border border-dashed border-line-strong px-3 text-[12px] text-fg-2 hover:bg-surface-2"
              >
                + 참고 이미지 · 양식 ({refs.length}/{MAX_REFS})
              </button>
            )}
            <input
              ref={refInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addRefs(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-[12px] text-fg-3">
            참고 이미지는 이미지를 만들 때 가장 우선하는 양식이에요 — 레이아웃·글자 배치·그림체·색을 똑같이 따라 내용만 바꿔 만들어요. (게시물 이미지로 그대로 들어가지는 않아요)
          </p>
        </div>


        <Field label="글씨체" hint="자동이면 Gemini가 형식에 맞게 골라요 (손글씨 메모 → 손글씨체, 날림 요청 → 날림체 등). 연출 방향에 글씨체를 적어도 돼요.">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setFont("auto")}
              aria-pressed={font === "auto"}
              className={cx(
                "flex h-14 items-center justify-center rounded-lg border text-[13px] font-medium",
                font === "auto" ? "border-accent bg-accent/8 text-fg" : "border-line-strong text-fg-2 hover:bg-surface-2",
              )}
            >
              ✨ 자동 (Gemini가 선택)
            </button>
            {(fonts.data?.data ?? []).map((f) => (
              <button
                key={f.key}
                type="button"
                disabled={busy}
                onClick={() => setFont(f.key)}
                aria-pressed={font === f.key}
                title={f.label}
                className={cx(
                  "flex h-14 flex-col items-start justify-center overflow-hidden rounded-lg border px-2 text-left",
                  font === f.key ? "border-accent bg-accent/8" : "border-line-strong hover:bg-surface-2",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.preview} alt="" className="h-6 w-auto max-w-full object-contain object-left" loading="lazy" />
                <span className="mt-0.5 truncate text-[11px] text-fg-3">{f.label}</span>
              </button>
            ))}
          </div>
        </Field>

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
            {photos.length ? `+ 사진 추가 (${photos.length}/${MAX_PHOTOS})` : "사진을 끌어다 놓거나 눌러서 선택 (선택 · 최대 8장)"}
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
        <p className="-mt-3 text-[12px] text-fg-3">사진은 선택이에요. Gemini가 컨셉에 맞는 사진만 골라 쓰고, 필요한 장면은 글 내용대로 새로 만들어요. &lsquo;두 사진을 합쳐 한 장 짜리로&rsquo;처럼 쓰면 여러 사진을 한 이미지로 합쳐요.</p>


        <Field
          label="캡션 양식 · 꼭 넣을 정보 (선택)"
          htmlFor="cn-format"
          hint={
            <>
              [ ] 칸이 없으면 캡션 요청으로 읽고 Gemini가 새로 써요. [ ] 칸이 있으면 양식으로 보고 칸만 채우며, 칸 밖 글자·줄바꿈은 그대로 들어가요. &lsquo;[후킹 3줄]&rsquo;처럼 줄 수를 쓰면 딱 맞춰요.
              추천인 코드·링크·가격처럼 Gemini가 모르는 정보는 칸 밖에 그대로 쓰거나 칸 안에 적어 주세요
              (예: {"[추천인 정보: 코드 ABC123]"}) — 바꾸지 않고 그대로 써요. 해시태그는 맨 뒤에 자동으로 붙어요.{" "}
              <button type="button" className="underline" onClick={() => setFormat(FORMAT_EXAMPLE)} disabled={busy}>
                예시 넣기
              </button>
            </>
          }
        >
          <textarea
            id="cn-format"
            rows={7}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder={FORMAT_PLACEHOLDER}
            className={cx(inputClass, "resize-y font-mono text-[12px]")}
            disabled={busy}
          />
        </Field>

        <details className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-medium text-fg-2">포인트 색 (선택)</summary>
          <div className="mt-3 space-y-3">
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
            <p className="text-[12px] text-fg-3">주제 조사와 이미지 연출에 몇 분 걸릴 수 있어요. 창을 닫지 마세요.</p>
          </div>
        ) : (
          <Button type="submit" variant="primary" className="w-full" disabled={prompt.trim().length < 2}>
            <IconSpark width={16} height={16} /> 게시물 만들기
          </Button>
        )}
      </form>
    </Card>
  );
}
