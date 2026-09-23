-- =====================================================================
-- api_map_overview는 **핀을 읽지 않는다.** places와 place_stats만 본다.
-- 따라서 성능을 좌우하는 것은 핀 수가 아니라 **핀이 꽂힌 장소 수**다.
--
-- 그래서 핀을 100만 개씩 심을 필요가 없다 (그렇게 하다 IO로 16분을 태웠다).
-- public_pin_count만 직접 세팅하면 같은 질문에 초 단위로 답한다.
--
-- 답하려는 것: **핀이 꽂힌 장소가 몇 곳이 되면 1단계(실시간 집계)가 무너지는가.**
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
begin;

create or replace function pg_temp.bench(label text, rounds int, sql text) returns void
language plpgsql as $$
declare t0 timestamptz; ms numeric; n bigint; r int;
begin
  execute sql into n; t0:=clock_timestamp();
  for r in 1..rounds loop execute sql into n; end loop;
  ms:=extract(epoch from clock_timestamp()-t0)*1000/rounds;
  raise notice '    %-26s % ms  (셀 %)', label, to_char(ms,'FM99990.00'), n;
end $$;

do $$
declare n int; tot bigint := (select count(*) from public.places); t0 timestamptz;
begin
  foreach n in array array[5000, 20000, 50000, 200000, 500000, 1000000] loop
    if n > tot then exit; end if;
    t0 := clock_timestamp();
    update public.places set public_pin_count = 0 where public_pin_count <> 0;
    -- 장소 n곳에 핀이 꽂힌 상태를 만든다 (평균 핀 수는 성능과 무관하다)
    update public.places set public_pin_count = 1 + (ctid::text::point)[1]::int % 40
     where id in (select id from public.places order by id limit n);
    analyze public.places;
    raise notice '';
    raise notice '━━ 핀이 꽂힌 장소 % 곳 (준비 %초) ━━',
      to_char(n,'FM9,999,999'), round(extract(epoch from clock_timestamp()-t0));
    perform pg_temp.bench('넓은 bbox (서울 전역)', 3,
      'select count(*) from public.api_map_overview(126.800,37.400,127.200,37.700,12,null::pin_category,300)');
    perform pg_temp.bench('전국', 3,
      'select count(*) from public.api_map_overview(125.0,33.0,131.0,39.0,12,null::pin_category,300)');
    perform pg_temp.bench('좁은 bbox (강남 한 화면)', 3,
      'select count(*) from public.api_map_overview(127.020,37.490,127.040,37.510,12,null::pin_category,300)');
  end loop;
end $$;
rollback;
