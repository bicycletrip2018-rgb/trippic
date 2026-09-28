-- =====================================================================
-- 054 검색 반경을 줄인다 — **30km 가 범인이었다** (§13.71)
--
-- ★ 053 이 *"좌표를 주면 그 근처만"* 으로 고쳤는데 기본 반경을 30km 로 뒀다.
--   해운대 기준 30km 는 **부산 대부분**이라 후보가 99,616곳이었다. 실측:
--     30km  396ms
--      3km   55ms
--      1km    8ms
--   *"근처만 본다"* 고 적어 놓고 근처가 아니었다. 숫자를 안 재면 이런 것이 남는다.
--
-- ★ 1.5km 로 잡는다. 자동 매칭을 고치는 상황(§13.70)은 **사진을 찍은 그 자리**를
--   다시 고르는 일이라, 그보다 멀면 애초에 그 사진의 장소가 아니다.
--   더 넓게 봐야 하면 호출부가 값을 준다.
-- =====================================================================
drop function if exists public.api_search(text, int, double precision, double precision, double precision);

create or replace function public.api_search(
  p_q text,
  p_limit int default 20,
  p_lng double precision default null,
  p_lat double precision default null,
  p_radius_m double precision default 1500      -- ★ 30000 → 1500
)
returns table (
  kind text, id text, name text, sub text,
  lng double precision, lat double precision,
  cover_url text, rank real
)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select btrim(p_q) as s),
  reg as (
    select 'region'::text as kind, r.code as id, r.name, r.sido as sub,
           ST_X(r.center) as lng, ST_Y(r.center) as lat,
           null::text as cover_url,
           similarity(r.name, (select s from q))::real as rank
    from public.regions r, q
    where r.name ilike '%' || q.s || '%'
    order by similarity(r.name, (select s from q)) desc, r.name
    limit 5
  ),
  hit as (
    select pl.id, pl.name, pl.region_code, pl.category, pl.geom
    from public.places pl, q
    where pl.closed_at is null
      and (
        (p_lng is not null and p_lat is not null
         and ST_DWithin(pl.geom::geography,
                        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                        p_radius_m)
         and pl.name ilike '%' || q.s || '%')
        or
        /* 좌표를 모르면 앞머리 일치. `places_name_trgm` 이 ILIKE 앞머리에도 듣는다
           (실측 "해%" 344ms) — 부분 일치(`%q%`)는 2글자에서 Seq Scan 으로 떨어진다. */
        (p_lng is null and pl.name ilike q.s || '%')
      )
    order by length(pl.name), pl.name
    limit greatest(1, p_limit)
  ),
  sub as (
    select pl.id, pl.name, pl.region_code, pl.category, pl.geom
    from public.places pl, q
    where p_lng is null and length(q.s) >= 3
      and pl.closed_at is null
      and pl.name ilike '%' || q.s || '%'
      and pl.id not in (select id from hit)
    order by length(pl.name), pl.name
    limit greatest(1, p_limit)
  ),
  merged as (select * from hit union all select * from sub)
  select * from reg
  union all
  (
    select 'place'::text, m.id::text, m.name,
           coalesce(rg.name, '') || ' · ' || m.category::text,
           ST_X(m.geom), ST_Y(m.geom), null::text, 0::real
    from merged m
    left join public.regions rg on rg.code = m.region_code
    order by length(m.name), m.name
    limit greatest(1, p_limit)
  );
$$;

comment on function public.api_search is
  '장소·지역 검색. 좌표를 주면 반경 1.5km 만 본다(실측 8~55ms). 좌표가 없으면 앞머리 일치 + 3자 이상 부분 일치. 점수 정렬을 하지 않는다.';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();
