-- =====================================================================
-- 035 섬 이동 — 차로 갈 수 없는 곳에 '차 시간'을 적지 않는다 (§12.25-E · §13.35)
--
-- ★ 지금까지는 **위도 한 줄**로 제주만 막았다(033·034). 울릉도·백령도는 그대로
--   "차로 3시간"이 찍혔다. 거짓 숫자는 없는 것보다 나쁘다 — 사용자가 그걸 믿고 간다.
--
-- ── 왜 경계 폴리곤으로 못 푸는가 (재봤다) ────────────────────────────
--   육지 덩어리를 이어 붙여 연결 성분을 구하면 정확할 텐데, 우리 `regions` 는
--   **관할 해역까지 포함한 단순화 폴리곤**이다:
--     울릉군 4,292km² (실제 육지 ~73km²) · 신안군 14,123km² (~650km²)
--   바다가 들어 있으니 "육지가 이어져 있나"를 물을 수 없다. → 그 길은 막혔다.
--
-- ── 그래서 아는 것만 적는다 ─────────────────────────────────────────
-- ★ **행정구역 단위로 확정할 수 있는 것만** 사실로 적는다. 제주(50110·50130)는
--   한 섬이고 육로로 뭍과 안 이어진다. 울릉군(47940)도 그렇다. 이건 추측이 아니다.
-- ★ 옹진군(28720)은 거의 전부 섬인데 영흥도처럼 다리로 이어진 곳이 섞여 있다.
--   → `unknown`. **모른다고 적고, 시간을 말하지 않는다.**
-- ★ 신안·진도·완도·통영·여수도 배로만 가는 섬을 갖고 있지만 **본토·연륙교 쪽이
--   훨씬 크다.** 군 전체를 unknown 으로 덮으면 갈 수 있는 곳 수백 곳이 같이 사라진다.
--   → 기본값(mainland)으로 두고, 그 군의 섬 몇 곳이 틀린다는 것을 여기 적어 둔다.
--   **군 단위로는 여기까지가 한계다.** 섬마다 가르려면 육지 폴리곤이 필요하고 없다.
-- =====================================================================

create table if not exists public.landmass (
  region_code text primary key references public.regions(code) on delete cascade,
  landmass    text not null,     -- 육로로 이어진 덩어리. 같으면 차로 간다.
  note        text not null      -- 왜 이렇게 적었는지. 근거 없는 줄은 넣지 않는다.
);

comment on table public.landmass is
  '육로 연결 덩어리. 여기 없는 지역은 본토(mainland)로 본다. landmass=unknown 이면 시간을 말하지 않는다.';

-- ★ 로컬 검증 DB 에는 경계 데이터가 없다(스키마만 올린다). 없는 지역은 건너뛴다 —
--   FK 로 막히면 마이그레이션 자체가 로컬에서 안 돌고, 그러면 문법 검증을 잃는다.
insert into public.landmass (region_code, landmass, note)
select v.code, v.lm, v.note
from (values
  ('50110', 'jeju',    '제주도 — 육로로 뭍과 이어지지 않는다 (배·비행기)'),
  ('50130', 'jeju',    '제주도 — 제주시와는 육로로 이어진다'),
  ('47940', 'ulleung', '울릉도·독도 — 배로만 간다'),
  ('28720', 'unknown', '옹진군 — 백령·연평은 배, 영흥도는 다리. 군 단위로는 가를 수 없다')
) as v(code, lm, note)
where exists (select 1 from public.regions r where r.code = v.code)
on conflict (region_code) do update
  set landmass = excluded.landmass, note = excluded.note;

-- ★ 이 프로젝트는 새 테이블에 RLS 가 **기본으로 켜진다.** grant 만 주면 0행이 보인다 —
--   권한은 있는데 정책이 없어서다. `regions` 와 같은 읽기 정책을 붙인다(공개 참고 자료).
--   (검사에서 잡혔다: authenticated 로 조회하니 제주가 'mainland' 로 나왔다)
alter table public.landmass enable row level security;
drop policy if exists landmass_read on public.landmass;
create policy landmass_read on public.landmass for select using (true);
grant select on public.landmass to anon, authenticated;

-- 지역 코드 → 덩어리. 없으면 본토.
create or replace function public.landmass_of(p_region_code text)
returns text language sql stable set search_path = public as $$
  select coalesce((select landmass from public.landmass where region_code = p_region_code), 'mainland')
$$;

-- 좌표 → 덩어리. ★ 경계가 해역을 포함하므로 **바다 위 좌표도 그 지역으로 떨어진다** —
--   여기서는 그게 맞다(제주 앞바다는 제주로 친다).
create or replace function public.landmass_at(p_lng double precision, p_lat double precision)
returns text language sql stable set search_path = public, extensions as $$
  select coalesce(
    (select public.landmass_of(r.code) from public.regions r
      where ST_Intersects(r.geom, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
      limit 1),
    'mainland')
$$;

comment on function public.landmass_at is
  '좌표가 속한 육로 덩어리. 경계가 해역을 포함하므로 앞바다 좌표도 그 지역으로 떨어진다.';

-- ---------------------------------------------------------------------
-- 시간 예산에서 위도 한 줄을 걷어낸다 (034 를 다시 쓴다)
-- ---------------------------------------------------------------------
create or replace function public.api_places_in_budget(
  p_lng double precision, p_lat double precision, p_budget_min int,
  p_cat pin_category default null, p_limit int default 30
)
returns table (
  place_id uuid, name text, category pin_category,
  dist_m double precision, drive_min int,
  stay_min int, stay_parties int, left_min int
)
language sql stable security invoker set search_path = public, extensions as $$
  with anchor as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           ((p_budget_min / 2.0) / 60.0 * 40000.0 / 1.4) as max_m,
           public.landmass_at(p_lng, p_lat) as lm
  ),
  near as (
    select pl.id, pl.name, pl.category, ST_Distance(pl.geom::geography, a.g) as d
    from public.places pl, anchor a
    where ST_DWithin(pl.geom::geography, a.g, a.max_m)
      and (p_cat is null or pl.category = p_cat)
      /* ★ 육로로 안 이어지면 차 시간을 낼 수 없다. `unknown` 도 뺀다 —
         모르는 것을 '갈 수 있다'로 보여 주면 시간 필터가 거짓말을 한다. */
      and public.landmass_of(pl.region_code) = a.lm
      and a.lm <> 'unknown'
  ),
  calc as (
    select n.id, n.name, n.category, n.d,
           ceil(n.d * 1.4 / (40000.0 / 60.0))::int as drive_min,
           (ps.stay_sec_p75 / 60)::int as stay_min, ps.parties
    from near n left join public.place_stay ps on ps.place_id = n.id
  )
  select id, name, category, d, drive_min, stay_min, parties,
         (p_budget_min - drive_min * 2 - coalesce(stay_min, 0))::int
  from calc
  where drive_min * 2 + coalesce(stay_min, 0) <= p_budget_min
  order by (stay_min is null), d
  limit p_limit
$$;

grant execute on function public.api_places_in_budget(
  double precision, double precision, int, pin_category, int) to anon, authenticated;

-- 화면(하루 코스)도 같은 표를 쓴다. 한 번 받아서 캐시한다 — 네 줄짜리다.
create or replace function public.api_landmass()
returns table (region_code text, landmass text)
language sql stable set search_path = public as $$
  select region_code, landmass from public.landmass
$$;
grant execute on function public.api_landmass() to anon, authenticated;
