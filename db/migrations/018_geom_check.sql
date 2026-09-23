-- =====================================================================
-- TRIPPIC · 018 좌표가 주소와 맞는지 표시한다
--
-- 배경(§10.40~41): 전국 경계를 OSM 원본으로 올린 뒤 465,914곳을 다시 판정하니
--   일치 99.90% · 불일치 450건이었다. 그런데 그 450건이 **오류가 아니었다.**
--     · 363건(81%)은 경계에서 **50m 이내** — 선 위다. 좌표 오차나 경계선 차이.
--     · 448건은 **주소가 현재 배정 편**이었다.
--     · 진짜 틀린 것은 **1km를 넘는 25건**뿐이고, 전부 `tour_api` 출처였다.
--       (서울 중구 주소인데 좌표는 평택, 신안군 주소인데 좌표는 군산…)
--
-- ★ 그래서 거르지 않는다. 거르면 멀쩡한 450건이 날아간다.
--   **얼마나 벗어났는지 숫자로 적어 두고**, 쓰는 쪽이 기준을 정하게 한다.
--
-- ★ 자동으로 고치지도 않는다. §10.41에서 '경도-1' 보정이 폴리곤 검사를 통과했는데
--   그 자리가 **바다**인 경우가 나왔다(서산B지구방조제). 실제로는 경계에서 100m였을 뿐이다.
--   폴리곤 검사를 통과한다고 맞는 보정이 아니다.
-- =====================================================================

alter table public.places add column if not exists geom_offset_m real;
alter table public.places add column if not exists geom_checked_at timestamptz;

comment on column public.places.geom_offset_m is
  '좌표가 주소의 시군구 경계에서 몇 m 밖에 있는가. 0이면 안쪽. '
  '50m 이하는 경계 잡음(실측 81%), 1km 초과는 좌표 오류로 본다.';
comment on column public.places.geom_checked_at is
  '마지막으로 검사한 시각. regions 경계가 바뀌면 다시 돌려야 한다.';

-- 의심스러운 것만 빨리 찾기 위한 부분 인덱스 (전체의 0.01%라 아주 작다)
create index if not exists places_geom_suspect_idx
  on public.places (geom_offset_m) where geom_offset_m > 200;
