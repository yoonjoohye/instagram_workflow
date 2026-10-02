import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/** 언어별 주소: /ko, /en/privacy 처럼 앞에 언어를 붙이면 그 언어로 보여 줍니다 (검색엔진이 언어마다 따로 수집).
 *  ?lang=ko 도 같은 뜻으로 받습니다. 고른 언어는 쿠키에도 저장해 이후 화면도 같은 언어로. */
export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const [, first, ...rest] = url.pathname.split("/");
  const fromPath = isLocale(first) ? first : null;
  const query = url.searchParams.get("lang");
  const lang = fromPath ?? (isLocale(query) ? query : null);

  const headers = new Headers(req.headers);
  if (lang) headers.set("x-locale", lang);

  let res: NextResponse;
  if (fromPath) {
    const target = url.clone();
    target.pathname = `/${rest.join("/")}`;
    res = NextResponse.rewrite(target, { request: { headers } });
  } else {
    res = NextResponse.next({ request: { headers } });
  }
  if (lang && req.cookies.get(LOCALE_COOKIE)?.value !== lang) {
    res.cookies.set(LOCALE_COOKIE, lang, { path: "/", maxAge: 31536000, sameSite: "lax" });
  }
  return res;
}

export const config = {
  // 페이지만 (API·정적 파일·이미지 제외)
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
