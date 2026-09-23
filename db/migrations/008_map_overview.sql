-- =====================================================================
-- TRIPPIC · 008 축소 화면 — 핀이 아니라 장소를 읽는다
--
-- 왜: 핀 100만 개에서 축소 화면(서울 전역 bbox)이 **로컬 1.36초 / Supabase 추정 16초**였다(§10.13).
--     `limit`이 비용을 줄이지 못한다 — bbox 안 핀을 전부 매칭해 그룹핑한 뒤에 자르기 때문이다.
--     핀이 늘수록 선형보다 나쁘게(10배 → 20.5배) 악화된다.
--
-- 핵심: **축소 화면에서 사용자가 보는 건 "이 지역에 몇 곳"이다. 핀 하나하나가 아니다.**
--     그리고 `place_stats`는 이미 트리거로 집계되고 있다 (그것도 `is_public`만 센다).
--     장소는 43만 개로 고정이고 핀처럼 무한히 늘지 않는다.
--
-- 적용 범위: **`all` 렌즈(모두의 지도)에만 쓴다.**
--     `mine`/`space`는 이미 빠르다 — 핀 100만에서도 mine은 3.72ms다.
--     user_id 인덱스가 먼저 걸러주기 때문이다. 거기는 고칠 게 없다.
--
-- 중장기: 이 함수의 **반환 모양(격자 셀)을 고정**해 둔다.
--     나중에 장소 수마저 부담이 되면 격자 집계 테이블이나 벡터 타일로 속을 갈아끼워도
--     클라이언트는 바뀌지 않는다. 지금 바꾸는 건 구현이지 계약이 아니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① 공개 핀 수를 places에 역정규화한다
--    이유: 공간 조건은 places.geom에 걸리는데 "핀이 있는가"는 place_stats에 있다.
--    43만 곳을 전부 훑고 나서 조인하면 의미가 없다.
--    여기 두면 **부분 공간 인덱스**로 핀 없는 장소를 통째로 건너뛴다.
-- ---------------------------------------------------------------------
alter table public.places add column if not exists public_pin_count int not null default 0;
comment on column public.places.public_pin_count is
  '공개 핀 수. place_stats.pin_count의 사본이다 — 부분 공간 인덱스를 만들려고 역정규화했다.';

create index if not exists places_pinned_gix
  on public.places using gist (geom) where public_pin_count > 0;
comment on index public.places_pinned_gix is
  '핀이 하나라도 꽂힌 장소만. 축소 화면은 이 인덱스만 탄다.';

-- refresh_place_stats가 사본도 같이 갱신하게 한다.
-- (004의 정의를 덮어쓴다 — 마지막 두 줄만 추가된 것이다)
create or replace function public.refresh_place_stats(p_place uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  v_top uuid;
begin
  if p_place is null then return; end if;

  select count(*)::int                                         as pin_count,
         count(distinct p.user_id)::int                        as visitor_count,
         count(*) filter (where p.verification = 'live')::int   as live_count,
         count(*) filter (where p.memo is not null
                            and length(btrim(p.memo)) > 0)::int as note_count,
         coalesce(sum(p.save_count), 0)::int                    as save_count,
         coalesce(sum(p.like_count), 0)::int                    as like_count
    into s
  from public.pins p
  where p.place_id = p_place and p.deleted_at is null and p.is_public;

  select m.id into v_top
  from public.pins p
  join public.media m on m.pin_id = p.id
  where p.place_id = p_place and p.deleted_at is null and p.is_public
  order by p.like_count desc, p.save_count desc, m.is_main desc, m.sort_order asc
  limit 1;

  insert into public.place_stats as ps
    (place_id, pin_count, visitor_count, live_count, note_count,
     save_count, like_count, top_media_id, score, updated_at)
  values (p_place, s.pin_count, s.visitor_count, s.live_count, s.note_count,
          s.save_count, s.like_count, v_top,
          public.compute_place_score(s.visitor_count, s.live_count, s.pin_count,
                                     s.save_count, s.like_count, s.note_count),
          now())
  on conflict (place_id) do update set
    pin_count = excluded.pin_count, visitor_count = excluded.visitor_count,
    live_count = excluded.live_count, note_count = excluded.note_count,
    save_count = excluded.save_count, like_count = excluded.like_count,
    top_media_id = excluded.top_media_id, score = excluded.score,
    updated_at = now();

  -- ★ 부분 인덱스용 사본. 값이 실제로 바뀔 때만 쓴다 (불필요한 인덱스 갱신을 피한다)
  update public.places
     set public_pin_count = s.pin_count
   where id = p_place and public_pin_count is distinct from s.pin_count;
end $$;

-- ---------------------------------------------------------------------
-- ② 축소 화면 — 격자 셀 단위 요약
--
-- 반환 모양이 **계약**이다. 지금은 places를 실시간으로 격자에 뭉개지만,
-- 나중에 격자 집계 테이블이나 벡터 타일로 바꿔도 이 모양은 유지한다.
--
-- security definer인 이유: 읽는 것이 전부 공개 집계뿐이다
--   · places — 참조 데이터 (RLS도 `using (true)`)
--   · places.public_pin_count — is_public 핀만 센 값 (refresh_place_stats 참조)
--   · place_stats — 마찬가지로 is_public만
--   비공개 기록은 애초에 이 경로에 들어오지 않는다. 렌즈도 받지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.api_map_overview(
  p_west double precision, p_south double precision,
  p_east double precision, p_north double precision,
  p_cells int default 12,                  -- 가로 방향 셀 개수
  p_category pin_category default null,
  p_limit int default 300
)
returns table (
  lng           double precision,
  lat           double precision,
  place_count   int,       -- 이 셀에 핀이 꽂힌 장소 수
  pin_count     int,       -- 그 장소들의 공개 핀 합계
  top_place_id  uuid,      -- 셀 대표 장소 (점수 최고)
  top_name      text,
  top_category  pin_category,
  top_media_id  uuid,
  top_score     real
)
language sql stable security definer set search_path = public, extensions as $$
  with env as (
    select ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326) as box,
           greatest((p_east - p_west) / greatest(p_cells, 1), 0.0005) as cell
  ),
  hit as (
    select pl.id, pl.name, pl.category, pl.geom,
           pl.public_pin_count,
           coalesce(st.score, 0)      as score,
           st.top_media_id,
           ST_SnapToGrid(pl.geom, e.cell, e.cell) as cellpt
    from public.places pl
    cross join env e                         -- 콤마조인과 left join은 섞을 수 없다
    left join public.place_stats st on st.place_id = pl.id
    where pl.public_pin_count > 0            -- ★ 부분 인덱스가 여기서 일한다
      and ST_Intersects(pl.geom, e.box)
      and (p_category is null or pl.category = p_category)
  ),
  grp as (
    select ST_X(cellpt) as gx, ST_Y(cellpt) as gy,
           count(*)::int                      as place_count,
           sum(public_pin_count)::int         as pin_count,
           ST_X(ST_Centroid(ST_Collect(geom))) as lng,
           ST_Y(ST_Centroid(ST_Collect(geom))) as lat,
           (array_agg(id   order by score desc, id))[1] as top_place_id,
           (array_agg(name order by score desc, id))[1] as top_name,
           (array_agg(category order by score desc, id))[1] as top_category,
           (array_agg(top_media_id order by score desc, id))[1] as top_media_id,
           max(score)::real                   as top_score
    from hit
    group by ST_X(cellpt), ST_Y(cellpt)
  )
  select lng, lat, place_count, pin_count,
         top_place_id, top_name, top_category, top_media_id, top_score
  from grp
  order by pin_count desc, place_count desc
  limit greatest(1, least(p_limit, 1000));
$$;

comment on function public.api_map_overview is
  '축소 화면(모두의 지도) 전용. 핀이 아니라 장소를 읽는다. 렌즈는 받지 않는다 — mine/space는 이미 빠르다.';

-- 권한
revoke execute on function public.api_map_overview(
  double precision, double precision, double precision, double precision,
  int, pin_category, int) from public;
grant execute on function public.api_map_overview(
  double precision, double precision, double precision, double precision,
  int, pin_category, int) to anon, authenticated;

select public.lock_function_privileges();

-- ---------------------------------------------------------------------
-- ③ 기존 데이터 backfill (008 이전에 들어온 핀)
-- ---------------------------------------------------------------------
update public.places pl
   set public_pin_count = st.pin_count
  from public.place_stats st
 where st.place_id = pl.id and pl.public_pin_count is distinct from st.pin_count;
