-- =====================================================================
-- 036 계절 축 — "지금 가면 이렇게 생겼다" (§12.25-D · §13.36)
--
-- ★ 관광공사 사진은 대개 **성수기 최상 조건**이다. 11월에 벚꽃 사진을 보고 가면
--   실망한다. 그런데 우리가 가진 49,285장에는 **촬영 시각이 한 줄도 없다** (실측).
--   → 계절로 거를 수 있는 것은 **사용자 사진뿐**이고, 기관 사진에 대해서는
--     "언제 찍혔는지 모른다"고 말하는 것이 지금 할 수 있는 전부다.
--     **그 말을 하는 것 자체가 이 기능의 절반**이다 — 정직함이 차별점이 되는 드문 자리다.
--
-- ★ 월은 **KST 기준**이다. UTC 로 자르면 한국의 1월 1일 새벽이 12월이 된다.
-- ★ 공개 자격이 있는 사진만 센다(009) — 계절 판정도 모두의 지도에 뜨는 것과 같아야 한다.
-- ★ 같은 일행은 1표(033·034와 같은 규칙). 한 사람이 30장 올렸다고 그 달이 30배
--   믿을 만해지지는 않는다.
-- =====================================================================

create or replace view public.place_photo_month as
with shot as (
  select pn.place_id,
         extract(month from (m.taken_at at time zone 'Asia/Seoul'))::int as month,
         coalesce(
           (select min(ps.space_id::text) from public.pin_spaces ps where ps.pin_id = pn.id),
           pn.user_id::text
         ) as party_pin,
         pn.user_id,
         m.id as media_id
  from public.media m
  join public.pins pn on pn.id = m.pin_id
  where m.taken_at is not null
    and m.public_ok
    and pn.deleted_at is null and pn.is_public and pn.place_id is not null
),
-- 한 사용자는 한 달에 한 표 (035까지와 같은 접기)
per_user as (
  select place_id, month, user_id, min(party_pin) as party, count(*) as photos
  from shot group by place_id, month, user_id
)
select place_id, month,
       count(distinct party)::int as parties,
       sum(photos)::int as photos
from per_user
group by place_id, month;

comment on view public.place_photo_month is
  '장소·월별 사용자 사진 수 (KST · 공개 자격 있는 것만 · 일행 1표). 기관 사진은 촬영 시각이 없어 여기 없다.';

-- 한 장소의 달력 — "몇 월에 찍힌 사진이 몇 장 있나"
create or replace function public.api_place_months(p_place_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', month, 'parties', parties, 'photos', photos)
                       order by month)
      from public.place_photo_month where place_id = p_place_id), '[]'::jsonb),
    /* ★ 기관 사진이 있는지, 그리고 그게 **언제 찍혔는지 모른다**는 사실을 같이 보낸다.
       화면이 "이 사진은 성수기일 수 있습니다"라고 말할 근거가 여기서 나온다. */
    'agency_photo', (select image_url is not null from public.places where id = p_place_id),
    'agency_month_known', false
  )
$$;
grant execute on function public.api_place_months(uuid) to anon, authenticated;

-- 이번 달에 찍힌 사진이 있는 곳 (갈 곳 탭의 칩)
create or replace function public.api_places_by_month(
  p_lng double precision, p_lat double precision,
  p_month int,
  p_radius_m double precision default 60000,
  p_limit int default 24
)
returns table (
  place_id uuid, name text, category pin_category,
  dist_m double precision, parties int, photos int
)
language sql stable security invoker set search_path = public, extensions as $$
  with a as (select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
                    public.landmass_at(p_lng, p_lat) as lm)
  select pl.id, pl.name, pl.category,
         ST_Distance(pl.geom::geography, a.g), mm.parties, mm.photos
  from public.place_photo_month mm
  join public.places pl on pl.id = mm.place_id
  cross join a
  where mm.month = p_month
    and ST_DWithin(pl.geom::geography, a.g, p_radius_m)
    -- 섬 규칙은 035 와 같다. 못 가는 곳을 '이번 달에 예쁘다'고 권하지 않는다.
    and public.landmass_of(pl.region_code) = a.lm and a.lm <> 'unknown'
  order by mm.parties desc, mm.photos desc, ST_Distance(pl.geom::geography, a.g)
  limit p_limit
$$;
grant execute on function public.api_places_by_month(
  double precision, double precision, int, double precision, int) to anon, authenticated;
grant select on public.place_photo_month to anon, authenticated;
