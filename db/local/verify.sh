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
# ── PostgreSQL 을 어디서 찾나 ────────────────────────────────────────
# 내 맥(홈브루)과 CI(우분투)가 경로가 다르다. **고정하면 한쪽에서만 돈다.**
if [ -z "${PGBIN:-}" ]; then
  for c in /opt/homebrew/opt/postgresql@16/bin /usr/lib/postgresql/16/bin \
           /usr/lib/postgresql/17/bin /usr/local/opt/postgresql@16/bin; do
    [ -x "$c/pg_ctl" ] && PGBIN="$c" && break
  done
fi
export PATH="${PGBIN:+$PGBIN:}$PATH"
command -v pg_ctl >/dev/null || { echo "pg_ctl 이 없다. PGBIN 을 주거나 postgresql 을 깔 것"; exit 1; }
export LC_ALL=C LANG=C          # macOS: 없으면 "postmaster became multithreaded"로 죽는다
# ★ 이 DB는 실행할 때마다 drop 된다. 적재 데이터는 trippic_data에 둔다.
#   (한 번 섞어 쓰다가 160만 행을 날렸다.)
PGH=/tmp; PGP=55432; DB=trippic_verify; PGDATA_DIR="${PGDATA_DIR:-$HOME/.trippic_pg}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
red(){ printf "\033[31m%s\033[0m\n" "$*"; }; green(){ printf "\033[32m%s\033[0m\n" "$*"; }

# ★ **한글 로케일이 없으면 여기서 멈춘다.** C 로케일로 넘어가면 pg_trgm 이 한글을
#   '문자'로 안 봐서 한글 트라이그램이 통째로 비고, similarity() 가 늘 0 이 된다.
#   → 검색 시험이 **조용히 전부 통과한다**(아무것도 안 재면서). 그게 제일 나쁘다.
locale -a 2>/dev/null | tr 'A-Z' 'a-z' | grep -qE '^en_us\.?utf-?8$' || {
  red "en_US.UTF-8 로케일이 없다 — C 로케일로 돌리면 한글 검색 시험이 **거짓으로 통과한다**"
  echo "   우분투: sudo locale-gen en_US.UTF-8   ·   맥: 기본으로 있다"; exit 1; }

# ★ 데이터 디렉터리가 없으면 만든다 (CI 는 매번 빈 러너다)
[ -d "$PGDATA_DIR" ] || initdb -D "$PGDATA_DIR" -U "$(id -un)" --encoding=UTF8 >/dev/null 2>&1 || {
  red "initdb 실패"; exit 1; }
pg_ctl -D "$PGDATA_DIR" -l /tmp/trippic_pg.log -o "-p $PGP -k $PGH" status >/dev/null 2>&1 || \
  pg_ctl -D "$PGDATA_DIR" -l /tmp/trippic_pg.log -o "-p $PGP -k $PGH" -w start >/dev/null 2>&1
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

# ★ 스텁은 PostGIS 를 **public 안의 평범한 함수**로 흉내 낸다. 실서버에서는
#   `extensions` 스키마의 **확장 소유** 함수라 067 의 `anon` 회수에서 제외되는데,
#   스텁에서는 제외가 안 돼 `st_x` 같은 것이 anon 에게서 회수된다.
#   → **스텁이 보정한다.** 067 을 스텁에 맞춰 흐리면 실서버 규칙이 거짓이 된다.
psql -X -h $PGH -p $PGP -q -d $DB -c "
do \$\$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname ~ '^(st_|_st_|geography|geometry|postgis)'
  loop execute format('grant execute on function %s to anon', f.sig); end loop;
end \$\$;" >/dev/null 2>&1
[ $FAIL -eq 0 ] || { echo; red "=== 문법 실패 $FAIL건 ==="; exit 1; }
psql -X -h $PGH -p $PGP -At -d $DB -c "
  select '  테이블 '||(select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
      || ' / 함수 '||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
      || ' / 인덱스 '||(select count(*) from pg_indexes where schemaname='public')
      || ' / RLS정책 '||(select count(*) from pg_policies where schemaname='public')
      || ' / 트리거 '||(select count(*) from pg_trigger where not tgisinternal)"

# ── 2. 배포 전 벽 (§13.123) ──────────────────────────────────────────
# ★ 이 검사는 스모크 28절에도 있다. **일부러 두 자리에서 부른다** —
#   검사기가 둘인 게 아니라 **같은 검사기를 두 군데서** 부르는 것이다.
#   스모크 한 절을 지우면 벽이 조용히 사라지는데, 여기는 파일 구조상
#   지우려면 **눈에 띄게** 지워야 한다. 그리고 CI 가 읽는 자리도 여기다.
#
# ★ **스모크보다 앞**이다. 스모크 안에도 같은 검사가 있어서 뒤에 두면 스모크가
#   먼저 멈춰 이 단계가 아예 안 돌고, CI 요약에 "무엇이 뚫렸나"가 안 남는다.
#   (실제로 그랬다. 구멍을 뚫어 보고 알았다.) 벽은 정적 검사라 앞에 와도 된다.
echo
echo "=== 2. 배포 전 벽 (067·068 을 한 문장으로) ==="
holes=$(psql -X -h $PGH -p $PGP -At -F'|' -d $DB -c "
  select proname||' '||layer||' — '||why from public.operator_wall_holes()
   where proname not like 'zz\_%'" 2>&1)
if [ -n "$holes" ]; then
  red "  구멍이 있다:"; echo "$holes" | sed 's/^/     /'
  red "=== 벽에 구멍이 있다 — 올리면 안 된다 ==="
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && {
    echo "### ❌ 운영자 벽에 구멍"; echo '```'; echo "$holes"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
  exit 1
fi
green "  OK   민감한 표에 닿는 자리에 빗장이 있고, anon 에서 안 닿는다"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && {
  echo "### ✅ 운영자 벽 통과"
  echo "민감한 표(\`operators\`·\`operator_log\`·\`reports\`)에 닿는 자리는"
  echo "① \`is_operator()\` 빗장이 있거나 이유를 적은 예외이고, ② \`anon\` 에서 안 닿는다."; } >> "$GITHUB_STEP_SUMMARY"

echo
echo "=== 3. 동작 ==="
out=$(psql -X -h $PGH -p $PGP -v ON_ERROR_STOP=1 -d $DB -f "$ROOT/db/local/smoke.sql" 2>&1)
echo "$out" | grep -E "NOTICE:|──" | sed 's/^psql:[^ ]* //; s/^NOTICE:  //'
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -E "ERROR|DETAIL" | sed 's/^/  /'
  red "=== 동작 검증 실패 ==="; exit 1
fi
echo
green "=== 전부 통과 (동작 검증 $(echo "$out" | grep -c 'OK  ')건) ==="

# ── 4. Supabase와 어긋나지 않았는가 ──────────────────────────────────
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
