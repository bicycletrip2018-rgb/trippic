-- =====================================================================
-- TRIPPIC · 015 검색 폴백 — 후보에 없는 장소를 이름으로 찾는다
--
-- 실측(§10.11): 후보 10개 안에 정답이 있는 비율이 86.9%다.
--   **업로드의 약 13%는 이 경로로 온다.** 지금까지 비어 있던 구멍이다.
--
-- ★ 전역 이름 검색으로 만들면 안 된다. "스타벅스"는 전국에 872곳이다.
--   사용자는 **자기가 있던 자리**의 가게를 찾는다. 검색도 좌표에 묶인다.
--
-- ★ 그리고 전역 ilike는 애초에 못 쓴다 — 실측:
--     select ... where name ilike '%협재%'      → Seq Scan, 564ms
--   2글자 한글 질의는 트라이그램을 하나도 못 뽑아낸다(3글자가 필요하다).
--   GIN 인덱스가 465,983행 **전부**를 반환하고 재검사로 걸러낸다.
--   한국어는 2음절 검색이 흔하므로 치명적이다.
--
--   → **공간 인덱스로 먼저 좁히고** 그 안에서 이름을 본다: 564ms → **5.3ms** (107배)
--     2km 안 장소 수: 제주 협재 696곳 · 해운대 3,914곳 · 종로 22,638곳
-- =====================================================================

create or replace function public.api_place_search(
  p_q text,
  p_lng double precision,
  p_lat double precision,
  p_cat pin_category default null,        -- 사진에서 추정한 카테고리
  p_radius_m double precision default 2000,
  p_limit int default 20
)
returns table (
  place_id uuid, name text, category pin_category, address text,
  dist_m double precision, score real,
  attachable boolean                       -- 이 사진을 여기 붙일 수 있는가 (009: 500m)
)
language sql stable security definer set search_path = public, extensions as $$
  with q as (
    select btrim(coalesce(p_q, '')) as t,
           ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           public.geo_cell(p_lng, p_lat) as cell
  )
  select pl.id, pl.name, pl.category, pl.address,
         ST_Distance(pl.geom::geography, q.g) as dist_m,
         (
           -- 이름이 얼마나 맞는가. 앞에서부터 맞으면 더 쳐준다 —
           -- 사람은 보통 앞글자부터 친다 ("협재" → "협재해수욕장")
             3.0 * similarity(regexp_replace(pl.name, '\s', '', 'g'),
                              regexp_replace(q.t, '\s', '', 'g'))
           + 1.5 * (case when pl.name ilike q.t || '%' then 1 else 0 end)
           -- 거리 — km 단위로 완만히. 후보 목록(m 단위)과 달리 넓게 본다
           + 2.0 * (1.0 / (1.0 + ST_Distance(pl.geom::geography, q.g) / 1000.0))
           -- 카테고리 일치
           + 1.0 * (case when p_cat is not null and pl.category = p_cat then 1 else 0 end)
           -- 그 좌표에서 남들이 고른 이력
           + 0.5 * ln(1 + coalesce(pk.pick_count, 0))
         )::real as score,
         ST_DWithin(pl.geom::geography, q.g, 500) as attachable
  from q
  join public.places pl
    -- ★ 순서가 중요하다. 공간 인덱스가 먼저 일해야 한다.
    on ST_DWithin(pl.geom::geography, q.g, greatest(p_radius_m, 100))
  left join public.place_picks pk on pk.place_id = pl.id and pk.cell = q.cell
  where q.t <> ''
    and (pl.name ilike '%' || q.t || '%'
         or similarity(regexp_replace(pl.name, '\s', '', 'g'),
                       regexp_replace(q.t, '\s', '', 'g')) > 0.25)
    and (p_cat is null or true)
  order by score desc, dist_m
  limit greatest(1, least(p_limit, 50));
$$;

comment on function public.api_place_search is
  '후보에 없는 장소를 이름으로 찾는다. **좌표에 묶인 검색**이다 — 공간으로 먼저 좁히고 이름을 본다.
   attachable=false면 009의 부착 거리(500m)를 넘어 그대로는 붙일 수 없다.';

revoke execute on function public.api_place_search(
  text, double precision, double precision, pin_category, double precision, int) from public;
grant execute on function public.api_place_search(
  text, double precision, double precision, pin_category, double precision, int)
  to anon, authenticated;

select public.lock_function_privileges();
