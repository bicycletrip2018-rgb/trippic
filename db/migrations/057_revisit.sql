-- =====================================================================
-- 057 `다시 가보기` — **내 기록에서** (§12.25 · §13.86)
--
-- ★ 웹 프로토타입에는 있는데 RN 에 없던 묶음이다(§13.85 점검에서 찾았다).
--   §12.25 가 이 묶음을 둔 이유: *"남의 콘텐츠가 0이어도 작동한다."*
--   다른 묶음(행사·가까운·안 가본 곳)은 전부 **남의 데이터**를 쓰지만
--   이것만은 **내 발자국**을 쓴다.
--
-- ★ 웹은 **앨범**을 썼다. RN 은 **서버의 내 핀**을 쓴다. 왜 다른가 —
--   웹 프로토타입에는 서버가 없었다. RN 에는 있고, 핀에는 이미 **장소 이름과
--   사진**이 붙어 있다. 앨범을 다시 스캔하면 1,200장을 훑어야 하는데
--   *"어디 갈까"* 를 보려고 들어온 화면에서 치를 값이 아니다.
--
-- ★ 규칙은 웹과 같게 둔다 — **오늘이 그 날이거나, 아주 오래된 것.**
--   *"작년 오늘 여기 있었습니다"* 가 이 묶음이 줄 수 있는 가장 좋은 한 줄이다.
-- =====================================================================

drop function if exists public.api_my_revisit(double precision, double precision, int, int);

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
      to_char(p.visited_at at time zone 'Asia/Seoul', 'MM-DD')
        = to_char(now() at time zone 'Asia/Seoul', 'MM-DD')
      or p.visited_at < now() - make_interval(days => greatest(1, p_old_days))
    )
  /* `distinct on` 은 같은 묶음에서 **맨 앞**을 남긴다 — 그 자리의 가장 오래된 기록을
     남긴다. *"2019년에 여기 있었습니다"* 가 작년 것보다 더 다시 가고 싶게 만든다. */
  order by coalesce(p.place_id::text, p.id::text), p.visited_at
  limit greatest(1, p_limit)
$$;

comment on function public.api_my_revisit is
  '다시 가보기 — 오늘이 그 날이거나 아주 오래된 내 기록. 장소당 한 장. 남의 콘텐츠가 0이어도 도는 유일한 묶음이다(§12.25·§13.86).';

grant execute on function public.api_my_revisit(double precision, double precision, int, int)
  to anon, authenticated;

select public.lock_function_privileges();
