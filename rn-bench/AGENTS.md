# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## 빌드가 막히면 — 전부 겪은 것들 (2026-09-23)

| 증상 | 원인 | 해결 |
|---|---|---|
| `Build input file cannot be found: .../ReactCodegen/...` | `xcodebuild -derivedDataPath` 를 직접 줘서 코드젠이 어긋남 | **`npx expo run:ios`** 를 쓴다 |
| `xcodebuild` 가 실패했는데 exit 0 | `\| tail` 로 파이프해 tail 의 코드가 잡힘 | 로그에서 `(N failures)` 를 직접 본다 |
| `Unicode Normalization not appropriate for ASCII-8BIT` (pod install) | 셸에 `LANG`/`LC_ALL` 이 비어 있음 | `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install` |
| 벤치가 데이터를 못 받음 | `localhost:5173` 서버 없음 | `cd ../prototype && /usr/bin/python3 -m http.server 5173` |

## 네이티브에 닿지 않는 수정

`expo run:ios` 는 `ios/` 가 이미 있으면 **prebuild 를 다시 돌리지 않는다.**
그래서 `app.json` 의 `ios.infoPlist` 를 고쳐도 빌드된 앱에는 안 들어간다.
`NSPhotoLibraryUsageDescription` 을 app.json 에만 적었다가 앱이 그냥 죽었다 —
iOS 는 문구 없는 권한 요청을 크래시로 다룬다.

`ios/` 는 .gitignore 에 있으므로 새로 받은 사람은 prebuild 로 app.json 에서 생성된다.
**이미 `ios/` 를 갖고 있는 기계에서만** 손으로 맞춰야 한다:

```
/usr/libexec/PlistBuddy -c "Add :<키> string '<값>'" ios/rnbench/Info.plist
```

또는 `npx expo prebuild -p ios --clean` (네이티브 수정이 있으면 날아간다).
