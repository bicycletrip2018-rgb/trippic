-- =====================================================================
-- 지금 붙어 있는 region_code를 **경계 폴리곤으로** 다시 판정한다.
--
-- ★ 자동으로 고치지 않는다. §10.39에서 배운 것:
--   주소가 현행 시군구를 명시하면 **주소가 폴리곤보다 권위 있다.**
--   재편이 최근일수록 OSM 경계가 덜 정확하다. 숫자를 먼저 보고 사람이 정한다.
--
-- psql -f db/import/audit_regions.sql
-- =====================================================================
set statement_timeout = '30min';

\echo '── 1. 경계 출처별 현황'
select geom_source, coalesce(geom_simplify_m, -1) as 단순화m, count(*) as 지역,
       round(avg(ST_NPoints(geom))) as 평균꼭짓점
from public.regions group by 1, 2 order by 3 desc;

\echo ''
\echo '── 2. 배정 vs 폴리곤 (전체)'
with j as (
  select p.region_code as cur,
         (select r2.code from public.regions r2
          where ST_Contains(r2.geom, p.geom) limit 1) as bypoly
  from public.places p
)
select case when bypoly is null then '폴리곤 밖'
            when bypoly = cur then '일치'
            else '불일치' end as 판정,
       count(*),
       round(100.0 * count(*) / sum(count(*)) over (), 2) as pct
from j group by 1 order by 2 desc;

\echo ''
\echo '── 3. 불일치 상위 (현재 → 폴리곤)'
with j as (
  select p.region_code as cur, p.address,
         (select r2.code from public.regions r2
          where ST_Contains(r2.geom, p.geom) limit 1) as bypoly
  from public.places p
)
select rc.sido || ' ' || rc.name as 현재, rp.sido || ' ' || rp.name as 폴리곤,
       count(*),
       count(*) filter (where j.address like '%' || rc.name || '%') as 주소가_현재와_일치
from j
join public.regions rc on rc.code = j.cur
join public.regions rp on rp.code = j.bypoly
where j.bypoly <> j.cur
group by 1, 2 order by 3 desc limit 15;
