-- =====================================================================
-- TRIPPIC · 014 모두의 사진 정렬 — 최신성 + 반응
--
-- 지금은 좋아요·저장·촬영일순이라 **오래된 인기 사진이 영원히 1등**이다.
-- 새 사진은 반응이 0이라 영원히 아래에 깔린다.
--
-- 일부러 간단하게 둔다. 고도화는 실제 반응 데이터가 쌓인 뒤에 한다 —
-- 지금 정교하게 만들면 **추측으로 만든 정교함**이 된다.
--   상수를 한 곳에 모아 두었으니 나중에 숫자만 바꾸면 된다.
-- =====================================================================

create or replace function public.media_rank(
  p_likes int, p_saves int, p_at timestamptz, p_focus real default null
) returns real language sql immutable as $$
  select (
    -- ① 반응 — 로그로 누른다. 하나가 폭발해도 목록을 독점하지 못하게.
    --    저장은 좋아요보다 **2배**로 본다. "나중에 가보겠다"가 더 강한 신호다.
      (1.0 + ln(1 + greatest(coalesce(p_likes,0),0)
                  + 2 * greatest(coalesce(p_saves,0),0)))
    -- ② 최신성 — 반감기 90일. 여행 사진은 뉴스가 아니라 천천히 낡는다.
    --    기준 시각은 **찍은 때**다. 올린 때가 아니다 —
    --    2015년에 찍은 사진은 지금의 그 장소를 보여주지 못한다.
    --    (가게가 바뀌었을 수 있다. 보는 사람이 알고 싶은 건 '지금 어떤가'다.)
    --    찍은 때를 모르면 90일 지난 것으로 친다. 추측으로 상단에 올리지 않는다.
    * power(0.5, coalesce(extract(epoch from now() - p_at) / 86400.0, 90.0) / 90.0)
    -- ③ 화질 — 동점을 가르는 정도로만. 이미 최소선은 010이 걸렀다.
    + 0.05 * ln(1 + greatest(coalesce(p_focus,0),0) / 1000.0)
  )::real
$$;

comment on function public.media_rank is
  '모두의 사진 정렬 점수. 반응(저장 2배) × 최신성(반감기 90일, 찍은 때 기준) + 화질 소량.';

-- 장소 사진 목록에 적용
-- ★ 반환 컬럼(rank)이 늘었다. create or replace 로는 반환 타입을 못 바꾼다 —
--   먼저 지워야 한다. 마이그레이션은 재실행 가능해야 하므로 if exists 를 붙인다.
drop function if exists public.api_place_media(uuid, text, int, int);
create or replace function public.api_place_media(
  p_place uuid,
  p_orientation text default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  media_id uuid, pin_id uuid, url text, poster_url text,
  type media_type, orientation text, width int, height int,
  crop_x real, crop_y real, crop_scale real,
  caption text, taken_at timestamptz,
  user_id uuid, like_count int, save_count int, rank real
)
language sql stable security definer set search_path = public, extensions as $$
  select m.id, p.id, m.url, m.poster_url,
         m.type, m.orientation, m.width, m.height,
         m.crop_x, m.crop_y, m.crop_scale,
         m.caption, m.taken_at,
         p.user_id, p.like_count, p.save_count,
         public.media_rank(p.like_count, p.save_count,
                           coalesce(m.taken_at, p.visited_at), m.focus_score) as rank
  from public.media m
  join public.pins p on p.id = m.pin_id
  where p.place_id = p_place
    and p.deleted_at is null
    and p.is_public
    and m.public_ok and m.quality_ok
    and (p_orientation is null or m.orientation = p_orientation)
  order by rank desc, m.id
  limit greatest(1, least(p_limit, 100)) offset greatest(p_offset, 0);
$$;

comment on function public.api_place_media is
  '장소의 공개 사진. 방향으로 거르고 최신성+반응으로 정렬한다.';

revoke execute on function public.media_rank(int, int, timestamptz, real) from public;
grant execute on function public.media_rank(int, int, timestamptz, real) to anon, authenticated;
revoke execute on function public.api_place_media(uuid, text, int, int) from public;
grant execute on function public.api_place_media(uuid, text, int, int) to anon, authenticated;

select public.lock_function_privileges();

-- ---------------------------------------------------------------------
-- 나중에 할 것 (지금 하면 추측이 된다)
--   · 다양성 쿼터 — 한 사용자가 한 장소의 목록을 독점하지 못하게 (§8.5)
--   · 노출 보정 — 새 사진에 잠깐 가산점을 줘 반응을 받을 기회를 준다
--   · 반감기 튜닝 — 90일은 짐작이다. 실제 저장·좋아요 로그로 다시 잡는다
--   · 계절 — 벚꽃 사진은 4월에, 설경은 1월에 올라와야 한다
-- ---------------------------------------------------------------------
