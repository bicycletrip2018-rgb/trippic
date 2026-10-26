<!-- 이 파일은 `bin/status.sh` 가 만든다. 손으로 고치지 마라 — 다음 실행에 덮인다.
     돌리면 생성 시각·브랜치 때문에 **늘 바뀐 것으로 뜬다.** 그건 정상이다 —
     내용이 달라진 게 없으면 `git checkout -- STATUS.md` 로 버리고,
     실제로 달라졌으면(기능이 늘었다거나) **그때만** 커밋한다. -->
# 지금 상태 — **재서 쓴 것**

```
생성: 2026-10-26 13:57 KST   ·   bin/status.sh
```

> **이 파일이 지금 사실이다.** `PLAN.md` 의 §0·§5·§6·§12 는 **기획 당시의
> 판단 기록**이고 지금 사실이 아니다. 숫자를 알고 싶으면 여기를 보고,
> **왜 그렇게 됐나**를 알고 싶으면 `PLAN.md` 의 §13.x 를 검색하라.

다시 만들려면: `./bin/status.sh`   ·   어긋났는지만 보려면: `./bin/doc-drift.sh`

---

## 1. 코드

| | |
|---|---|
| 탭 | **4개** — 지도 · 갈 곳 · 소식 · 마이 |
| 앱 소스 | `rn-bench/src` 54개 파일 · 11706줄 |
| 마이그레이션 | **102개** · 마지막 `102_comment_remove_definer.sql` · 다음 번호 **103** |
| `api_*` 함수 | DB 정의 76개 · 앱/웹 호출 49개 |

★ **아무도 안 부르는 `api_*` 가 27 개**다. 그중 일부는 «대체됨»이고 일부는
  «화면이 아직 없음»이다 — 둘은 다르다(§13.182). 목록:

```
api_comment_add api_comment_remove api_comments api_is_near_home 
api_join_space api_map_clusters api_map_overview api_map_places 
api_mark_closed api_mod_remove_pin api_mod_unsuspend_user 
api_operator_grant api_operator_list api_operator_log api_operator_revoke 
api_orientation_mix api_pin_publish_summary api_place_months 
api_place_search api_places_near api_record_pick api_report_history 
api_report_note api_report_reopen api_rotate_invite api_trips_in_view 
api_villages_in_bbox
```

## 2. 기능 — **기대와 실제**

기대 상태는 `bin/features.tsv` 에 적혀 있다. 아래 «실제»는 **지금 재 본 것**이다.
둘이 다르면 `bin/doc-drift.sh` 가 CI 에서 막는다 — **코드가 바뀌면 표를 같이 고쳐라.**

| 기능 | 기대 | 실제 | |
|---|:---:|:---:|:---:|
| 15초 클립 업로드 | 있음 | 있음 | ✓ |
| 사진 저장소 = Supabase Storage | 있음 | 있음 | ✓ |
| 사진 저장소 = Cloudflare R2 | 없음 | 없음 | ✓ |
| 비로그인 웹 뷰어 | 없음 | 없음 | ✓ |
| 정복률 | 있음 | 있음 | ✓ |
| 성취 뱃지 | 없음 | 없음 | ✓ |
| 연도 타임라인 슬라이더 | 없음 | 없음 | ✓ |
| 멤버 업로드 푸시 알림 | 없음 | 없음 | ✓ |
| 주간 로컬 알림 (푸시 아님) | 있음 | 있음 | ✓ |
| 스페이스 초대 링크 만들기 | 있음 | 있음 | ✓ |
| 스페이스 참여 (초대 수락) | 없음 | 없음 | ✓ |
| 댓글 — 서버 | 있음 | 있음 | ✓ |
| 댓글 — 앱 화면 | 없음 | 없음 | ✓ |
| 닉네임 바꾸기 — 서버 | 있음 | 있음 | ✓ |
| 닉네임 바꾸기 — 앱 화면 | 있음 | 있음 | ✓ |
| 남의 기록 하나 보기 — 서버 | 있음 | 있음 | ✓ |
| 남의 기록 하나 보기 — 앱 화면 | 있음 | 있음 | ✓ |
| 좋아요 누르기 | 없음 | 없음 | ✓ |
| @누구의 지도 (개인 프로필) | 없음 | 없음 | ✓ |
| 여행별 체크박스 필터 | 없음 | 없음 | ✓ |
| 글 3계층 — 여행 취지 | 없음 | 없음 | ✓ |
| 글 3계층 — 장소 한 줄 | 있음 | 있음 | ✓ |
| 글 3계층 — 사진 캡션 | 있음 | 있음 | ✓ |
| GPS 내 위치 | 있음 | 있음 | ✓ |
| 지도 축척 막대 | 있음 | 있음 | ✓ |
| 노출 3장 상한 | 없음 | 없음 | ✓ |
| 사진으로 채운 폴리곤 | 없음 | 없음 | ✓ |
| 강·하천·호수 표시 | 있음 | 있음 | ✓ |
| 지역·장소 통합 검색 | 있음 | 있음 | ✓ |
| 모두의 지도 표지 사진 | 있음 | 있음 | ✓ |
| 신고·차단 | 있음 | 있음 | ✓ |
| 계정·기록 지우기 | 있음 | 있음 | ✓ |

**어긋난 줄 없음** — 표와 코드가 같다.

## 3. git

```
브랜치     feat/pin-detail
커밋       29fece1 2026-10-26 feat(app): 닉네임 바꾸기 — 마이 → 계정 칸 (11월 묶음 1번) (#73)
작업본     6 개 변경/미추적
stash      0개
원격       https://github.com/bicycletrip2018-rgb/trippic.git

원격이 모르는 브랜치 (로컬에만 있는 것):
  bicycletrip2018-rgb/bream
  policy-fill

작업 폴더(worktree):
  /Users/nohhyeseong/PROJECTS/trippic               29fece1 [feat/pin-detail]
  /Users/nohhyeseong/orca/workspaces/trippic/bream  f845f50 [bicycletrip2018-rgb/bream]
```

## 4. 지금 돌고 있는 것

| 무엇 | |
|---|---|
| Metro / Expo 개발 서버 | 없음 |
| Gradle 데몬 | 없음 |
| 로컬 검증 PostgreSQL (포트 55432) | **열려 있다** |
| adb 서버 (포트 5037) | 없음 |
| prototype 정적 서버 (포트 3011) | 없음 |
| website 정적 서버 (포트 3020) | 없음 |
| Metro (포트 8081) | 없음 |
| 부팅된 iOS 시뮬레이터 | 없음 |

## 5. 서버 · 출시 · 웹

| 무엇 | 상태 |
|---|---|
| 소셜 로그인 (Supabase provider) | "apple":true "kakao":true |
| Supabase 프로젝트 | `ziwsvnkxytqifkfhiulu` |
| 약관·초대 페이지 | terms:200 privacy:200 support:200 invite:200 |
| 그 주소 | `https://bicycletrip2018-rgb.github.io/trippic-web/` |
| Expo 계정 | `nohhyeseong` |
| 최근 빌드 30건 | Android canceled 3 · Android finished 15 · iOS finished 1 |
| 가장 최근 | Android finished 10/19/2026, |
| **스토어 제출** | iOS finished 10/7/2026, |
| 서버 표류 (코드 ↔ 실서버) | `./db/local/verify.sh` 로 본다 — 여기서는 안 돌린다(30초) |

## 6. 이 파일이 **재지 못한 것**

★ 비워 두면 **못 잰 것이 사실로 둔갑한다.** 아래는 «모른다 + 어디를 열면 보이나» 다.

**명령으로는 영영 못 재는 것** — 사람이 열어 봐야 한다:

| 무엇 | 어디를 열면 보이나 |
|---|---|
| EAS 무료 플랜 **남은 빌드 수** | expo.dev → 계정 → Billing |
| App Store Connect **무료 앱 계약** 동의 | appstoreconnect.apple.com → 계약, 세금 및 금융 거래 |
| App ID 의 **Sign in with Apple** capability | developer.apple.com → Identifiers → `app.trippic` |
| TestFlight **내부/외부 테스터** 상태 | App Store Connect → 트립픽 → TestFlight |
| Supabase · 카카오 · 공공데이터 **계정 소유자** | 각 대시보드 (→ `DECISIONS.md`) |
| Google Play 개발자 계정 유무 | play.google.com/console (→ `DECISIONS.md`) |

**사람이 정해야 하는 것**(아직 안 정해진 것)은 `DECISIONS.md` 에 있다.
