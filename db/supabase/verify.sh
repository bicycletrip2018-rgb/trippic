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
# ★ `|| true` 가 **꼭 있어야 한다.** 없으면 psql 이 실패한 순간 `set -e` 가
#   대입문에서 스크립트를 죽여, 아래 "무엇이 틀렸나"를 **한 줄도 못 찍는다** —
#   실제로 그랬다: 실패하면 머리말 두 줄만 내고 조용히 exit 3 이었다(§13.91).
#   실패를 말 못 하는 검증기는 없느니만 못하다.
out=$(psql -X -d "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/db/local/smoke.sql" 2>&1) || true
echo "$out" | grep -E "NOTICE:|──" | sed 's/^psql:[^ ]* //; s/^NOTICE:  //'
if echo "$out" | grep -q "ERROR"; then
  echo "$out" | grep -E "ERROR|DETAIL|CONTEXT" | sed 's/^/  /'
  red "=== 실패 ==="; exit 1
fi
echo; green "=== 통과 ($(echo "$out" | grep -c 'OK  ')건) ==="

echo
echo "=== 실제 데이터가 있어야 볼 수 있는 것 (로컬 스텁에는 경계가 없다) ==="
psql -X -d "$DB_URL" -v ON_ERROR_STOP=1 -q <<'LAND' | sed 's/^/  /'
do $$
declare n int := 0;
  procedure_ok boolean;
begin
  -- 035 육로 덩어리 — 표의 내용은 경계 데이터가 있어야 확인된다
  if public.landmass_of('50110') = public.landmass_of('50130')
     and public.landmass_of('50110') <> public.landmass_of('26350') then
    raise notice 'OK   ★ 제주시·서귀포시는 한 덩어리, 부산은 다른 덩어리 — 위도로 가르면 제주 안이 쪼개진다';
  else raise exception 'FAIL 제주 판정'; end if;

  if public.landmass_of('47940') <> 'mainland' then
    raise notice 'OK   ★ 울릉도가 걸린다 — 위도 한 줄로는 안 걸려서 "차로 3시간"이 찍혔다';
  else raise exception 'FAIL 울릉도 판정'; end if;

  if public.landmass_of('28720') = 'unknown' then
    raise notice 'OK   ★ 옹진군은 모른다고 적는다 (백령은 배, 영흥도는 다리)';
  else raise exception 'FAIL 옹진 판정'; end if;

  if public.landmass_at(130.90, 37.50) = 'ulleung'
     and public.landmass_at(129.16, 35.16) = 'mainland' then
    raise notice 'OK   ★ 좌표로도 같은 답이 나온다 (울릉도 / 부산)';
  else raise exception 'FAIL 좌표 판정'; end if;

  -- 034+035 시간 예산: 8시간을 줘도 섬 밖으로 못 나간다
  select count(*) into n from public.api_places_in_budget(130.90, 37.50, 480, null, 500) b
    join public.places p on p.id = b.place_id
   where public.landmass_of(p.region_code) <> 'ulleung';
  if n = 0 then
    raise notice 'OK   ★ 울릉도에서 8시간을 줘도 육지 장소가 안 섞인다 (%건)', n;
  else raise exception 'FAIL 울릉도에서 육지가 % 건 섞였다', n; end if;

  select count(*) into n from public.api_places_in_budget(124.71, 37.96, 480, null, 500);
  if n = 0 then
    raise notice 'OK   ★ 덩어리를 모르는 곳(백령도)에서는 아무것도 말하지 않는다';
  else raise exception 'FAIL 모르는 곳에서 % 건을 내놨다', n; end if;
end $$;
LAND
echo

echo "=== 공간 인덱스가 실제로 쓰이는가 (로컬 스텁으로는 못 본 것) ==="
psql -X -d "$DB_URL" -c "
explain (analyze, buffers, format text)
select count(*) from public.places
where ST_DWithin(geom::geography,
                 ST_SetSRID(ST_MakePoint(129.16, 35.158), 4326)::geography, 150);" 2>&1 | head -12
