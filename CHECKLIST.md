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

## ✅ 3단계 · Apple Developer 등록 — **결제까지 끝남** (2026-10-04)

`개인/개인사업자`(= Individual / Sole Proprietor) 로 등록하고, 사업자번호 대신
**생년월일**을 넣어 결제까지 마쳤다. **승인 대기 중.**

- 승인 메일 제목: `Welcome to the Apple Developer Program` (**스팸함도 볼 것**)
- 중간에 **신분증 확인**을 요청할 수 있다 → 아이폰 **Apple Developer** 앱이 가장 빠르다
- 상태 보기: https://developer.apple.com/account

**끝났는지 확인**: 위 주소에서 `Certificates, Identifiers & Profiles` 가 보이면 된다.

★ 앞서 *"이름을 **영문**으로"* 라고 적었는데 **틀렸다.** 애플이 요구하는 것은
  **신분증에 적힌 그대로**이고, 한국 신분증이면 한글 이름이다.

★ 한국어 화면에서는 영어 메뉴 이름이 안 보인다(`Individual` 이 아니라
  `개인/개인사업자` 로 나왔다). 아래 단계는 **한국어·영어를 같이** 적어 둔다 —
  영어만 적어 두면 못 찾는다.


## 4단계 · App Store Connect 에 앱 만들기 (15분)

1. https://appstoreconnect.apple.com → `나의 앱`(My Apps) → `＋` → `신규 앱`(New App)
2. 아래대로 입력

| 칸 | 값 |
|---|---|
| 플랫폼 (Platforms) | iOS |
| 이름 | **트립픽** (이미 쓰이고 있으면 `트립픽 TRIPPIC`) |
| 기본 언어 (Primary Language) | 한국어 |
| 번들 ID (Bundle ID) | `app.trippic` ← **목록에 없으면 5단계를 먼저** |
| SKU | `trippic-ios` (아무 값, 공개 안 됨) |
| 사용자 액세스 (User Access) | 전체 액세스 (Full Access) |

3. 만든 뒤 `계약, 세금 및 금융 거래`(Agreements, Tax, and Banking) 로 가서
   **무료 앱 계약에 동의**하십시오
   — 이걸 안 하면 TestFlight 가 **"처리 중"에서 멈춥니다**

**끝났는지 확인**: 앱 목록에 `트립픽` 이 보이고, 계약 상태가 `활성` 이면 됩니다.

---

## 5단계 · 번들 ID 만들기 (5분 · 4단계에서 목록에 없었을 때만)

1. https://developer.apple.com/account/resources/identifiers/list
2. `＋` → `App IDs` → `App` → Continue
3. Description 은 `TRIPPIC`, Bundle ID 는 **Explicit** 으로 `app.trippic`
4. **Capabilities 에서 `Sign in with Apple` 체크** ← 빠뜨리면 애플 로그인이 안 됩니다
5. Continue → Register

---

## 6단계 · 애플 로그인 켜기 (5분)

★ **이게 없으면 심사에서 반려됩니다.** 카카오 로그인이 있으면 애플도 있어야 한다는
  규정(4.8)입니다.

### 6-1. App ID 에 애플 로그인 켜기

5단계에서 만든 App ID `app.trippic` 에 **`Sign in with Apple` 체크**가 되어
있어야 합니다. 그것만 되어 있으면 끝입니다.

1. https://developer.apple.com/account/resources/identifiers/list
2. `app.trippic` 클릭 → Capabilities 목록에서 **Sign in with Apple** 체크 확인
3. 안 되어 있으면 체크 → Save

> **`.p8` 키(Keys 메뉴)는 만들지 않아도 됩니다.**
> 그 키는 **웹 OAuth**(브라우저로 애플 로그인 페이지를 띄우는 방식)에서
> client secret 을 서명하는 데 쓰입니다. 트립픽은 **네이티브 방식**만 씁니다
> (`src/appleAuth.ts` → `grant_type=id_token`). 네이티브는 애플이 기기에서
> 직접 발급한 `identityToken` 을 Supabase 가 애플 공개키로 검증하므로
> 우리 쪽 비밀키가 끼어들 자리가 없습니다(§13.44, §13.153).
>
> 이미 키를 만들어 두셨다면 그냥 두십시오. 해는 없고, 나중에 웹 로그인을
> 붙일 때 쓰입니다. 단 **`.p8` 내용을 채팅·이슈·커밋에 붙여넣지 마십시오.**

### 6-2. Supabase 에 넣기

1. https://supabase.com/dashboard/project/ziwsvnkxytqifkfhiulu/auth/providers
2. **Apple** 을 펼치고 `Enable Sign in with Apple` 켜기
3. 아래대로 입력

| 칸 | 값 |
|---|---|
| Client IDs | `app.trippic` |
| Secret Key (for OAuth) | **비워 두기** |

4. Save

   ⚠ **Secret Key 는 비워 둬야 합니다.** 현재 Supabase UI 는 이 칸에
   **JWT 형식의 client secret** 을 받습니다. `.p8` 원문을 넣으면
   `Secret key should be a JWT` 오류가 나고 저장이 안 됩니다.
   네이티브 로그인은 이 칸이 비어 있어도 정상 동작합니다.

   Team ID / Key ID 칸은 지금 UI 에 **없습니다**. 안 보이는 게 정상입니다.

**끝났는지 확인**: 아래를 터미널에 붙여 `"apple":true` 가 나오면 됩니다.

```bash
curl -s "https://ziwsvnkxytqifkfhiulu.supabase.co/auth/v1/settings" -H "apikey: $(grep ANON_KEY /Users/nohhyeseong/PROJECTS/new_app_plan/rn-bench/.env.local | cut -d= -f2)" | grep -o '"apple":[a-z]*'
```

---

## 7단계 · 빌드 도구 준비 (10분)

```bash
mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global && npm install -g eas-cli
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
export PATH="$HOME/.npm-global/bin:$PATH"
eas login
```

> `npm install -g eas-cli` 를 그냥 돌리면 `EACCES`(권한 없음)가 납니다.
> `sudo` 를 쓰지 말고 위처럼 **홈 디렉터리에 설치**하십시오.
> 설치 후 `eas` 를 쓰려면 **터미널 탭을 새로 열거나** 위 `export PATH` 줄을
> 먼저 한 번 돌려야 합니다. 안 그러면 `zsh: command not found: eas` 가 납니다.

`eas login` 은 **Expo 계정**입니다(애플 계정 아닙니다). 없으면
https://expo.dev/signup 에서 무료로 만드십시오.

**끝났는지 확인**: `eas whoami` 가 계정 이름을 찍으면 됩니다.

---

## 8단계 · 첫 빌드 (30분 · 대부분 기다림)

★ 이 단계는 **제가 옆에서 같이** 할 수 있습니다. 명령만 실행해 주시면 됩니다.

> ✅ **출시 설정이 컴파일되는 것은 이미 확인했습니다**(§13.140, 2026-10-04).
> 계정 없이 되는 시뮬레이터용 Release 빌드를 끝까지 돌려서, 번들에 서버 값이
> 박히는 것과 앱이 운영 Supabase 에 붙는 것까지 봤습니다. 그래서 여기서 남은
> **진짜 위험은 서명뿐**입니다 — 아래 ★ 를 보십시오.

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

## 10.5단계 · 제출 전에 **권한 하나만** 손보기 (5분 · §13.141)

안드로이드 출시 APK 에 **`SYSTEM_ALERT_WINDOW`**(다른 앱 위에 표시)가 들어가 있습니다.
이건 `expo-dev-client` 의 개발 메뉴가 쓰는 것이고 **출시 앱에는 필요 없습니다.**
구글 플레이에서 권한 설명을 요구할 수 있고, 권한 목록을 보는 사람에게 놀랍게 보입니다.

`app.json` 의 `android.blockedPermissions` 에 **한 줄 더** 넣으면 빠집니다
(이미 `READ_MEDIA_AUDIO` 가 들어 있습니다):

```json
"blockedPermissions": [
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.SYSTEM_ALERT_WINDOW"
]
```

★ **지금 넣지 않은 이유**: 넣으면 **지금 쓰시는 개발 빌드의 개발 메뉴**가 같이
  불편해집니다. 개발이 끝나고 **제출 직전에** 넣는 것이 맞습니다.

★ 같이 들어 있는 `RECORD_AUDIO` 는 **빼면 안 됩니다** — 15초 동영상을 찍는
  기능이 실제로 마이크를 씁니다. 안 쓰는 줄 알고 뺄 뻔했는데, 코드를 보고 알았습니다.

★ `READ_MEDIA_AUDIO` 는 **이미 뺐습니다** — 오디오 파일을 읽는 코드가 없습니다.
  반대로 **`ACCESS_MEDIA_LOCATION` 은 없어서 넣었습니다.** 그게 없으면 안드로이드가
  사진의 좌표를 지워서 주고, **앱이 여행을 하나도 못 묶습니다**(§13.154).
  권한 목록은 *"많으면 뺀다"* 만이 아니라 *"없으면 넣는다"* 도 봐야 합니다.

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
