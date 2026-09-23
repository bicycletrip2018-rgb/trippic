#!/usr/bin/env bash
# =====================================================================
# 검증으로 쌓인 데이터를 지운다. **장소·경계·이미지는 건드리지 않는다.**
#
#   ./db/supabase/reset_test_data.sh
#
# ★ 이걸 스크립트로 남기는 이유: 검증을 돌릴 때마다 계정·핀·사진이 쌓인다.
#   손으로 지우면 무엇을 지웠는지 매번 달라지고, 실수로 자산을 지우는 날이 온다.
#
# ★ 저장소는 **API 로만** 지울 수 있다 (DB 에서 직접 지우면 storage.protect_delete 가 막는다).
#   주인만 지울 수 있으므로 정책을 **잠깐 열었다 반드시 닫는다.**
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
CFG="$ROOT/prototype/config.js"
K=$(grep -o 'anonKey: "[^"]*"' "$CFG" | sed 's/anonKey: "//; s/"$//')
U=$(grep -o 'url: "[^"]*"' "$CFG" | sed 's/url: "//; s/"$//')

echo "▶ 저장소 파일"
psql "$DB_URL" -q -c "drop policy if exists photos_cleanup on storage.objects"
psql "$DB_URL" -q -c "create policy photos_cleanup on storage.objects for delete to anon using (bucket_id='photos')"
trap 'psql "$DB_URL" -q -c "drop policy if exists photos_cleanup on storage.objects"' EXIT
N=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  curl -s -o /dev/null -X DELETE "$U/storage/v1/object/photos/$f" -H "apikey: $K" && N=$((N+1))
done < <(psql "$DB_URL" -tA -c "select name from storage.objects where bucket_id='photos'")
echo "   $N개 삭제"

echo "▶ DB 행"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 <<'SQL'
begin;
delete from public.comments;
delete from public.media;
delete from public.pin_spaces;
delete from public.trip_spaces;
delete from public.reactions;
delete from public.pins;
delete from public.trips;
delete from public.space_members;
delete from public.spaces;
delete from public.cover_events;
delete from public.region_progress;
delete from public.place_stats;
update public.places set public_pin_count = 0 where public_pin_count <> 0;
delete from auth.users where is_anonymous;   -- 익명 계정만. 실제 계정은 남긴다
commit;
SQL

psql "$DB_URL" -tA -c "
select '   남은 것 — 핀 '||(select count(*) from public.pins)
     ||' / 사진 '||(select count(*) from public.media)
     ||' / 계정 '||(select count(*) from auth.users)
     ||' / 저장소 '||(select count(*) from storage.objects where bucket_id='photos');
select '   자산 — 장소 '||(select count(*) from public.places)
     ||' / 경계 '||(select count(*) from public.regions)
     ||' / 이미지 '||(select count(*) from public.places where image_url is not null);"
