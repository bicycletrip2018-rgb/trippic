# 빌드와 올리기 (§13.134)

> ★ **여기 적힌 것 중 제가 못 하는 것은 ②·④뿐입니다.** 나머지는 명령 한 줄입니다.

## ① 값 넣기 — 빌드 전에 **한 번만**

앱이 서려면 세 값이 필요하다(`.env.example` 참고). 로컬은 `.env.local`,
빌드는 **EAS 환경변수**다. 셋 다 **공개 값**이다 — 앱을 뜯으면 어차피 보인다.

```bash
cd rn-bench
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL      --value "https://<ref>.supabase.co"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "sb_publishable_…"
eas env:create --environment production --name EXPO_PUBLIC_INVITE_BASE       --value "https://…/invite.html"
```

★ `preview` 환경에도 같은 값을 넣는다(`--environment preview`). 안 넣으면
  빌드는 **성공하는데 앱이 켜지자마자 죽는다** — `config.ts` 가 그 자리에서
  어느 이름이 비었는지 말하도록 해 뒀다(조용히 안 넘어간다).

## ② 애플 계정 — **대신 할 수 없다**

- Apple Developer Program 등록($99/년)
- `eas build` 가 처음 돌 때 Apple ID 를 묻는다. 로그인하면 인증서·프로비저닝을
  **EAS 가 알아서 만든다**(직접 만들 필요 없다)
- App Store Connect 에서 앱을 먼저 하나 만들어 둔다(이름 선점)

## ③ 빌드

```bash
eas build --profile preview    --platform ios   # TestFlight 전에 손으로 돌려 볼 것
eas build --profile production --platform ios   # 올릴 것
```

## ④ TestFlight

```bash
eas submit --profile production --platform ios
```

올라간 뒤 App Store Connect → TestFlight 에서 테스터를 초대한다. **여기부터가
사람 몫이다** — 다섯 명이 2주 쓰면 고칠 것이 나온다. 그게 MVP 테스트다.

## ⑤ 애플 계정 없이 미리 뚫어 보기 (§13.140)

출시 설정이 **컴파일은 되는지**, 번들에 값이 **박히는지**는 계정 없이도 본다.

```bash
cd rn-bench
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # ★ 없으면 pod install 이 죽는다
npx expo prebuild --platform ios --clean
(cd ios && pod install)
(cd ios && xcodebuild -workspace app.xcworkspace -scheme app \
   -configuration Release -sdk iphonesimulator \
   -destination 'generic/platform=iOS Simulator' \
   -derivedDataPath /tmp/trippic-dd CODE_SIGNING_ALLOWED=NO)
xcrun simctl install booted /tmp/trippic-dd/Build/Products/Release-iphonesimulator/app.app
xcrun simctl launch booted app.trippic
```

★ **Metro 를 끄고** 띄워야 의미가 있다. 켜져 있으면 번들이 안 박혔어도 돈다.

### 생성된 `Info.plist` 를 **반드시 열어 본다**

```bash
plutil -extract UIUserInterfaceStyle raw ios/app/Info.plist   # → Dark
```

★ §13.140 에서 여기가 `Automatic` 이었다. `app.json` 에는 `"dark"` 라고
  적혀 있었는데도 그랬다 — 스플래시의 `dark` **변형**이 되돌리기 때문이다.
  **적어 둔 것과 생성된 것은 다를 수 있다.**

## ⑥ 안드로이드도 계정 없이 뚫어 보기 (§13.141)

```bash
cd rn-bench
export JAVA_HOME=$(/usr/libexec/java_home -v 17) ANDROID_HOME=$HOME/Library/Android/sdk
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

★ **`-PreactNativeArchitectures=arm64-v8a` 를 꼭 준다.** 기본값은 네 개 ABI 를
  다 컴파일해서 **디스크를 수 GB 먹고, 모자라면 죽는다**(§13.141 에서 실제로
  `No space left on device` 로 죽었다). 실기기는 거의 다 arm64 다.
  출시용 `.aab` 는 EAS 가 네 개를 다 만들어 준다.

나온 APK 뜯어 보기:

```bash
AAPT=$ANDROID_HOME/build-tools/36.0.0/aapt2
APK=android/app/build/outputs/apk/release/app-release.apk
$AAPT dump badging $APK | grep -E "^package|application-label:|native-code"
$AAPT dump permissions $APK          # ★ 권한을 눈으로 센다
unzip -p $APK assets/index.android.bundle | strings | grep -c "<서버 주소>"
```

### 다크 모드는 **`styles.xml` 에 안 나온다**

안드로이드는 `expo-system-ui` 가 있어야 `userInterfaceStyle` 이 먹고,
그 결과는 **`strings.xml`** 에 들어간다:

```bash
grep user_interface_style android/app/src/main/res/values/strings.xml
# → <string name="expo_system_ui_user_interface_style">dark</string>
```

★ `styles.xml` 은 `Theme.AppCompat.DayNight` 그대로다 — **런타임에 건다.**
  테마만 보고 "안 먹었다"고 판단하면 틀린다.

## 아직 안 넣은 것

- **앱 아이콘이 Expo 기본**이다(파란 갈매기). 로고가 생기면 바꾼다.
- 스플래시는 **`assets/splash-blank.png`(완전 투명)** 을 가리킨다 —
  화면에는 배경색 `#0E0F13` 만 뜬다.

  ★ **`image` 를 아예 빼면 안드로이드 빌드가 깨진다**(§13.141):
  `expo-splash-screen` 이 `windowSplashScreenAnimatedIcon` 을 항상 쓰면서
  드로어블은 `image` 가 있을 때만 만든다. iOS 는 그냥 지나가므로
  **안드로이드까지 빌드해 보지 않으면 모른다.** 로고가 생기면
  이 파일을 바꾸되, **비우지는 말 것.**
- 안드로이드를 **실행해 본 적은 없다** — 에뮬레이터도 실기기도 없었다.
  컴파일과 APK 내용물까지만 봤다(§13.141).
