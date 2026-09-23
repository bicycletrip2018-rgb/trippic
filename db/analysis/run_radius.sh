#!/usr/bin/env bash
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
N=${1:-800}; SIGMA=${2:-15}; ACC=${3:-0.7}
PSQL=(psql -X -q -h /tmp -p 55432 -d trippic_data); [ -n "${DB_URL:-}" ] && PSQL=(psql -X -q -d "$DB_URL")
TOTAL=$("${PSQL[@]}" -At -c "select count(*) from public.places")
PCT=$(python3 -c "print(max(0.01,min(100,$N*300.0/max($TOTAL,1))))")
SQL=$(mktemp); trap 'rm -f "$SQL"' EXIT
if [ -z "${DB_URL:-}" ]; then
  sed -E -e 's/::geography/::point/g' -e 's/\bgeography\b/point/g' "$ROOT/db/analysis/radius_sweep.sql" > "$SQL"
else cp "$ROOT/db/analysis/radius_sweep.sql" "$SQL"; fi
echo "장소 $TOTAL개 · 표본 $N · GPS오차 σ=${SIGMA}m · 분류기 정확도 $ACC"
echo
printf "%-8s %-8s %-7s %-8s %-8s %-9s %-10s %s\n" 반경m 정확도 표본 top1% top5% top10% 정답없음% 평균후보
for R in 30 50 80 150 300; do
  "${PSQL[@]}" -At -F' ' -v acc=$ACC -v conf=$ACC -v n=$N -v sigma=$SIGMA -v radius=$R -v sample_pct=$PCT -f "$SQL" \
    | awk '{printf "%-8s %-8s %-7s %-8s %-8s %-9s %-10s %s\n",$1,$2,$3,$4,$5,$6,$7,$8}'
done
