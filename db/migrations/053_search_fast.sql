-- =====================================================================
-- 053 장소 검색을 **타이핑 속도로** (§13.71)
--
-- ★ 실측한 고장: 짧은 질의가 **죽는다.**
--     "해운대"(3자) → 4건 정상
--     "해운"(2자)   → statement timeout
--     "해"(1자)     → statement timeout
--   자동 매칭을 고친 뒤(§13.70) 남은 것은 *"틀렸을 때 고치는 길"* 과
--   *"좌표가 없을 때 직접 찾는 길"* 인데, 둘 다 **검색이 빨라야** 성립한다.
--
-- ★ 원인 셋:
--   1. `ilike '%해%'` — 트라이그램 인덱스는 **3글자 미만에서 못 쓴다.** Seq Scan.
--   2. `order by st.score desc` — 정렬하려면 **맞는 것을 전부** 모아야 한다.
--      LIMIT 이 있어도 소용없다.
--   3. `place_stats`·`media` 조인이 **맞은 행마다** 붙는다. 그 표는 0행이다(§13.60).
--
-- ★ 고치는 방향 — **인덱스를 늘리지 않는다.** DB 가 407MB / 무료 한도 500MB 다.
--   여기서 인덱스를 더하면 한도를 넘겨 **프로젝트가 읽기 전용으로 잠긴다**
--   (`03_load.sh` 가 같은 이유로 vacuum full 을 한다).
--   → 있는 인덱스로 푼다.
--
-- ★ 가장 큰 깨달음: **대개 우리는 어디인지 안다.** 사진에 좌표가 있으니
--   *"그 근처에서 이름으로"* 찾으면 된다. 후보가 수백 개로 줄어 `ilike` 가
--   공짜가 되고, **결과도 훨씬 맞는다** — 서울 사는 사람이 부산 사진을 고칠 때
--   전국의 동명 가게가 뜨면 그게 더 나쁘다.
-- =====================================================================

drop function if exists public.api_search(text, int);

create or replace function public.api_search(
  p_q text,
  p_limit int default 20,
  -- ★ 좌표를 주면 **그 근처만** 찾는다. 없으면(위치 없는 사진) 전국을 찾는다.
  p_lng double precision default null,
  p_lat double precision default null,
  p_radius_m double precision default 30000
)
returns table (
  kind text, id text, name text, sub text,
  lng double precision, lat double precision,
  cover_url text, rank real
)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select btrim(p_q) as s),
  -- ── 지역은 251행뿐이라 뭘 해도 싸다 ──────────────────────────────
  reg as (
    select 'region'::text as kind, r.code as id, r.name, r.sido as sub,
           ST_X(r.center) as lng, ST_Y(r.center) as lat,
           null::text as cover_url,
           similarity(r.name, (select s from q))::real as rank
    from public.regions r, q
    where r.name ilike '%' || q.s || '%'
    order by similarity(r.name, (select s from q)) desc, r.name
    limit 5
  ),
  -- ── 장소: **먼저 좁히고** 그 다음에 이름을 본다 ──────────────────
  hit as (
    select pl.id, pl.name, pl.region_code, pl.category, pl.geom
    from public.places pl, q
    where pl.closed_at is null
      and (
        /* 좌표를 아는 경우 — `places_geog_gix` 가 반경으로 먼저 자른다.
           남는 후보가 수백 개라 `ilike` 는 그 위에서 공짜다. */
        (p_lng is not null and p_lat is not null
         and ST_DWithin(pl.geom::geography,
                        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                        p_radius_m)
         and pl.name ilike '%' || q.s || '%')
        or
        /* 좌표를 모르는 경우 — **앞에서부터 맞는 것**만 본다.
           ★ 부분 일치(`%q%`)를 버리는 것이 아니라, 짧은 질의에서는
             앞머리 일치가 사람이 기대하는 것이고 **범위를 좁힐 수 있는
             유일한 조건**이다. 3글자 이상이면 아래 `sub` 가 부분 일치를 맡는다. */
        (p_lng is null and pl.name ilike q.s || '%')
      )
    /* ★ 점수로 정렬하지 않는다. 정렬하려면 맞는 것을 **전부** 모아야 하고,
       그게 타임아웃의 원인이었다. 이름 길이순이면 `해운대` 가 `해운대구
       무슨무슨 지점` 보다 앞에 온다 — 짧을수록 사람이 찾던 것에 가깝다. */
    order by length(pl.name), pl.name
    limit greatest(1, p_limit)
  ),
  -- ── 좌표를 모르고 3글자 이상이면 부분 일치도 더한다(트라이그램이 듣는다) ──
  sub as (
    select pl.id, pl.name, pl.region_code, pl.category, pl.geom
    from public.places pl, q
    where p_lng is null and length(q.s) >= 3
      and pl.closed_at is null
      and pl.name ilike '%' || q.s || '%'
      and pl.id not in (select id from hit)
    order by length(pl.name), pl.name
    limit greatest(1, p_limit)
  ),
  merged as (
    select * from hit union all select * from sub
  )
  select * from reg
  union all
  (
    /* ★ 이름·지역은 **줄인 뒤에** 붙인다. 맞은 행마다 조인하면
       그 조인이 곧 비용이다(예전 판이 그랬다). */
    select 'place'::text, m.id::text, m.name,
           coalesce(rg.name, '') || ' · ' || m.category::text,
           ST_X(m.geom), ST_Y(m.geom), null::text, 0::real
    from merged m
    left join public.regions rg on rg.code = m.region_code
    order by length(m.name), m.name
    limit greatest(1, p_limit)
  );
$$;

comment on function public.api_search is
  '장소·지역 검색. 좌표를 주면 그 반경만 본다(빠르고 더 맞는다). 좌표가 없으면 앞머리 일치 + 3자 이상 부분 일치. 점수 정렬을 하지 않는다 — 정렬하려면 맞는 것을 전부 모아야 해서 짧은 질의가 죽었다.';

grant execute on function public.api_search(text, int, double precision, double precision, double precision)
  to anon, authenticated;

select public.lock_function_privileges();
