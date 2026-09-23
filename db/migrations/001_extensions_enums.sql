-- =====================================================================
-- TRIPPIC · 001 확장 & 열거형
-- Supabase (PostgreSQL 15+ / PostGIS 3)
-- =====================================================================

-- ★ Supabase는 확장을 `extensions` 스키마에 둔다 (대시보드에서 켜도 거기로 간다).
--   그래서 이 파일의 create가 no-op이 될 수 있고, 그 경우 ST_*는 public에 없다.
--   모든 함수의 search_path를 `public, extensions`로 둔 이유가 이것이다.
--   (없는 스키마는 search_path에서 조용히 무시되므로 로컬에서도 안전하다.)
create extension if not exists postgis;      -- 공간 인덱스·반경·교차 질의
create extension if not exists pgcrypto;     -- gen_random_uuid, gen_random_bytes
create extension if not exists pg_trgm;      -- 상호명 부분일치 검색
create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- 열거형
-- ---------------------------------------------------------------------

-- 장소·기록 카테고리. PLAN §10 (두 공공데이터 소스를 전수 매핑해 확정)
--   TourAPI 신분류체계 대분류(10개)와 1:1로 맞췄다.
--   기존 7개로는 240개 소분류 중 164개가 'sight' 하나로 뭉개졌다.
--   저장은 10개로 세분화하고, 화면 칩은 6개로 묶는다 — 묶음을 바꿔도 데이터가 살아 있게.
--   맛집을 빼지 않는다. 대신 노출 단계에서 다양성 쿼터로 누른다(§8.5).
create type pin_category as enum (
  'nature',    -- 자연        TourAPI NA (해변 제외)
  'beach',     -- 해변        NA020800 해안절경 · NA020900 해변·해수욕장
  'heritage',  -- 역사·문화    HS + VE      / 상가: 유원지·오락 · 도서관·사적지
  'activity',  -- 체험·레저    EX + LS      / 상가: 스포츠 서비스
  'food',      -- 맛집        FD01~03      / 상가: 음식 − 비알코올 − 주점
  'cafe',      -- 카페        FD05         / 상가: 음식 > 비알코올
  'bar',       -- 술집        FD04         / 상가: 음식 > 주점
  'stay',      -- 숙소        AC           / 상가: 숙박
  'shop',      -- 쇼핑        SH           / 상가: 소매
  'event',     -- 축제·공연    EV
  'etc'
);

-- 인증 등급. PLAN §8
--   EXIF GPS는 조작이 쉬워 '실방문 인증'의 근거로 쓸 수 없다.
--   셋 다 지도는 채우되 뱃지와 노출 가중치만 차등한다.
create type verification_level as enum ('live','exif','manual');

-- 날짜 출처 3단 폴백. PLAN §6.5
create type date_source as enum ('exif','file','manual');

create type media_type as enum ('photo','video');

-- 스페이스는 '관계' 단위다. 여행 단위가 아니다. PLAN §6.7
create type space_type as enum ('personal','shared');
create type space_visibility as enum ('private','link');
create type member_role as enum ('owner','member');

-- 장소 원천. 자체 DB 구축이 핵심 자산. PLAN §10
--   상용 지도 API 결과는 저장하지 않는다(약관). 공공데이터만 적재한다.
create type place_source as enum ('public_data','tour_api','osm','user');

create type reaction_kind as enum ('like','save');
create type reaction_target as enum ('pin','place');

-- 커버리지 집계 범위
create type scope_type as enum ('user','space');

create type report_status as enum ('open','resolved','rejected');
