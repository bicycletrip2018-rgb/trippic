-- =====================================================================
-- 081 검색이 **이름 길이 순**이었다 (§13.158)
--
-- 실기기에서 "광안리" 를 쳤더니 이렇게 나왔다:
--
--   | 1위 | 광안리 (강북구 · bar)  |  ← 3글자. **가장 짧다**            |
--   | 2위 | 광안리 (종로구 · food) |                                   |
--   | …   | 광안리가 · 광안리앤     |  4글자                            |
--   | 없음| **광안리해수욕장**      |  **7글자라 `limit 14` 에 잘렸다**  |
--
-- 062 가 두 가지(반경 / 앞머리)를 갈라 색인을 살린 것은 옳았다. 다만 그때
-- 정렬을 `order by length(pl.name), pl.name` 으로 뒀다 — 그건 **동점 처리**이지
-- 순위가 아니다. 관련도도, 인기도도, 거리도 보지 않는다.
--
-- ── 인기도 신호는 **이미 있었다** ────────────────────────────────────
-- 외부 API 를 들이기 전에 우리 표부터 봤다.
--
--   | 신호                     | 어디                     | 뜻                        |
--   |--------------------------|--------------------------|---------------------------|
--   | `places.source`          | 002                      | `tour_api` = 관광지·해수욕장·문화재 |
--   | `places.image_url`       | 025                      | TourAPI 가 사진을 준 곳    |
--   | `places.public_pin_count`| 008                      | 공개 기록 수 — **자체 인기도** |
--
-- `db/import/02_tourapi.py` 가 이미 적어 뒀다:
--   *"상가업소정보에는 관광지·자연·해수욕장·문화재가 단 하나도 없다"*
-- 즉 **광안리해수욕장은 `tour_api`, 광안리(강북구 bar)는 `public_data`** 다.
-- **출처만 봐도 갈린다.**
--
-- ── 같이 고치는 것: 화면이 쓸 수 있는 모양으로 준다 ──────────────────
-- 전에는 `sub` 에 `'지역명 · ' || category::text` 를 **서버에서 이어 붙여** 줬다.
-- 그래서 화면에 `강동구 · food` 라고 영어가 그대로 떴다. `MapSearch` 는 그
-- 문자열을 **잘라서** 한국어로 바꾸고 있었고(`sub.split(' · ')[1]`),
-- `PlacePicker` 는 그 보정이 없어 영어가 샜다.
-- **이어 붙인 것을 다시 자르게 만들면 안 된다** — `category` 와 `address` 를
-- 따로 준다. 한국어 이름은 화면이 안다(`theme.ts` 의 `CAT`).
--
-- ★ 색인 전략은 **건드리지 않는다**(053·062 의 규칙). 가지는 그대로 갈라 두고
--   정렬식만 바꾼다. 안쪽 limit 은 순위를 매길 재료가 남도록 넉넉히 뽑는다 —
--   `order by length limit 14` 로 먼저 자르면 **랭킹이 볼 것이 없다.**
-- =====================================================================

drop function if exists public.api_search(text, int, double precision, double precision, double precision);

create or replace function public.api_search(
  p_q text,
  p_limit int default 20,
  p_lng double precision default null,
  p_lat double precision default null,
  p_radius_m double precision default 1500
)
returns table (
  kind text, id text, name text, sub text,
  lng double precision, lat double precision,
  cover_url text, rank real,
  -- ★ 새로 주는 것. 화면이 문자열을 자르지 않아도 되게.
  category text, address text, dist_m double precision
)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_s text := btrim(p_q);
  v_n int  := greatest(1, coalesce(p_limit, 20));
  v_pool int;                       -- 순위를 매길 재료. 자른 뒤에 매기면 늦다
  /* ★ `geography` 변수를 **선언하지 않는다.** 로컬 검증은 PostGIS 를 스텁으로
     치환하는데(`db/local/001_postgis_stub.sql`) 컬럼 정의만 바꾸고 **plpgsql
     변수 선언은 못 바꾼다** — `type "geography" does not exist` 로 멈춘다.
     062 가 인라인으로 쓴 이유가 이것이다. 식이 길어도 **검증되는 쪽**이 낫다. */
begin
  if v_s = '' then return; end if;
  v_pool := greatest(v_n * 4, 60);

  /* ── 지역 — 251행이라 어떻게 써도 싸다 ── */
  return query
    select 'region'::text, r.code, r.name, r.sido,
           ST_X(r.center), ST_Y(r.center),
           null::text, similarity(r.name, v_s)::real,
           null::text, null::text, null::double precision
    from public.regions r
    where r.name ilike '%' || v_s || '%'
    order by similarity(r.name, v_s) desc, r.name
    limit 5;

  if p_lng is not null and p_lat is not null then
    /* ── 좌표를 안다: 반경 안에서 부분 일치 ── */
    return query
      with cand as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.address,
               pl.geom, pl.source, pl.image_url, pl.public_pin_count,
               ST_Distance(pl.geom::geography,
                           ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as d
        from public.places pl
        where pl.closed_at is null
          and ST_DWithin(pl.geom::geography,
                         ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                         p_radius_m)
          and pl.name ilike '%' || v_s || '%'
        limit v_pool
      )
      select 'place'::text, c.id::text, c.name,
             coalesce(rg.name, '') || ' · ' || c.category::text,
             ST_X(c.geom), ST_Y(c.geom), null::text,
             (  (case when c.name = v_s then 4.0 else 0 end)
              + (case when c.name ilike v_s || '%' then 2.5 else 0 end)
              + 2.0 * similarity(c.name, v_s)
              + (case when c.source = 'tour_api' then 3.0 else 0 end)
              + (case when c.image_url is not null then 1.0 else 0 end)
              + 0.8 * ln(1 + coalesce(c.public_pin_count, 0))
              + 2.0 * (1.0 / (1.0 + c.d / 1000.0))
             )::real,
             c.category::text, c.address, c.d
      from cand c
      left join public.regions rg on rg.code = c.region_code
      order by 8 desc, length(c.name), c.name
      limit v_n;
  else
    /* ── 좌표를 모른다: 앞머리 일치 + 3자 이상이면 부분 일치도 ──
       ★ 안쪽 limit 을 `v_pool` 로 넉넉히 둔다. 전에는 `v_n`(14) 으로 먼저
         자르면서 **광안리해수욕장이 거기서 떨어졌다.** */
      return query
      with pre as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.address,
               pl.geom, pl.source, pl.image_url, pl.public_pin_count
        from public.places pl
        where pl.closed_at is null and pl.name ilike v_s || '%'
        order by length(pl.name), pl.name
        limit v_pool
      ),
      mid as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.address,
               pl.geom, pl.source, pl.image_url, pl.public_pin_count
        from public.places pl
        where length(v_s) >= 3
          and pl.closed_at is null
          and pl.name ilike '%' || v_s || '%'
          and not exists (select 1 from pre where pre.id = pl.id)
        order by length(pl.name), pl.name
        limit v_pool
      ),
      cand as (select * from pre union all select * from mid)
      select 'place'::text, c.id::text, c.name,
             coalesce(rg.name, '') || ' · ' || c.category::text,
             ST_X(c.geom), ST_Y(c.geom), null::text,
             (  (case when c.name = v_s then 4.0 else 0 end)
              + (case when c.name ilike v_s || '%' then 2.5 else 0 end)
              + 2.0 * similarity(c.name, v_s)
              + (case when c.source = 'tour_api' then 3.0 else 0 end)
              + (case when c.image_url is not null then 1.0 else 0 end)
              + 0.8 * ln(1 + coalesce(c.public_pin_count, 0))
             )::real,
             c.category::text, c.address, null::double precision
      from cand c
      left join public.regions rg on rg.code = c.region_code
      order by 8 desc, length(c.name), c.name
      limit v_n;
  end if;
end $$;

comment on function public.api_search is
  '장소·지역 검색. 두 경우를 갈라 쓴다(062, 색인). 순위는 이름 길이가 아니라
   **관련도 + 랜드마크(tour_api) + 자체 인기도 + 거리**다(081). category/address 를
   따로 준다 — 화면이 sub 문자열을 자르지 않게.';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
