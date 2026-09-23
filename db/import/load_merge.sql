-- =====================================================================
-- 스테이징(stg_places) → public.places 병합
-- load_stage.sql 로 적재한 **뒤에** 돌린다. (한 파일로 합치지 말 것 — 위 파일 주석 참조)
--   psql -f db/import/load_merge.sql
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
set statement_timeout = '2h';

-- ---------------------------------------------------------------------
-- ⚠️ 대량 적재에서 두 번 같은 대가를 치렀다. 여기 적어 둔다.
--
-- ① **인덱스를 켠 채로 넣지 말 것.**
--    places에는 GiST 2개 + GIN 트라이그램 1개가 걸려 있다.
--    157만 행을 그대로 넣었더니 행마다 인덱스를 갱신하느라 **1시간 넘게 IO에 묶였다.**
--    내리고 → 넣고 → 다시 만드는 것이 정석이다 (db/import/bulk_reload.sql).
--
-- ② **`pkill`로는 DB 작업이 안 멈춘다.**
--    psql 클라이언트만 죽고 **서버의 COPY/INSERT는 계속 돌며 락을 쥔다.**
--    한 번은 죽였다고 생각한 COPY가 1시간을 더 돌면서 다음 작업을 전부 막았다.
--    반드시 `pg_stat_activity`를 보고 `pg_terminate_backend(pid)`로 끝낼 것.
--
-- ③ 셸 스크립트를 죽여도 **다음 줄이 실행될 수 있다.**
--    load_merge를 중단했더니 뒤따르던 `drop table stg_places`가 실행돼
--    스테이징이 사라졌고, 다시 COPY해야 했다.
-- ---------------------------------------------------------------------

-- ── 1) TourAPI 먼저 ──────────────────────────────────────────────────
insert into public.places (name, category, address, geom, source, source_ref, is_ground, floor_no)
select name, category, nullif(address,''),
       ST_SetSRID(ST_MakePoint(lng, lat), 4326),
       source, source_ref, is_ground, floor_no
from stg_places where source = 'tour_api'
on conflict (source, source_ref) where source_ref is not null
do update set name = excluded.name, category = excluded.category,
              address = excluded.address, geom = excluded.geom,
              updated_at = now();

-- ── 2) 상가업소 ──────────────────────────────────────────────────────
-- ★ 중복 제거는 여기서 하지 않는다. `04_dedup.py`가 적재 **전에** 끝낸다.
--   DB에서 하던 때: 교차출처 15분 + 같은출처 10분, 규칙 한 줄 고치면 전량 재적재 30~40분.
--   오프라인으로 옮긴 뒤: 41초, 그리고 **무엇을 왜 지웠는지 파일로 남아** 미리 검토할 수 있다.
--   (지우고 나서 감사했더니 1.1%가 과삭제였던 적이 있다.)
--
--   또 하나: DB판은 동점을 uuid로 갈라 **적재할 때마다 살아남는 쪽이 달랐다.**
--   오프라인판은 source_ref로만 가르므로 같은 입력이면 항상 같은 결과가 나온다.
insert into public.places (name, category, address, geom, source, source_ref, is_ground, floor_no)
select s.name, s.category, nullif(s.address,''),
       ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326),
       s.source, s.source_ref, s.is_ground, s.floor_no
from stg_places s
where s.source = 'public_data'
on conflict (source, source_ref) where source_ref is not null
do update set name = excluded.name, category = excluded.category,
              address = excluded.address, geom = excluded.geom,
              is_ground = excluded.is_ground, floor_no = excluded.floor_no,
              updated_at = now();

-- ── 3) 지역코드 백필 (regions가 적재된 뒤에만 의미가 있다) ───────────
update public.places p set region_code = r.code
from public.regions r
where p.region_code is null and ST_Intersects(r.geom, p.geom);

analyze public.places;

-- ── 뒷정리 ───────────────────────────────────────────────────────────
-- ★ 안 하면 용량이 두 배가 된다. 실측: 적재 직후 628MB → 정리 후 243MB.
--   무료 플랜 한도는 500MB이고, 넘기면 프로젝트가 읽기 전용으로 잠긴다.
--     · stg_places — 적재용 임시 테이블 (143MB)
--     · places의 죽은 튜플 — delete/upsert가 남긴 것
--   vacuum full은 트랜잭션 안에서 못 돌리므로 \gexec 없이 따로 실행한다.
drop table if exists stg_places;

-- ── 결과 ─────────────────────────────────────────────────────────────
select source, count(*) as 장소수 from public.places group by source order by 2 desc;
select category, count(*) as 장소수,
       round(100.0*count(*)/sum(count(*)) over (), 1) as 비중
from public.places group by category order by 2 desc;

\echo ''
\echo '▶ 죽은 튜플 회수 (용량 절반)'
\echo '  vacuum full public.places'

-- =====================================================================
-- ★ 적재 후 반드시 할 것 (§10.42)
--
--   1) 지역코드 채우기      python3 db/import/load_regions.py
--   2) 좌표 검사            python3 db/import/check_geom.py      ← Supabase 전용
--
-- 2번은 로컬에서 못 한다. 로컬 PostGIS 스텁은 regions.geom이 `point`라
-- 폴리곤 포함 검사가 성립하지 않는다. 좌표 검사는 실서버에서만 의미가 있다.
--
-- 검사는 **거르지도 고치지도 않는다.** geom_offset_m에 숫자만 적는다.
-- 실측(465,914곳): 주소 지역 안 99.905% · 50m 이내 잡음 360 · 1km 초과 의심 24(전부 tour_api).
-- =====================================================================
