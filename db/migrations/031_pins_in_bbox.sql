-- =====================================================================
-- 031 뷰포트로 잘라 읽기 — 지도가 보고 있는 만큼만 가져온다
--
-- ★ 지금까지 지도는 `pins?order=visited_at.desc&limit=200` 으로 **최근 200개**를
--   읽었다. 그러면 두 가지가 동시에 틀린다:
--     ㉠ 서울을 보고 있는데 제주 기록이 실려 온다 (화면에 안 그려질 것을 받는다)
--     ㉡ 기록이 200개를 넘는 순간 **오래된 곳은 지도에서 사라진다** —
--        사용자는 자기가 올린 것이 없어졌다고 느낀다. 그게 §13.24 가 막으려던 바로 그것이다.
--
-- ★ 잘리는 것 자체는 못 막는다. 화면 하나에 수만 개가 들어오는 줌이 있기 때문이다.
--   막을 수 없으면 **숨기지 않는다** — `more` 로 "더 있다"를 돌려준다.
--   개수를 세지 않는다: limit+1 만 읽어 보면 "더 있는가"는 알 수 있고,
--   **정확한 개수를 알려고 뷰포트 전체를 세는 것이 바로 이 함수가 피하려는 일**이다.
--
-- ★ 내 기록도 같이 준다. 지도는 '모두의 것 + 내 것'을 겹쳐 그린다 —
--   따로 부르면 왕복이 두 번이고, 두 응답의 시점이 어긋나 깜빡인다.
-- =====================================================================

create or replace function public.api_pins_in_bbox(
  p_w double precision,              -- 서
  p_s double precision,              -- 남
  p_e double precision,              -- 동
  p_n double precision,              -- 북
  p_limit int default 300,
  p_cat pin_category default null    -- 카테고리 필터 (없으면 전부)
)
returns table (
  id uuid,
  user_id uuid,
  trip_id uuid,
  place_id uuid,
  region_code text,
  lng double precision,
  lat double precision,
  category pin_category,
  memo text,
  visited_at timestamptz,
  verification verification_level,
  is_public boolean,
  is_mine boolean,
  comment_count int,
  like_count int,
  save_count int,
  media_url text,
  media_w int,
  media_h int,
  more boolean                       -- 이 화면에 이보다 더 있다
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (
    -- ★ 날짜변경선을 넘는 뷰포트는 여기서 다루지 않는다. 대한민국만 그리는 지도라
    --    그 경우가 없고, 없는 경우를 위한 코드는 검증할 수 없다.
    select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g
  ),
  hit as (
    select p.*
    from public.pins p, box b
    where p.deleted_at is null
      and p.geom && b.g                                   -- GiST 인덱스가 먹는 자리
      and (p.is_public or p.user_id = auth.uid())
      and (p_cat is null or p.category = p_cat)
    order by p.visited_at desc
    limit p_limit + 1                                     -- ★ 한 개만 더 — "더 있는가"에 그거면 된다
  ),
  n as (select count(*) as c from hit)
  select h.id, h.user_id, h.trip_id, h.place_id, h.region_code,
         ST_X(h.geom), ST_Y(h.geom),
         h.category, h.memo, h.visited_at, h.verification, h.is_public,
         (h.user_id = auth.uid()) as is_mine,
         h.comment_count, h.like_count, h.save_count,
         m.url, m.width, m.height,
         (n.c > p_limit) as more
  from hit h
  cross join n
  /* 대표 1장만. ★ 공개 핀에는 **공개 자격이 있는 사진만** 붙인다(009) —
     판정에서 빠진 사진이 모두의 지도에 뜨면 그 판정은 아무 일도 안 한 것이다.
     ★ 주인에게도 똑같이 뺀다. 주인한테만 보여 주면 "내 사진이 지도에 있다"고 믿게 되는데
       실제로는 아무도 못 본다 — 판정을 해 놓고 말하지 않는 것과 같다.
       빠졌다는 말은 등록 화면이 한다(§6). 지도는 지도에 있는 것만 보여 준다.
     ★ 비공개 핀은 나만 보는 것이라 공개 자격을 따지지 않는다. */
  left join lateral (
    select url, width, height
    from public.media
    where pin_id = h.id
      and (not h.is_public or public_ok)
    order by is_main desc, sort_order, created_at
    limit 1
  ) m on true
  order by h.visited_at desc
  limit p_limit
$$;

comment on function public.api_pins_in_bbox is
  '지도 뷰포트(서·남·동·북) 안의 공개 핀 + 내 핀. more=true 면 화면에 더 있다(개수는 세지 않는다).';

-- 지도는 로그인 없이도 읽는다 (§3)
grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category
) to anon, authenticated;
