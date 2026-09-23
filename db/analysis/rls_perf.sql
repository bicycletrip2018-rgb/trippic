-- =====================================================================
-- RLS 성능 실측 — 정책이 지도 조회를 얼마나 느리게 하는가
--
-- 걱정하던 것: pins_read 정책의 `pin_shared_with_me(id)` 가 **핀마다** 호출된다.
--   지도 한 화면에 핀 200개면 서브쿼리 200번이다.
--   security definer라 RLS 재귀는 피했지만 비용은 그대로 남는다.
--
-- 측정 방법: 합성 사용자와 핀을 넣고, 같은 bbox 질의를
--   ① 소유자(authenticated)  ② 비로그인(anon)  ③ 정책 없는 상태(postgres)
-- 로 각각 돌려 비교한다. 차이가 곧 RLS 비용이다.
--
-- 전부 롤백한다. 운영 DB에 그대로 돌려도 안전하다.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;   -- bench() 출력이 notice다
-- Supabase 기본 statement_timeout은 짧다. 합성 데이터 생성에만 늘린다.
set statement_timeout = '15min';
begin;

\timing off

-- ── 합성 데이터 ──────────────────────────────────────────────────────
-- 사용자 50명. 그중 한 명(주인공)이 핀을 많이 갖는다.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'perf'||i||'@t.io'
from generate_series(1, :users) i;

-- 스페이스 하나에 20명을 넣는다 (공유 경로 비용을 재기 위해)
insert into public.spaces (id, type, title, owner_id)
values ('99999999-0000-0000-0000-000000000001', 'shared', '성능시험',
        '00000000-0000-0000-0000-000000000001');
insert into public.space_members (space_id, user_id)
select '99999999-0000-0000-0000-000000000001',
       ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
from generate_series(1, 20) i;

-- 핀: 실제 장소 좌표 위에 올린다. 서울·부산·제주에 실제로 분포한다.
-- ★ 장소를 한 번만 훑는다. 행마다 offset을 걸면 O(n²)라 Supabase가 타임아웃을 낸다.
insert into public.pins (id, user_id, geom, category, visited_at, is_public)
select ('88888888-0000-0000-0000-' || lpad(p.rn::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad((1 + (p.rn % :users))::text, 12, '0'))::uuid,
       p.geom, p.category,
       now() - (p.rn % 900) * interval '1 day',
       (p.rn % 3 = 0)                       -- 3분의 1만 공개
from (
  select geom, category, row_number() over () as rn
  from public.places
  where geom && ST_MakeEnvelope(126.7, 33.2, 129.3, 37.7, 4326)   -- 서울·부산·제주
  limit :pins
) p;

-- 비공개 핀의 절반을 스페이스에 공유 → pin_shared_with_me가 실제로 일하게 만든다
insert into public.pin_spaces (pin_id, space_id)
select id, '99999999-0000-0000-0000-000000000001'
from public.pins where not is_public and (('x'||substr(id::text,1,8))::bit(32)::int % 2) = 0;

analyze public.pins; analyze public.pin_spaces; analyze public.space_members;

select '합성 핀 ' || count(*) || '개 / 공개 ' || count(*) filter (where is_public)
     || ' / 스페이스 공유 ' || (select count(*) from public.pin_spaces) as 준비
from public.pins;

-- ── 측정 ─────────────────────────────────────────────────────────────
-- 강남역 일대 한 화면 정도의 bbox
\set w 127.020
\set s 37.490
\set e 127.040
\set n 37.510

create or replace function pg_temp.bench(label text, rounds int, sql text)
returns void language plpgsql as $$
declare t0 timestamptz; ms numeric; n bigint; r int;
begin
  execute sql into n;                       -- 워밍업 (플랜 캐시·버퍼)
  t0 := clock_timestamp();
  for r in 1..rounds loop execute sql into n; end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / rounds;
  raise notice '  %-42s % ms   (행 %)', label, to_char(ms, 'FM990.00'), n;
end $$;

\echo ''
\echo '── A. 원시 bbox 조회 (RLS 우회 = 소유자 권한) ──'
select pg_temp.bench('정책 없음 (postgres)', 5, format(
  'select count(*) from public.pins where deleted_at is null and geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)',
  :w, :s, :e, :n));

\echo ''
\echo '── B. 로그인 사용자 — pins_read 정책이 걸린다 ──'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.bench('RLS 적용 (핀 소유자, 스페이스 멤버)', 5, format(
  'select count(*) from public.pins where deleted_at is null and geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)',
  :w, :s, :e, :n));
select pg_temp.bench('api_map_places · 렌즈 mine', 5, format(
  'select count(*) from public.api_map_places(%s,%s,%s,%s,''mine'',null,null,null,null,null,null,null,null,200)',
  :w, :s, :e, :n));
select pg_temp.bench('api_map_places · 렌즈 all', 5, format(
  'select count(*) from public.api_map_places(%s,%s,%s,%s,''all'',null,null,null,null,null,null,null,null,200)',
  :w, :s, :e, :n));
select pg_temp.bench('api_map_places · 렌즈 space', 5, format(
  'select count(*) from public.api_map_places(%s,%s,%s,%s,''space'',''99999999-0000-0000-0000-000000000001'',null,null,null,null,null,null,null,200)',
  :w, :s, :e, :n));

\echo ''
\echo '── C. 스페이스 멤버가 아닌 사용자 (pin_shared_with_me가 전부 헛돈다) ──'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000045', false);
select pg_temp.bench('RLS 적용 (남남 — 최악 케이스)', 5, format(
  'select count(*) from public.pins where deleted_at is null and geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)',
  :w, :s, :e, :n));

\echo ''
\echo '── D. 비로그인 웹 뷰어 ──'
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select pg_temp.bench('anon — is_public 분기만 탄다', 5, format(
  'select count(*) from public.pins where deleted_at is null and geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)',
  :w, :s, :e, :n));
select pg_temp.bench('api_map_places · anon', 5, format(
  'select count(*) from public.api_map_places(%s,%s,%s,%s,''all'',null,null,null,null,null,null,null,null,200)',
  :w, :s, :e, :n));

\echo ''
\echo '── E. 실행계획 — 정책이 인덱스를 막는가 ──'
reset role; set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
explain (analyze, costs off, timing off)
select id from public.pins
where deleted_at is null and geom && ST_MakeEnvelope(:w, :s, :e, :n, 4326);

reset role;
rollback;
