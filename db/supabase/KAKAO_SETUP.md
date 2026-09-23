# 카카오 로그인 켜기 (§13.41)

코드는 다 붙어 있다. **꺼져 있으면 버튼이 아예 안 보이고**, 켜면 그 즉시 보인다
(`/auth/v1/settings` 의 `external.kakao` 를 보고 결정한다).

지금 상태를 확인하는 법:

```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | python3 -m json.tool | grep -i kakao
```

`"kakao": false` 면 아래를 해야 한다. **키를 다루는 일이라 대신 해 드릴 수 없다.**

## 1. 카카오 개발자 — 앱 만들기
1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가하기
2. **앱 키 → REST API 키** 를 적어 둔다 (Supabase 의 *Client ID*)
3. 제품 설정 → **카카오 로그인** → 활성화 **ON**
4. **Redirect URI** 에 아래를 등록한다 (Supabase 가 받는 주소다):
   ```
   <SUPABASE_URL>/auth/v1/callback
   ```
5. 보안 → **Client Secret** 생성 후 **활성화 ON**, 그 값을 적어 둔다
6. 동의 항목 → **닉네임**만 필수로 둔다.
   ★ 이메일은 **받지 않는다.** §2(최소 수집)에 맞고, 카카오 이메일 동의는
   사업자 심사가 필요해 개인 개발자는 막힌다.

## 2. Supabase 대시보드
Authentication → Providers → **Kakao**
- Enable **ON**
- Client ID = REST API 키
- Client Secret = 위에서 만든 값
- Callback URL 이 카카오에 등록한 것과 **글자까지 같은지** 확인

## 3. 돌아올 주소 등록
Authentication → URL Configuration → **Redirect URLs** 에 앱이 돌아올 주소를 넣는다.
여기 없는 주소로는 **돌려보내지 않는다** (그게 이 목록의 존재 이유다).

- 개발(웹): `http://localhost:3012/index.html`
- **RN(앱): `app.trippic.bench://auth`**

  ★ 새 스킴을 만들지 않았다. Expo 가 번들 id 를 **기본 스킴으로 이미 Info.plist 에
  넣어 두었다** — 새로 만들면 재빌드가 붙는다(§13.28). 확인:
  ```bash
  grep -A3 CFBundleURLSchemes rn-bench/ios/rnbench/Info.plist
  ```
  나중에 `trippic://` 처럼 짧은 스킴을 쓰고 싶으면 `app.json` 의 `expo.scheme` 에
  넣고 **한 번 재빌드**한 뒤, 이 목록의 주소도 같이 바꾼다.

## 4. 확인
```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | grep -o '"kakao":[a-z]*'
```
`"kakao":true` 가 되면 마이 탭에 **카카오로 이어 두기** 가 저절로 나타난다.

## 아직 안 된 것
- **애플 로그인** — 심사 지침 4.8 은 애플 로그인을 **지목하지 않는다.** 카카오 **로그인**을
  넣는 순간 "동등한 다른 로그인"이 필요해지고, 그때 애플이 가장 모호함이 없는 선택이다.
  **카카오 로그인을 안 넣으면 4.8 자체가 적용되지 않는다** — 자세한 것은 PLAN §13.43.

## ★ 그런데 정말 카카오 **로그인**이 필요한가
**카카오톡으로 링크를 보내는 것은 로그인이 아니다.** 초대 링크는 그냥 URL 이라
OS 공유 시트로 카카오톡에 보내면 끝이고, 카카오 SDK 도 로그인도 필요 없다(§13.43).
이 문서는 *"카카오로 간편하게 시작"* 이 정말 필요해졌을 때를 위한 것이다.
- **콜드 스타트(앱이 꺼져 있을 때 링크가 깨우는 경로)** 는 **개발 빌드에서 확인할 수 없다** —
  Expo 개발 런처가 URL 을 가로채기 때문이다. **릴리스 빌드에서 확인 완료(§13.46)**:
  개발 런처가 빠진 바이너리에서 꺼진 앱을 링크로 깨워 세션이 링크의 계정으로 바뀌는 것까지 봤다.
  (앱이 떠 있을 때 들어오는 경로는 §13.42 에서, 릴리스에서는 §13.46 에서 확인했다)
