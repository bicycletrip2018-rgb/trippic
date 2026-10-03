-- =====================================================================
-- 064 **저장한 곳 목록** (§13.103)
--
-- 063 이 저장을 담을 곳을 열었다. 그런데 **저장해 놓고 꺼내 볼 데가 없으면**
-- 저장은 *"눌렀다는 느낌"* 일 뿐이다 — 다시 찾으려면 또 검색해야 한다.
--
-- ★ **탭을 만들지 않는다.** §13.102 에 적어 둔 그대로다:
--   *"0건인 지금 탭을 늘리면 §12.4·§12.26-A 가 두 번 거절한 '빈 탭' 이 또 생긴다."*
--   → `갈 곳` 의 **묶음 하나**로 넣는다. 비면 줄이 아예 안 뜨므로 빈 화면이 없고,
--     `다시 가보기`(§13.86)가 이미 같은 모양이다 — **내 데이터로 서는 줄**이다.
--
-- ★ 모양을 `api_my_revisit` 과 **일부러 맞췄다.** 같은 카드가 그린다 —
--   줄마다 다른 모양을 주면 화면이 줄 수만큼 갈라진다(§13.37).
--
-- ★ `security invoker` 다. RLS(`reactions_read_own`)가 **내 저장만** 준다 —
--   여기서 `user_id = auth.uid()` 를 또 쓰지 않는다. 다만 **왜 안 써도 되는지**를
--   적어 둔다: §13.91 의 `mine_count` 는 RLS 가 남의 **공개** 핀을 통과시켜서
--   한 줄이 필요했는데, `reactions` 는 **읽기 정책 자체가 내 것뿐**이라 다르다.
-- =====================================================================

create or replace function public.api_my_saves(
  p_lng double precision,
  p_lat double precision,
  p_limit int default 24
)
returns table (
  place_id    uuid,
  name        text,
  category    pin_category,
  lng         double precision,
  lat         double precision,
  dist_m      double precision,
  saved_at    timestamptz,
  image_url   text,
  thumb_url   text,
  region_name text,
  event_start date,
  event_end   date,
  /** 내가 가 본 곳인가 — 저장만 해 둔 곳과 다녀온 곳은 다른 할 일이다 */
  been        boolean,
  /** 문을 닫았다고 신고된 곳(051). 저장해 둔 사이에 닫혔을 수 있다 */
  closed      boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  select pl.id, pl.name, pl.category,
         ST_X(pl.geom), ST_Y(pl.geom),
         ST_Distance(pl.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
         r.created_at,
         pl.image_url,
         coalesce(pl.image_thumb_url, pl.image_url),
         rg.name,
         pl.event_start, pl.event_end,
         exists (select 1 from public.pins mp
                  where mp.place_id = pl.id and mp.user_id = auth.uid()
                    and mp.deleted_at is null),
         pl.closed_at is not null
  from public.reactions r
  join public.places  pl on pl.id = r.target_id
  left join public.regions rg on rg.code = pl.region_code
  where r.target_type = 'place' and r.kind = 'save'
  /* ★ **저장한 순서**다(최신 먼저). 거리순이 아니다 — 저장은 *"여기 가 보자"* 는
     표시라 **내가 찜한 차례**가 곧 그 사람의 생각 순서다. 거리는 카드가 적는다.
     (`다시 가보기` 는 거리순인데, 그건 *"지금 근처에 예전 자리가 있나"* 라
      묻는 것이 달라서다.) */
  order by r.created_at desc
  limit greatest(1, p_limit);
$$;
comment on function public.api_my_saves is
  '내가 저장한 장소 — 저장한 순서(최신 먼저). `갈 곳` 의 묶음 하나로 선다. 비면 줄이 안 뜬다(§13.103).';

grant execute on function public.api_my_saves(double precision, double precision, int)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 나중에 할 것 (지금 하면 추측이 된다)
--   · 지도에 저장한 곳 표시 — 목록보다 이쪽이 먼저일 수도 있다. 둘 다 쓰고 나서 본다
--   · 정렬 바꾸기(거리순·가까운 것부터) — **몇 개나 저장하는지** 보고 정한다.
--     다섯 개면 순서가 아무 뜻이 없고, 쉰 개면 거리순이 필요해진다
--   · 폴더·태그 — 쉰 개가 넘는 사람이 실제로 생긴 다음
-- ---------------------------------------------------------------------
