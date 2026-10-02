-- =====================================================================
-- 058 **장소 상세** (§13.91)
--
-- ★ 왜 이제 필요한가. §13.74 에서 `갈 곳` 카드를 누르면 **지도로 날아간다.**
--   그런데 거기 내 핀이 없으면 **열 것이 없다** — 카드를 누른 사람이 원한 것은
--   "저기 가 보자"인데 받은 것은 *"아무것도 없는 지도"* 다. 웹 시안도 같은 자리에
--   `alert("실제 앱에서는 장소 상세가 열립니다")` 를 두고 비워 놨다.
--
-- ★ 장소 상세는 **핀 상세와 다른 것**이다. 핀 상세(`PinSheet`)는 *기록 하나*를
--   보여 준다 — 사진 한 장, 메모, 머문 시간. 장소 상세는 *자리 하나*를 보여 준다 —
--   이름·주소·행사일·그 자리의 사진 여러 장·내가 가 봤는지.
--   겹치지 않으므로 둘 다 있어야 한다. 하나로 묶으면 *"이 사진의 메모"* 와
--   *"이 장소의 사진들"* 이 한 시트에서 싸운다.
--
-- ── 여기서 **안 만든 것**: `저장` ─────────────────────────────────
-- ★ 웹 시안의 alert 는 `· 저장` 을 약속한다. **그걸 따르지 않았다.**
--   `place_stats.save_count` · `pins.save_count` 칸은 있는데 **그 칸을 쓰는 표가
--   없다.** 저장을 담을 곳이 없으니 버튼은 숫자를 못 올리고, 다시 열어도 저장한
--   표시가 없다. `PinSheet` 에 적어 둔 규칙을 그대로 지킨다 —
--   *"죽은 버튼을 만들지 않는다. 누르면 아무 일도 안 나는 버튼은 없느니만 못하다."*
--   → 저장은 표(`place_saves`)를 만드는 날 같이 붙인다. 그날까지는 없는 채로 둔다.
--
-- ★ 같은 이유로 드러난 것: `media_rank(like_count, save_count, …)` 의 **앞 두 인자가
--   늘 0 이다**(014). 반응을 적는 곳이 없으니 지금 장소 사진 순서는 사실상
--   *초점 점수 + 최신성*으로만 정해진다. 014 의 `나중에 할 것` 에 이 줄이 없었다 —
--   "반감기 90일은 짐작"이라고만 적어 두고, 그 식의 **절반이 상수**인 것은 안 적었다.
-- =====================================================================

-- ── ① 장소 한 곳의 사실 ──────────────────────────────────────────
-- ★ `security invoker` 다. 표지 사진과 `mine_*` 는 **보는 사람에 따라 달라야**
--   하고, 그 판단은 RLS 가 이미 하고 있다(055 와 같은 선택).
--   definer 로 두면 남의 비공개 핀이 표지로 샐 수 있다.
--
-- ★ 한 번에 **한 곳만** 받는다. 묶음으로 받는 길(`api_place_covers`)은 따로 있고,
--   상세는 화면 하나에 하나뿐이라 배열 인자를 받을 이유가 없다.
create or replace function public.api_place_detail(p_place uuid)
returns table (
  place_id        uuid,
  name            text,
  category        pin_category,
  address         text,
  region_name     text,
  lng             double precision,
  lat             double precision,
  -- 기관 사진(관광공사). 사용자 표지가 없을 때 화면이 이걸 쓴다
  image_url       text,
  image_thumb_url text,
  image_license   text,
  event_start     date,
  event_end       date,
  concept         text,
  closed_at       timestamptz,
  -- 사용자 표지. ★ 여기서 **고르지 않는다** — 029 가 골라 둔 top_media_id 를 읽는다
  cover_url       text,
  cover_thumb_url text,
  cover_author    text,
  pin_count       int,
  visitor_count   int,
  media_count     int,
  -- ★ 상세에서 가장 값나가는 줄: **내가 가 봤는가.** 여행 앱에서 장소를 열었을 때
  --   첫 질문이 그것이고, 서버는 그 답을 한 줄로 낼 수 있다.
  mine_count      int,
  mine_last_at    timestamptz
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.id, p.name, p.category, p.address, rg.name,
         ST_X(p.geom), ST_Y(p.geom),
         p.image_url, p.image_thumb_url, p.image_license,
         p.event_start, p.event_end, p.concept, p.closed_at,
         cm.url,
         /* 047 의 작은 판. 없으면 본판으로 — `coalesce` 를 화면이 아니라
            여기서 한다(055 와 같은 규칙). */
         coalesce(cm.thumb_url, cm.url),
         public.display_name(cp.user_id),
         coalesce(st.pin_count, 0), coalesce(st.visitor_count, 0),
         coalesce(st.media_count, 0),
         mine.n, mine.last_at
  from public.places p
  left join public.regions     rg on rg.code = p.region_code
  left join public.place_stats st on st.place_id = p.id
  left join public.media       cm on cm.id = st.top_media_id
  left join public.pins        cp on cp.id = cm.pin_id
  /* ★ `user_id = auth.uid()` 를 **적어 둔다.** RLS 가 이미 남의 비공개를 막지만,
     RLS 는 *공개 핀*을 통과시키므로 이걸 빼면 `mine_count` 가 **남의 공개 기록까지
     센다.** 함수를 읽는 사람이 정책을 외우고 있어야 뜻이 통하면 안 된다.
     ★ `pins_place_idx` 가 place_id 를 받는다 — 한 장소의 행은 적다. */
  left join lateral (
    select count(*)::int as n, max(mp.visited_at) as last_at
    from public.pins mp
    where mp.place_id = p.id
      and mp.user_id = auth.uid()
      and mp.deleted_at is null
  ) mine on true
  where p.id = p_place;
$$;
comment on function public.api_place_detail is
  '장소 한 곳의 상세 — 사실·표지·집계·내가 가 봤는지. 저장은 담을 표가 없어 넣지 않았다(§13.91).';

-- ── ② 장소의 사진 목록에 **작은 판과 찍은 사람**을 더한다 ──────────
-- ★ 013/014 가 만든 그대로는 상세 화면에 못 쓴다. 두 가지가 없다:
--   · `thumb_url` — 047 이 올리는 작은 판. 없으면 격자 30칸에 **1600px 원본 30장**을
--     내려받는다. 047 은 지도 카드 여덟 장 때문에 만든 것인데, 격자가 더 급하다.
--   · `author` — 남의 사진을 남의 사진이라고 **적을 수가 없다.** `user_id` 만
--     오므로 화면이 uuid 를 들고 이름을 못 쓴다. 출처를 못 적는 사진은 올리면 안 된다.
--
-- ★ `create or replace` 로는 안 된다 — 돌려주는 칸이 늘면
--   `cannot change return type of existing function`. **먼저 지운다**(047 과 같다).
--   지우면 grant 도 같이 사라지므로 아래에서 다시 준다.
drop function if exists public.api_place_media(uuid, text, int, int);

create or replace function public.api_place_media(
  p_place uuid,
  p_orientation text default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  media_id uuid, pin_id uuid, url text, thumb_url text, poster_url text,
  type media_type, orientation text, width int, height int,
  crop_x real, crop_y real, crop_scale real,
  caption text, taken_at timestamptz,
  user_id uuid, author text, like_count int, save_count int, rank real
)
language sql stable security definer set search_path = public, extensions as $$
  select m.id, p.id, m.url,
         coalesce(m.thumb_url, m.url), m.poster_url,
         m.type, m.orientation, m.width, m.height,
         m.crop_x, m.crop_y, m.crop_scale,
         m.caption, m.taken_at,
         p.user_id, public.display_name(p.user_id),
         p.like_count, p.save_count,
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
  '장소의 공개 사진. 방향으로 거르고 최신성+반응으로 정렬한다. 반응 칸은 아직 늘 0 이다(§13.91).';

grant execute on function public.api_place_detail(uuid) to anon, authenticated;
grant execute on function public.api_place_media(uuid, text, int, int) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 나중에 할 것 (지금 하면 추측이 된다)
--   · `place_saves` 표 — 그때 상세에 `저장` 이 붙고 `save_count` 가 뜻을 갖는다
--   · 내 기록 **목록** — 지금 상세는 `mine_count` 로 *몇 번 갔는지*만 안다.
--     그 사진들을 거기서 보여 주려면 비공개까지 나오는 길이 필요한데,
--     `api_place_media` 는 공개만 준다(그게 맞다). 지도 시트가 이미 하는 일이라
--     중복인지부터 봐야 한다 — 재 보기 전에 만들면 두 번째 격자가 된다
--   · `detailIntro2` 의 시간·요금·주최 — 운영키가 필요하다(§13.87)
-- ---------------------------------------------------------------------
