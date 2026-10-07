import { messages } from "./messages";
import type { Locale } from "./config";

type Messages = typeof messages;
type Ns = keyof Messages;
/** "ns.key" 형태의 모든 문구 키 */
export type MessageKey = { [N in Ns]: `${N & string}.${keyof Messages[N]["ko"] & string}` }[Ns];
export type Vars = Record<string, string | number | null | undefined>;

export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const dot = key.indexOf(".");
  const ns = messages[key.slice(0, dot) as Ns] as unknown as Record<Locale, Record<string, string>>;
  const k = key.slice(dot + 1);
  let text = ns?.[locale]?.[k] ?? ns?.ko?.[k] ?? key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : String(vars[name])));
  return text;
}

export type T = (key: MessageKey, vars?: Vars) => string;
export const makeT = (locale: Locale): T => (key, vars) => translate(locale, key, vars);
