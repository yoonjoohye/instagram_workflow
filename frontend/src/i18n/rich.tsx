import { Fragment, type ReactNode } from "react";

/** "여기서는 <b>댓글</b>을 <link>설정</link>" 처럼 문구 안의 태그를 React 요소로 바꿉니다. */
export function rich(text: string, tags: Record<string, (chunk: ReactNode) => ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/gs;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const render = tags[m[1]];
    out.push(<Fragment key={i++}>{render ? render(m[2]) : m[2]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
