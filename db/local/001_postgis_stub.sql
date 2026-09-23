-- =====================================================================
-- PostGIS 스텁 (로컬 문법 검증 전용)
--
-- 왜: brew의 postgis는 의존성이 133개다 (llvm · gdal · boost · postgresql@17/@18 …).
--     5~8GB가 더 필요해 설치를 포기했다.
--
-- 이 스텁으로 검증되는 것 / 안 되는 것
--   ✅ 테이블·컬럼·제약·열거형 정의
--   ✅ 함수 시그니처, plpgsql 본문 문법
--   ✅ 트리거 배선, RLS 정책 (재귀 포함)
--   ✅ 인덱스 정의 (공간 인덱스는 point_ops로 치환)
--   ❌ 실제 공간 연산의 정확성 (ST_DWithin의 거리 계산 등)
--   ❌ PostGIS 전용 최적화·통계
--
-- ★ Supabase에는 진짜 PostGIS가 있으므로 이 파일은 올리지 않는다.
-- =====================================================================

-- geometry / geography 를 core `point`로 대신한다.
-- 검증 스크립트가 `geometry(Point,4326)` 같은 타입 수식자를 `point`로 치환한다.

-- ── 생성자 ────────────────────────────────────────────────────────────
create or replace function ST_MakePoint(double precision, double precision)
returns point language sql immutable as $$ select point($1, $2) $$;

create or replace function ST_SetSRID(point, int)
returns point language sql immutable as $$ select $1 $$;

create or replace function ST_MakeEnvelope(
  double precision, double precision, double precision, double precision, int default 4326)
returns box language sql immutable as $$ select box(point($1,$2), point($3,$4)) $$;

-- ── 좌표 추출 ─────────────────────────────────────────────────────────
create or replace function ST_X(point) returns double precision
language sql immutable as $$ select $1[0] $$;
create or replace function ST_Y(point) returns double precision
language sql immutable as $$ select $1[1] $$;

-- ── 경계상자 겹침 (&&) ───────────────────────────────────────────────
-- PostGIS 의 `geom && envelope` 는 GiST 인덱스를 타는 **경계상자 겹침** 연산자다.
-- core 에는 point && box 가 없어서 직접 만든다 (031 이 이걸 쓴다).
-- ★ 정확성이 아니라 **문법**을 보는 스텁이므로 포함 여부로 대신한다 —
--   점의 경계상자는 점 자신이라 `<@` 가 곧 겹침이다.
create or replace function public.geom_bbox_overlaps(point, box) returns boolean
language sql immutable as $$ select $1 <@ $2 $$;
create operator && (leftarg = point, rightarg = box,
                    function = public.geom_bbox_overlaps, commutator = &&);
create or replace function public.geom_bbox_overlaps(box, point) returns boolean
language sql immutable as $$ select $2 <@ $1 $$;
create operator && (leftarg = box, rightarg = point,
                    function = public.geom_bbox_overlaps, commutator = &&);

-- ── 관계·거리 ─────────────────────────────────────────────────────────
create or replace function ST_Intersects(point, box) returns boolean
language sql immutable as $$ select $1 <@ $2 $$;
create or replace function ST_Intersects(box, point) returns boolean
language sql immutable as $$ select $2 <@ $1 $$;
create or replace function ST_Intersects(point, point) returns boolean
language sql immutable as $$ select $1 ~= $2 $$;

-- 대충 미터로 환산 (검증용이지 정확도는 의미 없다)
create or replace function ST_Distance(point, point) returns double precision
language sql immutable as $$ select ($1 <-> $2) * 111320.0 $$;

create or replace function ST_DWithin(point, point, double precision) returns boolean
language sql immutable as $$ select ($1 <-> $2) * 111320.0 <= $3 $$;

-- ── 집계·변환 ─────────────────────────────────────────────────────────
-- ST_Collect는 PostGIS에서 집계 함수다. 여기서도 집계로 만든다.
create or replace function st_collect_sfunc(point, point) returns point
language sql immutable as $$ select coalesce($1, $2) $$;
create aggregate ST_Collect(point) (sfunc = st_collect_sfunc, stype = point);

create or replace function ST_Centroid(point) returns point
language sql immutable as $$ select $1 $$;

create or replace function ST_SnapToGrid(point, double precision, double precision)
returns point language sql immutable as $$
  select point(round(($1[0] / $2))::numeric::double precision * $2,
               round(($1[1] / $3))::numeric::double precision * $3) $$;

create or replace function ST_Envelope(point) returns point
language sql immutable as $$ select $1 $$;
create or replace function ST_PointOnSurface(point) returns point
language sql immutable as $$ select $1 $$;
