-- =====================================================================
-- 핀이 늘어날 때 지도 조회가 어떻게 늘어나는가
--
-- definer 전환으로 공간 인덱스를 타게 됐으니 **선형이 아니라 로그**로 늘 것이다.
-- 그건 추정이었다. 여기서 실제로 잰다.
--
-- 핀을 단계적으로 늘리며 같은 bbox 질의를 반복한다. 전부 롤백한다.
-- 단계마다 DB 용량도 같이 찍어 무료 플랜(500MB)을 넘기지 않게 감시한다.
--
-- psql -v users=200 -v steps='100000,300000,600000,1000000' -v maxmb=450
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
set statement_timeout = '30min';
begin;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'sc'||i||'@t.io'
from generate_series(1, :users) i;

insert into public.spaces (id, type, title, owner_id)
values ('99999999-0000-0000-0000-000000000002', 'shared', '규모시험',
        '00000000-0000-0000-0000-000000000001');
insert into public.space_members (space_id, user_id)
select '99999999-0000-0000-0000-000000000002',
       ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
from generate_series(1, 20) i;

-- 실제 장소 위에 핀을 올린다. place_id를 채워야 현실적이다 —
-- 지도는 place 단위로 묶어 보여주므로 place_id가 null이면 그룹이 핀 수만큼 생긴다.
create temp table src as
select id as place_id, geom, category, row_number() over () as rn
from public.places
where geom && ST_MakeEnvelope(126.7, 33.2, 129.3, 37.7, 4326);
create index on src (rn);
analyze src;

create or replace function pg_temp.bench(label text, rounds int, sql text)
returns numeric language plpgsql as $$
declare t0 timestamptz; ms numeric; n bigint; r int;
begin
  execute sql into n;
  t0 := clock_timestamp();
  for r in 1..rounds loop execute sql into n; end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / rounds;
  raise notice '    %-34s % ms  (행 %)', label, to_char(ms,'FM99990.00'), n;
  return ms;
end $$;

-- 단계별로 핀을 더 넣으며 측정
do $$
declare
  target int;
  have   int := 0;
  srcn   int := (select count(*) from src);
  mb     numeric;
  steps  int[] := string_to_array(current_setting('trippic.steps'), ',')::int[];
  maxmb  numeric := current_setting('trippic.maxmb')::numeric;
  users  int := current_setting('trippic.users')::int;
  base_mb numeric := pg_database_size(current_database()) / 1048576.0;
begin
  foreach target in array steps loop
    -- ★ 삽입 전에 예측해서 막는다. 삽입 후에 재면 이미 한 단계 초과다.
    --   (실수로 무료 한도를 넘기면 프로젝트가 읽기 전용으로 잠긴다.)
    if have > 0 then
      mb := pg_database_size(current_database()) / 1048576.0;
      if mb + (mb - base_mb) * (target - have)::numeric / have > maxmb then
        raise notice '';
        raise notice '⚠ 다음 단계(%)를 넣으면 한도 %MB를 넘긴다. 여기서 멈춘다.',
                     to_char(target,'FM999,999,999'), to_char(maxmb,'FM99990');
        exit;
      end if;
    end if;

    -- 이번 단계까지 채운다. 장소 수보다 많으면 순환시킨다.
    insert into public.pins (user_id, place_id, geom, category, visited_at, is_public)
    select ('00000000-0000-0000-0000-' || lpad((1 + (i % users))::text, 12, '0'))::uuid,
           s.place_id, s.geom, s.category,
           now() - (i % 900) * interval '1 day',
           (i % 3 = 0)
    from generate_series(have + 1, target) i
    join src s on s.rn = 1 + (i % srcn);
    have := target;

    insert into public.pin_spaces (pin_id, space_id)
    select id, '99999999-0000-0000-0000-000000000002'
    from public.pins p
    where not p.is_public
      and not exists (select 1 from public.pin_spaces x where x.pin_id = p.id)
      and (p.id::text like '%0' or p.id::text like '%1' or p.id::text like '%2');

    analyze public.pins; analyze public.pin_spaces;

    mb := pg_database_size(current_database()) / 1048576.0;
    raise notice '';
    raise notice '━━ 핀 % 개 · DB % MB ━━', to_char(have,'FM999,999,999'), to_char(mb,'FM99990.0');

    perform pg_temp.bench('api_map_places · all',   3, format(
      'select count(*) from public.api_map_places(127.020,37.490,127.040,37.510,''all'',null,null,null,null,null,null,null,null,200)'));
    perform pg_temp.bench('api_map_places · mine',  3, format(
      'select count(*) from public.api_map_places(127.020,37.490,127.040,37.510,''mine'',null,null,null,null,null,null,null,null,200)'));
    perform pg_temp.bench('api_map_places · 넓은 bbox', 3, format(
      'select count(*) from public.api_map_places(126.800,37.400,127.200,37.700,''all'',null,null,null,null,null,null,null,null,300)'));
    perform pg_temp.bench('api_map_clusters (z12)', 3, format(
      'select count(*) from public.api_map_clusters(126.800,37.400,127.200,37.700,12,''all'',null,null,300)'));
    perform pg_temp.bench('★ api_map_overview · 넓은 bbox', 3, format(
      'select count(*) from public.api_map_overview(126.800,37.400,127.200,37.700,12,null::pin_category,300)'));
    perform pg_temp.bench('★ api_map_overview · 전국', 3, format(
      'select count(*) from public.api_map_overview(125.0,33.0,131.0,39.0,12,null::pin_category,300)'));

  end loop;
end $$;

\echo ''
\echo '── 실행계획 (마지막 단계) ──'
explain (analyze, costs off, timing off)
select count(*) from public.api_map_places(127.020,37.490,127.040,37.510,'all',
       null,null,null,null,null,null,null,null,200);

rollback;
