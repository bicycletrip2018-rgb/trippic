-- =====================================================================
-- 062 검색이 **매번 타임아웃**하고 있었다 (§13.100)
--
-- ★ 실측한 고장: `api_search` 가 PostgREST 에서 **늘 500** 이었다.
--   (statement timeout 3.3s · psql 로 직접 부르면 4.7~8.7s)
--   §13.99 에서 검증(③ 웹 UI 스모크)이 잡았다 — 1년 가까이 아무도 못 썼을 수 있다.
--
-- ★ 실행계획으로 좁힌 원인:
--
--   | 잰 것                                   | 시간     |
--   |-----------------------------------------|----------|
--   | `api_search('전주한옥마을', 5)`          | 6,609 ms |
--   | **같은 본문**을 `PREPARE` 로              |   210 ms |
--   | 조각별(함수 안): reg 18 · sub 19 · 앞머리 15 | 각 수십 ms |
--   | 본문에서 **`ST_DWithin` 가지만 제거**      |  **13 ms** |
--
--   `hit` 이 *"좌표가 있으면 반경 안, 없으면 앞머리 일치"* 를 **하나의 `OR`** 로 썼다.
--   SQL 함수는 **일반계획(generic plan)** 으로 도므로 `p_lng is not null` 을
--   **접을 수 없다** — 좌표를 안 줘도 반경 가지가 살아남아 **465,914행에
--   geography 캐스트**를 돌린다. 그래서 색인이 통째로 무용지물이 된다.
--
--   ★ `PREPARE` 가 빨랐던 것이 함정이었다. 준비된 문은 처음 몇 번 **맞춤계획**을
--     써서 NULL 을 보고 가지를 지운다 — 그래서 *"본문은 빠른데 함수는 느리다"* 가
--     됐고, 본문만 보고 있으면 영영 못 찾는다.
--
-- ★ 053 은 *"부분 일치는 2글자에서 Seq Scan 으로 떨어진다"* 까지 알고 적어 뒀는데,
--   **그 `OR` 자체가 색인을 막는다**는 것은 몰랐다. 조건을 하나 더 붙여 막은 것이
--   아니라 **두 경우를 한 식에 넣은 것**이 문제였다.
--
-- ── 고치는 길: 두 경우를 **갈라 쓴다** ───────────────────────────────
-- `plpgsql` 로 바꿔 `IF` 로 가른다. 갈라 두면 각 질의가 **따로 계획되어** 저마다
-- 색인을 탄다. 식을 더 영리하게 쓰는 것으로는 안 된다 — 플래너가 접을 수 없는 것은
-- 우리가 접어 줘야 한다.
--
-- ★ **인덱스를 늘리지 않는다**(053 의 규칙 그대로). DB 가 무료 한도에 가깝다.
-- ★ 돌려주는 모양·순서는 **그대로**다. 지역 먼저, 그다음 장소.
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
  cover_url text, rank real
)
language plpgsql stable security invoker set search_path = public, extensions as $$
declare
  v_s text := btrim(p_q);
  v_n int  := greatest(1, coalesce(p_limit, 20));
begin
  if v_s = '' then return; end if;      -- 빈 질의는 아무것도 안 돌려준다

  /* ── 지역 — 두 경우가 같다. 251행이라 어떻게 써도 싸다 ── */
  return query
    select 'region'::text, r.code, r.name, r.sido,
           ST_X(r.center), ST_Y(r.center),
           null::text, similarity(r.name, v_s)::real
    from public.regions r
    where r.name ilike '%' || v_s || '%'
    order by similarity(r.name, v_s) desc, r.name
    limit 5;

  if p_lng is not null and p_lat is not null then
    /* ── 좌표를 안다: 반경 안에서 부분 일치 ──
       ★ 여기서는 `%q%` 를 써도 된다. 반경이 먼저 걸러 주므로 대상이 작다. */
    return query
      select 'place'::text, pl.id::text, pl.name,
             coalesce(rg.name, '') || ' · ' || pl.category::text,
             ST_X(pl.geom), ST_Y(pl.geom), null::text, 0::real
      from public.places pl
      left join public.regions rg on rg.code = pl.region_code
      where pl.closed_at is null
        and ST_DWithin(pl.geom::geography,
                       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                       p_radius_m)
        and pl.name ilike '%' || v_s || '%'
      order by length(pl.name), pl.name
      limit v_n;
  else
    /* ── 좌표를 모른다: 앞머리 일치 + 3자 이상이면 부분 일치도 ──
       ★ 둘을 `union all` 로 **한 질의 안에서** 합치되, 조건에 `p_lng` 가 없으므로
         각 가지가 저마다 `places_name_trgm` 을 탄다. 같은 곳이 두 번 나오지 않게
         뒤쪽에서 앞쪽을 뺀다(예전 `sub` 의 `not in` 과 같은 뜻이다). */
    return query
      with pre as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.geom
        from public.places pl
        where pl.closed_at is null and pl.name ilike v_s || '%'
        order by length(pl.name), pl.name
        limit v_n
      ),
      mid as (
        select pl.id, pl.name, pl.region_code, pl.category, pl.geom
        from public.places pl
        where length(v_s) >= 3
          and pl.closed_at is null
          and pl.name ilike '%' || v_s || '%'
          and not exists (select 1 from pre where pre.id = pl.id)
        order by length(pl.name), pl.name
        limit v_n
      )
      select 'place'::text, m.id::text, m.name,
             coalesce(rg.name, '') || ' · ' || m.category::text,
             ST_X(m.geom), ST_Y(m.geom), null::text, 0::real
      from (select * from pre union all select * from mid) m
      left join public.regions rg on rg.code = m.region_code
      order by length(m.name), m.name
      limit v_n;
  end if;
end $$;

comment on function public.api_search is
  '장소·지역 검색. 좌표가 있으면 반경 안, 없으면 앞머리+부분 일치 — **두 경우를 갈라 쓴다**(한 OR 에 넣으면 일반계획이 색인을 못 탄다, §13.100).';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
