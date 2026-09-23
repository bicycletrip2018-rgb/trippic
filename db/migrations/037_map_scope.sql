-- =====================================================================
-- 037 함께 채운 지도 — 한 지도, 세 개의 스코프 (§12.28 · §13.37)
--
-- ★ 지도를 셋으로 나누지 않는다. **지도는 하나**고 무엇을 볼지만 고른다 —
--   지도를 나누면 §12.27에서 접었던 '정리함'과 같은 실수가 된다(같은 일을 하는
--   화면이 둘). 사람은 "내 사진 지도"와 "모두의 지도"를 오가는 게 아니라
--   **같은 자리에서 누구 것을 볼지**를 바꾼다.
--
-- ── 세 스코프의 정의 ─────────────────────────────────────────────────
--   `mine`   내가 올린 전부. **공개 여부와 무관하다** — 나만 보기도 내 지도에는 있다.
--   `shared` **내가 속한 스페이스에 올라온 핀.** 내가 올려 공유한 것 + 남이 올려
--            나에게 공유된 것. 둘을 가르지 않는다 — '함께 채운다'가 그런 뜻이다.
--   `public` 공개된 핀 전부.
--
-- ★ **셋은 겹친다. 그건 결함이 아니다.** 내가 올려서·스페이스에 공유하고·공개까지 한
--   핀은 셋 모두에 있다. 스코프는 핀을 **분류**하는 게 아니라 *"지금 무엇을 보고
--   싶은가"* 다. 배타적 3분할로 만들면 그 핀을 어디에 넣어도 거짓말이 된다.
--
-- ★ **`public` 에 내 것을 뺄 것인가** — 뺐다. 그러면 *"내 사진이 모두의 지도에 떴나"*
--   를 확인할 길이 사라진다. §13.24가 막으려던 침묵과 같은 모양이다. → **넣는다.**
--   대신 `source` 로 구분한다: 내 것 / 함께한 사람 / 남. 시트가 나눠 세면 된다.
--
-- ★ `shared` 는 **공개 여부를 안 본다.** 나만 보기 핀도 스페이스에 넣었으면 멤버가
--   본다 — 그게 스페이스의 존재 이유고, 028("공개 기록에는 댓글이 안 달린다,
--   기준은 공개가 아니라 스페이스")과 같은 규칙이다.
--
-- ★ 스페이스에서 나가면 그 핀은 **바로 안 보인다.** RLS(pins_read → pin_shared_with_me)가
--   이미 그렇게 한다. 여기서 따로 흉내 내지 않는다 — 두 벌이 되면 갈라진다.
--
-- ★ 우리에겐 1:1 '친구' 개념이 없다. 공유의 단위는 **스페이스**다(§12.1: 닫힌 방이라
--   모더레이션이 필요 없다). 그래서 이름도 `friend` 가 아니라 `shared` 다.
-- =====================================================================

drop function if exists public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category);

create or replace function public.api_pins_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 300,
  p_cat pin_category default null,
  p_scope text default 'all'          -- 'mine' | 'shared' | 'public' | 'all'
)
returns table (
  id uuid, user_id uuid, trip_id uuid, place_id uuid, region_code text,
  lng double precision, lat double precision,
  category pin_category, memo text, visited_at timestamptz, stay_sec int,
  verification verification_level, is_public boolean, is_mine boolean,
  source text,                        -- 'mine' | 'shared' | 'other' — 카드의 출처 배지
  comment_count int, like_count int, save_count int,
  media_url text, media_w int, media_h int, more boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  with me as (select auth.uid() as uid),
  box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  hit as (
    select p.*,
           /* ★ 한 줄씩 함수를 부르지 않는다 — 뷰포트에 300개면 300번이 된다.
              스페이스 멤버십을 한 번 조인해서 끝낸다. */
           exists (
             select 1 from public.pin_spaces ps
             join public.space_members sm on sm.space_id = ps.space_id
             where ps.pin_id = p.id and sm.user_id = (select uid from me)
           ) as shared_with_me
    from public.pins p, box b
    where p.deleted_at is null
      and p.geom && b.g
      and (p_cat is null or p.category = p_cat)
      /* RLS(pins_read)가 이미 볼 수 있는 것만 준다. 여기서는 **좁히기만** 한다. */
      and case p_scope
            when 'mine'   then p.user_id = (select uid from me)
            when 'public' then p.is_public
            when 'shared' then exists (
              select 1 from public.pin_spaces ps
              join public.space_members sm on sm.space_id = ps.space_id
              where ps.pin_id = p.id and sm.user_id = (select uid from me))
            else true
          end
    order by p.visited_at desc
    limit p_limit + 1
  ),
  n as (select count(*) as c from hit)
  select h.id, h.user_id, h.trip_id, h.place_id, h.region_code,
         ST_X(h.geom), ST_Y(h.geom),
         h.category, h.memo, h.visited_at, h.stay_sec, h.verification, h.is_public,
         (h.user_id = (select uid from me)) as is_mine,
         /* ★ 순서가 곧 규칙이다: 내 것이면 내 것이고, 아니면서 스페이스에 있으면
            '함께', 둘 다 아니면 남이다. 한 핀에 배지는 하나다. */
         case when h.user_id = (select uid from me) then 'mine'
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

comment on function public.api_pins_in_bbox is
  '뷰포트 안의 핀. p_scope 로 좁힌다(mine/shared/public/all). source 는 출처 배지 — 셋은 겹칠 수 있다.';

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category, text)
  to anon, authenticated;
