-- =====================================================================
-- 096 차단하면 **장소가 통째로 사라졌다** (§13.178)
--
-- 「모두의 지도」를 키우기 전에 *"차단한 사람 사진이 표지로 뜨나"* 를 확인했다.
-- 체인을 끝까지 따라가 보니 **차단은 모든 경로에서 지켜지고 있었다**:
--
--   pins_read(072)   : 차단한 사람의 핀을 가린다
--   media_read       : `exists(select 1 from pins ...)` — 위 정책을 **물려받는다**
--   api_place_media  : security definer 지만 `my_blocks()` 를 **직접 본다**
--   api_place_detail : `left join` 이라 표지가 null 이 되고 화면이 기관 사진으로 떨어진다
--
-- ★ 그런데 **095(내가 지난주에 만든 것)만 `join`(inner)** 이었다.
--   표지를 올린 사람을 차단하면 그 줄이 통째로 빠져 **장소가 지도에서 사라진다.**
--   차단한 것은 **그 사람**이지 **그 해수욕장**이 아니다.
--
-- → 표지가 안 보이면 **그 장소의 다음 사진**으로 떨어진다.
--   ★ *"표지는 029 가 고른다"* 는 규칙(§13.74·055)은 **안 깬다.**
--     `top_media_id` 가 여전히 1순위고, **그것이 안 보일 때만** 다음을 쓴다.
--     고르는 곳을 늘린 것이 아니라 **못 보는 경우의 대비**를 더한 것이다.
--
-- ★ 비용: 상위 N개(줌당 4~10)를 **먼저 추린 뒤** 그 줄에만 lateral 을 돌린다.
--   상자 안 모든 장소에 돌리면 서울에서 수백 번이 된다.
-- =====================================================================

create or replace function public.api_public_covers_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_zoom double precision default 14,
  p_limit int default null
)
returns table (
  place_id uuid, name text, category pin_category,
  lng double precision, lat double precision,
  thumb_url text, author text,
  visitor_count int, media_count int, score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with lim as (
    select coalesce(p_limit,
             case when p_zoom < 12 then 4
                  when p_zoom < 14 then 6
                  when p_zoom < 16 then 8
                  else 10 end) as n
  ),
  /* 먼저 **후보를 N개로 줄인다** — lateral 은 이 줄에만 돈다 */
  top as (
    select pl.id, pl.name, pl.category, pl.geom,
           st.top_media_id, st.visitor_count, st.media_count, st.score
    from public.place_stats st
    join public.places pl on pl.id = st.place_id
    , lim
    where pl.geom && ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326)
      and pl.closed_at is null
      and st.top_media_id is not null
      and st.visitor_count >= 1
    order by st.score desc, st.visitor_count desc, pl.id
    limit (select n from lim)
  )
  select t.id, t.name, t.category,
         ST_X(t.geom), ST_Y(t.geom),
         c.thumb_url, c.author,
         t.visitor_count, t.media_count, t.score
  from top t
  /* ★ **보이는 것 중에서** 고른다. RLS 가 이미 차단·비공개를 걷어냈으므로
     여기 남은 것은 전부 «내가 볼 수 있는 사진» 이다.
     ★ 1순위는 여전히 `top_media_id`(029 가 고른 표지)다. */
  join lateral (
    select coalesce(m.thumb_url, m.url) as thumb_url,
           public.display_name(p.user_id) as author
    from public.media m
    join public.pins p on p.id = m.pin_id
    where p.place_id = t.id
      and p.deleted_at is null
      and p.is_public
      and m.public_ok and m.quality_ok
    order by (m.id = t.top_media_id) desc,
             public.media_rank(p.like_count, p.save_count,
                               coalesce(m.taken_at, p.visited_at), m.focus_score) desc,
             m.id
    limit 1
  ) c on true
$$;

comment on function public.api_public_covers_in_bbox is
  '상자 안에서 사람들이 많이 간 곳 + 표지(095). 표지를 올린 사람을 차단했으면
   **그 장소의 다음 사진**으로 떨어진다(096) — 차단한 것은 그 사람이지 그 장소가
   아니다. 고르는 규칙은 029 그대로이고, 못 보는 경우의 대비만 더했다.';

grant execute on function public.api_public_covers_in_bbox(
  double precision, double precision, double precision, double precision,
  double precision, int) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
