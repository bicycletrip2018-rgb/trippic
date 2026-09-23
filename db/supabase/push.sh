#!/usr/bin/env bash
# =====================================================================
# 마이그레이션을 Supabase에 올린다.
#
#   export DB_URL='postgresql://postgres.<ref>:<PW>@aws-0-<region>.pooler.supabase.com:5432/postgres'
#   ./db/supabase/push.sh --check    # 아무것도 안 바꾸고 환경만 본다
#   ./db/supabase/push.sh            # 실제 적용
#
# 원칙
#   · db/local/* 는 **절대** 올리지 않는다 (Supabase 흉내 셰임 + PostGIS 스텁).
#     auth.uid()를 덮어쓰면 그 순간 RLS가 전부 무너진다.
#   · 적용 이력을 public.schema_migrations에 남겨 재실행해도 안전하게 한다.
#   · 트랜잭션 하나로 묶는다. 중간에 실패하면 아무것도 안 남는다.
# =====================================================================
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
: "${DB_URL:?DB_URL이 필요하다. Supabase → Project Settings → Database → Connection string (URI)}"
red(){ printf "\033[31m%s\033[0m\n" "$*"; }; green(){ printf "\033[32m%s\033[0m\n" "$*"; }
Q(){ psql -X -At -d "$DB_URL" -c "$1"; }

# ---------------------------------------------------------------------
# 스키마 표류 점검 — 로컬 파일과 Supabase에 적용된 것이 같은가
#
# ★ 이걸 안 해서 008·009를 만들고도 안 올린 채 며칠을 보냈다.
#   중복 제거 쿼리가 "public_pin_count 컬럼이 없다"고 에러를 내서야 알았다.
#   파일 내용 해시를 함께 기록하면 **적용 후 수정된 것**까지 잡힌다
#   (005·006을 적용 뒤에 고친 적이 있다).
#
# 스키마 자체를 비교하지 않는 이유: 로컬은 PostGIS 스텁이라 타입이 다르다
#   (point vs geometry). 마이그레이션 **원장**을 비교하는 편이 정확하다.
# ---------------------------------------------------------------------
drift() {
  psql -X -d "$DB_URL" -q -c "
    create table if not exists public.schema_migrations (
      version text primary key, applied_at timestamptz not null default now());
    alter table public.schema_migrations add column if not exists checksum text;" >/dev/null

  # ★ 원장을 **한 번에** 가져온다. 파일마다 psql을 부르면 왕복이 쌓여 12초가 된다.
  local ledger; ledger=$(psql -X -At -F'|' -d "$DB_URL" \
    -c "select version, coalesce(checksum,'') from public.schema_migrations")

  local n_missing=0 n_changed=0 fix=""
  echo "=== 스키마 표류 점검 ==="
  for f in "$ROOT"/db/migrations/*.sql; do
    local v h rec
    v=$(basename "$f"); h=$(shasum -a 256 "$f" | cut -c1-16)
    rec=$(printf '%s\n' "$ledger" | awk -F'|' -v k="$v" '$1==k{print $2; found=1} END{if(!found) print "\x01"}')
    if [ "$rec" = $'\x01' ]; then
      red "  미적용   $v"; n_missing=$((n_missing+1))
    elif [ -z "$rec" ]; then
      echo "  적용됨   $v  (해시 기록 없음 — 이번에 기록한다)"
      fix="$fix update public.schema_migrations set checksum='$h' where version='$v';"
    elif [ "$rec" != "$h" ]; then
      red "  변경됨   $v  (적용 후 파일이 수정됐다)"; n_changed=$((n_changed+1))
    else
      green "  일치     $v"
    fi
  done
  # ★ `[ ... ] && cmd` 로 쓰면 안 된다. 조건이 거짓일 때 AND 리스트가 1을 반환하고
  #   set -e 가 그걸 실패로 보고 스크립트를 끝낸다. (표류가 없는데 있다고 나왔다.)
  if [ -n "$fix" ]; then psql -X -d "$DB_URL" -q -c "$fix" >/dev/null; fi

  # 원장에만 있고 파일이 없는 것 (파일을 지웠거나 이름을 바꿨다)
  printf '%s\n' "$ledger" | while IFS='|' read -r v _; do
    if [ -n "$v" ] && [ ! -f "$ROOT/db/migrations/$v" ]; then
      red "  파일없음 $v  (원장에만 있다)"
    fi
  done

  echo
  if [ $n_missing -gt 0 ] || [ $n_changed -gt 0 ]; then
    red "=== 표류: 미적용 ${n_missing}개 · 변경됨 ${n_changed}개 ==="
    echo "   ./db/supabase/push.sh 로 올리거나, 변경된 파일은 새 마이그레이션으로 나눌 것."
    return 1
  fi
  green "=== 표류 없음 ==="
  return 0
}

# ── 사전 점검 ────────────────────────────────────────────────────────
# --status 는 파일과 원장만 비교한다. 환경 점검(접속·로케일·PostGIS)은 건너뛴다 —
# 매번 40초씩 쓸 이유가 없다. 자주 돌려야 잡히는 종류의 문제다.
if [ "${1:-}" = "--status" ]; then
  drift; exit $?
fi

echo "=== 사전 점검 ==="
Q "select 1" >/dev/null || { red "접속 실패"; exit 1; }
green "  접속 OK  $(Q "select current_database()||' @ '||split_part(version(),' ',2)")"

CTYPE=$(Q "select datctype from pg_database where datname = current_database()")
if [[ "$CTYPE" == "C" || "$CTYPE" == "POSIX" ]]; then
  red "  LC_CTYPE=$CTYPE — pg_trgm이 한글을 문자로 보지 않는다."
  red "  similarity()가 항상 0이 되어 한글 검색과 장소 중복판정이 조용히 죽는다."
  exit 1
fi
green "  로케일 OK  LC_CTYPE=$CTYPE"

PG=$(Q "select count(*) from pg_available_extensions where name='postgis'")
[ "$PG" = "1" ] || { red "  postgis 확장을 쓸 수 없다"; exit 1; }
green "  postgis 사용 가능"

AU=$(Q "select count(*) from information_schema.tables where table_schema='auth' and table_name='users'")
[ "$AU" = "1" ] || { red "  auth.users가 없다 — Supabase 프로젝트가 맞는지 확인할 것"; exit 1; }
green "  auth.users 존재"

EXIST=$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name='pins'")
[ "$EXIST" = "0" ] && echo "  public 스키마: 비어 있음 (최초 적용)" || echo "  public 스키마: 이미 pins가 있음 (이어서 적용)"

[ "${1:-}" = "--check" ] && { echo; drift || true; echo; green "=== 점검만 하고 끝낸다 ==="; exit 0; }

# ── 적용 ─────────────────────────────────────────────────────────────
echo
echo "=== 적용 ==="
psql -X -d "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  create table if not exists public.schema_migrations (
    version text primary key, applied_at timestamptz not null default now());
  alter table public.schema_migrations add column if not exists checksum text;"

for f in "$ROOT"/db/migrations/*.sql; do
  v=$(basename "$f")
  if [ "$(Q "select count(*) from public.schema_migrations where version='$v'")" = "1" ]; then
    echo "  건너뜀 $v (적용됨)"; continue
  fi
  # 파일 하나를 트랜잭션 하나로. 실패하면 그 파일은 통째로 되돌아간다.
  h=$(shasum -a 256 "$f" | cut -c1-16)
  if psql -X -d "$DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
       -f "$f" -c "insert into public.schema_migrations(version, checksum) values ('$v','$h')
                   on conflict (version) do update set checksum = excluded.checksum,
                                                       applied_at = now()" 2>/tmp/push.err; then
    green "  OK   $v"
  else
    red   "  FAIL $v"; grep -E "ERROR|DETAIL|HINT" /tmp/push.err | head -6 | sed 's/^/       /'
    exit 1
  fi
done

# 확장이 어느 스키마에 있든 함수가 ST_*를 찾을 수 있는지 실제로 확인한다.
# Supabase는 확장을 extensions 스키마에 두므로 search_path가 틀리면 여기서 걸린다.
if ! Q "select public.candidate_radius(15)" >/dev/null 2>&1; then
  red "  함수가 PostGIS를 못 찾는다 — search_path에 extensions가 빠졌을 수 있다"; exit 1
fi
green "  함수에서 PostGIS 접근 OK"

echo
Q "select '테이블 '||(select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
     || ' / 함수 '||(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
     || ' / RLS정책 '||(select count(*) from pg_policies where schemaname='public')"
green "=== 적용 완료 ==="
