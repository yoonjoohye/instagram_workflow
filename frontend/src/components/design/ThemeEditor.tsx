"use client";

/** 내 테마 만들기: 색 6가지 + 제목·본문 글꼴. 고르는 대로 템플릿 미리보기에 바로 보임. 같은 이름이면 덮어씀. */

import { useEffect, useState } from "react";
import { Button, inputClass, Notice } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/core";
import { api, toApiError, useApi } from "@/lib/api";
import { buildPage, thumbOf } from "@/lib/design/render";
import { pageSize, TEMPLATES } from "@/lib/design/templates";
import type { Theme, ThemeColors } from "@/lib/design/themes";

const COLOR_KEYS: [keyof ThemeColors, MessageKey][] = [
  ["bg", "design.cBg"],
  ["surface", "design.cSurface"],
  ["text", "design.cText"],
  ["primary", "design.cPrimary"],
  ["on_primary", "design.cOnPrimary"],
  ["accent", "design.cAccent"],
];
// 미리보기: 색이 골고루 보이는 템플릿들
const SAMPLES = ["cn-bold", "nt-event", "cn-minimal"];

export function ThemeEditor({ base, onClose, onSaved }: { base: Theme; onClose: () => void; onSaved: (t: Theme) => void }) {
  const t = useT();
  const fonts = useApi<{ data: { key: string; label: string }[] }>("/studio/fonts");
  const [name, setName] = useState(base.mine ? base.name : "");
  const [colors, setColors] = useState<ThemeColors>({ ...base.colors });
  const [heading, setHeading] = useState(base.fonts.heading);
  const [body, setBody] = useState(base.fonts.body);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const draft: Theme = { id: "draft", name, colors, fonts: { heading, body } };

  // 고르는 대로 미리보기 (조금 멈췄을 때)
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const f = await import("fabric");
      const out: string[] = [];
      for (const id of SAMPLES) {
        const tpl = TEMPLATES.find((x) => x.id === id)!;
        const c = await buildPage(f, { page: tpl.cover, index: 0, total: 1, photos: [] }, draft, pageSize(tpl.post));
        out.push(thumbOf(c, 220));
        c.dispose();
      }
      if (alive) setPreviews(out);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(colors), heading, body]);

  async function save() {
    if (!name.trim()) return setError(t("design.themeName"));
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api<Theme>("/studio/themes", { method: "POST", json: { name: name.trim(), colors, fonts: { heading, body } } });
      onSaved({ ...saved, mine: true });
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={t("design.themeEditor")}>
      <div className="max-h-[92dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-surface-0 p-5 sm:rounded-2xl">
        <div className="flex items-center">
          <h3 className="flex-1 text-[16px] font-semibold">{t("design.themeEditor")}</h3>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[14px] text-fg-2 hover:bg-surface-2">
            {t("design.close")}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {previews.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="" className="aspect-[4/5] h-36 shrink-0 rounded-md border border-line object-cover" />
          ))}
        </div>
        <label className="block space-y-1 text-[13px]">
          <span className="text-fg-2">{t("design.themeName")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder={t("design.themeNamePh")} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COLOR_KEYS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[12px]">
              <input type="color" value={colors[k]} onChange={(e) => setColors((c) => ({ ...c, [k]: e.target.value }))} className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
              <span className="truncate">{t(label)}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["design.fHeading", heading, setHeading],
              ["design.fBody", body, setBody],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="block space-y-1 text-[13px]">
              <span className="text-fg-2">{t(label)}</span>
              <select value={value} onChange={(e) => set(e.target.value)} className={inputClass}>
                {(fonts.data?.data ?? [{ key: value, label: value }]).map((fo) => (
                  <option key={fo.key} value={fo.key}>
                    {fo.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <Button variant="primary" className="w-full" onClick={save} loading={saving} disabled={saving}>
          {saving ? t("design.saving") : t("design.save")}
        </Button>
      </div>
    </div>
  );
}
