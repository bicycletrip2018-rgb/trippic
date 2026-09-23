-- =====================================================================
-- 032 체류 시간 — 기기가 아는 것을 서버가 잃지 않게
--
-- ★ 하루 코스(§12.25-B)의 재료는 **순서와 체류 시간**이다. 순서는 `visited_at` 으로
--   서버에 남는데, **체류 시간은 등록하는 순간 사라진다.** 실측으로 확인했다:
--     핀 6개 · media 시각 폭 전부 `00:00:00`
--   §6 이 정거장마다 대표 1장만 올리기로 했기 때문이다(§13.29). 나머지 사진이
--   뒤에서 올라와도(§13.30) 사용자가 대표만 고르면 영영 1장이다.
--
-- ★ 그래서 **기기가 계산해서 숫자 하나만 보낸다.** 사진은 전부 기기에 있으므로
--   여기서는 정확하고, 서버로 가는 것은 정수 하나다 — 사진을 더 올릴 필요가 없다.
--
-- ★ 이 값이 "우리만 아는 것"의 실체다. *"성산일출봉에 1시간이면 되나 반나절인가"* 를
--   검색 광고도 인스타도 모른다. 사진 시각은 우리가 갖고 있다.
--
-- ★ **하한이다.** 첫 사진과 마지막 사진 사이일 뿐, 사진을 안 찍은 시간은 모른다.
--   그래서 이름이 `stay_sec` 이지 `duration` 이 아니고, 화면은 "사진 기준"이라고 적는다.
--   사진이 한 장이면 0 이 아니라 **null** 이다 — 0분이라고 쓰면 거짓말이 된다.
-- =====================================================================

alter table public.pins
  add column if not exists stay_sec int
  check (stay_sec is null or (stay_sec >= 0 and stay_sec <= 86400));

comment on column public.pins.stay_sec is
  '그 정거장의 첫 사진~마지막 사진 간격(초). 체류 시간의 **하한**이다. 사진 1장이면 null.';

-- 하루 코스는 "내 기록을 날짜로 잘라 시각순으로" 읽는다. 그 읽기의 인덱스다.
create index if not exists pins_user_visited_idx
  on public.pins (user_id, visited_at)
  where deleted_at is null;

-- 뷰포트 읽기도 같이 준다 — 지도에서 코스를 그릴 때 왕복을 한 번 더 하지 않도록.
-- 031 을 create or replace 로 다시 쓴다 (반환 컬럼이 늘어나므로 drop 이 먼저다).
drop function if exists public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category);

create or replace function public.api_pins_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 300, p_cat pin_category default null
)
returns table (
  id uuid, user_id uuid, trip_id uuid, place_id uuid, region_code text,
  lng double precision, lat double precision,
  category pin_category, memo text, visited_at timestamptz, stay_sec int,
  verification verification_level, is_public boolean, is_mine boolean,
  comment_count int, like_count int, save_count int,
  media_url text, media_w int, media_h int, more boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  hit as (
    select p.* from public.pins p, box b
    where p.deleted_at is null
      and p.geom && b.g
      and (p.is_public or p.user_id = auth.uid())
      and (p_cat is null or p.category = p_cat)
    order by p.visited_at desc
    limit p_limit + 1
  ),
  n as (select count(*) as c from hit)
  select h.id, h.user_id, h.trip_id, h.place_id, h.region_code,
         ST_X(h.geom), ST_Y(h.geom),
         h.category, h.memo, h.visited_at, h.stay_sec, h.verification, h.is_public,
         (h.user_id = auth.uid()), h.comment_count, h.like_count, h.save_count,
         m.url, m.width, m.height, (n.c > p_limit)
  from hit h cross join n
  left join lateral (
    select url, width, height from public.media
    where pin_id = h.id and (not h.is_public or public_ok)
    order by is_main desc, sort_order, created_at limit 1
  ) m on true
  order by h.visited_at desc
  limit p_limit
$$;

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category
) to anon, authenticated;
