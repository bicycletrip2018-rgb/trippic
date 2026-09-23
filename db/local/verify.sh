#!/usr/bin/env bash
# =====================================================================
# 마이그레이션을 로컬 PostgreSQL에 적용하고 두 단계로 검증한다.
#
#   1) 문법·구조 — 파일이 순서대로 적용되는가
#   2) 동작      — RLS가 실제로 막는가, GRANT가 실제로 있는가, 랭킹이 맞는가
#
# PostGIS는 설치하지 않는다 (의존성 133개, 5~8GB). 스텁으로 치환한다.
#   geometry(...)/geography → core `point`   ·   ST_* → 001_postgis_stub.sql
#   gist(geom) → gist(geom point_ops)
#
# ❌ 여기서 검증되지 않는 것
#   · 공간 연산의 정확성 (거리는 근사, 좌표계 없음)
#   · Supabase의 실제 auth.uid() JWT 파싱, 실제 롤 전환
#   · PostGIS 인덱스의 실행계획
#
# 사용: ./db/local/verify.sh
# =====================================================================
set -uo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
export LC_ALL=C LANG=C          # macOS: 없으면 "postmaster became multithreaded"로 죽는다
# ★ 이 DB는 실행할 때마다 drop 된다. 적재 데이터는 trippic_data에 둔다.
#   (한 번 섞어 쓰다가 160만 행을 날렸다.)
PGH=/tmp; PGP=55432; DB=trippic_verify
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
red(){ printf "\033[31m%s\033[0m\n" "$*"; }; green(){ printf "\033[32m%s\033[0m\n" "$*"; }

pg_ctl -D ~/.trippic_pg -l /tmp/trippic_pg.log -o "-p $PGP -k $PGH" status >/dev/null 2>&1 || \
  pg_ctl -D ~/.trippic_pg -l /tmp/trippic_pg.log -o "-p $PGP -k $PGH" start >/dev/null 2>&1
sleep 1
dropdb -h $PGH -p $PGP --if-exists $DB 2>/dev/null
# ★ 로케일이 중요하다. pg_trgm은 LC_CTYPE 기준으로 한글을 '문자'로 볼지 정한다.
#   C 로케일이면 한글 트라이그램이 통째로 비어 similarity()가 항상 0이 된다
#   → 한글 검색(api_search)과 장소 중복판정이 조용히 전부 실패한다.
createdb -h $PGH -p $PGP --template=template0 --encoding=UTF8 \
  --lc-collate=en_US.UTF-8 --lc-ctype=en_US.UTF-8 $DB || { red "createdb 실패"; exit 1; }

prep() {   # PostGIS 의존 구문을 core 타입으로 치환
  sed -E \
    -e 's/geometry\([A-Za-z]+, *[0-9]+\)/point/g' \
    -e 's/::geography/::point/g' \
    -e 's/\bgeography\b/point/g' \
    -e 's/using gist \(\(geom::point\)\)/using gist (geom point_ops)/g' \
    -e 's/using gist \(geom\)/using gist (geom point_ops)/g' \
    -e 's/using gist \(bbox\)/using gist (bbox point_ops)/g' \
    -e 's/create extension if not exists postgis;//' "$1"
}

FAIL=0
run() {
  local src="$1" name out; name=$(basename "$src")
  prep "$src" > "$TMP/$name"
  out=$(psql -X -h $PGH -p $PGP -v ON_ERROR_STOP=1 -q -d $DB -f "$TMP/$name" 2>&1)
  if [ $? -eq 0 ]; then green "  OK   $name"
  else red "  FAIL $name"; echo "$out" | grep -E "ERROR|DETAIL|HINT|LINE" | head -8 | sed 's/^/       /'; FAIL=$((FAIL+1)); fi
}

echo "=== 1. 문법·구조 ($DB) ==="
psql -X -h $PGH -p $PGP -q -d $DB -f "$ROOT/db/local/000_supabase_shim.sql" >/dev/null 2>&1 && green "  OK   000_supabase_shim.sql" || { red "  FAIL shim"; exit 1; }
psql -X -h $PGH -p $PGP -q -d $DB -f "$ROOT/db/local/001_postgis_stub.sql"  >/dev/null 2>&1 && green "  OK   001_postgis_stub.sql"  || { red "  FAIL stub"; exit 1; }
for f in "$ROOT"/db/migrations/*.sql; do run "$f"; done
[ $FAIL -eq 0 ] || { echo; red "=== 문법 실패 $FAIL건 ==="; exit 1; }
psql -X -h $PGH -p $PGP -At -d $DB -c "
  select '  테이블 '||(select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
      || ' / 함수 '||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
      || ' / 인덱스 '||(select count(*) from pg_indexes where schemaname='public')
      || ' / RLS정책 '||(select count(*) from pg_policies where schemaname='public')
      || ' / 트리거 '||(select count(*) from pg_trigger where not tgisinternal)"

echo
echo "=== 2. 동작 ==="
out=$(psql -X -h $PGH -p $PGP -v ON_ERROR_STOP=1 -d $DB -f "$ROOT/db/local/smoke.sql" 2>&1)
echo "$out" | grep -E "NOTICE:|──" | sed 's/^psql:[^ ]* //; s/^NOTICE:  //'
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -E "ERROR|DETAIL" | sed 's/^/  /'
  red "=== 동작 검증 실패 ==="; exit 1
fi
echo
green "=== 전부 통과 (동작 검증 $(echo "$out" | grep -c 'OK  ')건) ==="

# ── 3. Supabase와 어긋나지 않았는가 ──────────────────────────────────
# 로컬만 통과하고 Supabase에 안 올려 며칠을 보낸 적이 있다 (008·009).
# DB_URL이 있으면 여기서 같이 본다. 2초면 끝난다.
if [ -f "$ROOT/.env" ]; then
  set -a; . "$ROOT/.env"; set +a
fi
if [ -n "${DB_URL:-}" ]; then
  echo
  "$ROOT/db/supabase/push.sh" --status || {
    red "→ 로컬은 통과했지만 Supabase가 뒤처져 있다. ./db/supabase/push.sh"; exit 1; }
fi
