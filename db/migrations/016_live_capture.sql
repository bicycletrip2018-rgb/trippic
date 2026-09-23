-- =====================================================================
-- TRIPPIC · 016 "지금 여기" — 현장 촬영의 무결성
--
-- 세 진입점의 기준 좌표가 다르다 (§6.5):
--   앨범 소급 등록 → **사진 EXIF**        verification='exif'
--   지금 여기      → **현재 GPS**          verification='live'
--   지도에서 찍기  → 사용자 지정           verification='manual' (공개 불가, 009)
--
-- `live`는 셋 중 가장 신뢰도가 높다. compute_place_score가 live_count를 쓰고,
-- 앞으로 '실방문 인증' 같은 표시의 근거가 된다. 그러니 **주장만으로 두면 안 된다.**
-- =====================================================================

-- `live`인데 찍은 시각이 등록 시각과 한참 떨어져 있으면 현장 촬영이 아니다.
-- 3년 전 사진을 올리면서 live라고 주장하는 것을 막는다.
-- (하루 여유: 시간대 차이와 업로드 지연을 감안한다.)
alter table public.pins drop constraint if exists pins_live_is_recent;
alter table public.pins add constraint pins_live_is_recent check (
  verification <> 'live'
  or visited_at between created_at - interval '1 day' and created_at + interval '1 day'
);

comment on constraint pins_live_is_recent on public.pins is
  'live는 현장 촬영이다. 찍은 시각과 등록 시각이 하루 이상 벌어지면 live가 아니다.';

-- GPS 정확도를 남긴다 — 무엇을 근거로 live라고 했는지 기록한다.
-- 후보 반경(candidate_radius)도 이 값에서 나온다.
alter table public.pins add column if not exists gps_accuracy_m real;
comment on column public.pins.gps_accuracy_m is
  '등록 시점에 기기가 보고한 위치 정확도(m). live는 기기 GPS, exif는 사진 메타데이터.';

-- 정확도가 형편없으면 live라고 부르지 않는다. 기기가 위치를 모른다는 뜻이다.
-- 150m는 candidate_radius의 상한(300m)의 절반 — 그보다 나쁘면 장소를 특정할 수 없다.
alter table public.pins drop constraint if exists pins_live_needs_accuracy;
alter table public.pins add constraint pins_live_needs_accuracy check (
  verification <> 'live' or coalesce(gps_accuracy_m, 999) <= 150
);

comment on constraint pins_live_needs_accuracy on public.pins is
  '정확도 150m 초과면 live가 아니다 — 그 정도면 장소를 특정할 수 없다. exif나 manual로 남긴다.';

select public.lock_function_privileges();
