-- =====================================================================
-- 070 `api_feed_rails` 가 **임시파일에 두 번 쏟던 것**을 멈춘다 (§13.132)
--
-- §13.108 이 남긴 숙제: *"`unseen` 의 temp — **재고 나서**"*.
-- 쟀다. 그리고 **가정이 반만 맞았다.**
--
-- ── 실측 (강남 127.0276/37.4979 · r=30km · work_mem 2,184kB) ────────
--   따뜻할 때 205ms · temp read 865 / written 866  (매 호출마다)
--
--   | 자리                          | temp                        |
--   |-------------------------------|-----------------------------|
--   | `shown` CTE **구체화**        | written **431** (≈3.4MB)    |
--   | `unseen` 의 `distinct on` 정렬 | external merge **3,464kB**  |
--
--   `unseen` 만 보고 있었는데 **`shown` 도 똑같이 쏟고 있었다.** 14,215행 ×
--   228바이트 ≈ 3.2MB 라 `work_mem`(2,184kB)에 안 들어간다. `near` 와 `unseen`
--   이 그걸 **다시 읽는다**(read 865).
--
-- ── 왜 그렇게 넓었나 ────────────────────────────────────────────────
-- `shown` 이 `name`·`category`·`geom`·`image_url`·`image_thumb_url`·
-- `event_start`·`event_end` 를 **14,215행 내내 들고 다녔다.** 그런데 그 칸들은
-- **마지막 48행**에만 필요하다. 고르는 데 쓰는 것은 `id`·`region_code`·`d` 뿐이다.
--
-- ── 고침: **고를 때는 좁게, 보여 줄 때 붙인다** ─────────────────────
-- `shown` 을 (id, region_code, d) 로 줄이고, 마지막에 `places` 를 **다시 조인**한다.
-- 폭이 228 → 40바이트 언저리가 되어 14,215행이 **메모리에 들어간다.**
--
-- ★ `work_mem` 을 올리는 쪽은 안 골랐다. 그건 **쏟는 것을 숨기는 것**이지
--   옮기는 양을 줄이는 것이 아니고, 접속마다 메모리를 더 잡아 남이 대신 낸다.
--
-- ★ **순서를 명시적으로 들고 간다.** 전에는 Append 순서와 각 CTE 의 정렬이
--   그대로 흘러나왔다 — 조인을 붙이면 그 암묵적 순서가 깨진다. 앱은 레일별로
--   거르지만 **레일 안의 순서**(가까운 순·날짜 순)에는 기댄다. `rk`·`pos` 로
--   적어 둔다 — 전에 보장되던 것을 **말로 바꿔 적는 것**이지 새 규칙이 아니다.
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
           row_number() over (order by e.d) as pos, e.id, e.d
    from ev e
    where e.event_start <= current_date
      and coalesce(e.event_end, e.event_start) >= current_date
    order by e.d limit greatest(1, p_limit)
  ),
  soon as (
    select 'soon'::text as rail, 2 as rk,
           row_number() over (order by e.event_start, e.d) as pos, e.id, e.d
    from ev e
    where e.event_start > current_date
    order by e.event_start, e.d limit greatest(1, p_limit)
  ),
  near as (
    select 'near'::text as rail, 3 as rk,
           row_number() over (order by s.d) as pos, s.id, s.d
    from shown s
    order by s.d limit greatest(1, p_limit)
  ),
  unseen as (
    select 'unseen'::text as rail, 4 as rk,
           row_number() over (order by t.d) as pos, t.id, t.d
    from (
      select distinct on (s.region_code) s.id, s.region_code, s.d
      from shown s
      where s.region_code is not null
        and not exists (select 1 from near n where n.id = s.id)
        and not exists (
          select 1 from public.pins p
          where p.place_id = s.id and p.user_id = auth.uid() and p.deleted_at is null)
      order by s.region_code, s.d
    ) t
    order by t.d limit greatest(1, p_limit)
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
  '피드 네 줄. 고를 때는 (id,지역,거리)만 들고 보여 줄 때 붙인다 — 임시파일로 안 쏟는다(§13.132).';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
