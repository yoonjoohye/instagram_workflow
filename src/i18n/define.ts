/** 한 네임스페이스의 문구를 언어별로 정의합니다. en·ja 는 ko 와 같은 키를 모두 가져야 합니다 (빠지면 타입 오류).
 *  문구 안의 {name} 은 t(key, { name }) 으로 채우고, <b>…</b> 같은 태그는 rich() 로 바꿀 수 있습니다. */
export function defineMessages<K extends string>(m: {
  ko: Record<K, string>;
  en: Record<K, string>;
  ja: Record<K, string>;
}) {
  return m;
}
