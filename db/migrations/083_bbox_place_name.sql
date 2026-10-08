-- =====================================================================
-- 083 지도 카드에 **장소 이름이 없었다** (§13.159)
--
-- 사용자: *"어느정도 확대 이후에는 등록된 이미지에 위치 또는 날짜 텍스트로
--          같이 표시되면 좋겠다"*
--
-- 날짜는 이미 온다(`visited_at`). **이름이 안 온다.**
--
-- ★ `api.ts:390` 은 `places(name)` 을 읽고 있다 — 그런데 그건 **다른 경로**다
--   (하루 코스가 쓰는 PostgREST select). 지도는 `api_pins_in_bbox` 를 쓰고,
--   그 함수의 반환 목록에는 이름이 **처음부터 없었다.**
--   §13.89 가 *"CoursePin.placeName 은 선언돼 있는데 채우는 곳이 없어서 하루
--   코스가 «맛집 09:40» 이라고 적고 있었다"* 를 고쳤는데, **지도 쪽은 그때
--   같이 보지 않았다.** 같은 결핍이 두 화면에 있었고 하나만 고친 것이다.
--
-- ★ `place_id` 는 **이미 주고 있다.** 이름만 없어서, 화면이 이름을 보여 주려면
--   핀마다 장소를 한 번씩 더 물어야 했다 — 그래서 아무도 안 보여 줬다.
--   `left join` 한 번이면 끝난다(핀 300개 상한, 장소는 PK 조회).
--
-- ★ `left join` 이다. **장소가 없는 핀이 있다**(좌표만 있고 매칭 실패, 002 의
--   `place_id ... null 허용`). 그런 핀은 이름이 null 로 오고 화면은 날짜만 쓴다.
-- =====================================================================

/* ★ 반환 목록이 바뀌므로 **먼저 내린다.** `create or replace` 로는
   *"cannot change return type of existing function"* 이 난다 — 062·081 이
   같은 이유로 `drop` 을 먼저 썼다. */
drop function if exists public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid);

create or replace function public.api_pins_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 300,
  p_cat pin_category default null,
  p_scope text default 'mine_all',
  p_space uuid default null
)
returns table (
  id uuid, user_id uuid, trip_id uuid, place_id uuid, region_code text,
  lng double precision, lat double precision,
  category pin_category, memo text, visited_at timestamptz, stay_sec int,
  verification verification_level, is_public boolean, is_mine boolean,
  source text,
  comment_count int, like_count int, save_count int,
  media_url text, media_thumb text, media_w int, media_h int, more boolean,
  place_name text                      -- ★ 새로 — 맨 뒤에 붙인다(기존 순서 유지)
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  hit as (
    select s.*
    from public.pin_scoped s, box b
    where s.geom && b.g
      and (p_cat is null or s.category = p_cat)
      and (p_space is null or exists (
            select 1 from public.pin_spaces ps
            where ps.pin_id = s.id and ps.space_id = p_space))
      and case p_scope
            when 'mine'     then s.is_mine
            when 'public'   then s.is_public
            when 'shared'   then s.shared_with_me
            when 'mine_all' then (s.is_mine or s.shared_with_me)
            else true
          end
    order by s.visited_at desc
    limit p_limit + 1
  ),
  n as (select count(*) as c from hit)
  select h.id, h.user_id, h.trip_id, h.place_id, h.region_code,
         ST_X(h.geom), ST_Y(h.geom),
         h.category, h.memo, h.visited_at, h.stay_sec, h.verification, h.is_public,
         h.is_mine,
         case when h.is_mine then 'mine'
              when h.shared_with_me then 'shared'
              else 'other' end as source,
         h.comment_count, h.like_count, h.save_count,
         m.url,
         coalesce(m.thumb_url, m.url),
         m.width, m.height, (n.c > p_limit),
         pl.name
  from hit h cross join n
  left join lateral (
    select url, thumb_url, width, height from public.media
    where pin_id = h.id and (not h.is_public or public_ok)
    order by is_main desc, sort_order, created_at limit 1
  ) m on true
  left join public.places pl on pl.id = h.place_id
  order by h.visited_at desc
  limit p_limit
$$;

comment on function public.api_pins_in_bbox is
  '뷰포트 안의 핀. `place_name` 을 같이 준다(083) — 없으면 null 이다(장소 매칭은
   실패해도 핀은 남는다). 지도 표지 카드가 날짜와 함께 쓴다.';

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
