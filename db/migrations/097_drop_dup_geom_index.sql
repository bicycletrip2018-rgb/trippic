-- =====================================================================
-- 097 **인덱스가 본문보다 컸다** — 겹치는 공간 인덱스 하나 (§13.179)
--
-- DB 여유가 46 MB(454/500)뿐이라 `places`(379 MB)를 줄일 데가 있나 **쟀다.**
-- 그런데 줄일 곳은 데이터가 아니었다:
--
--     본문 138 MB  ·  인덱스 **241 MB**  ·  합계 379 MB
--
-- 칸 하나하나를 더하면 107 MB 다(주소 21 · geom 13 · 이름 8 · 원본키 9 …).
-- **장소를 지울 생각부터 했는데, 문제는 장소가 아니었다.**
--
-- 공간 인덱스가 **다섯 개**나 있었다:
--
--   places_geog_gix       63 MB  gist((geom)::geography)                 3,055,512회
--   places_geom_gix       37 MB  gist(geom)                                    158회  ←
--   places_live_geom_gix  21 MB  gist(geom) where closed_at is null            505회
--   places_feed_gix      3.8 MB  gist(geography) where image_url … closed …    323회
--   places_pinned_gix     24 kB  gist(geom) where public_pin_count > 0         654회
--   (8주치 실사용 통계 — 2026-08-25 부터)
--
-- ★ `places_geom_gix` 와 `places_live_geom_gix` 는 **같은 줄을 가리킨다** —
--   문 닫은 장소가 **0곳**이라 부분 인덱스가 사실상 전체를 덮는다. 그런데도
--   전체 인덱스가 37 MB, 부분이 21 MB 다. 차이는 **불어난 것**(bloat)이다.
--
-- ★ 계획을 찍어 봤다. 실제로 쓰이는 것은 **부분 인덱스**다:
--     Bitmap Index Scan on places_live_geom_gix
--   그래서 8주 동안 158회뿐이었다.
--
-- ★ 그 158회가 **누구였나**도 확인했다. 마이그레이션·적재 스크립트·앱 어디에도
--   `geom &&` 를 쓰면서 `closed_at is null` 을 안 거는 질의가 **없다.**
--   오늘 내가 크기를 재면서 돌린 임시 질의들이다.
--
-- → 지운다. **37 MB** 가 돌아오고 여유가 46 → 83 MB 가 된다.
--
-- ★ 되돌릴 수 있다. 인덱스는 지워도 **데이터가 안 없어진다** — 필요하면
--   `create index` 한 줄로 다시 만든다. 이 점이 «지오메트리 단순화» 와 다르다:
--   그쪽은 재 보니 10m 로 줄여도 **2 MB** 뿐인데 경계가 13.7m 움직이고
--   **원본이 영영 사라진다**(핀에 시군구를 붙이는 트리거가 그 모양을 쓴다).
--   그래서 그건 **안 했다.**
-- =====================================================================

drop index if exists public.places_geom_gix;

comment on index public.places_live_geom_gix is
  '장소의 공간 인덱스(097). 전체판(places_geom_gix)은 같은 줄을 가리키면서 37 MB 를
   쓰고 8주에 158회만 쓰여 지웠다 — 모든 질의가 `closed_at is null` 을 같이 건다.';

select public.lock_function_privileges();
