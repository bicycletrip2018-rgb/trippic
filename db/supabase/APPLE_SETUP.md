# 애플 로그인 켜기 (§13.44)

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

★ **네이티브 흐름(`signInWithIdToken`)은 이 갱신이 없다.** iOS 앱에서는 그쪽이 맞고,
화면도 매끄럽다(Face ID, 브라우저로 안 나감). 대신 `expo-apple-authentication` 을
넣어야 하고 **재빌드가 한 번** 붙는다. 출시 전에 옮기는 것을 권한다 — §13.44 참조.

## 1. Apple Developer (유료 프로그램 $99/년이 필요하다 — iOS 출시에 어차피 드는 돈)

1. **App ID** — `app.trippic.bench`. Capabilities 에서 **Sign in with Apple** 체크
2. **Services ID** — 웹용으로 **따로** 만든다 (예: `app.trippic.bench.web`)
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
  (네이티브는 App ID 로, 웹은 Services ID 로 온다)
- **Secret Key**: Team ID · Key ID · `.p8` 로 만든 JWT
- Authentication → URL Configuration → **Redirect URLs** 에 우리가 돌아올 주소:
  - 웹: `http://localhost:3012/index.html` (배포되면 실제 주소)
  - 앱: `app.trippic.bench://auth` ← §13.42 에서 쓰는 그 스킴

## 3. 확인
```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | grep -o '"apple":[a-z]*'
```
`"apple":true` 가 되면 마이 탭에 **애플로 이어 두기** 가 저절로 나타난다.

## 이걸 꼭 켜야 하는가
**카카오 로그인을 안 넣으면 안 켜도 된다.** 심사 지침 4.8 은 *"third-party 로그인을 쓰면
동등한 다른 로그인을 같이 내놓으라"* 이고, 우리 계정 체계(익명 + 이메일)만 쓰면
조항이 적용되지 않는다 — 자세한 것은 PLAN §13.43.
