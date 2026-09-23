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

- 개발: `http://localhost:3012/index.html`
- RN(앱): `trippic://auth` 같은 딥링크 — 앱 스킴을 정한 뒤 등록한다

## 4. 확인
```bash
curl -s "$SUPABASE_URL/auth/v1/settings" -H "apikey: $ANON_KEY" | grep -o '"kakao":[a-z]*'
```
`"kakao":true` 가 되면 마이 탭에 **카카오로 이어 두기** 가 저절로 나타난다.

## 아직 안 된 것
- **애플 로그인** — iOS 앱을 스토어에 올리려면 소셜 로그인이 있을 때 애플도 필수다.
  유료 개발자 프로그램($99/년)과 Service ID·Key 발급이 필요하다.
- **RN 쪽 콜백** — 웹은 `#access_token` 을 받는 코드가 있지만, 앱은 딥링크로 받아야 한다.
  스킴을 정하면 그때 붙인다.
