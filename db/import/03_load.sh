#!/usr/bin/env bash
# 두 출처를 변환해 DB에 넣는다.
#   ./db/import/03_load.sh                 # 로컬 검증 DB
#   DB_URL=postgres://... ./db/import/03_load.sh   # Supabase
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/data/out"; mkdir -p "$OUT"

[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }

if [ -z "${DB_URL:-}" ]; then
  PSQL=(psql -X -h /tmp -p 55432 -d trippic_data)
else
  PSQL=(psql -X -d "$DB_URL")
fi

if [ ! -s "$OUT/tourapi.tsv" ]; then
  echo "▶ TourAPI 수집 (개발키 하루 1,000호출)"
  python3 "$ROOT/db/import/02_tourapi.py" --resume > "$OUT/tourapi.tsv"
fi
if [ ! -s "$OUT/sangga.tsv" ]; then
  echo "▶ 상가업소정보 변환"
  ls "$ROOT"/data/sang/*.csv >/dev/null 2>&1 || {
    echo "  data/sang/*.csv 가 없다. ./db/import/fetch_sangga.sh 를 먼저 실행할 것."; exit 1; }
  python3 "$ROOT/db/import/01_sangga.py" "$ROOT"/data/sang/*.csv > "$OUT/sangga.tsv"
fi

echo "▶ 적재 (TourAPI 먼저 — 중복 판정이 순서에 의존한다)"
echo "▶ 중복 제거 (오프라인 — DB에서 25분 걸리던 일이 41초다)"
python3 "$ROOT/db/import/04_dedup.py" "$OUT/tourapi.tsv" "$OUT/sangga.tsv" \
  -o "$OUT/places.tsv" --report "$OUT/dedup_report.tsv"
echo "   무엇을 왜 지웠는지: $OUT/dedup_report.tsv — 올리기 전에 볼 것"

echo "▶ 적재"
cat "$OUT/places.tsv" | "${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$ROOT/db/import/load_stage.sql"
echo "▶ 병합"
"${PSQL[@]}" -v ON_ERROR_STOP=1 -f "$ROOT/db/import/load_merge.sql"

# ★ 용량 회수 — 안 하면 두 배가 된다 (628MB → 243MB). 무료 한도 500MB를 넘기면
#   프로젝트가 읽기 전용으로 잠긴다. vacuum full은 트랜잭션 밖에서만 돈다.
echo "▶ 용량 회수"
"${PSQL[@]}" -c "vacuum full public.places"
"${PSQL[@]}" -At -c "select 'DB ' || pg_size_pretty(pg_database_size(current_database()))"
