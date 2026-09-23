#!/usr/bin/env bash
# 실제 Supabase에서 동작 검증을 돌린다.
# smoke.sql은 통째로 롤백하므로 아무것도 남기지 않는다.
#   DB_URL=... ./db/supabase/verify.sh
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
: "${DB_URL:?DB_URL이 필요하다}"
red(){ printf "\033[31m%s\033[0m\n" "$*"; }; green(){ printf "\033[32m%s\033[0m\n" "$*"; }

echo "=== 실제 Supabase 동작 검증 ==="
echo "  로컬과 달리 여기서는 진짜 PostGIS와 진짜 auth.uid()가 돈다."
echo
out=$(psql -X -d "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/db/local/smoke.sql" 2>&1)
echo "$out" | grep -E "NOTICE:|──" | sed 's/^psql:[^ ]* //; s/^NOTICE:  //'
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -E "ERROR|DETAIL|CONTEXT" | sed 's/^/  /'
  red "=== 실패 ==="; exit 1
fi
echo; green "=== 통과 ($(echo "$out" | grep -c 'OK  ')건) ==="

echo
echo "=== 공간 인덱스가 실제로 쓰이는가 (로컬 스텁으로는 못 본 것) ==="
psql -X -d "$DB_URL" -c "
explain (analyze, buffers, format text)
select count(*) from public.places
where ST_DWithin(geom::geography,
                 ST_SetSRID(ST_MakePoint(129.16, 35.158), 4326)::geography, 150);" 2>&1 | head -12
