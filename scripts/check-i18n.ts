/** 번역 점검: 모든 문구가 ko·en·ja 에 있고, {변수}·<태그> 가 언어마다 같은지. 실행: npm run check:i18n */
import { messages } from "../src/i18n/messages";

const sig = (s: string) => [...(s.match(/\{\w+\}/g) ?? []), ...(s.match(/<\/?\w+>/g) ?? [])].sort().join(",");
const problems: string[] = [];
let total = 0;
for (const [ns, m] of Object.entries(messages) as [string, Record<string, Record<string, string>>][]) {
  for (const key of Object.keys(m.ko)) {
    total++;
    for (const lang of ["en", "ja"]) {
      const v = m[lang]?.[key];
      if (v === undefined) problems.push(`${lang} 에 없음: ${ns}.${key}`);
      else if (sig(m.ko[key]) !== sig(v)) problems.push(`${lang} 변수·태그 다름: ${ns}.${key} (${sig(m.ko[key])} ≠ ${sig(v)})`);
      else if (/[가-힣]/.test(v) && !/^\d+$/.test(key)) problems.push(`${lang} 에 한국어 남음: ${ns}.${key}`);
    }
  }
}
console.log(`문구 ${total}개 점검`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("문제 없음");
