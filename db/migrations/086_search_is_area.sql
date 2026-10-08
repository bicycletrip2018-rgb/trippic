-- =====================================================================
-- 086 검색 결과에 **"이건 지역이다"** 를 실어 준다 (§13.161)
--
-- 084·085 로 `양수리` 가 검색 1위가 됐다. 그런데 화면에는 **"기타"** 로 뜬다 —
-- 지역은 `category='etc'` 이기 때문이다. 사용자가 보는 글자가
-- *"양수리 · 기타 · 경기도 양평군 양서면"* 이면, **맞는 답을 찾아 주고도
-- 틀린 것처럼 보인다.**
--
-- ★ `category` 를 'area' 같은 값으로 바꾸지 않는다. `pin_category` 는 핀의
--   분류이고 지도 색까지 묶여 있다 — 거기에 행정구역을 섞으면 **지도에 지역
--   색이 생긴다.** 분류와 "무엇인가" 는 다른 축이다. 플래그로 따로 준다.
-- =====================================================================

drop function if exists public.api_search(text, int, double precision, double precision, double precision);

create or replace function public.api_search(
  p_q text,
  p_limit int default 20,
  p_lng double precision default null,
  p_lat double precision default null,
  p_radius_m double precision default 1500
)
returns table (
  kind text, id text, name text, sub text,
  lng double precision, lat double precision,
  cover_url text, rank real,
  category text, address text, dist_m double precision,
  is_area boolean                      -- ★ 086: 화면이 '지역'으로 보여 줄 수 있게
)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_s text := btrim(p_q);
  v_n int  := greatest(1, coalesce(p_limit, 20));
  v_pool int;
begin
  if v_s = '' then return; end if;
  v_pool := greatest(v_n * 4, 60);

  return query
    select 'region'::text, r.code, r.name, r.sido,
           ST_X(r.center), ST_Y(r.center),
           null::text, similarity(r.name, v_s)::real,
           null::text, null::text, null::double precision, false
    from public.regions r
    where r.name ilike '%' || v_s || '%'
    order by similarity(r.name, v_s) desc, r.name
    limit 5;

  if p_lng is not null and p_lat is not null then
    return query
      with cand as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.address,
               pl.geom, pl.source, pl.image_url, pl.public_pin_count, pl.is_area,
               ST_Distance(pl.geom::geography,
                           ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
        from public.places pl
        where pl.closed_at is null
          and ST_DWithin(pl.geom::geography,
                         ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                         p_radius_m)
          and pl.name ilike '%' || v_s || '%'
        limit v_pool
      )
      select 'place'::text, c.id::text, c.name,
             coalesce(rg.name, '') || ' · ' || c.category::text,
             ST_X(c.geom), ST_Y(c.geom), null::text,
             (  (case when c.name = v_s then 2.0 else 0 end)
              + (case when c.name ilike v_s || '%' then 2.5 else 0 end)
              + 2.0 * similarity(c.name, v_s)
              + (case when c.is_area then 3.5 else public.place_tier(c.category) end)
              + (case when c.source = 'tour_api' then 0.3 else 0 end)
              + (case when c.image_url is not null then 0.3 else 0 end)
              + 0.8 * ln(1 + coalesce(c.public_pin_count, 0))
              + 2.0 * (1.0 / (1.0 + c.d / 1000.0))
             )::real,
             c.category::text, c.address, c.d, c.is_area
      from cand c
      left join public.regions rg on rg.code = c.region_code
      order by 8 desc, length(c.name), c.name
      limit v_n;
  else
      return query
      with pre as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.address,
               pl.geom, pl.source, pl.image_url, pl.public_pin_count, pl.is_area
        from public.places pl
        where pl.closed_at is null and pl.name ilike v_s || '%'
        order by length(pl.name), pl.name
        limit v_pool
      ),
      mid as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.address,
               pl.geom, pl.source, pl.image_url, pl.public_pin_count, pl.is_area
        from public.places pl
        where length(v_s) >= 3
          and pl.closed_at is null
          and pl.name ilike '%' || v_s || '%'
          and not exists (select 1 from pre where pre.id = pl.id)
        order by length(pl.name), pl.name
        limit v_pool
      ),
      cand as (select * from pre union all select * from mid)
      select 'place'::text, c.id::text, c.name,
             coalesce(rg.name, '') || ' · ' || c.category::text,
             ST_X(c.geom), ST_Y(c.geom), null::text,
             (  (case when c.name = v_s then 2.0 else 0 end)
              + (case when c.name ilike v_s || '%' then 2.5 else 0 end)
              + 2.0 * similarity(c.name, v_s)
              + (case when c.is_area then 3.5 else public.place_tier(c.category) end)
              + (case when c.source = 'tour_api' then 0.3 else 0 end)
              + (case when c.image_url is not null then 0.3 else 0 end)
              + 0.8 * ln(1 + coalesce(c.public_pin_count, 0))
             )::real,
             c.category::text, c.address, null::double precision, c.is_area
      from cand c
      left join public.regions rg on rg.code = c.region_code
      order by 8 desc, length(c.name), c.name
      limit v_n;
end if;
end $$;

comment on function public.api_search is
  '장소·지역 검색. `is_area` 로 행정구역을 가려 준다(086). 순위 = 관련도 +
   카테고리 희소성 + 행정구역 가산 + 자체 인기도 + 거리.';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
