-- =====================================================================
-- 048 화면 안의 **상호** — 배경 지도가 못 주는 것을 우리가 준다 (§13.60)
--
-- ★ 문제: 배경 지도(OSM)에는 한국 상호가 거의 없다. 확대하면 도로만 남고
--   *"여기가 어떤 동네인지"* 가 안 온다. 사진 한 장만 떠 있으면 **내 위치에서
--   얼마나 먼지, 주변에 뭐가 있는지** 감이 없다.
--
-- ★ 그런데 **우리가 이미 갖고 있다** — `places` 465,914곳
--   (상가업소정보 407,580 + TourAPI 58,334). 배경 지도를 바꿔도 이건 안 바뀐다.
--   → 배경은 지형·도로를 깔고, **상호는 우리가 그린다.** 한글이고, 우리 카테고리고,
--     우리가 색과 밀도를 정한다.
--
-- ★ **다 주지 않는다.** 한 화면에 46만 곳을 보낼 수는 없다. 뷰포트로 자르고
--   **점수순으로 깎는다**(031 과 같은 규칙). 점수가 없는 곳은 우리 사용자가
--   아무도 안 간 곳이라 뒤로 민다.
--
-- ★ 핀(사용자 기록)과 **겹치지 않게** 하는 것은 화면의 일이다. 여기서는
--   *"이 화면에 무엇이 있나"* 에만 답한다.
-- =====================================================================

create or replace function public.api_places_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 60,
  p_cat pin_category default null
)
returns table (
  id uuid, name text, category pin_category,
  lng double precision, lat double precision,
  score real, pin_count int
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.id, p.name, p.category,
         ST_X(p.geom), ST_Y(p.geom),
         coalesce(s.score, 0)::real,
         coalesce(s.pin_count, 0)::int
  from public.places p
  left join public.place_stats s on s.place_id = p.id
  where p.geom && ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326)
    and (p_cat is null or p.category = p_cat)
  /* ★ 우리 사용자가 간 곳을 **먼저** 보여 준다. 같은 점수면 이름순 —
     매번 다른 집합이 뜨면 화면이 깜빡이는 것처럼 보인다(정렬이 불안정하면
     같은 화면에서도 뽑히는 것이 달라진다). */
  order by coalesce(s.score, 0) desc, p.name
  limit least(p_limit, 200)
$$;

comment on function public.api_places_in_bbox is
  '화면 안의 상호. 배경 지도에 없는 한국 상호를 우리 places(46만)로 채운다. 점수순으로 깎아서 준다.';

grant execute on function public.api_places_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category)
  to anon, authenticated;

select public.lock_function_privileges();
