-- =====================================================================
-- 반경과 후보 개수를 흔들어 본다.
--
-- 분류기 정확도를 아무리 올려도 top1이 55%에서 막힌다면,
-- 더 큰 지렛대가 다른 데 있을 수 있다. 둘 다 코드 한 줄로 바꿀 수 있는 값이다.
--   · 반경: 좁히면 정답이 빠질 위험, 넓히면 후보가 64개
--   · 보여줄 개수: 5개 → 10개
--
-- psql -v acc=.. -v conf=.. -v n=.. -v sigma=.. -v radius=.. -v sample_pct=..
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

create or replace function pg_temp.gauss(sigma double precision)
returns double precision language sql volatile as $$
  select sigma * sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random())
$$;

drop table if exists sim;
create temp table sim as
with sample as (
  select id, category, geom from public.places
  tablesample system (:sample_pct) where category is not null limit :n
),
cats as (select array_agg(e.enumlabel::text) a from pg_enum e
         join pg_type t on t.oid=e.enumtypid where t.typname='pin_category')
select s.id as truth_id, s.category as truth_cat,
  ST_X(s.geom) + pg_temp.gauss(:sigma) / (111320.0 * cos(radians(ST_Y(s.geom)))) as plng,
  ST_Y(s.geom) + pg_temp.gauss(:sigma) / 111320.0                                as plat,
  (case when random() < :acc then s.category::text
        else (select x from unnest(c.a) x where x <> s.category::text order by random() limit 1)
   end)::pin_category as pred_cat
from sample s cross join cats c;
create index on sim using gist (ST_SetSRID(ST_MakePoint(plng, plat), 4326));
analyze sim;

with ranked as (
  select sim.truth_id, p.id as cand_id,
         row_number() over (partition by sim.truth_id order by public.candidate_score(
             ST_Distance(p.geom::geography, ST_SetSRID(ST_MakePoint(sim.plng, sim.plat),4326)::geography),
             p.category = sim.pred_cat, :conf, coalesce(p.is_ground, true), 0, 0) desc) as rk
  from sim join public.places p
    on ST_DWithin(p.geom::geography, ST_SetSRID(ST_MakePoint(sim.plng,sim.plat),4326)::geography, :radius)
),
-- 정답이 반경 안에 아예 없는 경우도 세야 한다. 그게 반경을 좁힐 때의 진짜 비용이다.
hit as (
  select s.truth_id,
         max(case when r.cand_id = s.truth_id then r.rk end) as truth_rk,
         count(r.cand_id)                                    as n_cand
  from sim s left join ranked r on r.truth_id = s.truth_id
  group by s.truth_id
)
select :radius as 반경m, :acc as 정확도,
  count(*)                                                                as 표본,
  round(100.0*count(*) filter (where truth_rk = 1)  / count(*), 1)        as "top1_%",
  round(100.0*count(*) filter (where truth_rk <= 5) / count(*), 1)        as "top5_%",
  round(100.0*count(*) filter (where truth_rk <=10) / count(*), 1)        as "top10_%",
  round(100.0*count(*) filter (where truth_rk is null) / count(*), 1)     as "정답없음_%",
  round(avg(n_cand))                                                      as 평균후보수
from hit;
