-- =====================================================================
-- TRIPPIC · 003 인덱스
-- 질의 패턴: (a) 뷰포트 bbox 교차  (b) 기준점 반경  (c) 상호명 검색
--            (d) 렌즈별 필터       (e) 여행별 필터
-- =====================================================================

-- ---- 행정경계 ----
create index regions_geom_gix on public.regions using gist (geom);
create index regions_bbox_gix on public.regions using gist (bbox);
create index regions_sido_idx on public.regions (sido);

-- ---- 프로필 ----
create unique index profiles_handle_key on public.profiles (lower(handle));

-- ---- 스페이스 ----
create index space_members_user_idx on public.space_members (user_id);
create index spaces_owner_idx on public.spaces (owner_id) where deleted_at is null;

-- ---- 여행 ----
create index trips_user_date_idx on public.trips (user_id, start_date desc)
  where deleted_at is null;
create index trip_spaces_space_idx on public.trip_spaces (space_id);

-- ---- 장소 ----
create index places_geom_gix on public.places using gist (geom);
-- 반경 검색(ST_DWithin, 미터)용. geography 캐스팅은 별도 인덱스가 필요하다
create index places_geog_gix on public.places using gist ((geom::geography));
create index places_region_idx on public.places (region_code);
create index places_name_trgm on public.places using gin (name gin_trgm_ops);

-- ---- 기록 ----
-- (a) 뷰포트 교차 — 가장 빈번한 질의
create index pins_geom_gix on public.pins using gist (geom)
  where deleted_at is null;
-- (b) 기준점 반경
create index pins_geog_gix on public.pins using gist ((geom::geography))
  where deleted_at is null;
-- (d) 모두의 지도 — 공개 기록만, 공간 인덱스와 결합
create index pins_public_geom_gix on public.pins using gist (geom)
  where deleted_at is null and is_public;
-- (d) 내 지도 / 프로필 지도
create index pins_user_idx on public.pins (user_id, visited_at desc)
  where deleted_at is null;
-- (e) 여행별 필터
create index pins_trip_idx on public.pins (trip_id) where deleted_at is null;
-- 장소 집계 갱신
create index pins_place_idx on public.pins (place_id) where deleted_at is null;
-- 커버리지 집계 / 지역 리스트
create index pins_region_idx on public.pins (region_code) where deleted_at is null;
-- 연도 슬라이더
create index pins_visited_idx on public.pins (visited_at) where deleted_at is null;

create index pin_spaces_space_idx on public.pin_spaces (space_id);

-- ---- 미디어 ----
create index media_pin_idx on public.media (pin_id, sort_order);

-- ---- 반응 ----
create index reactions_target_idx on public.reactions (target_type, target_id, kind);

-- ---- 집계 ----
create index region_progress_scope_idx on public.region_progress (scope_type, scope_id);
create index place_stats_score_idx on public.place_stats (score desc);

-- ---- 신고 ----
create index reports_open_idx on public.reports (status, created_at desc) where status = 'open';
