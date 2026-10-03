# Auto Studio 앱 (iPhone · Android)

웹 서비스 화면을 앱 안(WebView)에 띄우고, 휴대폰에서만 되는 기능을 더한 앱입니다.

- **사진첩에서 자동으로 찾기**: 주제만 적으면 사진첩의 최근 사진(최대 2,000장) 중 어울리는 사진을 골라 줍니다.
  사진 분석은 휴대폰 안(웹 화면의 이미지 인식 모델)에서 하고, 고른 사진만 서버로 올라갑니다.
- **인스타 로그인**: 시스템 로그인 창(ASWebAuthenticationSession / Chrome Custom Tabs)에서 로그인한 뒤 일회용 코드로 앱 화면에 로그인합니다.
- **사진 저장**: 만든 게시물 이미지·동영상을 사진첩에 바로 저장합니다.
- 우리 사이트 밖의 링크(인스타 게시물 등)는 기본 브라우저·인스타 앱으로 엽니다.

## 실제 휴대폰에서 테스트 (개발자 계정 필요 없음)

1. 휴대폰에 **Expo Go** 앱을 설치합니다 (App Store / Google Play).
2. 컴퓨터와 휴대폰을 **같은 와이파이**에 연결합니다.
3. 이 폴더에서 실행합니다.
   ```bash
   cd mobile
   npx expo start
   ```
4. 화면의 QR 코드를 iPhone은 **카메라 앱**, Android는 **Expo Go**로 찍습니다.

기본으로 라이브 사이트(`app.json` → `extra.webUrl`)를 엽니다. 로컬 서버를 보려면:
```bash
EXPO_PUBLIC_WEB_URL=http://<컴퓨터 IP>:3000 npx expo start
```

Expo Go 의 한계: Android Expo Go 는 사진첩 전체 접근이 제한될 수 있습니다. 정식 빌드에서는 문제없습니다.

## 정식 빌드 · 스토어 등록 (나중에)

[EAS](https://docs.expo.dev/eas/) 클라우드 빌드를 씁니다 (컴퓨터에 Xcode·Android Studio 필요 없음).

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview   # 설치용 APK (Play 계정 없이 가능)
npx eas-cli@latest build --platform ios                          # Apple Developer 계정 필요 ($99/년)
npx eas-cli@latest submit                                        # 스토어 제출
```

스토어 등록 전 확인: 앱 이름·아이콘(`assets/`), 번들 ID `app.instaautostudio`, 개인정보처리방침 주소
(`https://instagram-workflow-nine.vercel.app/ko/privacy`), 사진 접근 이유 문구(`app.json` → `expo-media-library`).
