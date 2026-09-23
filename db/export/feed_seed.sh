#!/usr/bin/env bash
# =====================================================================
# 탭2 `갈 곳` 씨앗을 뽑는다.
#
#   ./db/export/feed_seed.sh          # prototype/feed-seed.json 갱신
#
# ★ 처음엔 임시 SQL 을 손으로 쳐서 만들었다. 그래서 **id를 빼먹은 것도 모르고**
#   지나갔고, 로그를 서버로 보낼 때가 되어서야 드러났다(§13.19 `no-id`).
#   뽑는 규칙은 코드로 남긴다 — 다시 뽑을 때 같은 규칙이어야 한다.
#
# ★ `random()` 을 쓰지 않는다. 다시 돌릴 때마다 다른 집합이 나오면
#   화면 검증이 흔들리고, 무엇이 바뀌었는지 알 수 없다.
#   `md5(id)` 로 **결정적이면서 고르게** 섞는다.
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
OUT="$ROOT/prototype/feed-seed.json"

psql "${DB_URL:?DB_URL 없음}" -X -tA -v ON_ERROR_STOP=1 <<'SQL' > "$OUT.tmp"
with ranked as (
  select p.id, p.name, p.category, p.concept,
         p.image_url, p.image_thumb_url, p.image_license,
         p.event_start, p.event_end,
         ST_X(p.geom::geometry) as lng, ST_Y(p.geom::geometry) as lat,
         r.sido || ' ' || r.name as region, p.region_code,
         row_number() over (
           partition by p.category, p.region_code
           order by (case when p.event_start >= current_date - 30 then 0 else 1 end),
                    md5(p.id::text)
         ) as rn
  from public.places p
  left join public.regions r on r.code = p.region_code
  where p.source = 'tour_api'
    and p.image_url is not null
    and p.category in ('heritage','nature','beach','activity','event','food','cafe','stay')
)
select coalesce(jsonb_agg(jsonb_build_object(
         'id',    id,            -- ★ 이게 없어서 로그를 서버로 못 보냈다
         'n',     name,   'c',   category,        'cpt', concept,
         'img',   image_url,     'thumb', image_thumb_url, 'lic', image_license,
         'evs',   event_start,   'eve',   event_end,
         'lng',   round(lng::numeric, 6), 'lat', round(lat::numeric, 6),
         'rg',    region,        'rc',    region_code)
       order by category, region_code, rn), '[]'::jsonb)
-- ★ 칸마다 몇 곳까지 담을지. 이 숫자가 곧 **내려받는 용량**이다.
--   실측: 40 → 28,836곳 10MB · 12 → 16,449곳 5.9MB · 6 → 아래 참조.
--   폰이 받을 크기가 아니다. 묶음 하나가 12장을 쓰므로 **지역·카테고리당 6곳**이면
--   화면은 그대로이고 용량은 절반이다. 지도를 움직이면 다른 지역이 나오므로
--   한 자리에서 12장을 다 쓸 일도 없다.
from ranked where rn <= 6;
SQL

python3 - "$OUT.tmp" "$OUT" <<'PY'
import json, sys, os
src, dst = sys.argv[1], sys.argv[2]
rows = json.load(open(src, encoding="utf-8"))
json.dump(rows, open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
os.remove(src)
print(f"  {len(rows):,}곳 · {os.path.getsize(dst)//1024:,}KB")
print(f"  id 있는 것 {sum(1 for r in rows if r.get('id')):,} / 컨셉 {sum(1 for r in rows if r.get('cpt')):,} / 기간 {sum(1 for r in rows if r.get('evs')):,}")
PY
