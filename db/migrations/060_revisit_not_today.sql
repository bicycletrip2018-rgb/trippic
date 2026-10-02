-- =====================================================================
-- 060 `다시 가보기` — **오늘 찍은 것이 "예전에 갔던 자리"로 떴다** (§13.92)
--
-- 059 를 실기기에서 보다가 걸렸다. 카드에 이렇게 적혀 있었다:
--
--     이중섭 미술관
--     **오늘 오늘 이 자리에**
--
-- 글자가 겹친 것은 증상이고, 원인은 **오늘 찍은 기록이 그 묶음에 들어온 것**이다.
-- 057 의 조건이 `MM-DD` 만 맞춰 보고 **연도를 안 본다**:
--
--     to_char(visited_at,'MM-DD') = to_char(now(),'MM-DD')
--
-- 오늘 찍은 핀은 당연히 오늘과 `MM-DD` 가 같다. 그래서 `anniversary = true` 가 되고,
-- 화면의 `yearsAgo()` 가 0년을 `오늘` 로 옮기면서 *"오늘 오늘 이 자리에"* 가 된다.
--
-- ★ **문구를 고치는 것은 답이 아니다.** 이 묶음의 이름은 `다시 가보기` 이고
--   설명 줄은 *"예전에 갔던 자리"* 다 — 오늘 등록한 곳은 거기 있으면 안 된다.
--   글자를 다듬으면 *"오늘 이 자리에"* 라는 더 멀쩡해 보이는 거짓말이 된다.
--
-- ★ 실데이터로 **재현된다.** 오늘 찍은 사진을 등록하면 바로 이 상태가 된다 —
--   앱을 처음 쓰는 사람이 가장 먼저 하는 일이 그것이다.
--
-- ★ 057 파일을 고치지 않는다. 이미 적용됐으므로 원장과 어긋난다
--   (`push.sh`: *"변경된 파일은 새 마이그레이션으로 나눌 것"*).
--
-- 본문은 057 그대로고 **조건 한 줄만** 늘었다.
-- =====================================================================

create or replace function public.api_my_revisit(
  p_lng double precision,
  p_lat double precision,
  p_limit int default 12,
  p_old_days int default 300          -- 이만큼 지났으면 '예전'으로 친다
)
returns table (
  place_id    uuid,
  name        text,
  category    pin_category,
  lng         double precision,
  lat         double precision,
  dist_m      double precision,
  visited_at  timestamptz,
  anniversary boolean,                -- 오늘이 그 날인가
  image_url   text,
  thumb_url   text,
  region_name text
)
language sql stable security invoker set search_path = public, extensions as $$
  /* ★ **한 장소에 한 장.** 같은 곳에서 다섯 번 찍었다고 카드가 다섯 장이 되면
     *"다시 가 볼 곳"* 이 아니라 *"내 사진 목록"* 이 된다.
     ★ 장소를 못 고른 핀도 버리지 않는다 — 메모나 지역 이름으로라도 부른다.
       좌표는 있으니 다시 갈 수는 있다. */
  select distinct on (coalesce(p.place_id::text, p.id::text))
         p.place_id,
         coalesce(pl.name, nullif(btrim(p.memo), ''), rg.name, '이름 없는 자리'),
         p.category,
         ST_X(p.geom), ST_Y(p.geom),
         ST_Distance(p.geom::geography,
                     ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography),
         p.visited_at,
         (to_char(p.visited_at at time zone 'Asia/Seoul', 'MM-DD')
            = to_char(now() at time zone 'Asia/Seoul', 'MM-DD')),
         m.url,
         coalesce(m.thumb_url, m.url),
         rg.name
  from public.pins p
  left join public.places  pl on pl.id = p.place_id
  left join public.regions rg on rg.code = p.region_code
  /* 대표 사진 한 장. 없으면 사진 없이 — 핀이 있다는 사실만으로도 카드는 선다. */
  left join lateral (
    select mm.url, mm.thumb_url from public.media mm
    where mm.pin_id = p.id order by mm.is_main desc, mm.sort_order limit 1
  ) m on true
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and (
      (to_char(p.visited_at at time zone 'Asia/Seoul', 'MM-DD')
         = to_char(now() at time zone 'Asia/Seoul', 'MM-DD')
       /* ★ **오늘 찍은 것은 빼고**(§13.92). 아래 머리말 참고 */
       and (p.visited_at at time zone 'Asia/Seoul')::date
             < (now() at time zone 'Asia/Seoul')::date)
      or p.visited_at < now() - make_interval(days => greatest(1, p_old_days))
    )
  /* `distinct on` 은 같은 묶음에서 **맨 앞**을 남긴다 — 그 자리의 가장 오래된 기록을
     남긴다. *"2019년에 여기 있었습니다"* 가 작년 것보다 더 다시 가고 싶게 만든다. */
  order by coalesce(p.place_id::text, p.id::text), p.visited_at
  limit greatest(1, p_limit)
$$;
comment on function public.api_my_revisit is
  '다시 가보기 — 오늘이 그 날이거나 아주 오래된 내 기록. **오늘 찍은 것은 빼고**(§13.92). 장소당 한 장.';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
