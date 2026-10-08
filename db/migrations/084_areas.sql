-- =====================================================================
-- 084 지역(읍·면·리)을 **고를 수 있게** 한다 — 1단계 (§13.161)
--
-- 사용자: *"양수리 놀러 가서 찍은 사진인데 위치가 딱 고정되어 있지 않다.
--          이곳저곳 밖에서 하천에서 찍은 사진이다.
--          네이버는 «양수리» 자체가 있어서 지리로 묶어 저장할 수 있다"*
--
-- `SUBREGION_PLAN.md` 1단계다. **외부 데이터를 받지 않는다** —
-- 우리 `places` 의 주소에 이미 들어 있다.
--
-- ── 왜 새 표가 아니라 `places` 의 플래그인가 ─────────────────────────
-- 새 표로 만들면 **검색·등록·핀 이름이 전부 새 길을 타야 한다.** 핀은 이름을
-- `places` 에서 얻으므로(083), 지역이 `places` 안에 있으면 **클라이언트가
-- 고칠 것이 없다** — 고르면 그냥 된다.
--
-- ★ `place_source` 에 값을 더하지 않는다. `push.sh` 는 전부 **한 트랜잭션**으로
--   묶는데, PostgreSQL 은 **새 enum 값을 만든 트랜잭션 안에서 그 값을 못 쓴다.**
--   플래그 컬럼이면 그 함정이 없다.
--
-- ── 좌표는 어디서 오나 ──────────────────────────────────────────────
-- 그 지역 **안에 있는 장소들의 중심**이다. 실측한 신뢰도:
--
--   | 단위  | 개수  | 근거 두께                          |
--   |------|------|-----------------------------------|
--   | 읍·면 | 1,389 | 전국 ≈1,400 — **사실상 전부**. 절반이 5~20곳 이상 |
--   | 리    | 2,088 | 전국 2만의 10%. 74%가 1곳          |
--
-- 여러 곳인 리의 평균 지름은 1.8~4.5 km 로 **리 크기 안쪽**이다.
-- → **지역을 가리키기엔 충분하고, 정확한 지점을 찍기엔 부족하다.**
--   사용자가 원한 정밀도가 정확히 그것이다.
--
-- ★ 그래서 **`n_places` 를 같이 적는다.** 근거가 1곳인 것과 30곳인 것은
--   다른 것이고, 숨기면 나중에 둘을 구분할 방법이 없다.
-- ★ **'현장 인증'은 여기에 안 붙는다.** 009 의 부착 거리(500m)를 지역 중심이
--   통과할 리 없고, 통과시키면 인증의 뜻이 사라진다(§6.5).
-- =====================================================================

alter table public.places add column if not exists is_area boolean not null default false;
alter table public.places add column if not exists area_places int;

comment on column public.places.is_area is
  '행정구역(읍·면·리)이다. 가게가 아니라 **범위**다 — 좌표는 그 안 장소들의 중심이고
   정확한 지점이 아니다(084).';
comment on column public.places.area_places is
  '이 지역을 만든 근거 장소 수. 1곳과 30곳은 다르다 — 숨기지 않는다(084).';

create index if not exists places_is_area_idx on public.places (is_area) where is_area;

-- ── 지역을 뽑아 넣는다 ───────────────────────────────────────────────
-- ★ 정규식을 **읍/면에 고정한다.** `[가-힣]+동` 만으로 잡으면 도로명("행당동길")
--   까지 걸린다. 리는 **반드시 읍/면 뒤**에 온다는 규칙을 그대로 쓴다.
-- ★ 동(洞)은 이번에 안 넣는다 — 도로명주소에 동이 안 들어가 근거가 없고,
--   도시에서는 상호 검색이 이미 잘 듣는다. 필요해지면 그때 2단계에서 한다.
with m as (
  select pl.region_code, pl.geom,
         (regexp_match(pl.address, '\s([가-힣]{1,8}(?:읍|면))\s'))[1]        as emd,
         (regexp_match(pl.address, '(?:읍|면)\s+([가-힣]{1,8}리)(?:\s|$)'))[1] as ri
  from public.places pl
  where pl.closed_at is null and pl.address is not null and not pl.is_area
),
emd as (
  select region_code, emd as name, null::text as parent, count(*)::int as n,
         ST_Centroid(ST_Collect(geom)) as c
  from m where emd is not null and region_code is not null
  group by 1,2
),
ri as (
  select region_code, ri as name, emd as parent, count(*)::int as n,
         ST_Centroid(ST_Collect(geom)) as c
  from m where ri is not null and region_code is not null
  group by 1,2,3
),
all_areas as (select * from emd union all select * from ri)
insert into public.places (name, category, address, region_code, geom,
                           source, source_ref, is_area, area_places)
select a.name,
       'etc'::pin_category,
       -- '경기도 양평군 양서면' / '경기도 양평군 양서면 양수리'
       btrim(concat_ws(' ', r.sido, r.name, a.parent)),
       a.region_code,
       a.c,
       'public_data'::place_source,      -- 상가업소정보 주소에서 **파생**된 것이다
       'area:' || a.region_code || ':' || coalesce(a.parent, '') || ':' || a.name,
       true,
       a.n
from all_areas a
join public.regions r on r.code = a.region_code
on conflict (source, source_ref) where source_ref is not null do nothing;

-- ── 후보 목록에서는 뺀다 ─────────────────────────────────────────────
-- ★ *"지금 여기"* 의 후보는 **17m 앞 가게**를 고르는 자리다. 거기에 1.2km 밖
--   지역이 섞이면 고르는 일을 방해한다. 지역은 **검색으로** 찾는다.
-- (api_place_candidates 는 019 이후 바뀐 적이 없어 여기서 덮어쓰지 않는다 —
--  대신 아래 085 에서 한 번에 손본다. 이 마이그레이션은 **넣기만** 한다.)

notify pgrst, 'reload schema';
