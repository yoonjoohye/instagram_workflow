/** Auto Studio 앱: 웹 서비스 화면(WebView) + 휴대폰 기능(사진첩·로그인·사진 저장).
 *  웹 화면이 window.ReactNativeWebView.postMessage 로 요청하면, 여기서 처리해 window.__nativeBridge.reply 로 답합니다. */
import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Platform, StyleSheet, useColorScheme, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import * as photos from "./src/photos";

// 개발 중에는 EXPO_PUBLIC_WEB_URL 로 로컬 서버(http://<컴퓨터 IP>:3000)를 가리킬 수 있습니다.
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || (Constants.expoConfig?.extra?.webUrl as string)).replace(/\/$/, "");
const WEB_HOST = new URL(WEB_URL).host;

// 웹이 앱 안인 줄 알게 페이지보다 먼저 심는 코드
const INJECT = `window.__NATIVE_APP__ = { platform: "${Platform.OS}", version: "${Constants.expoConfig?.version ?? ""}" }; true;`;

type Msg = { id: number; type: string; [k: string]: unknown };

export default function App() {
  const web = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const dark = useColorScheme() === "dark";

  const reply = useCallback((id: number, result?: unknown, error?: string) => {
    const msg = JSON.stringify({ id, result, error });
    web.current?.injectJavaScript(`window.__nativeBridge && window.__nativeBridge.reply(${msg}); true;`);
  }, []);

  /** 인스타 로그인: 시스템 브라우저 로그인 창 → 일회용 코드 → 앱 화면에서 세션으로 교환 */
  const login = useCallback(async (loginUrl: string) => {
    const redirect = Linking.createURL("auth");
    const url = `${loginUrl}${loginUrl.includes("?") ? "&" : "?"}app=${encodeURIComponent(redirect)}`;
    const result = await WebBrowser.openAuthSessionAsync(url, redirect);
    if (result.type !== "success") return;
    const code = Linking.parse(result.url).queryParams?.code;
    if (typeof code === "string") {
      web.current?.injectJavaScript(`window.location.href = ${JSON.stringify(`${WEB_URL}/api/py/auth/app-session?code=${encodeURIComponent(code)}`)}; true;`);
    }
  }, []);

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      let msg: Msg;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      try {
        switch (msg.type) {
          case "permission":
            return reply(msg.id, await photos.permission(Boolean(msg.request)));
          case "listPhotos":
            return reply(msg.id, await photos.listPhotos(Number(msg.offset) || 0, Number(msg.limit) || 200));
          case "thumbnails":
            return reply(msg.id, await photos.thumbnails(msg.ids as string[], Number(msg.side) || 256));
          case "photo":
            return reply(msg.id, await photos.photo(String(msg.photoId)));
          case "haptic":
            // 웹 슬라이더의 '틱'(눈금) · '팡'(가운데에 붙을 때)
            if (msg.kind === "snap") await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            else await Haptics.selectionAsync();
            return reply(msg.id, true);
          case "save": {
            const n = await photos.save(msg.urls as string[]);
            if (typeof msg.message === "string") Alert.alert(msg.message, `${n}`);
            return reply(msg.id, n);
          }
          default:
            return reply(msg.id, undefined, `unknown request: ${msg.type}`);
        }
      } catch (err) {
        reply(msg.id, undefined, err instanceof Error ? err.message : String(err));
      }
    },
    [reply],
  );

  /** 우리 사이트만 앱 안에서, 로그인은 로그인 창으로, 그 밖의 링크는 기본 브라우저·인스타 앱으로 */
  const onShouldStart = useCallback(
    (req: WebViewNavigation) => {
      let url: URL;
      try {
        url = new URL(req.url);
      } catch {
        return true;
      }
      if (url.protocol === "about:" || url.protocol === "blob:" || url.protocol === "data:") return true;
      if (url.host === WEB_HOST && url.pathname === "/api/py/auth/login") {
        login(req.url);
        return false;
      }
      if (url.host === WEB_HOST) return true;
      if ((req as WebViewNavigation & { isTopFrame?: boolean }).isTopFrame === false) return true; // iframe 등
      Linking.openURL(req.url).catch(() => {});
      return false;
    },
    [login],
  );

  // 안드로이드 뒤로 가기 = 웹 페이지 뒤로
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack]);

  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? "light" : "dark"} />
      <SafeAreaView style={[styles.root, { backgroundColor: dark ? "#121211" : "#f7f7f5" }]} edges={["top"]}>
        <WebView
          ref={web}
          source={{ uri: `${WEB_URL}/admin` }}
          injectedJavaScriptBeforeContentLoaded={INJECT}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStart}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(s) => setCanGoBack(s.canGoBack)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          applicationNameForUserAgent="InstaAutoStudioApp"
          style={{ backgroundColor: "transparent" }}
        />
        {loading && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
