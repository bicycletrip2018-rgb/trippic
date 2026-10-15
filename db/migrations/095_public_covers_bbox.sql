-- =====================================================================
-- 095 **사람들이 많이 간 곳이 지도에 사진으로 뜬다** (§13.171)
--
-- 사용자: *"지도의 확대 정도에 따라서 이미지를 클릭해서만 보는 게 아닌
--          **지도에서 노출되는 방식**도 고려해야 함. GPS로 내 현재 위치를
--          지도에서 직접 보고 가시적으로 **내 근처에서 사람들이 많이 방문했던
--          곳**을 직관적으로 인지하고 볼 수 있도록."*
--
-- ★ 재료는 **전부 있었다.** 이어 붙이는 함수 하나가 없었다:
--     `place_stats.top_media_id`  — 029 가 노출 대비 점수로 고른 표지
--     `place_stats.score`         — 004 의 인기도 (사람 수가 가장 세다)
--     `api_place_covers`(055)     — 표지 + 올린 사람. 다만 **id 목록**을 받는다
--   필요한 것은 **상자**로 묻는 길이다.
--
-- ★ **점수 절대값으로 자르지 않는다.** 그러면 서울은 꽉 차고 양평은 텅 빈다.
--   *"상자 안 상위 N개"* 로 하고 **N 만 줌으로** 정한다 — 091 에서 «20 고정» 이
--   다음 화면에서 틀렸던 것과 같은 함정이다(§13.169).
--
-- ★ 문턱은 둘뿐이다: **표지가 있을 것**(그릴 그림이 없으면 카드가 아니다)과
--   **다녀간 사람이 1명 이상**. 점수가 낮아도 상자 안에서 1등이면 보여 준다 —
--   시골에서 *"아무도 안 간 동네"* 가 되면 이 기능이 도시 전용이 된다.
-- =====================================================================

create or replace function public.api_public_covers_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_zoom double precision default 14,
  p_limit int default null                  -- 주면 줌 대신 이 값을 쓴다
)
returns table (
  place_id uuid, name text, category pin_category,
  lng double precision, lat double precision,
  thumb_url text, author text,
  visitor_count int, media_count int, score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with lim as (
    /* 멀리서는 아주 유명한 곳만, 가까이 올수록 동네까지.
       ★ «몇 장» 만 정한다 — 무엇이 유명한지는 상자가 정한다. */
    select coalesce(p_limit,
             case when p_zoom < 12 then 4
                  when p_zoom < 14 then 6
                  when p_zoom < 16 then 8
                  else 10 end) as n
  )
  select pl.id, pl.name, pl.category,
         ST_X(pl.geom), ST_Y(pl.geom),
         coalesce(m.thumb_url, m.url),
         public.display_name(p.user_id),
         st.visitor_count, st.media_count, st.score
  from public.place_stats st
  join public.places pl on pl.id = st.place_id
  join public.media  m  on m.id = st.top_media_id
  join public.pins   p  on p.id = m.pin_id
  , lim
  where pl.geom && ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326)
    and pl.closed_at is null
    and st.top_media_id is not null
    and st.visitor_count >= 1
  order by st.score desc, st.visitor_count desc, pl.id
  limit (select n from lim)
$$;

comment on function public.api_public_covers_in_bbox is
  '상자 안에서 **사람들이 많이 간 곳**을 표지 사진과 함께(095). 줌은 «몇 개를
   보여줄지»만 정한다 — 점수 절대값으로 자르면 서울만 차고 시골은 빈다.
   표지는 029 가 고른 것을 읽기만 한다(055 와 같은 규칙).';

grant execute on function public.api_public_covers_in_bbox(
  double precision, double precision, double precision, double precision,
  double precision, int) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
