-- =====================================================================
-- 후보 밀도 실측 — "사진 한 장 찍은 자리에 후보가 몇 개나 뜨는가"
--
-- 이 숫자가 007 설계의 근거다. 50m 안에 1곳이면 자동 확정이 성립하고,
-- 19곳이면 성립하지 않는다. 출처가 바뀔 때마다 다시 재야 한다.
--
-- psql -v pct=20 -v n=1500 -f db/analysis/density.sql
-- =====================================================================
\set ON_ERROR_STOP on
with s as (
  select id, geom, category from public.places tablesample system (:pct) limit :n
),
c as (
  select s.id,
    count(*) filter (where ST_DWithin(p.geom::geography, s.geom::geography, 30))  as r30,
    count(*) filter (where ST_DWithin(p.geom::geography, s.geom::geography, 50))  as r50,
    count(*) filter (where ST_DWithin(p.geom::geography, s.geom::geography, 150)) as r150,
    count(*) filter (where ST_DWithin(p.geom::geography, s.geom::geography, 50)
                       and p.category = s.category)                               as r50_같은카테고리
  from s
  join public.places p on ST_DWithin(p.geom::geography, s.geom::geography, 150)
  group by s.id
)
select '표본 ' || count(*) as 구분,
  percentile_disc(0.5) within group (order by r30)              as "30m_중앙",
  percentile_disc(0.5) within group (order by r50)              as "50m_중앙",
  percentile_disc(0.9) within group (order by r50)              as "50m_90%",
  max(r50)                                                      as "50m_최대",
  percentile_disc(0.5) within group (order by r150)             as "150m_중앙",
  percentile_disc(0.9) within group (order by r150)             as "150m_90%",
  percentile_disc(0.5) within group (order by r50_같은카테고리) as "50m+카테고리_중앙"
from c;

-- 밀집 지역만 따로 (후보가 10개 넘는 자리가 전체의 몇 %인가)
with s as (select id, geom from public.places tablesample system (:pct) limit :n),
c as (
  select s.id, count(*) as n
  from s join public.places p on ST_DWithin(p.geom::geography, s.geom::geography, 50)
  group by s.id)
select round(100.0 * count(*) filter (where n >= 10) / count(*), 1) as "50m에_10곳이상_%",
       round(100.0 * count(*) filter (where n = 1)  / count(*), 1)  as "50m에_1곳뿐_%"
from c;
