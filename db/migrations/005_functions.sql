-- =====================================================================
-- TRIPPIC · 005 조회 함수 (RPC)
-- 원칙: 지도와 리스트는 **같은 함수**의 결과를 공유한다.
--       별도 API를 두면 "지도엔 보이는데 리스트엔 없는" 불일치가 생긴다. PLAN §6
-- =====================================================================

-- ---------------------------------------------------------------------
-- 접근 판정 헬퍼 (RLS 재귀를 피하려고 security definer)
-- ---------------------------------------------------------------------
create or replace function public.is_space_member(p_space uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.space_members m
    where m.space_id = p_space and m.user_id = auth.uid());
$$;

create or replace function public.pin_shared_with_me(p_pin uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1
    from public.pin_spaces ps
    join public.space_members m on m.space_id = ps.space_id
    where ps.pin_id = p_pin and m.user_id = auth.uid());
$$;

-- 공개 노출 시 좌표 정밀도를 낮춘다(소수 3자리 ≈ 100m). PLAN §8
create or replace function public.blur_coord(v double precision, p_blur boolean)
returns double precision language sql immutable as $$
  select case when p_blur then round(v::numeric, 3)::double precision else v end;
$$;

-- ---------------------------------------------------------------------
-- 렌즈 필터 정의 (참고용).
-- 실제 질의에서는 이 함수를 호출하지 않고 **조건을 인라인**한다.
-- 함수로 감싸면 플래너가 부분 인덱스(pins_public_geom_gix 등)를 쓰지 못한다.
-- PLAN §6
--   all     : 전체 공개 기록
--   mine    : 내 기록 전부 (공개 여부 무관)
--   profile : 그 사람의 공개 기록만  ← `@누구의 지도`
--   space   : 그 스페이스에 공유된 기록
-- ---------------------------------------------------------------------
create or replace function public.lens_predicate(
  p_pin_user uuid, p_pin_public boolean, p_pin_id uuid,
  p_lens text, p_scope uuid
) returns boolean language sql stable as $$
  select case p_lens
    when 'mine'    then p_pin_user = auth.uid()
    when 'profile' then p_pin_user = p_scope and p_pin_public
    when 'space'   then public.is_space_member(p_scope)
                        and exists (select 1 from public.pin_spaces ps
                                 where ps.pin_id = p_pin_id and ps.space_id = p_scope)
    else p_pin_public
  end;
$$;

-- ---------------------------------------------------------------------
-- 1) 뷰포트 안의 장소 — 지도 핀 + 바텀시트 리스트 공용
--    핀 하나 = 장소 하나다. 같은 카페에 100명이 올려도 핀은 1개.
-- ---------------------------------------------------------------------
create or replace function public.api_map_places(
  p_west double precision, p_south double precision,
  p_east double precision, p_north double precision,
  p_lens text default 'all',
  p_scope uuid default null,
  p_category pin_category default null,
  p_trip_ids uuid[] default null,          -- 여행 체크박스 필터. PLAN §6.7
  p_from timestamptz default null,         -- 연도 슬라이더
  p_to   timestamptz default null,
  p_anchor_lng double precision default null,   -- 기준점. PLAN §6.6
  p_anchor_lat double precision default null,
  p_radius_m   double precision default null,
  p_limit int default 300
)
returns table (
  key           uuid,          -- place_id, 장소 미매칭이면 pin_id
  is_place      boolean,
  place_id      uuid,
  name          text,
  category      pin_category,
  region_code   text,
  lng           double precision,
  lat           double precision,
  pin_count     int,
  visitor_count int,
  save_count    int,
  like_count    int,
  cover_url     text,
  score         real,
  dist_m        double precision
)
-- ★ security definer인 이유 — 실측 (핀 3만개, Supabase)
--     RLS 없이       2.84 ms
--     RLS 적용     695.57 ms   ← 245배
--   pins_read 정책의 pin_shared_with_me(id)가 **핀마다** 호출되고,
--   그 탓에 공간 인덱스도 못 탄다 (Seq Scan). 핀이 100만이면 20초대다.
--   이 함수는 위 vis 절에 **가시성 조건을 이미 전부 갖고 있으므로**
--   RLS를 한 번 더 거는 건 중복이다. definer로 바꿔 중복을 없앤다.
--   ⚠️ 대신 space 렌즈의 is_space_member(p_scope) 검사가 **생명줄**이다.
--      그게 없으면 아무나 남의 space_id를 넣어 비공개 핀을 읽는다.
language sql stable security definer set search_path = public, extensions as $$
  with env as (
    select ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326) as box,
           case when p_anchor_lng is null then null
                else ST_SetSRID(ST_MakePoint(p_anchor_lng, p_anchor_lat), 4326)::geography
           end as anchor
  ),
  vis as (
    select p.*
    from public.pins p, env e
    where p.deleted_at is null
      and ST_Intersects(p.geom, e.box)
      and (p_category is null or p.category = p_category)
      and (p_trip_ids is null or p.trip_id = any(p_trip_ids))
      and (p_from is null or p.visited_at >= p_from)
      and (p_to   is null or p.visited_at <= p_to)
      and (e.anchor is null or p_radius_m is null
           or ST_DWithin(p.geom::geography, e.anchor, p_radius_m))
      and (
        (p_lens = 'all'     and p.is_public)
     or (p_lens = 'mine'    and p.user_id = auth.uid())
     or (p_lens = 'profile' and p.is_public and p.user_id = p_scope)
     or (p_lens = 'space'   and public.is_space_member(p_scope)   -- ★ 행마다가 아니라 한 번만 평가된다
                            and exists (select 1 from public.pin_spaces ps
                                         where ps.pin_id = p.id and ps.space_id = p_scope))
      )
  ),
  grp as (
    select coalesce(v.place_id, v.id)                        as key,
           (v.place_id is not null)                          as is_place,
           v.place_id                                        as place_id,
           count(*)::int                                     as pin_count,
           count(distinct v.user_id)::int                    as visitor_count,
           coalesce(sum(v.save_count),0)::int                 as save_count,
           coalesce(sum(v.like_count),0)::int                 as like_count,
           count(*) filter (where v.verification='live')::int as live_count,
           count(*) filter (where v.memo is not null
                              and length(btrim(v.memo))>0)::int as note_count,
           bool_and(v.user_id = auth.uid())                  as all_mine,
           ST_X(ST_Centroid(ST_Collect(v.geom)))             as lng,
           ST_Y(ST_Centroid(ST_Collect(v.geom)))             as lat,
           (array_agg(v.id order by v.like_count desc, v.save_count desc, v.id))[1] as top_pin_id
    from vis v
    group by coalesce(v.place_id, v.id), (v.place_id is not null), v.place_id
  )
  select
    g.key,
    g.is_place,
    g.place_id,
    coalesce(pl.name, tp.memo, '이름 없는 장소')                 as name,
    coalesce(pl.category, tp.category)                          as category,
    tp.region_code,
    public.blur_coord(g.lng, not g.all_mine)                    as lng,
    public.blur_coord(g.lat, not g.all_mine)                    as lat,
    g.pin_count, g.visitor_count, g.save_count, g.like_count,
    cm.url                                                      as cover_url,
    public.compute_place_score(g.visitor_count, g.live_count, g.pin_count,
                               g.save_count, g.like_count, g.note_count) as score,
    -- 좌표를 흐려도 정밀 거리가 나가면 기준점을 옮겨가며 삼변측량으로 복원할 수 있다.
    -- 남의 기록은 거리도 10m 단위로 끊는다.
    case when e.anchor is null then null
         when g.all_mine then
           ST_Distance(ST_SetSRID(ST_MakePoint(g.lng, g.lat),4326)::geography, e.anchor)
         else
           round(ST_Distance(ST_SetSRID(ST_MakePoint(g.lng, g.lat),4326)::geography,
                             e.anchor)::numeric / 10) * 10
    end                                                         as dist_m
  from grp g
  cross join env e
  join public.pins tp on tp.id = g.top_pin_id
  left join public.places pl on pl.id = g.place_id
  left join lateral (
    select m.url from public.media m
    where m.pin_id = g.top_pin_id
    order by m.is_main desc, m.sort_order asc, m.created_at asc
    limit 1
  ) cm on true
  order by score desc
  limit greatest(1, least(p_limit, 1000));
$$;

comment on function public.api_map_places is
  '뷰포트 기반 장소 조회. 지도와 리스트가 같은 결과를 쓴다. 상한을 두고 점수순으로 자른다.';

-- ---------------------------------------------------------------------
-- 2) 저줌 클러스터 — 서버에서 격자로 묶어 내려준다. PLAN §6
--    z ≤ 11 에서는 클라이언트가 전량을 받지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.api_map_clusters(
  p_west double precision, p_south double precision,
  p_east double precision, p_north double precision,
  p_cells int default 14,                   -- 화면 가로를 몇 칸으로 쪼갤지
  p_lens text default 'all',
  p_scope uuid default null,
  p_category pin_category default null,
  p_limit int default 200
)
returns table (
  lng double precision, lat double precision,
  cnt int, cover_url text
)
-- ★ security definer인 이유 — 실측 (핀 3만개, Supabase)
--     RLS 없이       2.84 ms
--     RLS 적용     695.57 ms   ← 245배
--   pins_read 정책의 pin_shared_with_me(id)가 **핀마다** 호출되고,
--   그 탓에 공간 인덱스도 못 탄다 (Seq Scan). 핀이 100만이면 20초대다.
--   이 함수는 위 vis 절에 **가시성 조건을 이미 전부 갖고 있으므로**
--   RLS를 한 번 더 거는 건 중복이다. definer로 바꿔 중복을 없앤다.
--   ⚠️ 대신 space 렌즈의 is_space_member(p_scope) 검사가 **생명줄**이다.
--      그게 없으면 아무나 남의 space_id를 넣어 비공개 핀을 읽는다.
language sql stable security definer set search_path = public, extensions as $$
  with env as (
    select ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326) as box,
           greatest((p_east - p_west) / greatest(p_cells,1), 0.0005) as cell
  ),
  vis as (
    select p.id, p.geom, p.like_count,
           ST_SnapToGrid(p.geom, e.cell, e.cell) as cellpt
    from public.pins p, env e
    where p.deleted_at is null
      and ST_Intersects(p.geom, e.box)
      and (p_category is null or p.category = p_category)
      and (
        (p_lens = 'all'     and p.is_public)
     or (p_lens = 'mine'    and p.user_id = auth.uid())
     or (p_lens = 'profile' and p.is_public and p.user_id = p_scope)
     or (p_lens = 'space'   and public.is_space_member(p_scope)   -- ★ 행마다가 아니라 한 번만 평가된다
                            and exists (select 1 from public.pin_spaces ps
                                         where ps.pin_id = p.id and ps.space_id = p_scope))
      )
  ),
  grp as (
    select ST_X(cellpt) as gx, ST_Y(cellpt) as gy,
           count(*)::int as cnt,
           ST_X(ST_Centroid(ST_Collect(geom))) as lng,
           ST_Y(ST_Centroid(ST_Collect(geom))) as lat,
           (array_agg(id order by like_count desc, id))[1] as top_pin_id
    from vis group by ST_X(cellpt), ST_Y(cellpt)
  )
  select g.lng, g.lat, g.cnt, cm.url
  from grp g
  left join lateral (
    select m.url from public.media m
    where m.pin_id = g.top_pin_id
    order by m.is_main desc, m.sort_order asc limit 1
  ) cm on true
  order by g.cnt desc
  limit greatest(1, least(p_limit, 1000));
$$;

comment on function public.api_map_clusters is
  '클러스터는 숫자가 아니라 대표 사진(cover_url)과 함께 내려준다. PLAN §9 원칙 1.7';

-- ---------------------------------------------------------------------
-- 3) 통합 검색 — 지역 + 장소. PLAN §6.6
-- ---------------------------------------------------------------------
create or replace function public.api_search(
  p_q text, p_limit int default 20
)
returns table (
  kind text,            -- 'region' | 'place'
  id   text,
  name text,
  sub  text,
  lng  double precision,
  lat  double precision,
  cover_url text,
  rank real
)
language sql stable security invoker set search_path = public, extensions as $$
  (
    select 'region'::text, r.code, r.name, r.sido,
           ST_X(r.center), ST_Y(r.center), null::text,
           similarity(r.name, btrim(p_q))::real
    from public.regions r
    where r.name ilike '%' || btrim(p_q) || '%'
    order by similarity(r.name, btrim(p_q)) desc, r.name
    limit 5
  )
  union all
  (
    select 'place'::text, pl.id::text, pl.name,
           coalesce(rg.name, '') || ' · ' || pl.category::text,
           ST_X(pl.geom), ST_Y(pl.geom), m.url,
           coalesce(st.score, 0)::real
    from public.places pl
    left join public.regions rg on rg.code = pl.region_code
    left join public.place_stats st on st.place_id = pl.id
    left join public.media m on m.id = st.top_media_id
    where pl.name ilike '%' || btrim(p_q) || '%'
    order by coalesce(st.score, 0) desc, pl.name
    limit greatest(1, p_limit)
  );
$$;

comment on function public.api_search is
  '지역과 장소를 한 결과에 섞는다. 장소에는 썸네일을 붙인다 — 이름만으로는 "이쁜지"를 모른다.';

-- ---------------------------------------------------------------------
-- 4) 기준점 반경 — "숙소에서 얼마나 먼지". PLAN §6.6
-- ---------------------------------------------------------------------
create or replace function public.api_places_near(
  p_lng double precision, p_lat double precision,
  p_radius_m double precision default 1000,
  p_lens text default 'all',
  p_scope uuid default null,
  p_category pin_category default null,
  p_limit int default 100
)
returns table (
  key uuid, name text, category pin_category,
  lng double precision, lat double precision,
  dist_m double precision, cover_url text, score real
)
language sql stable security invoker set search_path = public, extensions as $$
  -- 반경을 감싸는 최소 bbox를 직접 계산한다 (위도 보정 포함)
  with b as (
    select p_radius_m / 111320.0 as dlat,
           p_radius_m / (111320.0 * greatest(cos(radians(p_lat)), 0.01)) as dlng
  )
  -- 내부 함수는 점수순으로 자르므로, 가까운데 점수가 낮은 곳이 잘려 나간다.
  -- 넉넉히 받아 바깥에서 거리순으로 다시 자른다.
  select m.key, m.name, m.category, m.lng, m.lat, m.dist_m, m.cover_url, m.score
  from b, public.api_map_places(
         p_lng - b.dlng, p_lat - b.dlat, p_lng + b.dlng, p_lat + b.dlat,
         p_lens, p_scope, p_category, null, null, null,
         p_lng, p_lat, p_radius_m, least(p_limit * 5, 1000)) m
  order by m.dist_m asc nulls last
  limit greatest(1, p_limit);
$$;

-- ---------------------------------------------------------------------
-- 5) 커버리지 — 헤더의 `36.0% · 90/250`
-- ---------------------------------------------------------------------
create or replace function public.api_coverage(
  p_scope scope_type default 'user', p_scope_id uuid default null
)
returns table (unlocked int, total int, pct numeric)
language sql stable security invoker set search_path = public, extensions as $$
  select
    (select count(*)::int from public.region_progress rp
      where rp.scope_type = p_scope
        and rp.scope_id = coalesce(p_scope_id, auth.uid())),
    (select count(*)::int from public.regions),
    round(
      (select count(*)::numeric from public.region_progress rp
        where rp.scope_type = p_scope
          and rp.scope_id = coalesce(p_scope_id, auth.uid()))
      * 100.0 / nullif((select count(*) from public.regions), 0), 1);
$$;

-- ---------------------------------------------------------------------
-- 6) 여행 목록 — 뷰포트에 걸친 여행만. 체크박스 필터의 소스
-- ---------------------------------------------------------------------
create or replace function public.api_trips_in_view(
  p_west double precision, p_south double precision,
  p_east double precision, p_north double precision,
  p_lens text default 'mine', p_scope uuid default null
)
returns table (
  trip_id uuid, title text, note text,
  start_date date, end_date date, pin_count int, cover_url text
)
-- ★ security definer인 이유 — 실측 (핀 3만개, Supabase)
--     RLS 없이       2.84 ms
--     RLS 적용     695.57 ms   ← 245배
--   pins_read 정책의 pin_shared_with_me(id)가 **핀마다** 호출되고,
--   그 탓에 공간 인덱스도 못 탄다 (Seq Scan). 핀이 100만이면 20초대다.
--   이 함수는 위 vis 절에 **가시성 조건을 이미 전부 갖고 있으므로**
--   RLS를 한 번 더 거는 건 중복이다. definer로 바꿔 중복을 없앤다.
--   ⚠️ 대신 space 렌즈의 is_space_member(p_scope) 검사가 **생명줄**이다.
--      그게 없으면 아무나 남의 space_id를 넣어 비공개 핀을 읽는다.
language sql stable security definer set search_path = public, extensions as $$
  with vis as (
    select p.id, p.trip_id, p.like_count
    from public.pins p
    where p.deleted_at is null
      and p.trip_id is not null
      and ST_Intersects(p.geom, ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326))
      and (
        (p_lens = 'all'     and p.is_public)
     or (p_lens = 'mine'    and p.user_id = auth.uid())
     or (p_lens = 'profile' and p.is_public and p.user_id = p_scope)
     or (p_lens = 'space'   and public.is_space_member(p_scope)   -- ★ 행마다가 아니라 한 번만 평가된다
                            and exists (select 1 from public.pin_spaces ps
                                         where ps.pin_id = p.id and ps.space_id = p_scope))
      )
  ),
  grp as (
    select v.trip_id,
           count(*)::int as pin_count,
           (array_agg(v.id order by v.like_count desc, v.id))[1] as top_pin_id
    from vis v group by v.trip_id
  )
  select t.id, t.title, t.note, t.start_date, t.end_date, g.pin_count, cm.url
  from grp g
  join public.trips t on t.id = g.trip_id and t.deleted_at is null
  left join lateral (
    select m.url from public.media m
    where m.pin_id = g.top_pin_id
    order by m.is_main desc, m.sort_order asc limit 1
  ) cm on true
  order by t.start_date desc;
$$;

comment on function public.api_trips_in_view is
  '체크박스로 켜고 끌 여행 목록. 선택한 여행만 불투명, 나머지는 반투명. PLAN §6.7';

-- ---------------------------------------------------------------------
-- 7) 자택 근접 경고 — 공개 등록 직전에 부른다. 좌표는 절대 반환하지 않는다
-- ---------------------------------------------------------------------
create or replace function public.api_is_near_home(
  p_lng double precision, p_lat double precision, p_radius_m double precision default 300
) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid()
      and pr.home_geom is not null
      and ST_DWithin(pr.home_geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat),4326)::geography, p_radius_m));
$$;
