-- =====================================================================
-- TRIPPIC · 019 좌표를 못 믿는 장소는 후보에서 뺀다
--
-- 배경(§10.42): 좌표가 주소 시군구에서 1km 넘게 벗어난 장소가 24곳 있다(전부 tour_api).
--   숫자로는 465,914곳 중 0.005%라 그냥 두고 **신고로 받기로** 했다.
--   `reports`(target_type='place')가 이미 있어 채널은 만들 것이 없다.
--
-- ★ 그런데 한 군데서 물린다 — **후보 목록**이다.
--   api_place_candidates는 반경 안이면 무조건 올린다. 그래서
--   `진교장 (3, 8일)`은 하동군이 주소인데 좌표는 **255km 떨어진 곳**에 있고,
--   **그 자리 반경 150m 안에 장소가 136곳**이다. 거기서 사진 찍은 사람에게 후보로 뜬다.
--   고르면 자기 추억이 엉뚱한 장소에 붙고, place_picks가 그걸 학습한다.
--
-- ★ 거르는 기준을 1km로 둔 이유: 실측상 50m 이내가 81%로 전부 경계 잡음이고,
--   1km를 넘는 것만 실제 좌표 오류였다. 200m~1km(20곳)는 애매해서 남겨 둔다 —
--   과하게 거르면 멀쩡한 장소가 후보에서 사라진다.
--
-- ★ 검색(api_place_search)에서는 빼지 않는다. 거기서 빼면 사용자가 그 장소를
--   **아예 못 찾는다.** 좌표가 틀렸을 뿐 장소는 실재한다.
-- =====================================================================

create or replace function public.api_place_candidates(
  p_lng double precision,
  p_lat double precision,
  p_cat pin_category default null,
  p_cat_conf real default 0.0,
  p_gps_acc_m double precision default 15,
  p_limit int default 10
)
returns table (
  place_id uuid,
  name text,
  category pin_category,
  address text,
  dist_m double precision,
  score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with anchor as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           public.geo_cell(p_lng, p_lat) as cell,
           public.candidate_radius(p_gps_acc_m) as radius_m
  )
  select pl.id,
         pl.name,
         pl.category,
         pl.address,
         ST_Distance(pl.geom::geography, a.g) as dist_m,
         public.candidate_score(
           ST_Distance(pl.geom::geography, a.g),
           (p_cat is not null and pl.category = p_cat),
           coalesce(p_cat_conf, 0),
           coalesce(pl.is_ground, true),
           coalesce(pk.pick_count, 0),
           coalesce(st.score, 0)
         ) as score
  from anchor a
  join public.places pl
    on ST_DWithin(pl.geom::geography, a.g, a.radius_m)
  left join public.place_picks pk on pk.place_id = pl.id and pk.cell = a.cell
  left join public.place_stats st on st.place_id = pl.id
  -- ★ 주소와 1km 넘게 어긋난 좌표는 그 자리에 있다고 볼 수 없다 (018)
  where coalesce(pl.geom_offset_m, 0) <= 1000
  order by score desc
  limit greatest(1, least(p_limit, 20));
$$;

comment on function public.api_place_candidates is
  '반경은 사진의 GPS 정확도에서 계산한다(candidate_radius). 고정 반경은 한쪽을 반드시 희생한다. '
  '좌표가 주소와 1km 넘게 어긋난 장소는 제외한다(019) — 그 자리에 있다고 볼 수 없다.';

revoke execute on function public.api_place_candidates(
  double precision, double precision, pin_category, real, double precision, int) from public;
grant execute on function public.api_place_candidates(
  double precision, double precision, pin_category, real, double precision, int)
  to anon, authenticated;
