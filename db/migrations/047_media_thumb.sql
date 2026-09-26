-- =====================================================================
-- 047 지도에 깔 **작은 판** (§13.58)
--
-- ★ 지금 올라가는 판은 **하나뿐이다** — `MAX_EDGE = 1600`(api.ts).
--   지도에 표지 카드(이름 + 사진)를 세우면 카드 하나가 80~96pt 라, 화면에
--   여덟 장을 세울 때 **1600px 짜리를 여덟 장 내려받게 된다.**
--
-- ★ Supabase 의 이미지 변환(`?width=`)은 **유료 플랜**이다. URL 로 줄일 수 없으니
--   **올릴 때 한 장 더 만든다.** 기기에서 만들면 변환 비용이 0 이다(§13.22 와 같은 이유).
--
-- ★ 480px 을 고른 이유: 카드가 96pt → @3x 288px, 목록 썸네일이 120pt → 360px.
--   480 이면 둘 다 덮으면서 webp 로 30~60KB 다. 이보다 키우면 여덟 장이 다시 무겁고,
--   줄이면 @3x 에서 흐려진다.
--
-- ★ **`not null` 로 만들지 않는다.** 이미 올라간 사진에는 작은 판이 없다 —
--   읽는 쪽이 `coalesce(thumb_url, url)` 로 받는다. 과거를 다시 만들지 않아도
--   오늘부터 나아진다.
-- =====================================================================

alter table public.media add column if not exists thumb_url text;
comment on column public.media.thumb_url is
  '지도 카드·목록용 작은 판(긴 변 480px). 없으면 url 로 폴백한다 — 옛 사진에는 없다.';

-- ── 뷰포트 판이 작은 판도 내주게 한다 ────────────────────────────────
-- ★ 세 번째 고쳐 쓰는 함수다(031 → 042 → 043 → 047). 본문은 043 그대로고
--   **돌려주는 칸 하나만** 늘었다.
--
-- ★ `create or replace` 로는 **안 된다** — `cannot change return type of existing
--   function`. 돌려주는 칸이 늘면 시그니처가 달라진 것으로 보므로 **먼저 지운다.**
--   (인자는 그대로라 같은 이름·같은 인자의 함수 하나만 지우면 된다.)
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
  media_url text, media_thumb text, media_w int, media_h int, more boolean
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
         /* ★ 없으면 원본으로 **떨어뜨린다** — 옛 사진도 그냥 보인다.
            읽는 쪽이 둘 중 뭘 받았는지 몰라도 되게 서버가 정한다. */
         coalesce(m.thumb_url, m.url),
         m.width, m.height, (n.c > p_limit)
  from hit h cross join n
  left join lateral (
    select url, thumb_url, width, height from public.media
    where pin_id = h.id and (not h.is_public or public_ok)
    order by is_main desc, sort_order, created_at limit 1
  ) m on true
  order by h.visited_at desc
  limit p_limit
$$;

comment on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid) is
  '뷰포트 안의 핀. media_thumb 은 지도 카드용 작은 판(없으면 원본). 스코프 정의는 pin_scoped 뷰 하나뿐이다.';

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid) to anon, authenticated;

select public.lock_function_privileges();
