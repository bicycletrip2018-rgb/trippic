-- =====================================================================
-- 분류기 민감도 — **한 번만 조인하는** 판
--
-- 앞선 classifier_sensitivity.sql은 설정 하나마다 psql을 새로 띄우고
-- 같은 공간 조인을 처음부터 다시 했다. 장소가 1.9만(TourAPI만)일 땐 몰랐는데
-- 163만으로 늘리자 설정당 2.5~5분이 됐다 — 11개 설정에 1시간.
--
-- 비싼 건 "사진 주변 150m 안의 장소 찾기"이고, 설정마다 달라지는 건
-- **점수식뿐**이다. 그래서 후보를 한 번만 만들고, 설정 전부를 그 위에 얹는다.
--
-- 두 번째 가속: 로컬 PostGIS 스텁의 ST_DWithin은 인덱스를 범위 검색으로 쓰지 못한다.
--   Index Only Scan + Filter → 표본 하나마다 163만 건을 훑는다.
--   GiST point_ops가 지원하는 `<@ box`로 먼저 자르고, 정확한 거리로 다시 거른다.
--   ※ 이 최적화는 로컬 스텁 전용이다. 실서버(PostGIS)에서는 원본 하네스를 쓴다.
--
-- 분류기 흉내: 설정마다 난수를 새로 뽑으면 설정 간 차이에 난수 노이즈가 섞인다.
--   표본마다 u(균등난수)와 wrong_cat을 **한 번 고정**해 두고
--   pred = (u < acc ? 정답 : wrong_cat) 으로 만든다 → 설정끼리 짝지어 비교된다.
--
-- psql -v n=2000 -v sigma=15 -v radius=150 -f classifier_sensitivity_fast.sql
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
set work_mem = '256MB';

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
         join pg_type t on t.oid = e.enumtypid where t.typname = 'pin_category')
select s.id as truth_id, s.category as truth_cat,
       ST_X(s.geom) + pg_temp.gauss(:sigma) / (111320.0 * cos(radians(ST_Y(s.geom)))) as plng,
       ST_Y(s.geom) + pg_temp.gauss(:sigma) / 111320.0                                as plat,
       random() as u,
       (select x from unnest(c.a) x where x <> s.category::text
        order by random() limit 1)::pin_category as wrong_cat
from sample s cross join cats c;
analyze sim;

-- ★ 여기가 유일하게 비싼 단계다. 딱 한 번 돈다.
drop table if exists cand;
create temp table cand as
select s.truth_id, p.id as cand_id, p.category as cand_cat,
       coalesce(p.is_ground, true) as ground,
       (p.geom <-> point(s.plng, s.plat)) * 111320.0 as dist_m
from sim s
join public.places p
  on p.geom <@ box(point(s.plng - :radius / (111320.0 * cos(radians(s.plat))),
                         s.plat - :radius / 111320.0),
                   point(s.plng + :radius / (111320.0 * cos(radians(s.plat))),
                         s.plat + :radius / 111320.0))
where (p.geom <-> point(s.plng, s.plat)) * 111320.0 <= :radius;
create index on cand (truth_id);
analyze cand;

\echo ''
\echo '── 반경 안 후보 수 (분류기가 의미를 가지려면 후보가 둘 이상이어야 한다)'
select count(*) as 표본,
       round(avg(c)::numeric, 1) as 평균,
       percentile_disc(0.5) within group (order by c) as 중앙값,
       percentile_disc(0.9) within group (order by c) as "p90",
       max(c) as 최대,
       round(100.0 * count(*) filter (where c = 1) / count(*), 1) as "후보1곳_%"
from (select truth_id, count(*) c from cand group by 1) t;

\echo ''
\echo '── 분류기 정확도별 순위 품질 (신뢰도는 정확도에 맞춰 보정)'
\echo '   비교 기준은 acc=0이 아니라 **분류기를 끈 상태**(conf=0, 맨 윗줄)다'
with cfg(acc, conf, label) as (values
  (0.0::real, 0.0::real, '끔      '), (0.3::real, 0.3::real, '0.3     '),
  (0.5::real, 0.5::real, '0.5     '), (0.6::real, 0.6::real, '0.6     '),
  (0.7::real, 0.7::real, '0.7     '), (0.8::real, 0.8::real, '0.8     '),
  (0.9::real, 0.9::real, '0.9     '), (1.0::real, 1.0::real, '1.0     '),
  (0.5::real, 0.9::real, '0.5→과신'), (0.6::real, 0.9::real, '0.6→과신'),
  (0.7::real, 0.9::real, '0.7→과신')),
ranked as (
  select cfg.label, cfg.acc, cfg.conf, c.truth_id, c.cand_id,
         row_number() over (partition by cfg.label, c.truth_id order by
           public.candidate_score(
             c.dist_m,
             c.cand_cat = case when s.u < cfg.acc then s.truth_cat else s.wrong_cat end,
             cfg.conf, c.ground, 0, 0) desc) as rk
  from cfg cross join cand c join sim s on s.truth_id = c.truth_id)
select label as 분류기, acc as 정확도, conf as 신뢰도,
       count(distinct truth_id) as 표본,
       round(100.0 * count(*) filter (where rk = 1  and cand_id = truth_id)
             / nullif(count(distinct truth_id), 0), 1) as "top1_%",
       round(100.0 * count(*) filter (where rk <= 5 and cand_id = truth_id)
             / nullif(count(distinct truth_id), 0), 1) as "top5_%",
       round(100.0 * count(*) filter (where rk <= 10 and cand_id = truth_id)
             / nullif(count(distinct truth_id), 0), 1) as "top10_%",
       round(avg(rk) filter (where cand_id = truth_id), 2) as 정답평균순위
from ranked group by label, acc, conf order by label;
