-- =====================================================================
-- 056 `갈 곳` 을 **서버에서** 받는다 (§12.25 · §13.81)
--
-- ★ 탭2 는 지금까지 `http://localhost:5173/feed-seed.json` 을 받아 그렸다.
--   **개발 서버가 없으면 탭이 통째로 빈 화면**이다 — 출시된 앱에서는 아예 안 돈다.
--   주석은 *"번들 3.4MB 절약"* 이라고 적혀 있었지만, 절약한 것은 번들이고
--   잃은 것은 **기능 전체**였다.
--
-- ★ 그 사이에 `places` 가 씨앗이 가진 칸을 전부 갖게 됐다 —
--   `image_url` · `event_start/end` · `concept` · `region_code`.
--   실측: 씨앗 **9,696곳** vs places **465,914곳**(열려 있는 것). **48배**다.
--   씨앗을 들고 있을 이유가 남아 있지 않다.
--
-- ★ 성능에서 한 번 크게 틀렸다(기록해 둔다):
--     ST_DWithin(…geography…) 과 `geom <-> point`(KNN)를 **같이** 썼더니 3,220ms.
--     플래너가 두 인덱스 중 하나만 고르고 나머지를 필터로 돌린다.
--     → 하나만 쓴다. 반경으로 자르고 거리로 정렬: **82ms**.
--   §13.71 에서 배운 것과 같은 모양이다 — **먼저 좁히고 그 다음에 고른다.**
-- =====================================================================

drop function if exists public.api_feed_rails(double precision, double precision, int, double precision);

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
  /* ★ **일반 계획을 쓰지 못하게 한다**(§13.87). 본문을 그대로 EXPLAIN 하면 621ms 인데
     함수로 부르면 3.5초였다. 매개변수 있는 SQL 함수는 몇 번 부르고 나면 PostgreSQL 이
     **값을 안 보는 계획(generic plan)** 으로 갈아타는데, 여기서는 그게 치명적이다 —
     반경 안 후보가 해운대 2,534곳 · 강남 14,406곳으로 **5배 넘게 다르다.**
     값을 봐야 맞는 계획이 나온다. */
  set plan_cache_mode = 'force_custom_plan'
  as $$
  /* ★ 기준점을 **CTE 로 빼지 않는다.** 처음엔 `with me as (select ST_MakePoint…)`
     로 두고 `(select g from me)` 로 넘겼는데, 그러면 플래너가 그 값을 상수로 못 보고
     `places_geog_gix` 를 안 쓴다 — 같은 일이 106ms 에서 **2,286ms** 가 됐다.
     식을 그 자리에 적는다. 길어지지만 **인덱스가 듣는다.**

     보여 줄 만한 곳 — 사진이 있거나, **우리 사용자의 표지가 있는 곳**.
     뒤쪽이 §13.74 의 값이다: 관광공사 사진이 없어도 사람이 찍었으면 보여 준다. */
  /* ★ **`image_url is not null` 을 반경 안쪽에 둔다**(§13.87). 이 조건이 선택도의
     거의 전부다 — 빼고 재 보니 CTE 가 14,406행이 아니라 **288,445행**을 물었고
     강남에서 2~4초가 됐다. *"사진이 있거나 표지가 있거나"* 를 한 줄 OR 로 적으면
     그 선택도가 통째로 사라진다.
     → **두 집합을 따로 뽑아 합친다.** 왼쪽은 인덱스가 그대로 듣고,
       오른쪽은 `place_stats`(표지가 붙은 장소)에서 시작해 PK 로 조인하므로 거의 공짜다. */
  with base as (
    select pl.id, pl.name, pl.category, pl.geom, pl.region_code,
           pl.image_url, pl.image_thumb_url, pl.event_start, pl.event_end
    from public.places pl
    where pl.closed_at is null
      and pl.image_url is not null
      /* ★ **끝난 행사는 뺀다**(§13.87). 웹 프로토타입이 이미 적어 뒀다 —
         *"끝난 축제는 정보가 아니라 소음이다."* 그런데 서버로 옮기면서 그 규칙을
         `live`/`soon` 에만 걸고 `near`/`unseen` 에는 안 걸었다. 실제로
         **해운대 모래축제(5월에 끝남)** 가 `아직 안 가본 곳` 에 떠 있었다.
         ★ 날짜를 **모르는 것**은 남긴다 — 모르는 것을 끝났다고 치면
           멀쩡한 축제 1,262건이 통째로 사라진다. */
      and (pl.event_start is null
           or coalesce(pl.event_end, pl.event_start) >= current_date)
      and ST_DWithin(pl.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  ),
  /* 기관 사진이 없어도 **우리 사용자의 표지**가 있으면 보여 준다(§13.74). */
  covered as (
    select pl.id, pl.name, pl.category, pl.geom, pl.region_code,
           pl.image_url, pl.image_thumb_url, pl.event_start, pl.event_end
    from public.place_stats st
    join public.places pl on pl.id = st.place_id
    where st.top_media_id is not null
      and pl.closed_at is null
      and pl.image_url is null                 -- base 와 겹치지 않게
      and (pl.event_start is null
           or coalesce(pl.event_end, pl.event_start) >= current_date)
      and ST_DWithin(pl.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  ),
  shown as not materialized (
    select t.*, ST_Distance(t.geom::geography,
                            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
    from (select * from base union all select * from covered) t
  ),
  /* ── 지금 하는 행사 ─────────────────────────────────────────────
     ★ 행사는 **반경을 두지 않는다.** 전국에 날짜가 있는 것이 수백 개뿐이고,
       *"오늘 뭐 하나"* 는 조금 멀어도 답이 되는 질문이다. 대신 가까운 순으로 준다. */
  ev as (
    /* ★ `shown` 과 **같은 칸**을 뽑는다. 아래에서 네 묶음을 union all 하므로
       한쪽만 `pl.*` 로 두면 칸 수가 어긋나 함수가 통째로 안 선다(실제로 겪었다). */
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
  /* ── 아직 안 가본 곳 ───────────────────────────────────────────
     ★ 씨앗판은 *"안 가본 곳"* 이라고 적어 놓고 **어디를 가 봤는지 몰랐다.**
       거리순 앞쪽을 빼고 지역마다 하나씩 흩은 것이 전부였다 — 이름이 거짓말이었다.
       서버에는 내 핀이 있으므로 **진짜로** 뺄 수 있다.
     ★ 지역마다 하나씩. 같은 동네 열두 곳을 주면 *"다른 데"* 라는 뜻이 사라진다. */
  unseen as (
    select 'unseen'::text as rail, t.*
    from (
      select distinct on (s.region_code) s.*
      from shown s
      where s.region_code is not null
        /* ★ **`가까운` 에 이미 나온 곳은 뺀다.** 안 빼면 가장 가까운 지역의
           대표가 곧 가장 가까운 곳이라 **두 묶음의 첫 카드가 똑같아진다** —
           실제로 그렇게 나왔다. 씨앗판 주석이 이걸 이미 경고해 뒀는데
           (*"같은 묶음 두 개는 하나보다 나쁘다"*) 서버로 옮기면서 되살렸다.
           **고쳐 둔 것을 다시 밟지 않으려면 옮길 때 그 주석까지 옮겨야 한다.** */
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
  '탭2 갈 곳의 묶음 넷(지금 하는 행사·곧 시작·가까운·안 가본 곳)을 한 번에. 씨앗 파일을 대신한다 — 개발 서버 없이도 돌고, 장소가 48배다(§13.81).';

grant execute on function public.api_feed_rails(double precision, double precision, int, double precision)
  to anon, authenticated;

select public.lock_function_privileges();
