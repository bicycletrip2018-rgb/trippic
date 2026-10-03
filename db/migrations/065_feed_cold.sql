-- =====================================================================
-- 065 **차가운 첫 호출** — 재고 나서 고친다 (§13.107)
--
-- §13.85 가 *"첫 호출은 2~3초다(**차가운 버퍼**)"* 라고 적어 두고 넘어갔다.
-- 그 말은 **원인이 아니라 짐작**이었다. 재 보니 이렇다:
--
--   · 새 psql 연결에서 한 번 부르면 190ms — PostgREST 가 느린 게 아니다
--   · `EXPLAIN (ANALYZE, BUFFERS)` → **버퍼 6,314장**(해운대) · **15,608장**(강남)
--   · 강남은 `temp read=433 written=434` — **정렬이 디스크로 샌다**
--
-- 버퍼 한 장은 8KB 다. 6,314장이면 **49MB**, 15,608장이면 **122MB** 를 한 번
-- 부를 때마다 만진다. 데워져 있으면 메모리에서 읽어 빠르지만, **식어 있으면
-- 그만큼을 디스크에서 읽는다** — 그게 2~3초의 정체다.
-- → 그러니 고칠 것은 "버퍼를 데우는 일"이 아니라 **만지는 장수를 줄이는 일**이다.
--
-- 두 가지가 나왔다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① **같은 일을 두 번 한다** — `shown as not materialized`
--
--   `shown` 을 `near` 와 `unseen` 이 **둘 다** 읽는다. `not materialized` 는
--   플래너에게 *"인라인해라"* 는 뜻이라, 그 무거운 반경 스캔이 **두 번** 돈다.
--   실측(해운대): 버퍼 6,314 → **3,295**, 132ms → **74ms**.
--
--   ★ 왜 처음에 `not materialized` 였나 — 조건을 안쪽으로 밀어 넣으라고 둔 것이다.
--     그런데 `near` 는 거리순 정렬이 전부라 **밀어 넣을 조건이 없고**, `unseen` 도
--     `region_code is not null` 하나뿐이다. 얻는 것 없이 **두 배를 치르고 있었다.**
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ② **반경 색인이 너무 많이 집어 온다** — 부분 색인을 새로 둔다
--
--   지금 계획은 이렇게 돈다:
--     BitmapAnd
--       ├ places_image_idx  → 49,296행
--       └ places_geog_gix   → **99,644행** (버퍼 1,669장)
--     → 겹쳐서 2,475행
--
--   즉 **버릴 97,000행을 먼저 집어 온다.** 두 조건을 **한 색인에** 넣으면
--   그 일이 사라진다 — 반경 안에서 **사진 있는 곳만** 바로 나온다.
--   실측(해운대): 색인 스캔 99,644행/1,669장 → **2,858행/43장**.
--   전체 버퍼 3,295 → **1,555**.
--
--   ★ 조건은 함수의 `where` 와 **글자 그대로 같아야** 플래너가 쓴다.
--   ★ `places` 는 **대량으로 한 번 싣는 참고 데이터**다(46만 행, 138MB).
--     쓰기가 드물어서 색인 하나 더 두는 값이 싸다.
--   ★ `concurrently` 는 **안 쓴다** — 마이그레이션은 트랜잭션 안에서 돌고,
--     `concurrently` 는 트랜잭션 안에서 못 쓴다. 지금은 쓰기가 거의 없어
--     잠깐 잠기는 것이 문제가 안 된다.
-- ---------------------------------------------------------------------
create index if not exists places_feed_gix
  on public.places using gist ((geom::geography))
  where image_url is not null and closed_at is null;

comment on index public.places_feed_gix is
  '갈 곳 묶음 전용 — 반경 + 사진 있음을 한 색인에서 끝낸다. 두 색인을 겹치면 버릴 97,000행을 먼저 집어 온다(§13.107).';

-- ---------------------------------------------------------------------
-- 함수는 **한 글자만** 바뀐다: `not materialized` → `materialized`.
-- 나머지는 056 그대로다 — 손대지 않은 것을 손댄 것처럼 보이게 하지 않는다.
-- (056 의 주석은 거기 그대로 있다. 여기서는 바뀐 이유만 적는다.)
-- ---------------------------------------------------------------------
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
    select pl.id, pl.name, pl.category, pl.geom, pl.region_code,
           pl.image_url, pl.image_thumb_url, pl.event_start, pl.event_end
    from public.places pl
    where pl.closed_at is null
      and pl.image_url is not null
      and (pl.event_start is null
           or coalesce(pl.event_end, pl.event_start) >= current_date)
      and ST_DWithin(pl.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  ),
  covered as (
    select pl.id, pl.name, pl.category, pl.geom, pl.region_code,
           pl.image_url, pl.image_thumb_url, pl.event_start, pl.event_end
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
  /* ★ **`materialized` 다**(065). 이 집합을 `near` 와 `unseen` 이 둘 다 읽는데,
     인라인하면 무거운 반경 스캔이 **두 번** 돈다 — 실측으로 버퍼가 꼭 두 배였다. */
  shown as materialized (
    select t.*, ST_Distance(t.geom::geography,
                            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
    from (select * from base union all select * from covered) t
  ),
  ev as (
    select pl.id, pl.name, pl.category, pl.geom, pl.region_code,
           pl.image_url, pl.image_thumb_url, pl.event_start, pl.event_end,
           ST_Distance(pl.geom::geography,
                       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
    from public.places pl
    where pl.closed_at is null and pl.event_start is not null
  ),
  live as (
    select 'live'::text as rail, e.* from ev e
    where e.event_start <= current_date
      and coalesce(e.event_end, e.event_start) >= current_date
    order by e.d limit greatest(1, p_limit)
  ),
  soon as (
    select 'soon'::text as rail, e.* from ev e
    where e.event_start > current_date
    order by e.event_start, e.d limit greatest(1, p_limit)
  ),
  near as (
    select 'near'::text as rail, s.* from shown s
    order by s.d limit greatest(1, p_limit)
  ),
  unseen as (
    select 'unseen'::text as rail, t.*
    from (
      select distinct on (s.region_code) s.*
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
  select a.rail, a.id, a.name, a.category,
         ST_X(a.geom), ST_Y(a.geom), a.d,
         a.image_url, coalesce(a.image_thumb_url, a.image_url),
         a.event_start, a.event_end, rg.name
  from all_rails a
  left join public.regions rg on rg.code = a.region_code;
$$;

comment on function public.api_feed_rails is
  '탭2 `갈 곳` 의 묶음 넷 — 지금 하는 행사 · 곧 시작 · 여기서 가까운 · 아직 안 가본 곳. 065 에서 버퍼를 1/4 로 줄였다(§13.107).';

grant execute on function public.api_feed_rails(double precision, double precision, int, double precision)
  to anon, authenticated;

select public.lock_function_privileges();

analyze public.places;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 아직 **안 고친 것** (고치려면 더 재야 한다)
--   · 강남에서 `temp read/written` 이 난다 — `unseen` 의 `distinct on` 이
--     `shown` 전체를 (지역, 거리)로 **통째로 정렬**한다. 지역마다 한 줄만
--     필요한데 전부 줄 세우는 셈이다. 윈도 함수나 lateral 로 바꿀 수 있는데,
--     **어느 쪽이 빠른지 재 보기 전에는 고치지 않는다**(§13.87 의 교훈).
--   · 반경 30km 는 그대로 둔다. 좁히면 빨라지지만 **보여 줄 것이 줄어든다** —
--     속도를 위해 답을 깎는 것은 마지막 수단이다.
-- ---------------------------------------------------------------------
