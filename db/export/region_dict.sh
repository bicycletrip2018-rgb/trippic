#!/usr/bin/env bash
# =====================================================================
# 시군구 사전을 파일로 뽑는다 — 기기로 내려받아 **오프라인 조회**하기 위한 것.
#
# 왜 지역 단위인가 (§10.32 실측)
#   전국 1,635,152곳 = 51MB — 기기에 통째로 못 넣는다.
#   반면 **여행은 지역이 한두 개다.** 지역 사전만 받으면 조회가 기기에서 끝난다
#   → 서버 조회 0회, OCR로 읽은 글자가 기기를 떠나지 않는다(프라이버시).
#
# ★ JSON이 아니라 TSV다. 같은 내용이 raw 28% 작고(578→418KB) 파싱이 split 한 번이다.
#   gzip 후에는 차이가 줄지만, **기기에서의 파싱 비용**은 raw가 결정한다.
#
# ★ 키는 **법정동코드 시군구 5자리**다(26350 = 부산광역시 해운대구).
#   짧은 이름('중구')은 여러 시도에 있어 충돌하고, 주소의 시도 표기도
#   들쭉날쭉하다("제주특별자치도 제주시" / "제주 제주시"). 코드가 둘 다 없앤다.
#   places.region_code는 db/import/load_regions.py가 채운다.
#
# 사용: db/export/region_dict.sh 26350 50110 ...   (법정동코드 시군구 5자리)
# =====================================================================
set -euo pipefail
export PATH="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/prototype/dict"
mkdir -p "$OUT"
META="$OUT/.meta.tsv"; : > "$META"
PSQL=(psql -X -q -h /tmp -p 55432 -d trippic_data -At)

# ★ 지역 목록은 전국치를 한 장으로 내보낸다 (246개 · 8KB 남짓).
#   화면에서 지역을 고르려면 사전이 없는 지역도 보여야 하고,
#   코드 ↔ 보여줄 이름을 이을 것도 필요하다.
"${PSQL[@]}" <<'SQL' > "$OUT/regions.json"
select json_agg(json_build_object(
         'c', code, 'n', name, 's', sido,
         'lng', round(ST_X(center)::numeric, 4),
         'lat', round(ST_Y(center)::numeric, 4)) order by sido, name)
from public.regions;
SQL
echo "지역 목록 $(python3 -c "import json;print(len(json.load(open('$OUT/regions.json'))))")개 → regions.json"

for CODE in "$@"; do
  # ★ psql 변수(:'c')는 -c 에서는 치환되지 않는다. -f 나 표준입력에서만 된다.
  RN=$("${PSQL[@]}" -v c="$CODE" <<'SQL'
select sido||' '||name from public.regions where code=:'c';
SQL
)
  if [ -z "$RN" ]; then echo "$CODE: regions에 없다"; continue; fi
  # ★ 파일 이름이 법정동코드다. '중구'처럼 여러 시도에 있는 이름을 쓰면 충돌한다.
  "${PSQL[@]}" -F$'\t' -v c="$CODE" <<'SQL' > "$OUT/$CODE.tsv"
-- ★ region_code가 채워져 있으면 그걸 쓰고, 아직이면 주소로 맞춘다.
--   1,635,152행 백필은 디스크 바운드라 10분쯤 걸린다 — 사전 내보내기가 그걸 기다릴 이유가 없다.
select p.name, p.category::text,
       round(ST_X(p.geom)::numeric, 5), round(ST_Y(p.geom)::numeric, 5)
from public.places p, public.regions r
where r.code = :'c' and p.name <> ''
  and (p.region_code = r.code
       or (p.region_code is null
           and (array_to_string((string_to_array(p.address,' '))[1:2],' ') = r.sido||' '||r.name
             or array_to_string((string_to_array(p.address,' '))[1:3],' ') = r.sido||' '||r.name)))
order by p.name;
SQL
  n=$(wc -l < "$OUT/$CODE.tsv" | tr -d ' ')
  raw=$(stat -f%z "$OUT/$CODE.tsv")
  gz=$(gzip -9 -c "$OUT/$CODE.tsv" | wc -c | tr -d ' ')
  printf '%s\t%s\t%s\t%s\t%s\n' "$CODE" "$RN" "$n" "$raw" "$gz" >> "$META"
  printf "%-6s %-22s %7s곳  raw %6.1f KB  gzip %6.1f KB\n" "$CODE" "$RN" "$n" \
    "$(echo "$raw/1024" | bc -l)" "$(echo "$gz/1024" | bc -l)"
done

python3 - "$META" "$OUT/index.json" <<'PYEOF'
import json, sys
rows = []
for line in open(sys.argv[1], encoding="utf-8"):
    c, full, n, b, g = line.rstrip("\n").split("\t")
    rows.append({"c": c, "full": full, "n": int(n), "bytes": int(b), "gzip": int(g)})
json.dump(rows, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
print("→", sys.argv[2], len(rows), "개 사전")
PYEOF
rm -f "$META"
