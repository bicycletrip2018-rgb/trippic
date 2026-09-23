-- =====================================================================
-- 장소를 통째로 다시 넣을 때 쓴다 (증분 upsert는 load_merge.sql).
--
-- 인덱스를 내리고 → 넣고 → 다시 만든다.
-- 켠 채로 157만 행을 넣었더니 1시간 넘게 IO에 묶였다. 이 방식은 몇 분이다.
--
--   cat data/out/places.tsv | psql -f db/import/bulk_reload.sql
-- =====================================================================
\set ON_ERROR_STOP on
\timing on
set statement_timeout = '2h';

create unlogged table if not exists stg_places (
  name text, category pin_category, address text,
  lng double precision, lat double precision,
  source place_source, source_ref text, is_ground boolean, floor_no int);
truncate stg_places;
\copy stg_places (name, category, address, lng, lat, source, source_ref, is_ground, floor_no) from pstdin with (format text)

delete from public.places;

drop index if exists places_source_ref_key;
drop index if exists places_geom_gix;
drop index if exists places_geog_gix;
drop index if exists places_region_idx;
drop index if exists places_pinned_gix;
drop index if exists places_name_trgm;

insert into public.places (name, category, address, geom, source, source_ref, is_ground, floor_no)
select name, category, nullif(address, ''),
       ST_SetSRID(ST_MakePoint(lng, lat), 4326),
       source, source_ref, is_ground, floor_no
from stg_places;

create unique index places_source_ref_key on public.places (source, source_ref) where source_ref is not null;
create index places_geom_gix   on public.places using gist (geom);
create index places_geog_gix   on public.places using gist (geom);
create index places_region_idx on public.places (region_code);
create index places_pinned_gix on public.places using gist (geom) where public_pin_count > 0;
create index places_name_trgm  on public.places using gin (name gin_trgm_ops);

drop table if exists stg_places;
analyze public.places;
select source, count(*) from public.places group by source;
