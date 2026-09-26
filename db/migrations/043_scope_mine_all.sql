-- =====================================================================
-- 043 스코프 둘을 고친다 — **`전부`가 남의 것까지 담고 있었다** (§13.55)
--
-- ★ 042 의 `else true` 는 *"RLS 가 허락하는 전부"* 였다. 그런데 RLS 는
--   **남의 공개 핀도 허락한다**(pins_read). 그래서 첫 화면의 `전부` 칩에
--   다른 사람의 기록이 섞여 들어왔다.
--   기획 명세가 이 자리를 **`내 모든 기록`** 이라고 부르기로 했으니,
--   그 이름으로 남의 것이 섞이면 **이름이 거짓말이 된다.** 그리고 더 나쁜 것은
--   처음 앱을 연 사람이 **자기 기록을 못 찾는다**는 점이다.
--   → `mine_all` = 내가 올린 것 ∪ 내가 속한 스페이스의 것.
--
-- ★ `all` 은 **지우지 않는다.** 웹 프로토타입이 쓰고 있고, *"볼 수 있는 전부"* 는
--   그 자체로 뜻이 있다(탐색). 이름을 바꾸는 대신 **기본값을 옮긴다.**
--
-- ★ 스페이스 하나로 좁히기(`p_space`)는 **스코프와 따로 둔다.**
--   `p_scope='space'` 같은 값으로 만들면 "space 인데 id 가 없는" 상태가 생기고,
--   그때 무엇을 돌려줄지 정해야 한다 — **있을 수 없는 상태를 아예 안 만든다.**
--   좁히기는 어느 스코프 위에도 얹힌다.
--
-- ★ 멤버가 아닌 스페이스의 id 를 넣어도 **아무것도 안 샌다.** `pin_scoped` 가
--   security_invoker 라 RLS(pins_read)가 부른 사람 기준으로 먼저 걸린다.
--   그래서 여기서 멤버십을 또 확인하지 않는다 — **두 벌이 되면 갈라진다**(§13.37).
-- =====================================================================

create or replace function public.api_pins_by_region(
  p_scope text default 'mine_all',     -- 'mine_all' | 'mine' | 'shared' | 'public' | 'all'
  p_cat   pin_category default null,
  p_space uuid default null            -- 스페이스 하나로 좁힌다(선택)
)
returns table (region_code text, n int, n_mine int, n_shared int)
language sql stable security invoker set search_path = public, extensions as $$
  select s.region_code,
         count(*)::int,
         count(*) filter (where s.is_mine)::int,
         count(*) filter (where s.shared_with_me and not s.is_mine)::int
  from public.pin_scoped s
  where s.region_code is not null
    and (p_cat is null or s.category = p_cat)
    and (p_space is null or exists (
          select 1 from public.pin_spaces ps
          where ps.pin_id = s.id and ps.space_id = p_space))
    and case p_scope
          when 'mine'     then s.is_mine
          when 'public'   then s.is_public
          when 'shared'   then s.shared_with_me
          /* ★ 내 것 **또는** 함께. 남의 공개 핀은 여기 안 들어온다. */
          when 'mine_all' then (s.is_mine or s.shared_with_me)
          else true
        end
  group by s.region_code
$$;

comment on function public.api_pins_by_region(text, pin_category, uuid) is
  '지역별 핀 수. 뷰포트로 자르지 않는다 — 숫자는 지역 전체를 뜻한다. mine_all=내 것∪함께(남의 공개 제외).';

grant execute on function public.api_pins_by_region(text, pin_category, uuid) to anon, authenticated;

/* ★ 042 의 2인자 판을 **지운다.** 남겨 두면 기본값이 다른 두 벌이 공존하고,
   호출부가 어느 쪽에 붙었는지 알 수 없게 된다. PostgREST 는 인자 이름으로
   고르므로 둘 다 있으면 조용히 옛 판이 뽑힐 수 있다. */
drop function if exists public.api_pins_by_region(text, pin_category);

-- ── 뷰포트 판도 같은 규칙으로 ─────────────────────────────────────
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
  media_url text, media_w int, media_h int, more boolean
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
      /* RLS(pins_read)가 이미 볼 수 있는 것만 준다. 여기서는 **좁히기만** 한다. */
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
         /* ★ 순서가 곧 규칙이다: 내 것이면 내 것, 아니면서 스페이스에 있으면
            '함께', 둘 다 아니면 남이다. 한 핀에 배지는 하나다. */
         case when h.is_mine then 'mine'
              when h.shared_with_me then 'shared'
              else 'other' end as source,
         h.comment_count, h.like_count, h.save_count,
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

comment on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid) is
  '뷰포트 안의 핀. p_scope 로 좁힌다(mine_all/mine/shared/public/all). p_space 로 스페이스 하나만. 스코프 정의는 pin_scoped 뷰 하나뿐이다.';

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid) to anon, authenticated;

drop function if exists public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text);

select public.lock_function_privileges();
