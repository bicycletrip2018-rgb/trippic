#!/usr/bin/env bash
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"; export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
N=${1:-1500}; PCT=${2:-20}
SQL=$(mktemp); trap 'rm -f "$SQL"' EXIT
if [ -z "${DB_URL:-}" ]; then
  sed -E -e 's/::geography/::point/g' -e 's/\bgeography\b/point/g' "$ROOT/db/analysis/density.sql" > "$SQL"
  psql -X -q -h /tmp -p 55432 -d trippic_data -v pct=$PCT -v n=$N -f "$SQL"
else
  psql -X -q -d "$DB_URL" -v pct=$PCT -v n=$N -f "$ROOT/db/analysis/density.sql"
fi
