-- =====================================================================
-- 082 "출처가 랜드마크를 가른다" 는 틀렸다 — **카테고리가 가른다** (§13.158)
--
-- 081 은 `source = 'tour_api'` 에 +3.0 을 줬다. 근거는 `db/import/02_tourapi.py`
-- 의 *"상가업소정보에는 관광지·자연·해수욕장·문화재가 단 하나도 없다"* 였다.
-- **그 문장은 맞다.** 다만 그 역은 아니었다 — 적용 후 **운영에서 세어 보니**:
--
--   tour_api 안의 분포:  shop 14,177 · food 13,085 · heritage 8,050 · stay 6,700 …
--
-- TourAPI 는 관광지**만** 주는 곳이 아니라 **관광지도** 주는 곳이었다.
-- 출처로는 갈리지 않는다. `image_url` 도 마찬가지다(tour_api shop 의 97%가 갖고 있다).
--
-- ── 실제로 가르는 것: **카테고리의 희소성** ─────────────────────────
--
--   | 카테고리   | 장소 수  | 무엇인가 |
--   |-----------|---------|---------|
--   | beach     |     480 | **목적지** — 거기에 가려고 간다 |
--   | event     |   2,168 |  |
--   | nature    |   4,828 | **목적지** |
--   | heritage  |   8,050 | **목적지** |
--   | bar       |  26,164 | 가게 |
--   | stay      |  29,094 | 가게 |
--   | activity  |  30,080 |  |
--   | cafe      |  36,067 | 가게 |
--   | food      | 163,085 | 가게 |
--   | shop      | 165,696 | 가게 |
--
-- 해수욕장은 전국에 480곳이고 식당은 163,085곳이다. *"광안리"* 를 친 사람이
-- 찾는 것은 **480곳 쪽**이다.
--
-- ── 그리고 **완전 일치를 낮춘다** ────────────────────────────────────
-- 081 은 완전 일치에 +4.0 을 줬다. 그러면 강북구의 `광안리`(술집, 320km 밖)가
-- 8.5점으로 **무엇을 더해도 못 이긴다.** 실측 similarity 가
-- `('광안리해수욕장','광안리') = 0.333` 이라 유사도로는 1.33점밖에 못 번다.
--
-- 완전 일치 4.0 → **2.0**. 이름이 똑같다는 것은 단서이지 **답이 아니다** —
-- 네이버가 광안리해수욕장을 먼저 보여 주는 이유도 이름이 아니라 **그곳이 더
-- 많이 찾는 곳**이어서다. 우리에게 검색량은 없고, 가장 가까운 대용이 희소성이다.
--
-- ── 계산해 보고 정한 값 (추측 아님) ─────────────────────────────────
--   광안리(술집)      2.0 + 2.5 + 2.0×1.000            = 6.50
--   광안리해수욕장     0   + 2.5 + 2.0×0.333 + 3.0 + .6 = 6.77  ← 1위
--   광안리어방축제     0   + 2.5 + 0.667     + 1.2 + .6 = 4.97
--   광안리부산횟집     0   + 2.5 + 0.667     + 0   + .6 = 3.77
--
-- ★ `public_pin_count` 는 **지금 전부 0**이다. 가중치는 남겨 둔다 —
--   사용자가 쌓이면 **그때부터 이 식이 저절로 똑똑해진다.**
-- =====================================================================

/* ── 카테고리 등급 — **한곳에서 정한다** ────────────────────────────
   ★ 식 안에 `case` 를 흩어 두면 다른 함수(후보 목록·피드)가 같은 판단을 할 때
     숫자가 갈라진다. 바꿀 일이 생기면 **여기 하나만** 고친다.
   ★ 숫자의 근거는 **개수**다(위 표). 480곳과 165,696곳을 같은 무게로 두면
     희소한 쪽이 영영 안 보인다. */
create or replace function public.place_tier(c pin_category)
returns real language sql immutable parallel safe as $$
  select case c
           when 'beach'    then 3.0      --    480곳
           when 'nature'   then 3.0      --  4,828곳
           when 'heritage' then 3.0      --  8,050곳
           when 'event'    then 1.2      --  2,168곳 — 기간이 짧아 한 급 낮춘다
           when 'activity' then 1.2      -- 30,080곳
           else 0.0                      -- food·shop·cafe·stay·bar — 가게
         end::real;
$$;

comment on function public.place_tier is
  '검색·추천에서 쓰는 카테고리 등급. 희소한 카테고리가 목적지다(§13.158).';

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
  category text, address text, dist_m double precision
)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_s text := btrim(p_q);
  v_n int  := greatest(1, coalesce(p_limit, 20));
  v_pool int;
begin
  if v_s = '' then return; end if;
  v_pool := greatest(v_n * 4, 60);

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
             (  (case when c.name = v_s then 2.0 else 0 end)
              + (case when c.name ilike v_s || '%' then 2.5 else 0 end)
              + 2.0 * similarity(c.name, v_s)
              + public.place_tier(c.category)
              + (case when c.source = 'tour_api' then 0.3 else 0 end)
              + (case when c.image_url is not null then 0.3 else 0 end)
              + 0.8 * ln(1 + coalesce(c.public_pin_count, 0))
              + 2.0 * (1.0 / (1.0 + c.d / 1000.0))
             )::real,
             c.category::text, c.address, c.d
      from cand c
      left join public.regions rg on rg.code = c.region_code
      order by 8 desc, length(c.name), c.name
      limit v_n;
  else
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
             (  (case when c.name = v_s then 2.0 else 0 end)
              + (case when c.name ilike v_s || '%' then 2.5 else 0 end)
              + 2.0 * similarity(c.name, v_s)
              + public.place_tier(c.category)
              + (case when c.source = 'tour_api' then 0.3 else 0 end)
              + (case when c.image_url is not null then 0.3 else 0 end)
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
  '장소·지역 검색. 두 경우를 갈라 쓴다(062, 색인). 순위 = 관련도 + **카테고리 희소성**
   + 자체 인기도 + 거리(082). 출처(tour_api)는 랜드마크 신호가 아니다 — 그 안에
   상점 14,177곳이 있다.';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
