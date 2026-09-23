-- =====================================================================
-- TSV 두 개(상가업소·TourAPI) → public.places
--
-- 순서가 규칙이다:
--   1) TourAPI를 먼저 넣는다. 관광지·해수욕장·문화재는 대체 불가능하다.
--   2) 상가업소는 그 다음에 넣되, **100m 안에 이름이 비슷한 TourAPI 장소가
--      이미 있으면 버린다**. 같은 곳이 두 번 뜨는 게 가장 나쁘다.
--
-- 재실행 가능하다: (source, source_ref) 유니크 인덱스로 upsert 한다.
--
-- ★ 이 파일은 **적재만** 한다. 병합은 load_merge.sql이 한다.
--   한 파일에 섞으면 안 된다 — psql이 스크립트와 stdin 두 스트림을 오가다가
--   이후 구문의 바이트가 깨진다. 실제로 겪었다:
--     ERROR: invalid byte sequence for encoding "UTF8": 0xed 0x98 0xed
--   파일에도 데이터에도 깨진 바이트는 없었다. psql의 버퍼 문제다.
--
--   사용: cat tourapi.tsv sangga.tsv | psql -f db/import/load_stage.sql
--         그 다음                      psql -f db/import/load_merge.sql
--   `pstdin`이지 `stdin`이 아니다. -f 로 돌릴 때 stdin은 스크립트 파일을 가리킨다.
--   순서가 중요하다: TourAPI가 먼저 와야 한다 (병합 2단계가 그걸 전제한다).
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- ⚠️ 이 스크립트는 places를 **비우지 않는다.** upsert로 갱신할 뿐이다.
--
--   `truncate public.places cascade` 는 절대 쓰지 말 것.
--   places를 참조하는 테이블이 ON DELETE SET NULL 이어도
--   **TRUNCATE CASCADE는 참조하는 테이블을 전부 같이 비운다** —
--   pins · media · profiles · spaces · trips · reactions 까지 통째로 날아간다.
--   (한 번 실제로 그렇게 비웠다. 그때는 전부 0행이라 피해가 없었을 뿐이다.)
--
--   장소를 갈아엎어야 한다면 사용자 데이터가 없을 때만, 그리고
--   `delete from public.places` 로 한다 (FK의 SET NULL이 정상 작동한다).
-- ---------------------------------------------------------------------
do $$
declare n bigint;
begin
  select count(*) into n from public.pins;
  if n > 0 then
    raise notice '핀이 %건 있다. 장소는 upsert로만 갱신된다 (삭제 없음).', n;
  end if;
end $$;
-- ★ Supabase 기본 statement_timeout은 2분이다. 168만 행 중복제거는 그보다 오래 걸린다.
--   (한 번 여기서 잘려 상가업소가 통째로 누락됐다.)
set statement_timeout = '2h';

create unlogged table if not exists stg_places (
  name       text,
  category   pin_category,
  address    text,
  lng        double precision,
  lat        double precision,
  source     place_source,
  source_ref text,
  is_ground  boolean,
  floor_no   int
);
truncate stg_places;

\copy stg_places (name, category, address, lng, lat, source, source_ref, is_ground, floor_no) from pstdin with (format text)

create index on stg_places using gist (ST_SetSRID(ST_MakePoint(lng, lat), 4326));
analyze stg_places;

do $$ declare n bigint; begin
  select count(*) into n from stg_places; raise notice '스테이징 %행', n;
end $$;
