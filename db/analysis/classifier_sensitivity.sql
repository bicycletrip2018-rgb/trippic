-- =====================================================================
-- 사진 카테고리 분류기가 **몇 %부터 쓸모가 있는가**
--
-- 007의 랭킹에서 카테고리는 가중치 3.0짜리 — 가장 큰 항이다.
-- 그런데 분류기가 틀리면 그 3.0이 **엉뚱한 후보를 밀어올린다.**
-- 모델을 고르기 전에 이걸 먼저 재야 한다:
--   "정확도 X%인 분류기를 켜는 게, 아예 안 켜는 것보다 나은가?"
--
-- 방법: 실제 places에서 N곳을 뽑아 그곳에서 사진을 찍었다고 치고
--   · GPS 오차를 정규분포로 얹고 (도심 σ≈15m)
--   · 확률 X로 정답 카테고리를, 1-X로 엉뚱한 카테고리를 뱉는 분류기를 흉내내
--   · api_place_candidates와 같은 점수식으로 순위를 매겨
--   · 정답이 1등인 비율(top1)과 5등 안에 드는 비율(top5)을 센다
--
-- 비교 기준은 :acc = 0 이 아니라 **분류기를 끈 상태**(conf=0)다.
--
-- psql -v acc=0.7 -v conf=0.7 -v n=2000 -v sigma=15 -f classifier_sensitivity.sql
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- 정규분포 난수 (tablefunc 없이 Box–Muller)
create or replace function pg_temp.gauss(sigma double precision)
returns double precision language sql volatile as $$
  select sigma * sqrt(-2 * ln(greatest(random(), 1e-12))) * cos(2 * pi() * random())
$$;

drop table if exists sim;
create temp table sim as
with sample as (
  select id, category, geom
  from public.places
  tablesample system (:sample_pct)
  where category is not null
  limit :n
),
cats as (select array_agg(e.enumlabel::text) a from pg_enum e
         join pg_type t on t.oid=e.enumtypid where t.typname='pin_category')
select
  s.id                    as truth_id,
  s.category              as truth_cat,
  -- 사진의 GPS 좌표 = 실제 위치 + 오차. 위도 1도≈111km로 환산해 미터를 도로 바꾼다
  ST_X(s.geom) + pg_temp.gauss(:sigma) / (111320.0 * cos(radians(ST_Y(s.geom)))) as plng,
  ST_Y(s.geom) + pg_temp.gauss(:sigma) / 111320.0                                as plat,
  -- 분류기 출력: 확률 :acc 로 정답, 아니면 정답을 뺀 나머지 중 하나
  (case when random() < :acc then s.category::text
        else (select x from unnest(c.a) x where x <> s.category::text
              order by random() limit 1)
   end)::pin_category    as pred_cat
from sample s cross join cats c;

create index on sim using gist (ST_SetSRID(ST_MakePoint(plng, plat), 4326));
analyze sim;

-- 같은 점수식으로 순위를 매긴다 (place_picks는 콜드스타트라 0)
with ranked as (
  select sim.truth_id, p.id as cand_id,
         row_number() over (
           partition by sim.truth_id
           order by public.candidate_score(
             ST_Distance(p.geom::geography,
                         ST_SetSRID(ST_MakePoint(sim.plng, sim.plat), 4326)::geography),
             p.category = sim.pred_cat,
             :conf,
             coalesce(p.is_ground, true),
             0, 0) desc
         ) as rk
  from sim
  join public.places p
    on ST_DWithin(p.geom::geography,
                  ST_SetSRID(ST_MakePoint(sim.plng, sim.plat), 4326)::geography, 150)
)
select
  :acc                                                          as 분류기정확도,
  :conf                                                         as 신뢰도,
  count(distinct truth_id)                                      as 표본,
  round(100.0 * count(*) filter (where rk = 1 and cand_id = truth_id)
        / nullif(count(distinct truth_id), 0), 1)               as "top1_%",
  round(100.0 * count(*) filter (where rk <= 5 and cand_id = truth_id)
        / nullif(count(distinct truth_id), 0), 1)               as "top5_%",
  round(avg(rk) filter (where cand_id = truth_id), 2)           as 정답평균순위
from ranked;
