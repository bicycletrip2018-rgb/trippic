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

## 아직 안 넣은 것

- **스플래시 화면**(`expo-splash-screen`) — 네이티브 모듈이라 지금 넣으면
  지금 쓰는 개발 빌드가 깨진다. **첫 EAS 빌드 때 같이** 넣는다(어차피 다시 빌드한다).
- 안드로이드 — `package` 와 `versionCode` 는 적어 뒀지만 **한 번도 안 돌려 봤다**.
