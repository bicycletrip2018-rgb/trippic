# 애플 로그인 켜기 (§13.44)

> **지금은 미뤄 뒀다 (2026-09-24 결정).** 카카오만 먼저 켜고 왕복을 돌려 본다.
> 4.8 은 **심사 때** 걸리는 조항이라 개발을 막지 않는다. 유료 Apple Developer
> 계정($99/년)을 만들 때 이 문서대로 이어서 하면 된다.
> ★ **출시 전에는 필요하다** — 카카오 로그인이 켜져 있으면 4.8 이 적용된다.

코드는 다 붙어 있다. **꺼져 있으면 버튼이 아예 안 보이고**, 켜면 그 즉시 보인다
(`/auth/v1/settings` 의 `external.apple` 을 보고 정한다). 카카오와 같은 경로를 쓴다 —
provider 이름만 다르다.

```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | grep -o '"apple":[a-z]*'
```

## ⚠️ 먼저 알아야 할 것 — **6개월마다 키를 갈아야 한다**

웹 OAuth 흐름(지금 붙여 둔 것)은 애플이 요구하는 **client secret 이 6개월이면 만료**된다.
갱신을 잊으면 **어느 날 갑자기 모든 애플 로그인이 죽는다.** 조용히 죽는다 —
사용자는 이유를 모르고 우리도 알림을 못 받는다.

→ **캘린더에 6개월 반복 일정을 지금 걸어 두십시오.** 이건 코드로 막을 수 없다.
→ `.p8` 파일은 **한 번만 내려받을 수 있다.** 잃으면 새로 만들어야 한다.

★ **네이티브 흐름은 이미 붙였다 (§13.45).** `expo-apple-authentication` 으로
`id_token` 을 받아 Supabase 에 넘긴다 — **6개월 갱신이 필요 없다.**
앱에서는 그쪽이 기본이고, 웹 OAuth 는 **계정을 얹을 때**(임시 계정 id 를 지키며
애플을 추가할 때)만 쓴다. 둘의 쓰임이 다르다:

| | 언제 | 계정 id | 6개월 갱신 |
|---|---|---|---|
| **네이티브 `id_token`** | 앱에서 애플로 **들어갈 때** | **바뀐다** (→ 합치기 §13.40) | **없다** |
| 웹 OAuth | 지금 계정에 애플을 **얹을 때** | 그대로 | **있다** |

→ 앱만 쓸 거면 **Services ID·Key 없이** App ID 하나로 끝난다. 아래 2·3번은
웹 OAuth(얹기)를 쓸 때만 필요하다.

## 1. Apple Developer (유료 프로그램 $99/년이 필요하다 — iOS 출시에 어차피 드는 돈)

1. **App ID** — `app.trippic`. Capabilities 에서 **Sign in with Apple** 체크
2. **Services ID** — 웹용으로 **따로** 만든다 (예: `app.trippic.web`)
   - Sign in with Apple **Configure**
   - **Domains**: `<project-id>.supabase.co`
   - **Return URLs**: `https://<project-id>.supabase.co/auth/v1/callback`
     ★ 우리 앱 주소가 아니다. **애플 → Supabase → 우리** 순서로 돌아온다.
3. **Key** — Keys → 새 키 + **Sign in with Apple** 체크 → `AuthKey_XXXXXXXXXX.p8` 내려받기
   (다시 못 받는다)
4. **Team ID** 를 적어 둔다 (오른쪽 위 계정 정보)

## 2. Supabase 대시보드
Authentication → Providers → **Apple** → Enable

- **Client IDs**: App ID 와 Services ID 를 **둘 다** 넣는다
  (네이티브는 App ID `app.trippic` 로, 웹은 Services ID 로 온다)
  ★ 네이티브만 쓸 거면 App ID 만 넣어도 된다.
- **Secret Key**: Team ID · Key ID · `.p8` 로 만든 JWT
- Authentication → URL Configuration → **Redirect URLs** 에 우리가 돌아올 주소:
  - 웹: `http://localhost:3012/index.html` (배포되면 실제 주소)
  - 앱: `app.trippic://auth` ← §13.42 에서 쓰는 그 스킴

## 3. 확인
```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | grep -o '"apple":[a-z]*'
```
`"apple":true` 가 되면 마이 탭에 **애플로 이어 두기** 가 저절로 나타난다.

## 이걸 꼭 켜야 하는가
**카카오 로그인을 안 넣으면 안 켜도 된다.** 심사 지침 4.8 은 *"third-party 로그인을 쓰면
동등한 다른 로그인을 같이 내놓으라"* 이고, 우리 계정 체계(익명 + 이메일)만 쓰면
조항이 적용되지 않는다 — 자세한 것은 PLAN §13.43.


## ★ entitlement 은 로컬 빌드를 막는다 (실제로 겪었다)
`ios/rnbench/rnbench.entitlements` 에 `com.apple.developer.applesignin` 을 넣으면
**시뮬레이터 빌드까지** 서명 프로파일을 요구한다:

```
CommandError: No code signing certificates are available to use.
```

유료 계정이 있어야 그 capability 가 붙은 프로파일을 받는다.
→ 로컬 `ios/` 에서는 빼 두고 **`app.json` 의 `ios.usesAppleSignIn: true`** 만 남겼다.
실제 배포 빌드는 prebuild 가 app.json 을 보고 다시 넣는다.
**유료 계정을 만드신 뒤에 한 번 더 빌드해야 실제로 동작한다.**
