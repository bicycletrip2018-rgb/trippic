# TRIPPIC — DB 스키마

Supabase (PostgreSQL 15+ / PostGIS 3) 기준. `PLAN.md`의 결정을 그대로 옮긴 것이다.

> ## ⚠️ 실행 검증 안 됨
> 이 환경에 PostgreSQL이 없어 **한 줄도 실행해 보지 못했다.** 문법 오류가 남아 있을 수 있다.
> 적용 전에 반드시 로컬에서 한 번 돌려 볼 것:
> ```bash
> supabase start
> supabase db reset          # migrations/ 를 순서대로 적용한다
> ```
> 특히 확인해야 할 것:
> - `auth.users` 트리거 생성 권한 (Supabase는 허용하지만 순수 PG에서는 스키마가 없다)
> - `security definer` 함수들의 `search_path` 고정 여부
> - RLS 정책의 상호 참조로 인한 무한 재귀 (헬퍼 함수로 끊어 뒀으나 실측 필요)

## 파일

| 파일 | 내용 |
|---|---|
| `001_extensions_enums.sql` | PostGIS·pgcrypto·pg_trgm, 열거형 12종 |
| `002_tables.sql` | 테이블 14개 |
| `003_indexes.sql` | 공간(GiST)·부분·트라이그램 인덱스 |
| `004_triggers.sql` | 집계 캐시 유지, 가입 시 프로필·개인 스페이스 생성 |
| `005_functions.sql` | 조회 RPC 8개 |
| `006_rls.sql` | Row Level Security |

## 핵심 구조

```
Space (누구와 — 관계, 지속)
  └ Trip (언제 어디 — 여행, 자동 생성)
      └ Pin (1인 1방문 — 공개범위·인증등급이 붙는 곳)
          └ Media (사진 / 15초 클립)

Region (시군구 229) ← 커버리지 집계
  └ Place (POI, 공공데이터) ← Pin이 가리킨다. **지도에 그려지는 단위**
```

### 설계에서 꼭 지킨 것

**1. 기록은 스페이스에 종속되지 않는다.**
`Pin`은 `user_id`를 갖고, 스페이스 공유는 `pin_spaces` N:M이다.
같은 사진 한 장이 내 지도 · 스페이스 · 모두의 지도에 **동시에** 존재한다.

**2. 공개 범위는 Pin의 속성, 지도에 그려지는 것은 Place.**
`모두의 지도` = 공개 Pin이 1개 이상 있는 Place들. 같은 카페에 100명이 올려도 핀은 1개.

**3. 스페이스는 관계 단위다.**
`title`은 `지은이와` · `가족`처럼 사람으로 짓는다. 여행마다 새로 만들지 않는다.

**4. 기본값은 비공개.**
`pins.is_public default false`. 공개는 언제나 명시적 선택의 결과다.

**5. 집계는 캐시한다.**
커버리지를 매번 `COUNT`로 계산하지 않는다 → `region_progress`.
장소 점수도 트리거로 유지한다 → `place_stats`.

## 노출 점수 — `compute_place_score()`

반응 수만 보면 인스타·블로그와 같은 구조가 되어 협찬이 들어온다. (`PLAN.md` §8.5)

| 신호 | 계수 | 이유 |
|---|---:|---|
| 서로 다른 방문자 수 | `3.0 × ln(1+n)` | 한 사람이 100번보다 20명이 한 번씩이 신뢰된다 |
| 현장 인증(`live`) 비율 | `2.0 ×` | 조작이 가장 어렵다 |
| 저장 수 | `1.5 × ln(1+n)` | 좋아요보다 의도가 분명 |
| 글이 있는 기록 비율 | `1.0 ×` | 광고성 덤프에는 맥락이 없다 |
| 좋아요 수 | `0.5 × ln(1+n)` | 가장 조작하기 쉽다 |
| **한 계정 집중** | `− 1.5 ×` | `pin_count / visitor_count`가 2를 넘으면 감점 (홍보 계정 패턴) |

## 조회 RPC

| 함수 | 쓰임 |
|---|---|
| `api_map_places(...)` | **지도 핀 + 바텀시트 리스트 공용.** 둘이 같은 결과를 쓴다 |
| `api_map_clusters(...)` | z≤11 서버 클러스터. 대표 사진(`cover_url`)을 함께 내려준다 |
| `api_search(q)` | 지역 + 장소 통합 검색. 장소에는 썸네일 |
| `api_places_near(...)` | 기준점 반경. `dist_m` 포함 |
| `api_trips_in_view(...)` | 여행 체크박스 필터의 소스 |
| `api_coverage(...)` | 헤더의 `36.0% · 90/250` |
| `api_is_near_home(...)` | 자택 근접 경고. **좌표는 반환하지 않는다** |

`api_map_places`는 렌즈 4종(`all` / `mine` / `profile` / `space`)과
카테고리 · 여행 · 기간 · 기준점 반경 필터를 한 함수에서 처리한다.

### 좌표 프라이버시
소유자가 아닌 행은 `blur_coord()`로 **소수 3자리(약 100m)** 로 반올림해 내보낸다.
`profiles.home_geom`은 컬럼 GRANT에서 제외해 어떤 경로로도 나가지 않는다.

## 데이터 적재 순서

1. **regions** — VWorld/SGIS 시·군·구 경계. `bbox`, `center`는 임포트 시 채운다
   ```sql
   update public.regions set bbox = ST_Envelope(geom), center = ST_PointOnSurface(geom);
   ```
2. **places** — 공공데이터포털 소상공인 상가업소정보(`source='public_data'`)
   + 한국관광공사 TourAPI(`source='tour_api'`). `source_ref`로 재임포트 멱등성 확보
3. 나머지는 앱에서 생성

> 상용 지도 API(네이버·카카오) 결과는 **저장하지 않는다.** 약관 문제이자 이 설계의 전제다.
> 자체 DB 미스 시 폴백 조회는 화면 표시 전용이며 DB에 넣지 않는다.

## 알려진 한계 / 확인 필요

- **렌즈 조건을 인라인했다.** 함수로 감싸면 플래너가 부분 인덱스
  (`pins_public_geom_gix`)를 쓰지 못한다. 그래도 파라미터화된 계획에서는
  OR 분기가 남으므로, 프로파일링 후 렌즈별 함수 분리를 검토할 것.
- **`refresh_place_stats`는 동기 트리거다.** 인기 장소에 쓰기가 몰리면 경합이 생긴다.
  트래픽이 붙으면 `pg_cron` 배치나 큐로 빼야 한다.
- **`media_one_main_per_pin` 부분 유니크 인덱스** 때문에 대표 사진 교체는
  "기존 해제 → 신규 지정" 순서로 해야 한다. 한 트랜잭션 안에서 처리할 것.
- 15초 초과 영상·HLS는 스키마에 없다. `media_video_len` 제약을 풀 때 함께 설계한다.
