-- =====================================================================
-- 085 지역을 **검색에서는 먼저**, 후보에서는 **빼고** (§13.161)
--
-- 084 가 읍·면·리 3,477곳을 `places` 에 넣었다. 이제 두 자리를 손본다.
--
-- ① `api_search` — 지역에 가산점
--    *"양수리"* 를 친 사람이 찾는 것은 `양수리매운탕` 이 아니다. 082 가
--    카테고리 희소성으로 랜드마크를 올렸듯, 지역도 **그 질의의 답**이다.
--    지역은 `category='etc'` 라 `place_tier` 가 0 이다 — 따로 더해야 한다.
--
--    실측 similarity('양수리매운탕','양수리') = 0.5 이므로
--      양수리매운탕 : 2.5(앞머리) + 2.0×0.5            = 3.50
--      양수리(지역)  : 2.0(완전) + 2.5 + 2.0×1.0 + 3.5 = 10.0   ← 1위
--
-- ② `api_place_candidates` — 지역을 **뺀다**
--    *"지금 여기"* 의 후보는 **17m 앞 가게**를 고르는 자리다. 거기에
--    1.2km 밖 지역 중심이 섞이면 고르는 일을 방해하고, 더 나쁘게는
--    **'현장 인증'이 지역에 붙는다**(009 의 부착 거리를 우연히 통과하면).
--    인증은 *"그 자리에서 찍었다"* 를 뜻한다 — 범위에는 붙을 수 없다.
--    지역은 **검색으로** 찾는다.
-- =====================================================================

create or replace function public.api_place_candidates(
  p_lng double precision,
  p_lat double precision,
  p_cat pin_category default null,
  p_cat_conf real default 0.0,
  p_gps_acc_m double precision default 15,
  p_limit int default 10
)
returns table (
  place_id uuid, name text, category pin_category, address text,
  dist_m double precision, score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with anchor as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           public.geo_cell(p_lng, p_lat) as cell,
           public.candidate_radius(p_gps_acc_m) as radius_m
  )
  select pl.id, pl.name, pl.category, pl.address,
         ST_Distance(pl.geom::geography, a.g) as dist_m,
         public.candidate_score(
           ST_Distance(pl.geom::geography, a.g),
           (p_cat is not null and pl.category = p_cat),
           coalesce(p_cat_conf, 0),
           coalesce(pl.is_ground, true),
           coalesce(pk.pick_count, 0),
           coalesce(st.score, 0)
         ) as score
  from anchor a
  join public.places pl
    on ST_DWithin(pl.geom::geography, a.g, a.radius_m)
  left join public.place_picks pk on pk.place_id = pl.id and pk.cell = a.cell
  left join public.place_stats st on st.place_id = pl.id
  where coalesce(pl.geom_offset_m, 0) <= 1000
    and not pl.is_area                      -- ★ 085
  order by score desc
  limit greatest(1, least(p_limit, 20));
$$;

comment on function public.api_place_candidates is
  '그 좌표 근처의 장소 후보. **지역(is_area)은 뺀다**(085) — 현장 인증이 붙는
   자리라 범위가 아니라 지점이어야 한다.';

grant execute on function public.api_place_candidates(
  double precision, double precision, pin_category, real, double precision, int)
  to anon, authenticated;

-- ── 검색: 지역 가산점 ────────────────────────────────────────────────
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
  category text, address text, dist_m double precision
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
           null::text, null::text, null::double precision
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
             c.category::text, c.address, c.d
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
             c.category::text, c.address, null::double precision
      from cand c
      left join public.regions rg on rg.code = c.region_code
      order by 8 desc, length(c.name), c.name
      limit v_n;
end if;
end $$;

comment on function public.api_search is
  '장소·지역 검색. 순위 = 관련도 + 카테고리 희소성 + **행정구역 가산(085)** +
   자체 인기도 + 거리. 두 경우를 갈라 쓴다(062, 색인).';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
