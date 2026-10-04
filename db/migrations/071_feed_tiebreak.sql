-- =====================================================================
-- 071 피드의 **동점을 깬다** (§13.132)
--
-- 070 을 올리고 전후를 맞춰 보니 `near` 의 **마지막 한 자리**가 바뀌어 있었다.
-- 거리 수열은 글자 그대로 같았다:
--
--     55 69 69 88 88 90 90 90 93 94 94 98        (전·후 동일)
--
-- 데이터를 보니 **거리가 정확히 같은 곳들**이 있다 — 같은 건물의 여러 상호다:
--
--     69.171m 세 곳 · 87.811m 두 곳 · 90.206m 세 곳 · 98.299m 두 곳
--
-- 12번째 자리가 하필 98.299m 동점에 걸린다. `order by d limit 12` 에는
-- **동점을 깨는 기준이 없어서**, 누가 잘리는지가 **스캔 순서**로 정해진다.
-- 070 이 계획을 바꾸자 그 순서가 바뀌었다.
--
-- ★ **070 이 만든 버그가 아니라 070 이 드러낸 것이다.** 전에도 계획이 바뀌면
--   같은 자리에서 **다른 목록**이 나올 수 있었다 — 사용자에게는 이유 없이
--   어제 보이던 곳이 사라지는 일이다. 보이지 않으니 아무도 못 봤다.
--
-- ★ `id` 로 깬다. 뜻이 있는 순서는 아니지만 **고정된다** — 뜻 있는 두 번째
--   기준(평점·사진 수)은 지금 재 본 적이 없고, 안 재고 넣으면 그게 또
--   *"짐작으로 정한 순서"* 가 된다. 재게 되면 그때 바꾼다.
-- =====================================================================

create or replace function public.api_feed_rails(
  p_lng double precision,
  p_lat double precision,
  p_limit int default 12,
  p_radius_m double precision default 30000
)
returns table (
  rail        text,
  place_id    uuid,
  name        text,
  category    pin_category,
  lng         double precision,
  lat         double precision,
  dist_m      double precision,
  image_url   text,
  thumb_url   text,
  event_start date,
  event_end   date,
  region_name text
)
language sql stable security invoker
  set search_path = public, extensions
  set plan_cache_mode = 'force_custom_plan'
  as $$
  with base as (
    select pl.id, pl.geom, pl.region_code
    from public.places pl
    where pl.closed_at is null
      and pl.image_url is not null
      and (pl.event_start is null
           or coalesce(pl.event_end, pl.event_start) >= current_date)
      and ST_DWithin(pl.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  ),
  covered as (
    select pl.id, pl.geom, pl.region_code
    from public.place_stats st
    join public.places pl on pl.id = st.place_id
    where st.top_media_id is not null
      and pl.closed_at is null
      and pl.image_url is null
      and (pl.event_start is null
           or coalesce(pl.event_end, pl.event_start) >= current_date)
      and ST_DWithin(pl.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  ),
  /* ★ **좁다.** 고르는 데 필요한 세 칸만 든다 — 이게 070 의 전부다.
     `materialized` 는 그대로 둔다(065): `near` 와 `unseen` 이 둘 다 읽으므로
     인라인하면 무거운 반경 스캔이 두 번 돈다. */
  shown as materialized (
    select t.id, t.region_code,
           ST_Distance(t.geom::geography,
                       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
    from (select * from base union all select * from covered) t
  ),
  /* ★ `ev` 는 **안 좁혀도 된다** — 전국 행사가 941행이라 애초에 안 쏟는다.
     재지도 않고 넓게 손대면 그게 §13.108 이 경계한 "짐작으로 고치기"다. */
  ev as (
    select pl.id, pl.event_start, pl.event_end,
           ST_Distance(pl.geom::geography,
                       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
    from public.places pl
    where pl.closed_at is null and pl.event_start is not null
  ),
  live as (
    select 'live'::text as rail, 1 as rk,
           row_number() over (order by e.d, e.id) as pos, e.id, e.d
    from ev e
    where e.event_start <= current_date
      and coalesce(e.event_end, e.event_start) >= current_date
    order by e.d, e.id limit greatest(1, p_limit)
  ),
  soon as (
    select 'soon'::text as rail, 2 as rk,
           row_number() over (order by e.event_start, e.d, e.id) as pos, e.id, e.d
    from ev e
    where e.event_start > current_date
    order by e.event_start, e.d, e.id limit greatest(1, p_limit)
  ),
  near as (
    select 'near'::text as rail, 3 as rk,
           row_number() over (order by s.d, s.id) as pos, s.id, s.d
    from shown s
    order by s.d, s.id limit greatest(1, p_limit)
  ),
  unseen as (
    select 'unseen'::text as rail, 4 as rk,
           row_number() over (order by t.d, t.id) as pos, t.id, t.d
    from (
      select distinct on (s.region_code) s.id, s.region_code, s.d
      from shown s
      where s.region_code is not null
        and not exists (select 1 from near n where n.id = s.id)
        and not exists (
          select 1 from public.pins p
          where p.place_id = s.id and p.user_id = auth.uid() and p.deleted_at is null)
      order by s.region_code, s.d, s.id
    ) t
    order by t.d, t.id limit greatest(1, p_limit)
  ),
  all_rails as (
    select * from live union all select * from soon
    union all select * from near union all select * from unseen
  )
  /* ★ 보여 줄 칸은 **여기서** 붙인다. 48행에만 붙으므로 넓어도 싸다. */
  select a.rail, pl.id, pl.name, pl.category,
         ST_X(pl.geom), ST_Y(pl.geom), a.d,
         pl.image_url, coalesce(pl.image_thumb_url, pl.image_url),
         pl.event_start, pl.event_end, rg.name
  from all_rails a
  join public.places pl on pl.id = a.id
  left join public.regions rg on rg.code = pl.region_code
  order by a.rk, a.pos;
$$;

comment on function public.api_feed_rails is
  '피드 네 줄. 고를 때는 (id,지역,거리)만 들고 보여 줄 때 붙인다. 동점은 id 로 깬다(§13.132).';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
