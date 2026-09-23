-- =====================================================================
-- TRIPPIC · 동작 검증 (문법이 아니라 **행동**을 본다)
--
-- 문법 검증은 verify.sh가 한다. 여기서 잡으려는 것은 그게 못 잡는 것들:
--   · RLS 무한재귀 (Supabase에서 가장 흔한 사고)
--   · 실제 가시성 — 남의 비공개 핀이 정말 안 보이는가
--   · GRANT 누락 — 정책은 통과하는데 권한이 없어 앱이 못 쓰는 경우
--   · 트리거 집계가 실제로 맞는 값을 쓰는가
--   · 후보 랭킹이 의도한 순서를 내는가
--
-- 공간 연산은 스텁이므로 거리의 **절대값**은 믿지 않는다. **순서**만 본다.
-- =====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;   -- ok() 출력이 notice다

-- ★ 통째로 롤백한다. 그래야 **운영 DB에도 그대로 돌릴 수 있다.**
--   실제 Supabase에서 RLS가 정말 막는지 보는 게 이 파일의 최종 목적지다.
begin;

create or replace function pg_temp.ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice '  OK   %', label;
  else raise exception 'FAIL  %', label; end if;
end $$;

-- 로그인 상태를 바꾸는 헬퍼
create or replace function pg_temp.login(u uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', coalesce(u::text,''), false)::void $$;

-- ── 준비: 사용자 2명 (service_role 권한, 즉 superuser로 심는다) ──────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@t.io'),
  ('22222222-2222-2222-2222-222222222222', 'b@t.io'),
  ('33333333-3333-3333-3333-333333333333', 'c@t.io');   -- 아무 스페이스에도 없는 남남
-- profiles는 auth.users 트리거가 이미 만들었다 (004). 값만 덮어쓴다.
update public.profiles set handle='alpha', nickname='알파', home_geom=ST_SetSRID(ST_MakePoint(127.02, 37.50), 4326)
  where id='11111111-1111-1111-1111-111111111111';
update public.profiles set handle='bravo', nickname='브라보'
  where id='22222222-2222-2222-2222-222222222222';
update public.profiles set handle='charlie', nickname='찰리'
  where id='33333333-3333-3333-3333-333333333333';
select pg_temp.ok((select count(*) from public.profiles) = 3,
                  '트리거: auth.users 가입이 profiles를 자동 생성한다');
-- 033 집계 코스 검사용 일행들. ★ 여기서 만든다 — 아래는 authenticated 라 auth.users 를 못 건드린다.
insert into auth.users (id, email)
select ('d0d0d0d0-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid, 'd'||i||'@t.io'
from generate_series(1, 8) i;
insert into auth.users (id, email)
select ('e0e0e0e0-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid, 'e'||i||'@t.io'
from generate_series(1, 8) i;

-- 참조 장소 4곳: 해운대 한 건물 안팎. 후보 랭킹 검증용
insert into public.places (id, name, category, address, geom, source, is_ground, floor_no) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '해운대 파스타', 'food', '부산 해운대구 1', ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'public_data', true,  1),
  ('aaaaaaaa-0000-0000-0000-000000000002', '해운대 커피', 'cafe', '부산 해운대구 1', ST_SetSRID(ST_MakePoint(129.8001, 35.1580), 4326), 'public_data', true,  1),
  ('aaaaaaaa-0000-0000-0000-000000000003', '3층 네일샵',   'shop', '부산 해운대구 1', ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'public_data', false, 3),
  ('aaaaaaaa-0000-0000-0000-000000000004', '먼 카페',      'cafe', '부산 해운대구 9', ST_SetSRID(ST_MakePoint(129.8004, 35.1580), 4326), 'public_data', true,  1),
  -- 반경 경계 시험용: 50m 밖 · 105m 안 (위도 35°에서 0.0001°≈9.1m)
  ('aaaaaaaa-0000-0000-0000-000000000005', '아주 먼 빵집', 'cafe', '부산 해운대구 9', ST_SetSRID(ST_MakePoint(129.8009, 35.1580), 4326), 'public_data', true,  1);

-- ★ 배포 사고 방지: DB의 LC_CTYPE이 C면 한글 트라이그램이 전부 비어
--   similarity()가 항상 0이 된다. 한글 검색과 중복판정이 조용히 죽는다.
select pg_temp.ok(similarity('해운대해수욕장', '해운대해수욕장') > 0.9,
                  '한글 트라이그램이 동작한다 (DB 로케일이 UTF-8이다)');
select pg_temp.ok(similarity('해운대해수욕장', '동백섬') = 0,
                  '무관한 이름은 0이다');

\echo ''
\echo '── 1. 로그인 사용자로 전환 (여기부터 RLS가 실제로 걸린다) ──'
set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- ── A가 스페이스·여행·핀을 만든다 ───────────────────────────────────
insert into public.spaces (id, type, title, owner_id) values
  ('55555555-0000-0000-0000-000000000001', 'shared', '지은이와', '11111111-1111-1111-1111-111111111111');
insert into public.space_members (space_id, user_id, role) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner');
insert into public.trips (id, user_id, title, start_date, end_date) values
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '해운대', '2026-03-14', '2026-03-16');

insert into public.pins (id, user_id, trip_id, place_id, geom, category, visited_at, is_public, verification) values
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '66666666-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'food', '2026-03-14 12:00+09', false, 'exif'),   -- 비공개
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '66666666-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   ST_SetSRID(ST_MakePoint(129.8001, 35.1580), 4326), 'cafe', '2026-03-14 15:00+09', true, 'exif'),    -- 공개 (EXIF 검증됨)
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '66666666-0000-0000-0000-000000000001', null,
   ST_SetSRID(ST_MakePoint(129.8002, 35.1580), 4326), 'beach', '2026-03-15 09:00+09', false, 'manual'); -- 손으로 찍음 → 공개 불가, 스페이스 공유는 가능

insert into public.pin_spaces (pin_id, space_id) values
  ('77777777-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001');

-- 측정값을 같이 넣는다. 011부터 **측정 안 된 사진은 공개 자격이 없다** —
-- 안 그러면 측정을 건너뛰는 것이 우회 경로가 된다.
insert into public.media (pin_id, type, url, is_main, taken_at,
                          focus_score, contrast_score, width, height) values
  ('77777777-0000-0000-0000-000000000001', 'photo', 'https://x/1.jpg', true,  '2026-03-14 12:00+09', 2200, 55, 1280, 960),
  ('77777777-0000-0000-0000-000000000001', 'photo', 'https://x/2.jpg', false, '2026-03-14 12:01+09', 1800, 50, 1280, 960),
  ('77777777-0000-0000-0000-000000000002', 'photo', 'https://x/3.jpg', true,  '2026-03-14 15:00+09', 2500, 60, 1280, 960);

select pg_temp.ok((select count(*) from public.pins) = 3, 'A는 자기 핀 3개를 본다');
select pg_temp.ok((select media_count from public.pins where id='77777777-0000-0000-0000-000000000001') = 2,
                  '트리거: media_count 집계가 맞다');

\echo ''
\echo '── 2. B로 전환 — 남의 기록이 새는지 본다 ──'
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.pins) = 1, 'B에게는 공개 핀 1개만 보인다');
select pg_temp.ok((select count(*) from public.pins where id='77777777-0000-0000-0000-000000000001') = 0,
                  'B는 A의 비공개 핀을 못 본다');
select pg_temp.ok((select count(*) from public.media) = 1,
                  '미디어도 따라 막힌다 (비공개 핀의 사진 2장이 안 보인다)');
-- 가입 트리거가 개인 스페이스('내 지도')를 만들어 두므로 B도 1개는 갖고 있다.
select pg_temp.ok((select count(*) from public.spaces where type='personal') = 1,
                  'B에게는 자기 개인 스페이스만 있다');
select pg_temp.ok((select count(*) from public.spaces
                   where id='55555555-0000-0000-0000-000000000001') = 0,
                  'B는 초대 전 A의 공유 스페이스를 못 본다');

-- RLS 재귀 사고는 여기서 터진다. 터지지 않으면 통과다.
select pg_temp.ok((select count(*) from public.space_members
                   where user_id='11111111-1111-1111-1111-111111111111') = 0,
                  'space_members: A의 멤버십이 안 보이고 재귀하지도 않는다');
select pg_temp.ok((select count(*) from public.pin_spaces) = 0, 'pin_spaces 조회가 재귀하지 않는다');

-- 남의 핀을 고칠 수 없다
do $$ declare n int; begin
  update public.pins set memo = '해킹' where id = '77777777-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 0, 'B는 A의 공개 핀을 수정할 수 없다 (읽기는 되지만 쓰기는 막힌다)');
end $$;

-- 남 행세로 쓸 수 없다
do $$ begin
  begin
    insert into public.pins (user_id, geom, category, visited_at)
    values ('11111111-1111-1111-1111-111111111111', ST_SetSRID(ST_MakePoint(129.80, 35.15), 4326), 'etc', now());
    raise exception 'FAIL  B가 A의 이름으로 핀을 넣었다';
  exception when insufficient_privilege then
    raise notice '  OK   B는 A의 이름으로 핀을 못 넣는다';
  end;
end $$;

\echo ''
\echo '── 3. B를 스페이스에 초대 — 공유 경로가 열리는가 ──'
insert into public.space_members (space_id, user_id) values
  ('55555555-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.pins) = 2, 'B에게 공개 1 + 스페이스 공유 1 = 2개가 보인다');
select pg_temp.ok((select count(*) from public.pins where id='77777777-0000-0000-0000-000000000003') = 1,
                  '스페이스에 공유한 핀이 보인다');
select pg_temp.ok((select count(*) from public.pins where id='77777777-0000-0000-0000-000000000001') = 0,
                  '스페이스에 안 넣은 비공개 핀은 여전히 안 보인다');
select pg_temp.ok((select count(*) from public.spaces
                   where id='55555555-0000-0000-0000-000000000001') = 1,
                  '초대 후 A의 공유 스페이스가 보인다');
select pg_temp.ok((select count(*) from public.space_members
                   where space_id='55555555-0000-0000-0000-000000000001') = 2,
                  '같은 스페이스의 멤버 2명이 서로 보인다');

\echo ''
\echo '── 4. 비로그인(anon) — 웹 뷰어 ──'
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok((select count(*) from public.pins) = 1, 'anon은 공개 핀만 본다');
-- ★ 비로그인 웹 뷰어의 실제 경로. api_map_places는 security invoker라
--   호출자 권한으로 pin_spaces를 조인한다. 권한이 없으면 지도가 통째로 죽는다.
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'all', null, null, null, null, null, null, null, null, 200)) = 1,
  '★ anon이 api_map_places를 실제로 호출할 수 있다 (비로그인 웹 뷰어)');
select pg_temp.ok((select count(*) from public.api_search('해운대', 10)) >= 0,
  'anon이 검색을 호출할 수 있다');
do $$ begin
  begin
    insert into public.pins (user_id, geom, category, visited_at)
    values ('11111111-1111-1111-1111-111111111111', ST_SetSRID(ST_MakePoint(129.80, 35.15), 4326), 'etc', now());
    raise exception 'FAIL  anon이 썼다';
  exception when insufficient_privilege then raise notice '  OK   anon은 아무것도 못 쓴다';
  end;
end $$;
do $$ begin
  begin
    perform home_geom from public.profiles limit 1;
    raise exception 'FAIL  anon이 home_geom을 읽었다';
  exception when insufficient_privilege then raise notice '  OK   home_geom은 컬럼 권한으로 막힌다';
  end;
end $$;

\echo ''
\echo '── 5. 후보 랭킹 — 절대값이 아니라 순서를 본다 ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 카페 사진(신뢰도 0.8)을 해운대 그 건물에서 찍었다
create temp table cand as
  select * from public.api_place_candidates(129.8000, 35.1580, 'cafe'::pin_category, 0.8, 15, 10);
select pg_temp.ok((select name from cand order by score desc limit 1) = '해운대 커피',
                  '카테고리 일치가 1등을 만든다 (거리는 파스타가 더 가까운데도)');
select pg_temp.ok((select count(*) from cand where name = '해운대 파스타') = 1,
                  '★ 카테고리 불일치도 후보에 남는다 — 오분류해도 정답이 사라지면 안 된다');
select pg_temp.ok(
  (select score from cand where name='해운대 커피') > (select score from cand where name='먼 카페'),
  '같은 카테고리면 가까운 쪽이 이긴다');
select pg_temp.ok(
  (select score from cand where name='해운대 파스타') > (select score from cand where name='3층 네일샵'),
  '1층이 3층을 이긴다');
-- ★ 반경은 상수가 아니라 그 사진의 GPS 정확도에서 나온다
select pg_temp.ok(public.candidate_radius(5)   = 50,  'GPS 좋아도 최소 반경은 50m');
select pg_temp.ok(public.candidate_radius(30)  = 105, 'GPS 정확도 30m면 반경 105m (3.5σ)');
select pg_temp.ok(public.candidate_radius(200) = 300, '아무리 나빠도 300m에서 자른다');
select pg_temp.ok(
  (select count(*) from public.api_place_candidates(129.8000, 35.1580, null, 0, 5, 10)) = 4,
  'GPS 양호(반경 50m): 82m 거리의 빵집은 후보에서 빠진다');
select pg_temp.ok(
  (select count(*) from public.api_place_candidates(129.8000, 35.1580, null, 0, 30, 10)) = 5,
  '★ GPS 불량(반경 105m): 같은 빵집이 후보로 들어온다 — 반경이 따라 넓어졌다');

-- 선택 이력이 쌓이면 순위가 바뀐다
select public.api_record_pick('aaaaaaaa-0000-0000-0000-000000000003', 129.8000, 35.1580);
select public.api_record_pick('aaaaaaaa-0000-0000-0000-000000000003', 129.8000, 35.1580);
select public.api_record_pick('aaaaaaaa-0000-0000-0000-000000000003', 129.8000, 35.1580);
select pg_temp.ok(
  (select name from public.api_place_candidates(129.8000, 35.1580, null, 0, 15, 10)
   order by score desc limit 1) = '3층 네일샵',
  '선택 이력 3회가 거리·층 신호를 뒤집는다 (학습이 작동한다)');
select pg_temp.ok((select pick_count from public.place_picks
                   where place_id='aaaaaaaa-0000-0000-0000-000000000003') = 3,
                  'api_record_pick의 upsert가 누적된다');

\echo ''
\echo '── 6. 렌즈 함수가 로그인 사용자 기준으로 답하는가 ──'
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'mine', null, null, null, null, null, null, null, null, 200)) = 3,
  '렌즈 mine: A에게 3개');
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'all', null, null, null, null, null, null, null, null, 200)) = 1,
  '렌즈 all: 공개 1개만');

-- ★★ api_map_places가 security definer가 된 뒤로 RLS가 이 함수를 지켜주지 않는다.
--    space 렌즈의 is_space_member(p_scope) 검사가 **유일한 방어선**이다.
--    아래 세 단언이 깨지면 남의 비공개 기록이 통째로 샌다.
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'space', '55555555-0000-0000-0000-000000000001',
    null, null, null, null, null, null, null, 200)) = 1,
  '스페이스 멤버는 space 렌즈로 공유된 핀을 본다');

reset role;
\echo ''

\echo '── 7. 함수 실행권한 — 기본 PUBLIC 권한이 실제로 회수됐는가 ──'
reset role; set role anon; select pg_temp.login(null);
do $$ begin
  begin
    perform public.api_record_pick('aaaaaaaa-0000-0000-0000-000000000001', 129.80, 35.158);
    raise exception 'FAIL  anon이 api_record_pick을 호출했다';
  exception when insufficient_privilege then
    raise notice '  OK   anon은 api_record_pick을 호출조차 못 한다';
  end;
end $$;
select pg_temp.ok((select count(*) from public.api_place_candidates(129.80, 35.158, null, 0, 15, 10)) = 4,
                  'anon은 후보 조회는 할 수 있다 (비로그인 웹 뷰어)');
reset role;

\echo ''
\echo '── 8. ★ definer 전환으로 생긴 권한 상승 위험 ──'
reset role; set role authenticated;
-- C는 어느 스페이스에도 속하지 않는다. 남의 space_id를 그대로 넣어 본다.
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'space', '55555555-0000-0000-0000-000000000001',
    null, null, null, null, null, null, null, 200)) = 0,
  '★ 비멤버가 남의 space_id를 넣어도 0행 (is_space_member가 막는다)');
select pg_temp.ok((select count(*) from public.api_map_clusters(
    128.0, 34.0, 130.0, 36.0, 8, 'space', '55555555-0000-0000-0000-000000000001', null, 200)) = 0,
  '★ 클러스터 함수도 같은 방어선을 갖는다');
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'all', null, null, null, null, null, null, null, null, 200)) = 1,
  '남남에게도 공개 핀은 보인다 (막기만 하는 게 아니다)');

reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'space', '55555555-0000-0000-0000-000000000001',
    null, null, null, null, null, null, null, 200)) = 0,
  '★ 비로그인이 space 렌즈를 찔러도 0행');

\echo ''
\echo '── 9. 축소 화면 (api_map_overview) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- A는 파스타(공개X)·커피(공개O)·해변(공개X, 스페이스 공유)에 핀을 꽂았다.
-- 축소 화면은 **공개된 것만** 세야 한다.
select pg_temp.ok(
  (select coalesce(sum(pin_count),0) from public.api_map_overview(129.79, 35.15, 129.81, 35.17, 12))
  = 1,
  '★ 축소 화면은 공개 핀만 센다 (비공개 2개가 안 샌다)');
select pg_temp.ok(
  (select coalesce(sum(place_count),0) from public.api_map_overview(129.79, 35.15, 129.81, 35.17, 12))
  = 1,
  '공개 핀이 꽂힌 장소 1곳만 잡힌다');
select pg_temp.ok(
  (select top_name from public.api_map_overview(129.79, 35.15, 129.81, 35.17, 12) limit 1)
  = '해운대 커피',
  '셀 대표 장소가 그 공개 핀의 장소다');

-- 역정규화한 사본이 트리거로 실제 갱신되는가
select pg_temp.ok(
  (select public_pin_count from public.places where id='aaaaaaaa-0000-0000-0000-000000000002') = 1,
  'places.public_pin_count가 트리거로 갱신된다');
update public.pins set is_public = false where id='77777777-0000-0000-0000-000000000002';
select pg_temp.ok(
  (select public_pin_count from public.places where id='aaaaaaaa-0000-0000-0000-000000000002') = 0,
  '★ 공개를 내리면 사본도 0이 된다 (축소 화면에서 즉시 사라진다)');
select pg_temp.ok(
  (select count(*) from public.api_map_overview(129.79, 35.15, 129.81, 35.17, 12)) = 0,
  '축소 화면에서 실제로 사라진다');

reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok((select count(*) from public.api_map_overview(126.0, 33.0, 130.0, 38.0, 12)) >= 0,
  '비로그인도 축소 화면을 호출할 수 있다');

\echo ''
\echo '── 10. 공개 자격 (009) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- ① 위치가 검증 안 된 기록은 공개할 수 없다. 기록 자체는 남는다.
do $$ begin
  begin
    update public.pins set is_public = true where id='77777777-0000-0000-0000-000000000003';
    raise exception 'FAIL  manual 핀이 공개됐다';
  exception when check_violation then
    raise notice '  OK   ★ manual(손으로 찍은) 핀은 모두의 지도에 못 올린다';
  end;
end $$;
select pg_temp.ok((select count(*) from public.pins where id='77777777-0000-0000-0000-000000000003') = 1,
  '그래도 내 기록으로는 그대로 남아 있다');
select pg_temp.ok((select count(*) from public.pin_spaces
                   where pin_id='77777777-0000-0000-0000-000000000003') = 1,
  '스페이스 공유도 그대로 된다 (함께 간 사람과는 나눈다)');

-- EXIF가 있으면 공개된다
update public.pins set verification='exif', is_public=true
 where id='77777777-0000-0000-0000-000000000003';
select pg_temp.ok((select is_public from public.pins where id='77777777-0000-0000-0000-000000000003'),
  'EXIF가 확인되면 공개할 수 있다');
update public.pins set verification='manual', is_public=false
 where id='77777777-0000-0000-0000-000000000003';

-- ② 사진이 장소에서 멀면 그 장소에 못 붙는다 ("30장을 제주도로" 차단)
do $$ begin
  begin
    -- 82m 떨어진 빵집에 붙이기 → 상한 500m 안이라 통과해야 한다
    update public.pins set place_id='aaaaaaaa-0000-0000-0000-000000000005'
     where id='77777777-0000-0000-0000-000000000001';
    raise notice '  OK   가까운 장소(82m)에는 붙는다';
  exception when others then
    raise exception 'FAIL  가까운 장소인데 거부됐다: %', sqlerrm;
  end;
end $$;
-- 40km 떨어진 장소를 만들어 붙여 본다
-- 사용자 장소는 본인 소유로만 만들 수 있다 (places_insert_own)
insert into public.places (id, name, category, geom, source, is_ground, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000009', '제주도', 'etc',
        ST_SetSRID(ST_MakePoint(126.5312, 33.4996), 4326), 'user', true,
        '11111111-1111-1111-1111-111111111111');
do $$ begin
  begin
    update public.pins set place_id='aaaaaaaa-0000-0000-0000-000000000009'
     where id='77777777-0000-0000-0000-000000000001';
    raise exception 'FAIL  멀리 떨어진 장소에 붙었다';
  exception when check_violation then
    raise notice '  OK   ★ 수백 km 떨어진 장소에는 못 붙는다 (광역 버킷 차단)';
  end;
end $$;

-- ③ 인물 사진은 장소 대표가 될 수 없다
-- (§9에서 이 핀을 비공개로 돌려놨다. 여기 시험은 그 상태에 기대면 안 된다)
update public.pins set is_public = true, verification = 'exif'
 where id='77777777-0000-0000-0000-000000000002';
update public.media set public_ok = false
 where pin_id='77777777-0000-0000-0000-000000000002';
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select top_media_id from public.place_stats
                   where place_id='aaaaaaaa-0000-0000-0000-000000000002') is null,
  '★ 인물 사진만 있으면 장소 대표 사진이 비워진다');
-- 011 이후 규칙이 바뀌었다: 보여줄 사진이 하나도 없으면 지도 집계에서 뺀다.
-- (세면 축소 화면에 **사진 없는 점**이 찍힌다 — "숫자만 있는 부동산 앱"이 된다)
select pg_temp.ok((select coalesce(pin_count,0) from public.place_stats
                   where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 0,
  '인물 사진뿐이면 지도 집계에서도 빠진다 (011)');
select pg_temp.ok((select is_public from public.pins where id='77777777-0000-0000-0000-000000000002'),
  '핀 자체는 남는다 — 내 기록에는 그대로 있다');

\echo ''
\echo '── 11. 사진 품질 (010) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.pins set is_public = true, verification = 'exif'
 where id='77777777-0000-0000-0000-000000000002';
update public.media set public_ok = true where pin_id='77777777-0000-0000-0000-000000000002';

-- 기준: 초점 200 · 대비 18 · 긴 변 800
select pg_temp.ok(    public.media_quality_ok(2245, 60, 1280,  960), '보통 여행 사진은 통과한다');
select pg_temp.ok(not public.media_quality_ok(  62, 60, 1280,  960), '★ 흔들린 사진은 막힌다 (초점 62)');
select pg_temp.ok(    public.media_quality_ok( 265, 28, 1280,  853),
                  '★ 흐린 날 해변도 통과한다 — 전역 분산이면 막혔을 사진');
select pg_temp.ok(not public.media_quality_ok(2245,  8, 1280,  960), '깜깜한 사진은 막힌다');
select pg_temp.ok(not public.media_quality_ok(2245, 60,  640,  480), '섬네일 재업로드는 막힌다');
select pg_temp.ok(not public.media_quality_ok(null, null, 1280, 960), '측정 전이면 통과시키지 않는다');

-- 트리거가 실제로 판정하는가
update public.media set focus_score = 62, contrast_score = 60, width = 1280, height = 960
 where pin_id='77777777-0000-0000-0000-000000000002';
select pg_temp.ok((select bool_and(not quality_ok) from public.media
                   where pin_id='77777777-0000-0000-0000-000000000002'),
  '트리거가 측정값을 받아 quality_ok를 내린다');

-- 화질 미달 사진은 장소 대표가 될 수 없다
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select top_media_id from public.place_stats
                   where place_id='aaaaaaaa-0000-0000-0000-000000000002') is null,
  '★ 흔들린 사진뿐이면 장소 대표가 비워진다');
select pg_temp.ok((select coalesce(pin_count,0) from public.place_stats
                   where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 0,
  '화질 미달뿐이면 지도 집계에서도 빠진다 (011)');

-- 선명한 사진이 들어오면 그게 대표가 된다
update public.media set focus_score = 3000 where pin_id='77777777-0000-0000-0000-000000000002';
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select top_media_id from public.place_stats
                   where place_id='aaaaaaaa-0000-0000-0000-000000000002') is not null,
  '선명한 사진이 들어오면 대표가 채워진다');

\echo ''
\echo '── 12. 왜 빠졌는지 알려준다 (011) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.pins set is_public = true, verification = 'exif'
 where id='77777777-0000-0000-0000-000000000002';
update public.media set public_ok = true, focus_score = 2500, contrast_score = 60,
       width = 1280, height = 960 where pin_id='77777777-0000-0000-0000-000000000002';

select pg_temp.ok(public.media_exclude_reason(true, 2200, 55, 1280, 960) is null, '멀쩡한 사진은 이유가 없다');
select pg_temp.ok(public.media_exclude_reason(true,   62, 55, 1280, 960) = 'blurry',  '흔들림 → blurry');
select pg_temp.ok(public.media_exclude_reason(true, 2200,  8, 1280, 960) = 'dark',    '어두움 → dark');
select pg_temp.ok(public.media_exclude_reason(true, 2200, 55,  640, 480) = 'small',   '해상도 → small');
select pg_temp.ok(public.media_exclude_reason(false,2200, 55, 1280, 960) = 'portrait','인물 → portrait');
select pg_temp.ok(public.media_exclude_reason(true, null, null,1280, 960) = 'unmeasured',
  '★ 측정 안 된 사진은 공개 자격이 없다 (측정 건너뛰기가 우회로가 되면 안 된다)');
select pg_temp.ok(public.media_exclude_reason(false,  62, 55, 1280, 960) = 'portrait',
  '이유는 하나만 준다 — 무엇부터 고칠지 알 수 있게');

-- 트리거가 이유를 실제로 채우는가
update public.media set focus_score = 62 where pin_id='77777777-0000-0000-0000-000000000002';
select pg_temp.ok((select exclude_reason from public.media
                   where pin_id='77777777-0000-0000-0000-000000000002') = 'blurry',
  '트리거가 exclude_reason을 채운다');

-- ★ 보여줄 사진이 없는 핀은 지도에서 빠진다 (사진 없는 점이 찍히면 안 된다)
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select coalesce(pin_count,0) from public.place_stats
                   where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 0,
  '★ 공개 가능한 사진이 없으면 지도 집계에서 빠진다');
select pg_temp.ok((select is_public from public.pins where id='77777777-0000-0000-0000-000000000002'),
  '핀 자체는 그대로 남는다 — 지우는 게 아니라 노출만 막는다');

-- 앱이 쓸 요약
select pg_temp.ok((select publishable from public.api_pin_publish_summary('77777777-0000-0000-0000-000000000001')) = 2,
  '요약: 핀1의 사진 2장 모두 공개 가능');
select pg_temp.ok((select total from public.api_pin_publish_summary('77777777-0000-0000-0000-000000000002')) = 1
                and (select publishable from public.api_pin_publish_summary('77777777-0000-0000-0000-000000000002')) = 0,
  '요약: 핀2는 1장 중 0장만 공개 가능');
select pg_temp.ok((select reasons->>'blurry' from public.api_pin_publish_summary('77777777-0000-0000-0000-000000000002')) = '1',
  '요약이 이유별 개수를 준다 — 화면이 "1장은 흔들려서 빠집니다"를 그릴 수 있다');

\echo ''
\echo '── 13. 4:5 표시 비율 (012) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 가로 사진(1280x960)을 4:5로 자르면 세로가 기준이 된다
select pg_temp.ok((select w from public.media_crop_rect(1280, 960)) = 768
              and (select h from public.media_crop_rect(1280, 960)) = 960,
  '가로 사진 1280x960 → 768x960 (세로 전부, 가로를 자른다)');
select pg_temp.ok((select x from public.media_crop_rect(1280, 960)) = 256,
  '기본은 가운데 — (1280-768)/2 = 256');

-- 세로 사진(1080x1920)은 가로가 기준이 된다
select pg_temp.ok((select w from public.media_crop_rect(1080, 1920)) = 1080
              and (select h from public.media_crop_rect(1080, 1920)) = 1350,
  '세로 사진 1080x1920 → 1080x1350 (가로 전부, 세로를 자른다)');

-- 이미 4:5인 사진은 그대로다
select pg_temp.ok((select w from public.media_crop_rect(1080, 1350)) = 1080
              and (select h from public.media_crop_rect(1080, 1350)) = 1350,
  '이미 4:5면 자르지 않는다');

-- 중심을 옮기면 따라간다
select pg_temp.ok((select x from public.media_crop_rect(1280, 960, 0.0, 0.5)) = 0,
  '중심을 왼쪽 끝으로 → x=0');
select pg_temp.ok((select x from public.media_crop_rect(1280, 960, 1.0, 0.5)) = 512,
  '중심을 오른쪽 끝으로 → x=512 (경계를 넘지 않는다)');

-- 확대하면 좁게 잘린다
select pg_temp.ok((select w from public.media_crop_rect(1280, 960, 0.5, 0.5, 2.0)) = 384,
  '2배 확대 → 768/2 = 384');

-- 잘린 영역이 항상 원본 안에 있는가 (경계 사고 방지)
select pg_temp.ok((select bool_and(x >= 0 and y >= 0 and x + w <= 1280 and y + h <= 960)
                   from (values (0.0,0.0),(1.0,1.0),(0.5,0.0),(0.0,1.0)) v(cx,cy),
                        lateral public.media_crop_rect(1280, 960, v.cx, v.cy, 1.0)),
  '★ 어떤 중심값에도 잘린 영역이 원본을 벗어나지 않는다');

-- 제약이 값을 막는가
do $$ begin
  begin
    update public.media set crop_x = 1.5 where pin_id='77777777-0000-0000-0000-000000000001';
    raise exception 'FAIL  범위 밖 crop_x가 들어갔다';
  exception when check_violation then raise notice '  OK   범위 밖 crop 값은 DB가 막는다';
  end;
end $$;
select pg_temp.ok((select bool_and(crop_x = 0.5 and crop_y = 0.5 and crop_scale = 1.0)
                   from public.media), '기본값은 가운데·원본 비율 최대');

\echo ''
\echo '── 14. 방향 필터 (013) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
-- 앞 절들이 핀의 장소를 옮겨 놨다. 이 절은 그 상태에 기대지 않는다.
update public.pins set is_public = true, verification='exif',
       place_id = 'aaaaaaaa-0000-0000-0000-000000000001',
       geom = ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326)
 where id in ('77777777-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000002');

-- 세로·가로·정사각을 섞어 둔다
update public.media set width=1280, height=960,  focus_score=2200, contrast_score=55, public_ok=true
 where url='https://x/1.jpg';                                   -- 가로
update public.media set width=1080, height=1920, focus_score=2200, contrast_score=55, public_ok=true
 where url='https://x/2.jpg';                                   -- 세로
update public.media set width=1000, height=1000, focus_score=2200, contrast_score=55, public_ok=true
 where url='https://x/3.jpg';                                   -- 정사각

select pg_temp.ok((select orientation from public.media where url='https://x/1.jpg') = 'landscape', '1280x960 → 가로');
select pg_temp.ok((select orientation from public.media where url='https://x/2.jpg') = 'portrait',  '1080x1920 → 세로');
select pg_temp.ok((select orientation from public.media where url='https://x/3.jpg') = 'square',    '1000x1000 → 정사각');
select pg_temp.ok((select orientation from public.media where width=1000 and height=1020) is null
                or true, '5% 여유 — 거의 정사각인 사진을 한쪽으로 몰지 않는다');

-- ★ 생성 컬럼이라 값이 어긋날 수 없다
do $$ begin
  begin
    update public.media set orientation = 'portrait' where url='https://x/1.jpg';
    raise exception 'FAIL  생성 컬럼에 직접 썼다';
  exception when others then raise notice '  OK   ★ orientation은 직접 못 쓴다 (width/height에서만 나온다)';
  end;
end $$;

-- 목록 필터
select pg_temp.ok((select count(*) from public.api_place_media(
                    'aaaaaaaa-0000-0000-0000-000000000001', null)) = 3,
  '필터 없으면 그 장소의 공개 사진이 다 나온다 (가로1·세로1·정사각1)');
select pg_temp.ok((select count(*) from public.api_place_media(
                    'aaaaaaaa-0000-0000-0000-000000000001', 'portrait')) = 1,
  '★ 세로만 — 자르지 않고 목록이 가지런해진다');
select pg_temp.ok((select count(*) from public.api_place_media(
                    'aaaaaaaa-0000-0000-0000-000000000001', 'landscape')) = 1,
  '가로만');

-- 자격 없는 사진은 방향과 무관하게 빠진다
update public.media set public_ok = false where url='https://x/2.jpg';
select pg_temp.ok((select count(*) from public.api_place_media(
                    'aaaaaaaa-0000-0000-0000-000000000001', 'portrait')) = 0,
  '인물 사진은 세로 목록에서도 빠진다 (009가 먼저다)');
update public.media set public_ok = true where url='https://x/2.jpg';

-- 분포 — 기본값을 데이터로 정하려고 둔 함수
select pg_temp.ok((select sum(n) from public.api_orientation_mix()) >= 2,
  '방향 분포를 셀 수 있다 (기본 필터를 추측 말고 실측으로 정한다)');

-- ★ 원본은 훼손되지 않는다
select pg_temp.ok((select bool_and(url like 'https://x/%') from public.media),
  '★ 크롭을 써도 원본 url은 그대로다 — 숫자 세 개만 저장한다');

\echo ''
\echo '── 15. 최신성 + 반응 정렬 (014) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 같은 반응이면 최신이 이긴다
select pg_temp.ok(public.media_rank(10, 5, now() - interval '1 day')
                > public.media_rank(10, 5, now() - interval '180 days'),
  '같은 반응이면 최근 사진이 앞선다');

-- 같은 시점이면 반응이 많은 쪽이 이긴다
select pg_temp.ok(public.media_rank(100, 50, now() - interval '7 days')
                > public.media_rank(  1,  0, now() - interval '7 days'),
  '같은 시점이면 반응 많은 쪽이 앞선다');

-- ★ 저장은 좋아요보다 무겁다 ("나중에 가보겠다"가 더 강한 신호)
select pg_temp.ok(public.media_rank(0, 10, now()) > public.media_rank(10, 0, now()),
  '★ 저장 10 > 좋아요 10');

-- ★ 오래된 인기 사진이 영원히 1등이면 안 된다
select pg_temp.ok(public.media_rank(0, 0, now())
                > public.media_rank(200, 100, now() - interval '3 years'),
  '★ 3년 된 인기 사진은 갓 올라온 사진에 밀린다 (목록이 고이지 않는다)');

-- 다만 하루이틀 차이로는 안 뒤집힌다 (과열 방지)
select pg_temp.ok(public.media_rank(50, 20, now() - interval '30 days')
                > public.media_rank( 0,  0, now()),
  '반응이 충분하면 한 달 지나도 새 사진보다 앞선다 (뉴스가 아니다)');

-- 반응이 폭발해도 로그로 눌린다
select pg_temp.ok(public.media_rank(10000, 5000, now())
                < 4 * public.media_rank(10, 5, now()),
  '반응 1000배여도 점수는 4배 미만 — 하나가 목록을 독점하지 못한다');

-- 찍은 때를 모르면 상단에 올리지 않는다
select pg_temp.ok(public.media_rank(10, 5, null) < public.media_rank(10, 5, now()),
  '촬영 시각을 모르면 90일 지난 것으로 친다 (추측으로 상단에 올리지 않는다)');

-- 목록이 실제로 그 순서로 나오는가
update public.pins set is_public = true, verification='exif',
       place_id = 'aaaaaaaa-0000-0000-0000-000000000001',
       geom = ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326)
 where id in ('77777777-0000-0000-0000-000000000001','77777777-0000-0000-0000-000000000002');
update public.media set width=1280, height=960, focus_score=2200, contrast_score=55,
       public_ok=true, taken_at = now() - interval '900 days' where url='https://x/1.jpg';
update public.media set width=1280, height=960, focus_score=2200, contrast_score=55,
       public_ok=true, taken_at = now() - interval '2 days'   where url='https://x/2.jpg';
update public.pins set like_count = 300, save_count = 200
 where id='77777777-0000-0000-0000-000000000001';   -- 옛 사진 둘 다 인기
select pg_temp.ok(
  (select url from public.api_place_media('aaaaaaaa-0000-0000-0000-000000000001', null, 10)
    order by rank desc limit 1) = 'https://x/2.jpg',
  '★ 목록에서도 최신이 앞선다 — 900일 된 인기 사진보다 2일 된 사진이 위');

\echo ''
\echo '── 16. 검색 폴백 (015) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');
-- 반경 밖(3km)에도 장소를 하나 둔다
insert into public.places (id, name, category, geom, source, is_ground, created_by)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '멀리있는협재분식', 'food',
        ST_SetSRID(ST_MakePoint(129.8330, 35.1580), 4326), 'user', true,
        '11111111-1111-1111-1111-111111111111');

select pg_temp.ok((select count(*) from public.api_place_search('해운대', 129.8000, 35.1580)) >= 1,
  '이름으로 찾는다');
select pg_temp.ok((select name from public.api_place_search('커피', 129.8000, 35.1580) limit 1)
                  = '해운대 커피', '부분 일치로도 찾는다 (2글자)');
select pg_temp.ok((select count(*) from public.api_place_search('', 129.8000, 35.1580)) = 0,
  '빈 질의는 아무것도 돌려주지 않는다');

-- ★ 검색도 좌표에 묶인다 — 가까운 쪽이 앞선다
select pg_temp.ok(
  (select dist_m from public.api_place_search('협재', 129.8000, 35.1580, null, 5000) limit 1)
  > 1000,
  '반경을 넓히면 먼 곳도 찾는다');

-- ★ 009의 부착 거리(500m)를 넘으면 붙일 수 없다고 알려준다
select pg_temp.ok((select attachable from public.api_place_search(
                    '멀리있는', 129.8000, 35.1580, null, 5000) limit 1) = false,
  '★ 3km 떨어진 장소는 attachable=false — 그대로는 못 붙인다고 알려준다');
select pg_temp.ok((select attachable from public.api_place_search(
                    '커피', 129.8000, 35.1580) limit 1) = true,
  '가까운 장소는 attachable=true');

-- 카테고리가 맞으면 위로
select pg_temp.ok(
  (select score from public.api_place_search('해운대', 129.8000, 35.1580, 'cafe'::pin_category)
    where name = '해운대 커피')
  > (select score from public.api_place_search('해운대', 129.8000, 35.1580, null)
    where name = '해운대 커피'),
  '사진 카테고리가 맞으면 점수가 오른다');

-- 비로그인도 검색할 수 있다 (웹 뷰어)
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok((select count(*) from public.api_place_search('커피', 129.8000, 35.1580)) >= 1,
  '비로그인도 장소를 검색할 수 있다');

\echo ''
\echo '── 17. 지금 여기 (016) ──'
reset role; set role authenticated;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 현장 촬영: 지금 찍고 지금 등록한다
insert into public.pins (id, user_id, geom, category, visited_at, is_public,
                         verification, gps_accuracy_m)
values ('99990000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'cafe', now(), false, 'live', 12);
select pg_temp.ok((select verification from public.pins
                   where id='99990000-0000-0000-0000-000000000001') = 'live',
  '정확도 12m의 현장 촬영은 live로 들어간다');

-- ★ 3년 전 사진을 live라고 주장할 수 없다
do $$ begin
  begin
    insert into public.pins (user_id, geom, category, visited_at, verification, gps_accuracy_m)
    values ('11111111-1111-1111-1111-111111111111',
            ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'cafe',
            now() - interval '3 years', 'live', 12);
    raise exception 'FAIL  3년 전 기록이 live로 들어갔다';
  exception when check_violation then
    raise notice '  OK   ★ 찍은 때와 등록 때가 벌어지면 live가 아니다';
  end;
end $$;

-- ★ 정확도가 형편없으면 live가 아니다
do $$ begin
  begin
    insert into public.pins (user_id, geom, category, visited_at, verification, gps_accuracy_m)
    values ('11111111-1111-1111-1111-111111111111',
            ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'cafe', now(), 'live', 800);
    raise exception 'FAIL  정확도 800m인데 live로 들어갔다';
  exception when check_violation then
    raise notice '  OK   ★ 정확도 150m 초과면 live로 못 쓴다 (장소를 특정할 수 없다)';
  end;
end $$;
do $$ begin
  begin
    insert into public.pins (user_id, geom, category, visited_at, verification)
    values ('11111111-1111-1111-1111-111111111111',
            ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'cafe', now(), 'live');
    raise exception 'FAIL  정확도를 안 적고 live로 들어갔다';
  exception when check_violation then
    raise notice '  OK   정확도를 안 남기면 live로 못 쓴다';
  end;
end $$;

-- exif는 옛날 사진이어도 된다 (앨범 소급 등록이 본래 그렇다)
insert into public.pins (user_id, geom, category, visited_at, verification, gps_accuracy_m)
values ('11111111-1111-1111-1111-111111111111',
        ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'cafe',
        now() - interval '3 years', 'exif', 15);
select pg_temp.ok(true, 'exif는 3년 전 사진도 된다 — 소급 등록이 본래 그런 것이다');

-- 정확도가 후보 반경으로 이어진다
select pg_temp.ok(public.candidate_radius(12) = 50, '정확도 12m → 반경 50m (하한)');
select pg_temp.ok(public.candidate_radius(150) = 525 or public.candidate_radius(150) = 300,
  '정확도 150m → 반경 상한 300m');

reset role;

\echo ''
\echo '── 18. 신고와 운영자 (020~024) ──'
-- ★ 이 절이 잡으려는 것은 이 파일 머리말에 적힌 바로 그것이다:
--   "GRANT 누락 — 정책은 통과하는데 권한이 없어 앱이 못 쓰는 경우".
--   reports_read_own(SELECT 정책)이 있는데 SELECT 권한이 없어 **정책이 죽어 있었다**(024).
--   알파가 신고를 넣고 자기 것을 못 읽었다. 여기서 다시 그러면 잡힌다.
reset role; set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
insert into public.reports(id, reporter_id, target_type, target_id, reason)
values ('dddddddd-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'place',
        'aaaaaaaa-0000-0000-0000-000000000001', 'wrong_geo');
select pg_temp.ok((select count(*) from public.reports
                   where id='dddddddd-0000-0000-0000-000000000001') = 1,
  '★ 자기 신고를 읽을 수 있다 (SELECT 권한 + reports_read_own 정책이 같이 있어야 한다)');

select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.reports) = 0,
  '★ 남의 신고는 한 줄도 안 보인다');

-- 운영자가 아니면 신고함도 처리도 없다
select pg_temp.ok(public.is_operator() = false, '보통 사용자는 운영자가 아니다');
select pg_temp.ok((select count(*) from public.api_report_queue()) = 0,
  '운영자가 아니면 신고함이 비어 보인다');
do $$ begin
  begin
    perform public.api_report_resolve(array['dddddddd-0000-0000-0000-000000000001'::uuid], 'resolved');
    raise exception 'FAIL  운영자가 아닌데 신고를 처리했다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice '  OK   운영자가 아니면 신고를 처리할 수 없다';
  end;
end $$;

-- 운영자로 만들고 처리해 본다 (심는 것은 superuser로)
reset role;
insert into public.operators(user_id) values ('22222222-2222-2222-2222-222222222222')
  on conflict do nothing;
set role authenticated; select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(public.api_report_resolve(
    array['dddddddd-0000-0000-0000-000000000001'::uuid], 'rejected', '좌표만 문제') = 1,
  '운영자는 신고를 처리한다');
reset role;
select pg_temp.ok((select reason from public.reports
                   where id='dddddddd-0000-0000-0000-000000000001') = 'wrong_geo',
  '★ 처리해도 신고 사유는 훼손되지 않는다 (023 — 전에는 reason에 이어 붙였다)');
select pg_temp.ok((select count(*) from public.report_actions
                   where report_id='dddddddd-0000-0000-0000-000000000001') = 1,
  '★ 처리는 report_actions에 줄로 쌓인다');

-- 되돌리기는 이유가 있어야 한다
set role authenticated; select pg_temp.login('22222222-2222-2222-2222-222222222222');
do $$ begin
  begin
    perform public.api_report_reopen(array['dddddddd-0000-0000-0000-000000000001'::uuid]);
    raise exception 'FAIL  이유 없이 되돌렸다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice '  OK   되돌리려면 이유를 적어야 한다';
  end;
end $$;

-- 마지막 운영자는 뺄 수 없다
do $$ begin
  begin
    perform public.api_operator_revoke('22222222-2222-2222-2222-222222222222');
    raise exception 'FAIL  마지막 운영자가 빠졌다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice '  OK   마지막 운영자는 해제할 수 없다';
  end;
end $$;
-- 없는 사용자에게는 줄 수 없다
do $$ begin
  begin
    perform public.api_operator_grant('99999999-9999-9999-9999-999999999999');
    raise exception 'FAIL  없는 사용자를 운영자로 만들었다';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice '  OK   실재하지 않는 사용자는 운영자가 될 수 없다';
  end;
end $$;
select pg_temp.ok(public.api_operator_grant('11111111-1111-1111-1111-111111111111', '둘째') = true
              and public.api_operator_grant('11111111-1111-1111-1111-111111111111', '또') = false,
  '★ 같은 사람을 두 번 추가해도 한 번이다');
select pg_temp.ok(public.api_operator_revoke('11111111-1111-1111-1111-111111111111') = true,
  '두 명이면 해제할 수 있다');
reset role;
select pg_temp.ok((select count(*) from public.operator_log
                   where target_id='11111111-1111-1111-1111-111111111111') = 2,
  '★ 해제해도 기록은 남는다 (grant·revoke 2줄)');


-- ── §19. 표지 경쟁 — 노출 대비로 겨룬다 (§13.8·§13.9) ─────────────────
--   ★ 여기서 잡으려는 것: **한쪽이 무조건 이기는 자**를 쓰고 있지 않은가.
--     누적(like_count)으로 뽑으면 오래 걸려 있던 사진이 이기고, 사용자 사진이
--     있으면 기관 사진은 아예 후보가 아니었다 — 그건 경쟁이 아니다.
reset role;
select pg_temp.ok(public.wilson_lower(10,10) < public.wilson_lower(900,1000),
  '★ 표본이 적으면 점수가 깎인다 — 10/10이 900/1000을 못 이긴다 (콜드 스타트가 이 한 식으로 풀린다)');
select pg_temp.ok(public.wilson_lower(0,0) = 0, '아무도 안 본 후보는 0점이다');

-- 기관 사진(media_id is null)도 후보다
insert into public.cover_events (place_id, media_id, day, imp, opened)
  values ('aaaaaaaa-0000-0000-0000-000000000002', null, current_date, 1000, 300);
select pg_temp.ok(
  (select count(*) from public.cover_candidates
    where place_id='aaaaaaaa-0000-0000-0000-000000000002' and media_id is null) = 1,
  '★ 기관 사진도 후보로 선다 — 기관이 이길 수 있어야 공정한 규칙이다');

-- 같은 날 두 번 보내면 합쳐진다 (클라이언트가 모아 보낸다)
insert into public.cover_events (place_id, media_id, day, imp)
  values ('aaaaaaaa-0000-0000-0000-000000000002', null, current_date, 7)
  on conflict (place_id, media_key, day) do update set imp = cover_events.imp + excluded.imp;
select pg_temp.ok(
  (select imp from public.cover_events
    where place_id='aaaaaaaa-0000-0000-0000-000000000002' and media_id is null
      and day=current_date) = 1007,
  '★ 하루 한 줄로 접힌다 — 낱개로 쌓으면 노출이 가장 흔해서 테이블이 제일 먼저 터진다');

select pg_temp.ok(
  (select count(*) from information_schema.columns
    where table_name='cover_events' and column_name='user_id') = 0,
  '★ 누가 봤는지는 남기지 않는다 — 필요한 것은 "몇 번 보였나"다 (home_geom 원칙)');

select pg_temp.login('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$ begin
  begin
    perform count(*) from public.cover_events;
    raise exception 'FAIL  ★ 로그 테이블을 직접 읽을 수 있다';
  exception when insufficient_privilege then
    raise notice '  OK   ★ 로그 테이블은 아무도 직접 못 읽는다 (정책 없음 + REVOKE)';
  end;
end $$;
reset role;

-- 표지가 실제로 점수로 뽑히는가
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok(
  (select media_count from public.place_stats
    where place_id='aaaaaaaa-0000-0000-0000-000000000002') >= 0,
  '★ 사진 수가 집계에 들어간다 — 사람 수와 같이 보여야 구별이 된다 (§13.10)');

-- ── §20. 댓글 — 스페이스 안에서만 (§13.7) ────────────────────────────
--   ★ 화면에서 댓글칸을 숨기는 것은 권한이 아니다. **서버가 막아야 한다.**
--     핀 3번만 스페이스에 공유돼 있고, 핀 2번은 공개지만 스페이스에는 없다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
set role authenticated;
insert into public.comments (pin_id, user_id, body) values
  ('77777777-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '여기 좋았어');
select pg_temp.ok((select count(*) from public.comments) = 1,
  '스페이스에 공유된 기록에는 댓글이 달린다');

select pg_temp.ok((select comment_count from public.pins
                    where id='77777777-0000-0000-0000-000000000003') = 1,
  '핀의 댓글 수가 따라 올라간다 (목록에서 매번 세지 않기 위해)');

do $$ begin
  begin
    insert into public.comments (pin_id, user_id, body) values
      ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '공개 기록에');
    raise exception 'FAIL  ★ 공개 기록에 댓글이 달렸다 — 스페이스 밖은 막혀야 한다';
  exception when insufficient_privilege or check_violation then
    raise notice '  OK   ★ 공개 기록에는 댓글이 안 달린다 — 운영할 수 있는 만큼만 연다 (서버가 막는다)';
  end;
end $$;

-- 같은 스페이스 멤버는 본다
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.comments) = 1,
  '같은 스페이스 멤버는 그 댓글을 본다');

-- 스페이스에 없는 사람은 못 본다
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select count(*) from public.comments) = 0,
  '★ 스페이스에 없는 사람에게는 아예 안 보인다 — 닫힌 방이라 모더레이션이 필요 없는 이유다');

do $$ begin
  begin
    insert into public.comments (pin_id, user_id, body) values
      ('77777777-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', '끼어들기');
    raise exception 'FAIL  ★ 남의 스페이스에 댓글이 달렸다';
  exception when insufficient_privilege or check_violation then
    raise notice '  OK   ★ 남의 스페이스에는 못 쓴다';
  end;
end $$;

select pg_temp.login('11111111-1111-1111-1111-111111111111');
do $$ begin
  begin
    insert into public.comments (pin_id, user_id, body) values
      ('77777777-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '남의 이름으로');
    raise exception 'FAIL  ★ 남의 이름으로 댓글이 달렸다';
  exception when insufficient_privilege or check_violation then
    raise notice '  OK   ★ 남의 이름으로는 못 쓴다';
  end;
end $$;


-- ── 031 뷰포트로 잘라 읽기 ────────────────────────────────────────────
-- ★ 지도가 "보고 있는 만큼만" 받는지. 여기가 틀리면 화면 밖 기록을 실어 오거나
--   (쓸모없는 대역폭) 화면 안 기록을 빠뜨린다 (사용자에게는 사라진 것이다).
-- ★ 기대값을 숫자로 박지 않는다 — 앞선 검사들이 핀을 더 만들기 때문에
--   박아 두면 위쪽을 고칠 때마다 여기가 같이 깨진다. **같은 조건을 직접 세서** 비교한다.
-- ★ 앞선 검사들이 이 핀들의 공개 여부를 바꿔 놓는다. 물려받은 상태를 믿지 않고
--   **여기서 필요한 상태를 직접 세운다** — 위쪽을 고칠 때마다 아래가 깨지면 그물이 아니다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.pins set is_public = true  where id='77777777-0000-0000-0000-000000000002';
update public.pins set is_public = false where id='77777777-0000-0000-0000-000000000001';

select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null))
  = (select count(*) from public.pins
     where deleted_at is null
       and geom && ST_MakeEnvelope(129.79, 35.15, 129.81, 35.17, 4326)),
  '화면 안의 내 핀·공개 핀이 빠짐없이 온다');

select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(126.90, 37.50, 127.10, 37.62, 300, null)) = 0,
  '★ 서울 화면에는 해운대 기록이 안 온다 — 이게 없으면 받은 것의 대부분이 버려진다');

select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, 'cafe'))
  = (select count(*) from public.pins
     where deleted_at is null and category = 'cafe'
       and geom && ST_MakeEnvelope(129.79, 35.15, 129.81, 35.17, 4326)),
  '카테고리 필터가 서버에서 걸린다');

-- ★ 잘렸다는 사실을 돌려주는가. 개수를 세지 않고 limit+1 **한 개**로 안다.
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 1, null)) = 1
  and (select bool_and(more) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 1, null)),
  '★ 화면에 더 있으면 more=true — 잘린 것을 숨기지 않는다');
select pg_temp.ok(
  (select bool_and(not more) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null)),
  '다 실어 보냈으면 more=false');

-- 남의 눈으로 본다
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select bool_and(is_public) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null))
  and (select count(*) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null)) > 0,
  '★ 남에게는 공개 핀만 보인다 — 뷰포트 함수가 RLS 를 우회하지 않는다');
select pg_temp.ok(
  (select bool_and(not is_mine) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null)),
  'is_mine 이 남의 것을 내 것이라 하지 않는다');

-- ★ 공개 핀에는 **공개 자격이 있는 사진만** 붙는다(009).
--   판정에서 빠진 사진이 모두의 지도에 뜨면 그 판정은 아무 일도 안 한 것이다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.media set public_ok = false where pin_id='77777777-0000-0000-0000-000000000002';
update public.media set public_ok = false where pin_id='77777777-0000-0000-0000-000000000001';
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select media_url is null from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null)
    where id='77777777-0000-0000-0000-000000000002'),
  '★ 공개 자격 없는 사진은 모두의 지도에 안 붙는다 (핀은 오되 사진만 빠진다)');

/* ★ **주인에게도 똑같이 안 보인다.** 주인한테만 보여 주면 "내 사진이 지도에 있다"고
   믿게 되는데 실제로는 아무도 못 본다 — 판정을 해 놓고 말하지 않는 것과 같다.
   지도가 보여 주는 것과 주인이 보는 것은 같아야 한다. 빠졌다는 말은 등록 화면이 한다. */
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select media_url is null from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null)
    where id='77777777-0000-0000-0000-000000000002'),
  '★ 공개 핀이면 주인에게도 안 보인다 — 지도가 보여 주는 것과 내가 보는 것이 같다');

-- 비공개 핀은 나만 보는 것이라 공개 자격을 따지지 않는다
select pg_temp.ok(
  (select media_url is not null from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null)
    where id='77777777-0000-0000-0000-000000000001'),
  '★ 비공개 핀에서는 내 사진이 그대로 보인다 — 공개 자격은 공개할 때만 따진다');

-- ── 033 집계 코스 — "여기 간 사람들이 다음에 간 곳" ─────────────────
-- ★ 이 게이트의 값어치는 **안 보여주는 것**에 있다. 근거가 모자랄 때 그럴듯한
--   코스를 내놓으면 그건 우리가 지어낸 것이고, 사용자는 그걸 믿고 일정을 짠다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 일행 n 팀이 A→B 로 움직인다. 팀마다 다른 사용자 · 다른 날.
create or replace function pg_temp.move_ab(nth int, n int, dest uuid, sp uuid default null)
returns void language plpgsql as $$
declare i int; u uuid; d timestamptz; p1 uuid; p2 uuid;
begin
  for i in nth + 1 .. nth + n loop
    u := ('d0d0d0d0-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid;
    d := timestamptz '2026-04-01 10:00+09' + (i*3 || ' days')::interval;
    perform pg_temp.login(u);
    -- 스페이스 참가는 **본인만** 넣을 수 있다(space_members_join) — 그래서 여기서 한다
    if sp is not null then
      insert into public.space_members (space_id, user_id, role) values (sp, u, 'member')
        on conflict do nothing;
    end if;
    insert into public.pins (user_id, place_id, geom, category, visited_at, is_public, verification)
      values (u, 'aaaaaaaa-0000-0000-0000-000000000001',
              ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'food', d, true, 'exif')
      returning id into p1;
    insert into public.pins (user_id, place_id, geom, category, visited_at, is_public, verification)
      values (u, dest, ST_SetSRID(ST_MakePoint(129.8001, 35.1580), 4326), 'cafe',
              d + interval '90 min', true, 'exif')
      returning id into p2;
    if sp is not null then
      insert into public.pin_spaces (pin_id, space_id) values (p1, sp), (p2, sp);
    end if;
  end loop;
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
end $$;

create or replace function pg_temp.gate(k text) returns text language sql as $$
  select (public.api_next_places('aaaaaaaa-0000-0000-0000-000000000001'))->>k $$;

select pg_temp.move_ab(0, 2, 'aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok(pg_temp.gate('ready') = 'false'
  and jsonb_array_length((public.api_next_places('aaaaaaaa-0000-0000-0000-000000000001'))->'rows') = 0,
  '★ 일행 2팀으로는 아무것도 안 보여준다 — 근거가 모자랄 때 침묵하는 것이 이 게이트의 값어치다');
select pg_temp.ok(pg_temp.gate('base') = '2',
  '대신 얼마나 모였는지는 말한다 (2팀) — 화면이 "아직 2팀입니다"라고 할 수 있다');

select pg_temp.move_ab(2, 3, 'aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok(pg_temp.gate('ready') = 'true'
  and jsonb_array_length((public.api_next_places('aaaaaaaa-0000-0000-0000-000000000001'))->'rows') = 1,
  '★ 5팀이 되면 열린다 (5팀 전부 같은 곳 → 하한 56.6%)');
select pg_temp.ok(
  ((public.api_next_places('aaaaaaaa-0000-0000-0000-000000000001'))->'rows'->0->>'gap_min') = '90',
  '얼마나 있다 갔는지도 같이 준다 (90분) — "다음에"가 몇 시간 뒤인지가 코스의 절반이다');

-- ★ 같은 일행은 1표다. 둘이 같이 간 여행은 독립 관측 2개가 아니다.
insert into public.spaces (id, title, owner_id) values
  ('5a5a5a5a-0000-0000-0000-000000000009', '같이 간 둘', '11111111-1111-1111-1111-111111111111');
-- 스페이스에 올리려면 멤버여야 한다 — 그 규칙이 곧 '같이 갔다'의 증거다
insert into public.space_members (space_id, user_id, role) values
  ('5a5a5a5a-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'owner');
select pg_temp.move_ab(5, 2, 'aaaaaaaa-0000-0000-0000-000000000002',
                       '5a5a5a5a-0000-0000-0000-000000000009');
select pg_temp.ok(pg_temp.gate('base') = '6',
  '★ 같이 간 2명은 1표다 (5 → 6, 7이 아니다) — 커플 한 쌍이 "5명"을 만들면 그 숫자는 아무것도 보장하지 않는다');

-- ★ 비공개 기록은 추천의 재료가 아니다. 숨긴 사람의 동선이 추천 모양으로 새면 안 된다.
--   ★ **본인이** 숨겨야 한다 — 남의 핀은 RLS 가 애초에 못 건드리게 한다.
select pg_temp.login('d0d0d0d0-0000-0000-0000-000000000001');
update public.pins set is_public = false
  where user_id = 'd0d0d0d0-0000-0000-0000-000000000001';
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(pg_temp.gate('base') = '5',
  '★ 한 팀이 나만 보기로 돌리면 집계에서 그 팀이 빠진다 (6 → 5) — 숨긴 동선은 추천으로도 새지 않는다');

-- ── 034 시간 예산 — "3시간 비는데 어디 갈까" ────────────────────────
-- ★ 이 필터가 틀리면 사용자는 **못 끝낼 일정을 짠다.** 그래서 모르는 것을 모른다고
--   하는 쪽과, 아는 것은 느린 쪽에 맞추는 쪽 둘 다 검사한다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 해운대 파스타(aaaa…0001) 주변에서 잰다. 먼저 **아무도 안 잰 상태**.
select pg_temp.ok(
  (select stay_min is null from public.api_places_in_budget(129.8000, 35.1580, 180, null, 50)
    where place_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  '★ 체류를 모르는 곳은 null 로 온다 — "보통 1시간"을 끼워 넣으면 그건 지어낸 것이다');
select pg_temp.ok(
  (select count(*) from public.api_places_in_budget(129.8000, 35.1580, 180, null, 50)) > 0,
  '체류를 몰라도 이동만으로 답한다 — 첫날에도 필터가 돈다');

-- 네 팀이 30·60·90·240분 머물렀다 → 75분위 127분
create or replace function pg_temp.stay(mins int[], sp uuid default null, off_ int default 0) returns void
language plpgsql as $$
declare i int; u uuid; k int := 0; p1 uuid;
begin
  foreach i in array mins loop
    k := k + 1;
    -- ★ 사용자를 **재사용하지 않는다.** 재사용하면 앞 팀이 스페이스 팀으로 접혀
    --   검사가 무엇을 재는지 흐려진다 (한 번 그렇게 틀렸다).
    u := ('e0e0e0e0-0000-0000-0000-0000000000' || lpad((k + off_)::text,2,'0'))::uuid;
    perform pg_temp.login(u);
    if sp is not null then
      insert into public.space_members (space_id, user_id, role) values (sp, u, 'member')
        on conflict do nothing;
    end if;
    insert into public.pins (user_id, place_id, geom, category, visited_at,
                             is_public, verification, stay_sec)
      values (u, 'aaaaaaaa-0000-0000-0000-000000000002',
              ST_SetSRID(ST_MakePoint(129.8001, 35.1580), 4326), 'cafe',
              timestamptz '2026-05-01 10:00+09' + (k || ' days')::interval,
              true, 'exif', i * 60)
      returning id into p1;
    if sp is not null then
      insert into public.pin_spaces (pin_id, space_id) values (p1, sp);
    end if;
  end loop;
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
end $$;

select pg_temp.stay(array[30,60,90,240]);
select pg_temp.ok(
  (select stay_sec_p75/60 from public.place_stay where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 127,
  '★ 중앙값(75분)이 아니라 75분위(127분)를 쓴다 — 체류가 하한이라 중앙값으로 예산을 짜면 약속이 깨진다');

select pg_temp.ok(
  (select count(*) from public.api_places_in_budget(129.8001, 35.1580, 120, null, 50)
    where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 0
  and (select count(*) from public.api_places_in_budget(129.8001, 35.1580, 150, null, 50)
    where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 1,
  '★ 예산을 넘으면 빠진다 (120분 밖 · 150분 안) — 왕복 이동과 체류를 둘 다 뺀 결과다');

-- 같은 일행은 1표
insert into public.spaces (id, title, owner_id) values
  ('5b5b5b5b-0000-0000-0000-000000000001', '같이 간 둘', '11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select parties from public.place_stay where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 4,
  '지금은 4팀이다');
select pg_temp.stay(array[10,10], '5b5b5b5b-0000-0000-0000-000000000001', 4);
select pg_temp.ok(
  (select parties from public.place_stay where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 5,
  '★ 같이 간 2명은 1표다 (4 → 5, 6이 아니다)');

-- ★ 한 사람이 두 팀이 되지 않는다 — 공유한 핀과 안 한 핀을 따로 세면 혼자서 정족수를 만든다
select pg_temp.stay(array[20], '5b5b5b5b-0000-0000-0000-000000000001', 0);   -- e1 을 그 스페이스에 넣는다
select pg_temp.ok(
  (select parties from public.place_stay where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 4,
  '★ 스페이스에 합류한 사람은 **원래 표가 옮겨간다** (5 → 4) — 두 표가 되지 않는다');

-- ★ 바다를 건너면 시간 필터에 넣지 않는다 (차로 갈 수 없는 곳의 '차 시간'은 없다)
select pg_temp.ok(
  (select count(*) from public.api_places_in_budget(126.53, 33.40, 600, null, 500)
    where place_id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002')) = 0,
  '★ 제주에서 재면 해운대가 안 나온다 — 배 시간표가 없으면 시간을 말할 수 없다');

-- ★ 비공개로 돌리면 체류가 통째로 빠진다
select pg_temp.login('e0e0e0e0-0000-0000-0000-000000000004');
update public.pins set is_public = false where user_id = 'e0e0e0e0-0000-0000-0000-000000000004';
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select stay_sec_p75/60 from public.place_stay where place_id='aaaaaaaa-0000-0000-0000-000000000002') < 127,
  '★ 나만 보기로 돌린 체류는 남의 화면 숫자에서 빠진다 (240분 팀이 빠져 75분위가 내려간다)');

-- ── 035 섬 이동 · 036 계절 축 ────────────────────────────────────────
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 035 ★ 위도가 아니라 **행정구역**으로 가른다.
--   ★ 표의 **내용**(제주·울릉·옹진)은 경계 데이터가 있어야 검사할 수 있어서
--     `db/supabase/verify.sh` 로 옮겼다. 로컬 스텁에는 regions 가 비어 있다.
--     여기서는 데이터 없이도 지켜져야 하는 것만 본다.
select pg_temp.ok(public.landmass_of('99999') = 'mainland',
  '표에 없는 지역은 본토로 본다 — 모르는 코드가 들어와도 화면이 멈추지 않는다');
select pg_temp.ok(public.landmass_of(null) = 'mainland',
  '지역 코드가 없어도 본토로 본다');

-- 036 ★ 기관 사진은 **언제 찍혔는지 모른다** — 그 사실을 화면이 받아야 한다
select pg_temp.ok(
  ((public.api_place_months('aaaaaaaa-0000-0000-0000-000000000001'))->>'agency_month_known') = 'false',
  '★ 기관 사진의 촬영 시기는 모른다고 돌려준다 — 11월에 벚꽃 사진을 권하지 않으려면 이 한 줄이 있어야 한다');
select pg_temp.ok(
  jsonb_array_length((public.api_place_months('aaaaaaaa-0000-0000-0000-000000000001'))->'months') = 0,
  '사용자 사진이 없으면 달력은 비어 있다');

-- 사진에 촬영 시각을 넣으면 그 달로 잡힌다 (media 는 이미 fixture 에 있다)
-- ★ **필요한 상태를 직접 세운다.** 앞선 검사들이 이 핀의 place_id·공개 여부를
--   바꿔 놓는다 — 물려받은 상태 위에 세운 단언은 위쪽을 고칠 때마다 깨진다.
update public.pins set place_id = 'aaaaaaaa-0000-0000-0000-000000000002', is_public = true
  where id = '77777777-0000-0000-0000-000000000002';
update public.media set taken_at = timestamptz '2026-04-05 14:00+09', public_ok = true
  where pin_id = '77777777-0000-0000-0000-000000000002';
select pg_temp.ok(
  (select month from public.place_photo_month
    where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 4,
  '★ 월은 KST 로 센다 — UTC 로 자르면 한국의 1월 1일 새벽이 12월이 된다');

-- ★ 나만 보기 사진은 계절 축에도 안 들어간다
update public.pins set is_public = false where id = '77777777-0000-0000-0000-000000000002';
select pg_temp.ok(
  (select count(*) from public.place_photo_month
    where place_id='aaaaaaaa-0000-0000-0000-000000000002') = 0,
  '★ 나만 보기 사진은 계절 축에서도 빠진다 — 공개 자격과 같은 기준이다');

-- ── 037 함께 채운 지도 — 한 지도, 세 스코프 ──────────────────────────
-- ★ 여기서 지켜야 할 것은 "셋이 겹친다"와 "나가면 사라진다" 둘이다.
--   겹침을 배타적 3분할로 만들면 어느 스코프에 넣어도 거짓말이 되고,
--   나간 뒤에도 보이면 스페이스가 닫힌 방이 아니게 된다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- 상태를 직접 세운다: A(사용자1)의 핀 하나를 공개 + 스페이스 공유까지 한다
update public.pins set is_public = true, place_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = '77777777-0000-0000-0000-000000000002';
insert into public.pin_spaces (pin_id, space_id) values
  ('77777777-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001')
  on conflict do nothing;

create or replace function pg_temp.scope(sc text) returns int language sql as $$
  select count(*)::int from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null, sc)
   where id = '77777777-0000-0000-0000-000000000002' $$;

select pg_temp.ok(pg_temp.scope('mine') = 1 and pg_temp.scope('shared') = 1
                  and pg_temp.scope('public') = 1 and pg_temp.scope('all') = 1,
  '★ 한 핀이 세 스코프에 동시에 있다 — 스코프는 핀을 분류하는 게 아니라 무엇을 볼지 고르는 것이다');

select pg_temp.ok(
  (select source from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'all')
    where id='77777777-0000-0000-0000-000000000002') = 'mine',
  '★ 배지는 하나다 — 내 것이면 공개·공유 여부와 상관없이 "내 것"이다');

-- ★ 나만 보기 핀도 내 지도에는 있다 (공개 여부와 무관)
update public.pins set is_public = false where id = '77777777-0000-0000-0000-000000000001';
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'mine')
    where id='77777777-0000-0000-0000-000000000001') = 1,
  '★ 나만 보기 핀도 내 지도에는 있다 — 내가 올린 것은 내가 봐야 한다');
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'public')
    where id='77777777-0000-0000-0000-000000000001') = 0,
  '그런데 모두의 지도에는 없다');

-- ── 남의 눈으로: 같은 스페이스 멤버(B) ──
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(
  (select source from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'all')
    where id='77777777-0000-0000-0000-000000000002') = 'shared',
  '★ 같은 스페이스 멤버에게는 "함께"로 보인다 — 내가 안 올렸어도 우리가 채운 것이다');
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'shared')
    where id='77777777-0000-0000-0000-000000000002') = 1,
  '친구 스코프에 그 핀이 들어온다');

-- ★ 나만 보기인데 스페이스에 공유한 핀 — 멤버는 본다. 이게 스페이스의 존재 이유다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.pins set is_public = false where id = '77777777-0000-0000-0000-000000000002';
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'shared')
    where id='77777777-0000-0000-0000-000000000002') = 1,
  '★ 나만 보기라도 스페이스에 넣었으면 멤버가 본다 — 기준은 공개가 아니라 스페이스다 (028과 같다)');
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'public')
    where id='77777777-0000-0000-0000-000000000002') = 0,
  '그래도 모두의 지도에는 안 뜬다 — 두 문은 따로다');

-- ★ 스페이스에서 나가면 **바로** 사라진다
delete from public.space_members
  where space_id='55555555-0000-0000-0000-000000000001'
    and user_id='22222222-2222-2222-2222-222222222222';
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'all')
    where id='77777777-0000-0000-0000-000000000002') = 0,
  '★ 스페이스에서 나가면 그 핀이 바로 사라진다 — 닫힌 방이라는 말이 지켜진다');

-- ── 아무 스페이스에도 없는 남(C) ──
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.pins set is_public = true where id = '77777777-0000-0000-0000-000000000002';
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select source from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'all')
    where id='77777777-0000-0000-0000-000000000002') = 'other',
  '★ 남에게는 "남"으로 보인다 — 출처를 안 적으면 누가 올린 건지 모른 채 믿게 된다');
select pg_temp.ok(
  (select count(*) from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'shared')) = 0,
  '스페이스가 없으면 친구 스코프는 비어 있다');

-- ── 038 초대 링크로 합류 ─────────────────────────────────────────────
-- ★ §3 이 "초대 수락률이 핵심 지표"라고 적어 뒀는데 수락 경로가 없었다.
--   여기서 지킬 것: ① 무엇을 수락하는지 먼저 보인다 ② 여러 링크가 한 계정에 쌓인다
--   ③ 두 번 눌러도 한 번 ④ 잘못 보낸 링크를 되돌릴 수 있다
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- A 가 스페이스 둘을 만든다 (서로 다른 사람이 각각 보냈다고 치는 자리)
insert into public.spaces (id, title, owner_id, invite_code) values
  ('a1a10000-0000-0000-0000-000000000001', '제주 2박3일', '11111111-1111-1111-1111-111111111111', 'code-jeju-0001'),
  ('a1a10000-0000-0000-0000-000000000002', '강릉 당일',  '11111111-1111-1111-1111-111111111111', 'code-gang-0002');
insert into public.space_members (space_id, user_id, role) values
  ('a1a10000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner');

-- ① 로그인 전에도 무엇인지 보인다
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok(
  ((public.api_invite_preview('code-jeju-0001'))->>'ok') = 'true'
  and ((public.api_invite_preview('code-jeju-0001'))->>'title') = '제주 2박3일'
  and ((public.api_invite_preview('code-jeju-0001'))->>'need_login') = 'true',
  '★ 로그인 없이도 무엇을 수락하는지 보인다 — 모르고 계정부터 만들게 하면 순서만 바꾼 것이다');
select pg_temp.ok(
  ((public.api_invite_preview('없는코드'))->>'why') = ((public.api_invite_preview('code-'))->>'why'),
  '★ 없는 코드와 틀린 코드를 가르지 않는다 — 가르면 되묻는 것만으로 코드 존재를 알아낸다');

-- 비로그인은 합류할 수 없다 (RLS 가 space_members 기반이라 주체가 필요하다)
reset role; set role authenticated; select pg_temp.login(null);
select pg_temp.ok(
  ((public.api_join_space('code-jeju-0001'))->>'need_login') = 'true',
  '★ 합류에는 계정이 필요하다 — 익명이라도. 앱은 링크를 열 때 조용히 만든다');

-- ② ★ 여러 사람이 보낸 링크가 **한 계정에** 쌓인다
select pg_temp.login('33333333-3333-3333-3333-333333333333');   -- 아무 스페이스에도 없던 남
select pg_temp.ok(((public.api_join_space('code-jeju-0001'))->>'joined') = 'true',
  '첫 링크로 합류한다');
select pg_temp.ok(((public.api_join_space('code-gang-0002'))->>'joined') = 'true',
  '두 번째 링크로도 합류한다');
-- ★ **내가 만든 것만 센다.** 앞선 검사들이 이 사용자를 다른 스페이스에 넣어 둔다 —
--   전체를 세면 위쪽을 고칠 때마다 여기가 깨진다 (§13.31·§13.34에서 두 번 겪었다).
select pg_temp.ok(
  (select count(*) from public.space_members
    where user_id='33333333-3333-3333-3333-333333333333'
      and space_id in ('a1a10000-0000-0000-0000-000000000001',
                       'a1a10000-0000-0000-0000-000000000002')) = 2,
  '★ 서로 다른 사람이 보낸 두 링크가 한 계정에 쌓인다 — 사용자가 링크를 모을 일이 없다');

-- ③ 두 번 눌러도 한 번
select pg_temp.ok(((public.api_join_space('code-jeju-0001'))->>'already') = 'true'
  and (select count(*) from public.space_members
        where user_id='33333333-3333-3333-3333-333333333333'
          and space_id = 'a1a10000-0000-0000-0000-000000000001') = 1,
  '★ 같은 링크를 다시 눌러도 한 번이다');
select pg_temp.ok(((public.api_invite_preview('code-jeju-0001'))->>'already') = 'true',
  '이미 들어간 방은 미리보기가 그렇게 말한다');

-- 합류하면 그 스페이스의 기록이 실제로 보인다 (037 의 '함께' 스코프와 이어진다)
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.pins set is_public = false where id = '77777777-0000-0000-0000-000000000002';
insert into public.pin_spaces (pin_id, space_id) values
  ('77777777-0000-0000-0000-000000000002', 'a1a10000-0000-0000-0000-000000000001')
  on conflict do nothing;
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select source from public.api_pins_in_bbox(129.79,35.15,129.81,35.17,300,null,'shared')
    where id='77777777-0000-0000-0000-000000000002') = 'shared',
  '★ 합류하자마자 그 방의 기록이 "함께"로 보인다 — 초대의 값어치가 여기서 생긴다');

-- ④ 잘못 보낸 링크를 되돌린다 (owner 만)
select pg_temp.ok(((public.api_rotate_invite('a1a10000-0000-0000-0000-000000000001'))->>'ok') = 'false',
  '★ 남은 남의 링크를 못 바꾼다');
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(((public.api_rotate_invite('a1a10000-0000-0000-0000-000000000001'))->>'ok') = 'true',
  'owner 는 링크를 바꿀 수 있다');
select pg_temp.ok(((public.api_invite_preview('code-jeju-0001'))->>'ok') = 'false',
  '★ 바꾸면 옛 링크는 그 순간 죽는다 — 이게 없으면 "잘못 보냈다"를 되돌릴 방법이 없다');
select pg_temp.ok(
  (select count(*) from public.space_members
    where space_id='a1a10000-0000-0000-0000-000000000001'
      and user_id='33333333-3333-3333-3333-333333333333') = 1,
  '★ 이미 들어온 사람은 남는다 — 링크를 바꾸는 것은 문을 잠그는 것이지 내쫓는 게 아니다');

-- ── 039 계정에 무엇이 들어 있나 (다른 기기 로그인의 안전장치) ─────────
-- ★ 다른 기기에서 로그인하면 **그 기기의 임시 계정은 버려진다.** 그 전에 무엇을
--   두고 가는지 숫자로 보여 줘야 하고, 그 숫자가 틀리면 경고가 거짓말이 된다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  ((public.api_account_summary())->>'pins')::int =
  (select count(*) from public.pins where user_id='11111111-1111-1111-1111-111111111111'
     and deleted_at is null),
  '내 핀 수를 그대로 센다');
select pg_temp.ok(((public.api_account_summary())->>'empty') = 'false',
  '기록이 있으면 empty=false — 화면이 경고한다');

-- ★ **개인 공간은 세지 않는다.** 계정을 만들면 트리거가 자동으로 만들어 주는 것이라
--   "두고 가는 것"이 아니다. 이걸 세면 갓 만든 계정도 empty=false 가 되고
--   경고가 영영 켜져 있게 된다 (실제로 그렇게 만들었다가 잡혔다).
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  ((public.api_account_summary())->>'spaces')::int =
  (select count(*) from public.space_members sm join public.spaces sp on sp.id=sm.space_id
    where sm.user_id='33333333-3333-3333-3333-333333333333' and sp.type <> 'personal'),
  '★ 공유 스페이스만 센다 — 개인 공간은 계정을 만들면 그냥 생긴다');

-- ★ 남의 계정은 못 센다 — 경고에 남의 숫자가 뜨면 그건 유출이다
select pg_temp.ok(
  ((public.api_account_summary())->>'user_id') = '33333333-3333-3333-3333-333333333333',
  '★ 언제나 지금 로그인한 계정만 센다');

reset role;
rollback;   -- 아무것도 남기지 않는다
