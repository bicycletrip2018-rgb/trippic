# App Store 등록에 넣을 것 (초안) — §13.134

> ★ **노란 표시(⬜)는 운영자가 정해야 합니다.** 나머지는 제가 썼고, 그대로 쓰셔도
>   되고 고치셔도 됩니다. 심사에서 **실제로 묻는 것만** 추렸습니다.

## 이름·부제

| | |
|---|---|
| 앱 이름(30자) | **트립픽** |
| 부제(30자) | 사진으로 다시 그리는 내 여행 지도 |
| 번들 ID | `app.trippic` |

★ 번들 ID 는 §13.141 에서 `app.trippic.bench` → **`app.trippic`** 으로 바꿨다.
  (이 문단은 한동안 *"바꿀 수 없다, 그대로 간다"* 라고 적혀 있었다 — 그때는
  그게 맞았고, **바꾼 뒤에도 한참 그대로 남아 있었다.**)
  첫 출시 뒤에는 정말로 못 바꾼다. 플레이스토어 주소에 그대로 보인다.

## 설명 (4,000자 한도)

```
찍어 둔 사진이 앨범 어딘가에 묻혀 있습니다.
트립픽은 그 사진들을 전국 지도 위에 다시 펼칩니다.

■ 앨범을 훑어 여행 단위로 묶습니다
사진의 촬영 시각과 좌표만 읽어, 같은 날 같은 곳에서 찍은 것들을 한 여행으로
모읍니다. 이 과정은 기기 안에서 일어나고, 올라가는 것은 직접 고른 사진뿐입니다.

■ 내가 가 본 곳이 지도에 쌓입니다
시·군·구 단위로 어디를 채웠는지 보입니다. 다음에 어디를 갈지가 지도에서 보입니다.

■ 같이 간 사람과 한 지도를 채웁니다
링크 하나로 초대하면, 각자 올린 기록이 한 장의 지도에 모입니다.

■ 왜 추천하는지 적어 둡니다
'지금 하는 행사' '곧 시작합니다' '여기서 가까운' — 묶음마다 이유를 적습니다.
설명할 수 없는 추천은 하지 않습니다.

장소 정보와 일부 사진은 한국관광공사 공공데이터를 씁니다.
```

## 키워드 (100자, 쉼표 구분)

```
여행기록,여행지도,사진정리,국내여행,여행앨범,발자국,여행일기,가볼만한곳,축제,여행코스
```

## 심사가 묻는 것

| 항목 | 답 |
|---|---|
| 로그인 필요? | **아니요** — 회원가입 없이 바로 씁니다(익명 계정 자동) |
| 소셜 로그인 | 카카오 · **애플**(4.8 조항 때문에 **필수**) |
| 심사용 계정 | **필요 없음이고, 만들 수도 없다.** 이메일/비밀번호 경로가 앱에 아예 없다(`SOCIALS = ["kakao","apple"]`). `App.tsx:103` 이 켤 때 `ensureSession()` 을 부르고 그게 `api.ts:245` 에서 **익명 로그인**으로 떨어진다 — 로그인 벽이 없다. 아래 심사 메모를 적는 것으로 끝난다 |
| 수출 규정 | 표준 HTTPS 만 씀 → **면제**(`ITSAppUsesNonExemptEncryption = false`) |
| 연령 등급 | 사용자 생성 콘텐츠가 있으므로 **12+** 가 보통 |
| 개인정보처리방침 URL | `https://bicycletrip2018-rgb.github.io/trippic-web/privacy.html` ✅ 공개됨 |
| 지원 URL | `https://bicycletrip2018-rgb.github.io/trippic-web/support.html` ✅ |
| 이용약관 URL | `https://bicycletrip2018-rgb.github.io/trippic-web/terms.html` ✅ **무관용 조항 포함** |

## 가이드라인 1.2 (UGC) — **다 됐다**

★ **확인해 보고 적는다.** 처음엔 *"신고는 있다"* 고 적었다가 **틀린 것을 알고
  고쳤다** — 코드의 `신고` 는 전부 *장소가 문을 닫았다*는 뜻이었고, 사용자
  콘텐츠를 신고하는 길은 앱에 없었다. **읽어 보지 않았으면 그대로 제출했을
  자리다.**

| 애플이 요구하는 것 (1.2) | 지금 |
|---|---|
| **신고** 기능 + 제때 응답 | ✅ `api_report_create`(072) · 소식·장소 상세에 버튼 · 운영자 큐로 들어가고 **어드민 화면**에서 처리한다(§13.146) |
| 문제 사용자 **차단** | ✅ `blocks`(072) · 소식·지도·장소 상세에서 사라진다 · 마이에서 푼다 |
| 불쾌한 콘텐츠를 **거르는 수단** | ✅ 신고 → 운영자 큐 → **열어서 확인**(075) → **내리고 조치**(074·077). 화질·인물 자동 필터도 있다(009·010) |
| **약관**에 무관용 명시 + 동의 | ✅ 첫 실행 전면(§13.136) · 무관용 조항을 **화면에 직접** · 거절 경로 포함 |
| 공개된 **연락처** | ✅ 마이 탭 링크 · `support.html` 공개됨(§13.139) |

★ 서버 절반(표·정책·운영자 큐)은 **원래 있었다.** 없던 것은 앱에서 부를 길과
  차단이었고 §13.135·§13.136 에서 만들었다.

★★ 그런데 그때 *"다 됐다"* 고 적은 것은 **반만 맞았다.** 운영자가 신고를
  **보지도 지우지도 못했다**(§13.144 에서 알았다). 지금은 다 된다 —
  보기(075) · 내리기+파일 삭제(074) · 조치 사다리와 알림(077) · 어드민 화면(076).
  **글로 쓴 약속을 코드가 지킨다.**

## 개인정보 라벨 (App Privacy)

실제로 모으는 것만 적는다. 지어내지도, 빠뜨리지도 않는다.

| 분류 | 모으나 | 사용자와 연결되나 | 추적에 쓰나 |
|---|---|---|---|
| 사진·동영상 | **예**(직접 고른 것만) | 예 | 아니요 |
| 위치(대략/정확) | **예**(앱 사용 중만) | 예 | 아니요 |
| 식별자(계정 id) | **예** | 예 | 아니요 |
| 사용자 콘텐츠(닉네임·댓글) | **예** | 예 | 아니요 |
| 진단(오류 기록) | **예** | 예 | 아니요 |
| 연락처·검색기록·구매·광고 식별자 | **아니요** | — | — |

★ **추적(Tracking)은 전부 '아니요'** 다 — 광고 SDK 가 하나도 없다. 그래서
  ATT(앱 추적 투명성) 팝업도 필요 없다.

## 기기 — **아이폰 전용**

`ios.supportsTablet: false` (§13.149). 아이패드 스크린샷을 안 내도 되고,
심사자가 **안 해 본 화면을 열 일도 없다.** 나중 버전에서 켤 수 있다.

생성물로 확인: `ios/app.xcodeproj` 의 `TARGETED_DEVICE_FAMILY = 1`.
(`Info.plist` 의 `UIDeviceFamily` 를 보면 안 된다 — 요즘 Xcode 는 거기 안 적는다.)

## 스크린샷 → `store/` 폴더

**다섯 장**이면 충분하고, 순서가 곧 이야기다:

| | 화면 | 상태 |
|---|---|---|
| 1 | 전국 지도 — 채운 지역이 보이는 화면 | 기록 필요 |
| 2 | 앨범 훑기 → 여행으로 묶인 화면 | 기록 필요 |
| 3 | 장소 상세 — 사진과 '몇 번 갔는지' | 기록 필요 |
| 4 | `갈 곳` — 묶음마다 이유가 적힌 화면 | ✅ **찍었다** (`store/01-갈곳.png`) |
| 5 | 함께 채운 지도(초대) | 기록 필요 |

규격은 **1320 × 2868**(6.9형)이다.

★ 4번은 **전부 진짜 데이터**다 — 한국관광공사 실제 행사·사진·날짜·소요시간.

★★ 나머지는 시뮬레이터 앨범에 사진을 넣어야 하는데 **`simctl addmedia` 가
   Xcode 26.6 에서 깨져 있다**(§13.150). 네 가지 길을 다 시도해 실패했다.
   **TestFlight 로 직접 몇 장 올려 본 뒤에 찍는다** — 어차피 그게 더 낫다.

★ **애플은 스크린샷 한 장만 있어도 제출을 받는다.** 이것이 출시를 막지 않는다.

## 아직 못 정한 것 (⬜)

- **연령 등급** — 12+ 가 기본이지만 App Store Connect 설문에 직접 답해야 한다
- ~~**심사 메모**~~ — ✅ 아래에 그대로 붙여넣을 수 있게 써 뒀다

★ 그 밖의 빈 칸(운영 주체·문의·보관 기간·14세 미만)은 **§13.139 에서 다 채웠고
  공개됐다.** 이 목록은 그 뒤로도 한참 *"못 정했다"* 고 말하고 있었다 —
  **문서는 코드보다 먼저 낡는다.**

---

## 심사 메모 (App Review Information → Notes)

★ **계정을 달라는 칸은 비워 둔다.** 줄 계정이 없다 — 앱에 이메일/비밀번호
  로그인 경로가 없고, 켜면 익명 계정이 자동으로 생겨 바로 쓸 수 있다.

★ **진짜 위험은 계정이 아니라 빈 화면이다.** 이 앱의 주 흐름은 *"내 앨범의
  위치정보 있는 사진을 훑어 여행으로 묶는다"* 인데, **심사 기기의 앨범에는
  그런 사진이 없다.** 그대로 두면 심사자는 아무것도 못 보고 "기능이 없다"
  (4.2) 로 판단할 수 있다. 그래서 메모의 절반은 **앨범 없이 끝까지 가 보는
  길**을 알려 주는 데 쓴다 — `(+)` → **지금 찍기**는 카메라와 현재 GPS 만
  쓰므로(`src/AddSheet.tsx:26` → `src/live.ts:51` `capture()`) 쿠퍼티노에서도
  된다.

★ **문구를 코드에서 확인하고 적었다.** 처음엔 *"(+) 를 누르면 지금 찍기"* 라고
  썼는데, 실제로는 `(+)` → **`AddSheet`("여행 추억 남기기")** → 두 갈래다.
  버튼 이름도 "지금 찍기" 가 아니라 **"지금 여기서 찍기"** 였다. 심사자는 우리가
  적어 준 글자를 화면에서 찾는다 — **한 글자 틀리면 못 찾는다.**

### 영어 (실제로 읽는 쪽)

```text
No sign-in is required. The app creates an anonymous account on first launch,
so every feature below is reachable immediately. We cannot provide a demo
account because the app has no email/password sign-in at all.

IMPORTANT — how to see the app working on a review device:

The main flow groups the user's OWN geotagged photos into trips. A review
device typically has no geotagged travel photos, so that flow will correctly
find nothing. To exercise the app end to end, please use the on-the-spot path
instead:

  1. Tap the (+) button on the main screen.
  2. A sheet titled "여행 추억 남기기" opens with two options. Choose the
     FIRST one, "지금 여기서 찍기" (Capture here, now) — the one with the
     camera icon.
  3. Allow Camera, take a photo, then allow Location when asked.
  4. The app reads your current coordinates, finds the nearby place, and
     creates a record. This works anywhere in the world.

Notes:
- Please test on a real device. This path opens the camera, which the
  iOS Simulator does not have.
- Location is requested AFTER the photo is taken, on purpose, so the reason
  is clear. We only use When In Use. We never request Always/background.
- Sign in with Apple works with your own Apple ID if you wish to test it.
  Kakao sign-in requires a Korean Kakao account and cannot be tested from
  outside Korea; it is optional and no feature is gated behind it.
- Photos stay on the device. Nothing is uploaded unless the user explicitly
  chooses to publish a record.
- User-generated content: every record that shows another user's photo has a
  Report and Block button (the place detail sheet, and the records list).
  Reports go to an operator queue that we review; we can hide content and
  suspend accounts. See our Terms for the zero-tolerance clause required by
  Guideline 1.2.
```

### 한국어 (우리가 확인용으로 읽는 쪽)

```text
로그인이 필요 없습니다. 켜면 익명 계정이 자동으로 만들어져 모든 기능을 바로
쓸 수 있습니다. 앱에 이메일/비밀번호 로그인 경로 자체가 없어 심사용 계정을
드릴 수 없습니다.

심사 기기에서 앱이 도는 것을 보시려면:

주 흐름은 사용자 본인 앨범의 '위치정보가 있는 사진'을 여행으로 묶는 것입니다.
심사 기기 앨범에는 그런 사진이 없을 수 있고, 그때는 아무것도 묶이지 않는 것이
정상 동작입니다. 끝까지 해 보시려면 아래 경로를 써 주십시오.

  1. 메인 화면의 (+) 를 누릅니다
  2. "여행 추억 남기기" 시트가 열립니다. 두 갈래 중 첫 번째 "지금 여기서 찍기"
     (📷 아이콘) 를 고릅니다
  3. 카메라를 허용하고 사진을 찍은 뒤, 이어서 위치를 허용합니다
  4. 현재 좌표로 근처 장소를 찾아 기록이 만들어집니다 — 어느 나라에서도 됩니다

- 실기기에서 봐 주십시오. 이 경로는 카메라를 열고, 시뮬레이터에는 카메라가 없습니다
- 위치는 사진을 찍은 **뒤에** 묻습니다(의도된 순서입니다). '앱을 사용하는 동안'
  만 쓰며 백그라운드 위치는 요청하지 않습니다
- 애플 로그인은 심사자님 본인 Apple ID 로 바로 되십니다. 카카오 로그인은 한국
  카카오 계정이 있어야 해서 해외에서는 안 되지만, 선택 사항이고 로그인으로
  막히는 기능은 없습니다
- 사진은 기기에 남습니다. 사용자가 직접 공개를 고르기 전에는 올라가지 않습니다
- 사용자 생성 콘텐츠: 남의 사진이 보이는 모든 자리(장소 상세 시트, 기록 목록)에
  신고·차단 버튼이 있고, 신고는 운영자 큐로 들어가 우리가 처리합니다.
  숨김과 계정 정지가 가능합니다
```

★ **시뮬레이터 이야기를 숨기지 않는다.** "실기기에서 봐 달라" 는 부탁은
  약점처럼 보이지만, **안 적으면 심사자가 시뮬레이터에서 카메라를 못 열고
  '버그' 로 적는다.** 아는 한계를 먼저 말하는 편이 싸다.
