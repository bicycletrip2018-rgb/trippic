-- =====================================================================
-- 094 **순위를 매기기 전에 버리고 있었다** (§13.169)
--
-- 사용자: *"가게 외에 광안리, 북한산 등 자연도 해당 위치 이름이 뜨는지 확인해줘."*
--
-- 재 봤다. 광안리 모래밭(129.1185, 35.1532)에서 「광안리」로 검색하면:
--
--     광안리그집(stay) · 광안리와랑(stay) · 광안리끄티집(bar) · 광안리대패(food) …
--
-- **열두 칸에 「광안리해수욕장」이 없다.** 그런데 그 해변은 **43m** 앞에 있다.
--
-- ★ 처음에는 순위식(082)을 의심했다 — `similarity('광안리해수욕장','광안리')`
--   가 **0.333** 인데 `similarity('광안리','광안리')` 는 **1.000** 이라,
--   트라이그램이 **이름이 길수록 벌을 준다.** 그럴듯했다. 그런데 아니었다.
--
-- ★ 진짜 원인은 **후보를 모으는 단계**다:
--
--     1500m 안에서 '광안리' 를 포함하는 장소 = **187곳**
--     그런데 `cand` 가 `limit 60` 인데 **order by 가 없다.**
--
--   정렬 없는 `limit` 은 «아무 60개» 다. 순위식은 그 60개 안에서만 돈다 —
--   **해수욕장은 순위에서 진 것이 아니라 심사장에 못 들어갔다.**
--
-- → 자르기 **전에** 세운다. 정확히 같은 이름 → 접두 일치 → 랜드마크 → 가까운 순.
--   순위식(082)은 **한 줄도 안 건드렸다.** 고칠 곳이 거기가 아니었다.
--
-- ★ 좌표 없는 가지(`else`)는 **이미 `order by length(name), name` 으로 자르고
--   있었다.** 그래서 「북한산」을 좌표 없이 찾으면 북한산성·북한산 족두리봉·
--   북한산국립공원이 **잘 나온다.** 두 가지가 달랐고, 나쁜 쪽만 좌표를 받는다.
-- =====================================================================

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
  is_area boolean
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
        /* ★ **자르기 전에 세운다**(094). 이 줄이 없어서 187곳 중 «아무 60개» 가
           심사장에 들어갔고, 43m 앞의 해수욕장이 거기서 빠졌다. */
        order by (pl.name = v_s) desc,
                 (pl.name ilike v_s || '%') desc,
                 public.place_tier(pl.category) desc,
                 ST_Distance(pl.geom::geography,
                             ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography)
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
        order by public.place_tier(pl.category) desc, length(pl.name), pl.name
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
        order by public.place_tier(pl.category) desc, length(pl.name), pl.name
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
end;
$$;

comment on function public.api_search is
  '장소·지역 검색. ★ 후보를 **자르기 전에 세운다**(094) — 정확 일치 → 접두 →
   랜드마크 → 가까운 순. 그 전에는 정렬 없는 limit 이라 43m 앞의 해수욕장이
   심사장에 못 들어갔다. 순위식은 082 그대로다.';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
