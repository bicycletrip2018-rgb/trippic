#!/usr/bin/env bash
# 분류기 정확도를 0%→100%로 훑으며 top1/top5를 잰다.
#   ./db/analysis/run_sensitivity.sh [표본수] [GPS오차m]
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
N=${1:-2000}; SIGMA=${2:-15}
PSQL=(psql -X -q -h /tmp -p 55432 -d trippic_data)
[ -n "${DB_URL:-}" ] && PSQL=(psql -X -q -d "$DB_URL")

TOTAL=$("${PSQL[@]}" -At -c "select count(*) from public.places")
PCT=$(python3 -c "print(max(0.01, min(100, $N*300.0/max($TOTAL,1))))")
SQL=$(mktemp); trap 'rm -f "$SQL"' EXIT
# 로컬은 PostGIS 스텁이라 geography를 point로 바꿔 돌린다
if [ -z "${DB_URL:-}" ]; then
  sed -E -e 's/::geography/::point/g' -e 's/\bgeography\b/point/g' \
    "$ROOT/db/analysis/classifier_sensitivity.sql" > "$SQL"
else
  cp "$ROOT/db/analysis/classifier_sensitivity.sql" "$SQL"
fi

echo "장소 $TOTAL개 · 표본 $N · GPS오차 σ=${SIGMA}m"
echo
printf "%-8s %-8s %-8s %-8s %-8s %s\n" 정확도 신뢰도 표본 top1% top5% 평균순위
for ACC in 0.0 0.3 0.5 0.6 0.7 0.8 0.9 1.0; do
  # 신뢰도는 정확도에 맞춰 보정된 상태로 둔다 (과신 케이스는 아래에서 따로)
  "${PSQL[@]}" -At -F' ' -v acc=$ACC -v conf=$ACC -v n=$N -v sigma=$SIGMA -v sample_pct=$PCT -f "$SQL" \
    | awk '{printf "%-8s %-8s %-8s %-8s %-8s %s\n", $1, $2, $3, $4, $5, $6}'
done
echo
echo "과신 케이스 — 정확도는 낮은데 신뢰도만 0.9로 뱉는 분류기"
printf "%-8s %-8s %-8s %-8s %-8s %s\n" 정확도 신뢰도 표본 top1% top5% 평균순위
for ACC in 0.5 0.6 0.7; do
  "${PSQL[@]}" -At -F' ' -v acc=$ACC -v conf=0.9 -v n=$N -v sigma=$SIGMA -v sample_pct=$PCT -f "$SQL" \
    | awk '{printf "%-8s %-8s %-8s %-8s %-8s %s\n", $1, $2, $3, $4, $5, $6}'
done
