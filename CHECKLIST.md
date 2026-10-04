# 직접 하셔야 하는 것 — **순서대로**

> 제가 못 하는 것만 모았습니다. **신원·결제·키·사람**이 걸린 일들입니다.
> 각 단계마다 *"끝났는지 어떻게 아나"* 를 적어 뒀습니다.
> 막히시면 그 단계 번호를 말씀해 주시면 됩니다.

---

## ✅ 0·1·2단계는 **끝났습니다** (2026-10-04)

운영 주체 `노혜성` · 문의 `bicycletrip2018@gmail.com` 으로 채워 **공개했습니다**:

```
https://bicycletrip2018-rgb.github.io/trippic-web/terms.html
https://bicycletrip2018-rgb.github.io/trippic-web/privacy.html
https://bicycletrip2018-rgb.github.io/trippic-web/support.html
```

앱의 `마이 → 이용약관` 에서 눌러 열리는 것까지 확인했습니다.
**바꾸고 싶으시면 말씀만 하시면 됩니다** — 시행일을 올리고 다시 올립니다.

### → **지금 하실 것은 3단계(Apple Developer 등록)입니다.**

---

<details><summary>0단계 · 먼저 정하실 것 (끝남)</summary>

## 0단계 · 먼저 정하실 것 (10분, 컴퓨터 없이)

아래 여섯 가지는 **제가 지어낼 수 없습니다.** 종이에 적어 두시면 1단계가 빨라집니다.

| 정할 것 | 설명 | 예 |
|---|---|---|
| ① 운영 주체 | 개인 이름 또는 상호 | `홍길동` |
| ② 문의 이메일 | 사용자가 보낼 주소. **실제로 받으셔야 합니다** | `help@…` |
| ③ 개인정보 보호책임자 | 이름과 연락처(②와 같아도 됩니다) | `홍길동 · help@…` |
| ④ 오류 기록 보관 기간 | 앱 오류 로그를 얼마나 둘지 | `90일` 권장 |
| ⑤ 탈퇴 후 삭제 시점 | 계정 지우면 언제 완전 삭제할지 | `즉시` 권장 |
| ⑥ 만 14세 미만 정책 | 받을지 말지 | `만 14세 미만은 가입할 수 없습니다` 권장 |

★ ②는 **개인 메일이 그대로 공개**됩니다. 따로 만드시길 권합니다.

---

## 1단계 · 문서 빈 칸 채우기 (끝남)

`website/` 의 세 파일에 **노란 칸 12곳**이 있습니다. 그 칸만 바꾸시면 됩니다.

```
website/terms.html     3곳 — 시행일 · 운영 주체 · 이메일
website/privacy.html   8곳 — 시행일 · 상호 · 이메일 · 보호책임자 · ④ · ⑤ · 이메일 · ⑥
website/support.html   1곳 — 이메일
```

### 하는 법

1. 각 파일을 여시면 `<span class="fill">…</span>` 로 감싸인 노란 글자가 보입니다
2. **그 안의 글자만** 바꾸십시오 (`<span class="fill">` 과 `</span>` 는 그대로 두셔도 됩니다)
3. 다 바꾸신 뒤 **맨 위의 노란 경고 상자**(`<div class="todo">…</div>`)를 **지우십시오**

★ 시행일은 **실제로 공개하는 날**을 적으십시오.

**끝났는지 확인**: 세 파일에서 `YYYY-MM-DD` 와 `운영 주체` 가 검색되지 않으면 됩니다.

> 이 작업은 제가 대신 해 드릴 수 있습니다 — **값만 알려 주시면** 제가 채우고
> 다음 단계까지 진행합니다. 직접 하실 필요는 없습니다.

---

## 2단계 · 문서 공개하기 (끝남)

채운 세 파일을 공개 웹에 올립니다.
→ https://github.com/bicycletrip2018-rgb/trippic-web

★ 이 단계도 **제가 해 드릴 수 있습니다**(1단계가 끝나면 바로). 직접 하시려면:

1. 위 저장소에서 `Add file` → `Upload files`
2. `terms.html` · `privacy.html` · `support.html` 세 개를 올리고 `Commit changes`
3. 1~2분 뒤 아래 주소가 열리는지 확인

```
https://bicycletrip2018-rgb.github.io/trippic-web/terms.html
https://bicycletrip2018-rgb.github.io/trippic-web/privacy.html
https://bicycletrip2018-rgb.github.io/trippic-web/support.html
```

**끝났는지 확인**: 세 주소가 **휴대폰에서도** 열리면 됩니다.

</details>

---

## 3단계 · Apple Developer 등록 ← **여기부터** (30분 + 승인 대기 1~2일)

**여기부터는 제가 못 합니다.** 신원 확인과 결제가 걸립니다.

1. https://developer.apple.com/programs/enroll/ 접속
2. Apple ID 로 로그인 (없으면 새로 만드십시오 — **앱 전용으로 하나 만드시길 권합니다**)
3. **Individual(개인)** 선택
   - 법인/사업자로 하시면 **D-U-N-S 번호**가 필요해 1~2주 더 걸립니다
   - 개인으로 등록하면 App Store 에 **본인 이름이 공개**됩니다. 그게 싫으시면 사업자
4. 이름·주소를 **영문**으로, 여권/신분증과 똑같이 입력
5. 결제 (**$99/년** · 약 13만원)
6. 승인 메일을 기다립니다 (보통 24~48시간)

**끝났는지 확인**: https://developer.apple.com/account 에 들어갔을 때
왼쪽에 `Certificates, IDs & Profiles` 가 보이면 됩니다.

---

## 4단계 · App Store Connect 에 앱 만들기 (15분)

1. https://appstoreconnect.apple.com → `나의 앱` → `＋` → `신규 앱`
2. 아래대로 입력

| 칸 | 값 |
|---|---|
| 플랫폼 | iOS |
| 이름 | **트립픽** (이미 쓰이고 있으면 `트립픽 TRIPPIC`) |
| 기본 언어 | 한국어 |
| 번들 ID | `app.trippic.bench` ← **목록에 없으면 5단계를 먼저** |
| SKU | `trippic-ios` (아무 값, 공개 안 됨) |
| 사용자 액세스 | 전체 액세스 |

3. 만든 뒤 `계약, 세금 및 금융 거래` 로 가서 **무료 앱 계약에 동의**하십시오
   — 이걸 안 하면 TestFlight 가 **"처리 중"에서 멈춥니다**

**끝났는지 확인**: 앱 목록에 `트립픽` 이 보이고, 계약 상태가 `활성` 이면 됩니다.

---

## 5단계 · 번들 ID 만들기 (5분 · 4단계에서 목록에 없었을 때만)

1. https://developer.apple.com/account/resources/identifiers/list
2. `＋` → `App IDs` → `App` → Continue
3. Description 은 `TRIPPIC`, Bundle ID 는 **Explicit** 으로 `app.trippic.bench`
4. **Capabilities 에서 `Sign in with Apple` 체크** ← 빠뜨리면 애플 로그인이 안 됩니다
5. Continue → Register

---

## 6단계 · 애플 로그인 켜기 (30분)

★ **이게 없으면 심사에서 반려됩니다.** 카카오 로그인이 있으면 애플도 있어야 한다는
  규정(4.8)입니다.

### 6-1. 키 만들기

1. https://developer.apple.com/account/resources/authkeys/list
2. `＋` → Key Name 에 `TRIPPIC Sign in with Apple`
3. **`Sign in with Apple` 체크** → Configure → Primary App ID 에 `app.trippic.bench` → Save
4. Continue → Register → **`Download`**

   ⚠ **`AuthKey_XXXXXXXXXX.p8` 파일은 한 번만 받을 수 있습니다.**
   잃어버리면 키를 새로 만들어야 합니다. 받는 즉시 안전한 곳에 두십시오.

5. 같은 화면에서 **Key ID**(10자)를 적어 두십시오
6. 오른쪽 위 계정 이름 옆의 **Team ID**(10자)도 적어 두십시오

### 6-2. Supabase 에 넣기

1. https://supabase.com/dashboard/project/ziwsvnkxytqifkfhiulu/auth/providers
2. **Apple** 을 펼치고 `Enable Sign in with Apple` 켜기
3. 아래대로 입력

| 칸 | 값 |
|---|---|
| Client IDs | `app.trippic.bench` |
| Secret Key | ↓ 아래 설명 |
| Team ID | 6-1 의 Team ID |
| Key ID | 6-1 의 Key ID |

4. **Secret Key** 칸에는 받으신 `.p8` 파일을 **텍스트 편집기로 열어**
   `-----BEGIN PRIVATE KEY-----` 부터 `-----END PRIVATE KEY-----` 까지 **전부** 붙여넣으십시오
5. Save

**끝났는지 확인**: 아래를 터미널에 붙여 `"apple":true` 가 나오면 됩니다.

```bash
curl -s "https://ziwsvnkxytqifkfhiulu.supabase.co/auth/v1/settings" -H "apikey: $(grep ANON_KEY /Users/nohhyeseong/PROJECTS/new_app_plan/rn-bench/.env.local | cut -d= -f2)" | grep -o '"apple":[a-z]*'
```

---

## 7단계 · 빌드 도구 준비 (10분)

```bash
npm install -g eas-cli
eas login
```

`eas login` 은 **Expo 계정**입니다(애플 계정 아닙니다). 없으면
https://expo.dev/signup 에서 무료로 만드십시오.

**끝났는지 확인**: `eas whoami` 가 계정 이름을 찍으면 됩니다.

---

## 8단계 · 첫 빌드 (30분 · 대부분 기다림)

★ 이 단계는 **제가 옆에서 같이** 할 수 있습니다. 명령만 실행해 주시면 됩니다.

```bash
cd /Users/nohhyeseong/PROJECTS/new_app_plan/rn-bench
eas init                       # 프로젝트를 Expo 에 연결 (한 번만)
```

그 다음 **서버 값 세 개**를 EAS 에 넣습니다 (`.env.local` 의 값 그대로):

```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL      --value "https://ziwsvnkxytqifkfhiulu.supabase.co"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<.env.local 의 값>"
eas env:create --environment production --name EXPO_PUBLIC_INVITE_BASE       --value "https://bicycletrip2018-rgb.github.io/trippic-web/invite.html"
```

빌드:

```bash
eas build --profile production --platform ios
```

- **Apple ID 를 묻습니다** → 3단계의 계정으로 로그인
- 인증서·프로비저닝은 **EAS 가 알아서 만듭니다** (직접 만들지 마십시오)
- 15~25분 걸립니다. 링크가 나오면 거기서 진행 상황이 보입니다

**끝났는지 확인**: `Build finished` 와 함께 `.ipa` 링크가 나오면 됩니다.

★ 첫 빌드는 **서명 문제로 한 번 실패하는 일이 흔합니다.** 실패해도 당황하지
  마시고 로그를 저에게 보여 주십시오 — 대부분 설정 한 줄입니다.

---

## 9단계 · TestFlight 에 올리기 (20분)

```bash
eas submit --profile production --platform ios
```

올라간 뒤 App Store Connect → `트립픽` → **TestFlight** 탭:

1. **수출 규정** 을 묻습니다 → **`아니요`** (표준 HTTPS 만 씁니다)
2. `내부 테스팅` → `＋` → 그룹 만들기 → 본인 추가
3. 본인 아이폰에 **TestFlight** 앱을 깔고 초대 메일의 링크를 누르면 설치됩니다

**끝났는지 확인**: 본인 아이폰에서 **트립픽**이 열리면 됩니다.

★ **여기까지가 1차 목표**입니다. 여기서 한 번 직접 써 보시고, 이상한 곳을
  저에게 말씀해 주시면 고칩니다.

---

## 10단계 · 테스터 다섯 분 (2주)

TestFlight → `외부 테스팅` → 그룹 만들기 → 메일 주소로 초대.
외부 테스터는 **애플의 간단한 검수**를 한 번 거칩니다(보통 하루).

★ 다섯 분께 이렇게 부탁하시면 쓸모 있는 답이 옵니다:

> "사진 앨범에서 여행 하나를 올려 보고, **어디서 막혔는지** 알려 주세요."

★ 저는 **오류를 자동으로 받고 있습니다**(§13.120). 테스터가 말 안 해도
  앱이 터지면 제가 봅니다. 성적표도 만들어 뒀습니다.

---

## 11단계 · 심사 제출

테스터 피드백을 반영한 뒤에 합니다. 제가 준비물(설명·키워드·개인정보 라벨)을
`STORE.md` 에 써 뒀습니다. 그때 같이 보시죠.

---

## 나중에, 급하지 않은 것

- **공공데이터포털 운영키** — 지금은 개발키(하루 1,000회)입니다.
  사용자가 늘면 https://www.data.go.kr 에서 운영키로 전환 신청하십시오.
- **애플 client secret 6개월 갱신** — 웹 OAuth 를 쓸 때만 해당합니다.
  앱은 네이티브 방식이라 갱신이 필요 없습니다(§13.44).
