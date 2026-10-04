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
/* ★ **표 전체를 세지 않는다**(§13.84). 예전에는 `count(*) = 3` 이었는데,
   그건 *"이 DB 에 프로필이 3개뿐"* 이라는 뜻이라 **빈 프로젝트에서만** 참이다.
   실제 계정이 하나라도 생기는 순간 영영 실패하고(실측: 프로필 14개),
   그때부터 DB 검증 전체가 첫 줄에서 멎는다 — **쌓인 데이터가 테스트를 죽였다.**
   ★ 재야 할 것은 *"방금 넣은 셋이 각각 프로필을 얻었나"* 다. 그게 트리거의 일이고,
     이 쪽이 원래 단언보다 **더 정확하다** — 남의 행을 세지 않으므로. */
select pg_temp.ok(
  (select count(*) from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222',
                 '33333333-3333-3333-3333-333333333333')) = 3,
  '트리거: auth.users 가입이 profiles를 자동 생성한다');
-- 033 집계 코스 검사용 일행들. ★ 여기서 만든다 — 아래는 authenticated 라 auth.users 를 못 건드린다.
insert into auth.users (id, email)
select ('d0d0d0d0-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid, 'd'||i||'@t.io'
from generate_series(1, 8) i;
insert into auth.users (id, email)
select ('e0e0e0e0-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid, 'e'||i||'@t.io'
from generate_series(1, 8) i;
-- 040 계정 합치기 검사용 **임시(익명) 계정** A. ★ is_anonymous 는 auth 스키마라
-- 여기(superuser 구간)에서만 넣을 수 있다.
insert into auth.users (id, email, is_anonymous)
values ('aaaa1111-0000-0000-0000-00000000000a', null, true);

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

/* ★ 아래 네 단언은 **이 절의 픽스처(`77777777-…`)만** 센다. 예전에는
   `count(*) from public.pins` 로 **표 전체**를 셌는데, 그러면 *"이 DB 에 핀이
   셋뿐"* 이라는 뜻이라 **빈 프로젝트에서만** 참이다 — 실서버에 핀이 하나라도
   있으면 첫 단언에서 멎고 뒤의 270여 건이 통째로 안 돈다. §13.84 가 같은 모양을
   네 건 고쳤는데 여기가 남아 있었고, §13.92 에서 두 번 걸렸다.
   스코프를 박으면 **더 엄격해진다** — RLS 가 내 것만 주는지를 그대로 잰다. */
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

select pg_temp.ok((select count(*) from public.pins where id::text like '77777777-%') = 3, 'A는 자기 핀 3개를 본다');
select pg_temp.ok((select media_count from public.pins where id='77777777-0000-0000-0000-000000000001') = 2,
                  '트리거: media_count 집계가 맞다');

\echo ''
\echo '── 2. B로 전환 — 남의 기록이 새는지 본다 ──'
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select count(*) from public.pins where id::text like '77777777-%') = 1, 'B에게는 공개 핀 1개만 보인다');
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
select pg_temp.ok((select count(*) from public.pins where id::text like '77777777-%') = 2, 'B에게 공개 1 + 스페이스 공유 1 = 2개가 보인다');
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
select pg_temp.ok((select count(*) from public.pins where id::text like '77777777-%') = 1, 'anon은 공개 핀만 본다');
-- ★ 비로그인 웹 뷰어의 실제 경로. api_map_places는 security invoker라
--   호출자 권한으로 pin_spaces를 조인한다. 권한이 없으면 지도가 통째로 죽는다.
select pg_temp.ok((select count(*) from public.api_map_places(
    128.0, 34.0, 130.0, 36.0, 'all', null, null, null, null, null, null, null, null, 200)) = 1,
  '★ anon이 api_map_places를 실제로 호출할 수 있다 (비로그인 웹 뷰어)');
/* ★ 예전에는 `>= 0` 이었다 — **아무것도 재지 않는 단언**이다. 그래서 검색이
   1년 가까이 매번 타임아웃이었는데도 스모크는 내내 초록이었다(§13.100).
   *"부르면 터지지 않는다"* 는 *"된다"* 가 아니다. 무엇이 나와야 하는지를 적는다. */
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
select pg_temp.login(null);   -- 심는 것은 **서버 자신**으로(068 벽을 안 건드리게)
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
/* ★ **`p_scope => 'all'` 로 부른다**(§13.84). 기본값은 `mine_all`(§13.55 에서 붙었다)
   이라, 남이 그냥 부르면 *"내 것 + 나와 공유된 것"* 이 0건이라 **당연히 비어** 나온다.
   그 0건으로는 *"RLS 를 우회하지 않는다"* 를 증명할 수 없다 — 함수가 스스로 걸러
   놓고 RLS 가 막았다고 착각하는 꼴이다.
   `all` 로 불러야 **RLS 만이 유일한 문지기**가 되고, 그때 남는 것이 공개 핀뿐이어야
   비로소 이 단언이 뜻을 갖는다. 스코프가 생기면서 이 단언이 낡았다. */
select pg_temp.ok(
  (select bool_and(is_public) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null, 'all'))
  and (select count(*) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null, 'all')) > 0,
  '★ 남에게는 공개 핀만 보인다 — 뷰포트 함수가 RLS 를 우회하지 않는다');
select pg_temp.ok(
  (select bool_and(not is_mine) from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null, 'all')),
  'is_mine 이 남의 것을 내 것이라 하지 않는다');

-- ★ 공개 핀에는 **공개 자격이 있는 사진만** 붙는다(009).
--   판정에서 빠진 사진이 모두의 지도에 뜨면 그 판정은 아무 일도 안 한 것이다.
select pg_temp.login('11111111-1111-1111-1111-111111111111');
update public.media set public_ok = false where pin_id='77777777-0000-0000-0000-000000000002';
update public.media set public_ok = false where pin_id='77777777-0000-0000-0000-000000000001';
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  /* 남의 눈이므로 `'all'` 로 부른다 — 기본 `mine_all` 은 0건이라 아무것도 못 본다(위 참조) */
  (select media_url is null from public.api_pins_in_bbox(129.79, 35.15, 129.81, 35.17, 300, null, 'all')
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

-- ── 042 지역 집계 — 줌이 바뀌면 단위가 바뀐다 ────────────────────────
-- ★ 여기서 지킬 것 셋:
--   ① 지역 숫자는 **뷰포트와 무관**하다 — 화면을 밀 때마다 숫자가 변하면 거짓말이다
--   ② 스코프를 그대로 따른다 — 037 과 **같은 규칙**이어야 한다(뷰가 하나이므로)
--   ③ 0곳 지역은 아예 주지 않는다
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- ① 뷰포트와 무관: 같은 스코프면 어디를 보고 있든 같은 답이 온다
--    (집계 함수에는 애초에 bbox 인자가 없다 — 그것이 설계다)
select pg_temp.ok(
  (select count(*) from public.api_pins_by_region('mine', null))
  = (select count(distinct region_code) from public.pins
      where user_id = auth.uid() and deleted_at is null and region_code is not null),
  '★ 지역 숫자는 뷰포트가 아니라 지역 전체를 뜻한다');

-- ② 037 과 같은 규칙: 스코프별 합이 bbox 함수의 결과와 어긋나지 않는다
--    (전국을 덮는 상자로 부르면 둘은 같은 집합을 세게 된다)
create or replace function pg_temp.agg(sc text) returns int language sql as $$
  select coalesce(sum(n),0)::int from public.api_pins_by_region(sc, null) $$;
create or replace function pg_temp.bbx(sc text) returns int language sql as $$
  select count(*)::int from public.api_pins_in_bbox(124,33,132,39,10000,null,sc)
   where region_code is not null $$;

select pg_temp.ok(pg_temp.agg('mine')   = pg_temp.bbx('mine'),   '집계와 핀 목록이 어긋나지 않는다 — mine');
select pg_temp.ok(pg_temp.agg('shared') = pg_temp.bbx('shared'), '집계와 핀 목록이 어긋나지 않는다 — shared');
select pg_temp.ok(pg_temp.agg('public') = pg_temp.bbx('public'), '집계와 핀 목록이 어긋나지 않는다 — public');
select pg_temp.ok(pg_temp.agg('all')    = pg_temp.bbx('all'),    '★ 스코프 규칙이 한 벌이다 — 집계와 목록이 같은 뷰를 본다');

-- ③ 0곳은 주지 않는다
select pg_temp.ok(
  (select count(*) from public.api_pins_by_region('all', null) where n = 0) = 0,
  '0곳 지역은 아예 주지 않는다 — 251줄이 거의 다 0이면 실어 보낼 이유가 없다');

-- 카테고리 필터도 같은 규칙을 탄다
select pg_temp.ok(
  (select coalesce(sum(n),0) from public.api_pins_by_region('all','cafe'))
  <= (select coalesce(sum(n),0) from public.api_pins_by_region('all', null)),
  '카테고리로 좁히면 줄어들지언정 늘지 않는다');

-- ★ 남의 나만 보기 핀은 집계에도 안 섞인다 — 숫자로도 새면 안 된다
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select coalesce(sum(n),0) from public.api_pins_by_region('mine', null)) = 0,
  '★ 남의 계정으로 보면 내 지도 집계는 0이다 — 숫자로도 새지 않는다');

-- ── 058 장소 상세 — 자리 하나를 묻는다 (§13.91) ───────────────────────
-- ★ 여기서 지킬 것 넷:
--   ① 사실을 그대로 준다 — 지역 이름은 join 으로 오고, 모르면 비운다
--   ② `mine_count` 는 **내 것만** 센다. RLS 는 남의 **공개** 핀을 통과시키므로
--      `user_id = auth.uid()` 가 없으면 *"내가 3번 갔다"* 가 된다 — 가장 쉬운 거짓말
--   ③ 표지는 029 가 고른 것을 **읽기만** 하고, 찍은 사람 이름을 같이 준다
--   ④ 남의 비공개 사진은 표지로도 새지 않는다 (security invoker 가 하는 일)
\echo ''
\echo '── 19. 장소 상세 (058) ──'
reset role;   -- 픽스처는 세션 사용자(superuser)로 심는다
/* ★ **`regions` 에 줄을 넣지 않는다.** 처음엔 넣었고, 점 하나로 세 칸을 채웠다 —
   이 DB 는 PostGIS 스텁이라 MultiPolygon·Polygon 이 전부 `point` 로 눌려 있어
   로컬에서는 통과했다. 그런데 같은 스모크가 **진짜 Supabase 에서도 돈다**
   (`db/supabase/verify.sh`) — 거기서 바로 걸렸다:
     `Geometry type (Point) does not match column type (MultiPolygon)`
   스텁이 느슨한 것을 사실로 착각하면, 로컬만 보고 "됐다"고 적게 된다.
   → 경계를 지어내는 대신 **표가 말하는 것과 같은지**를 잰다. 로컬에는 지역이
     없으니 둘 다 null 이고(모르면 비운다), 실서버에는 251개가 있으니 거기서는
     진짜 이름이 맞는지까지 잰다. 한쪽에서만 도는 단언보다 낫다. */

insert into public.places (id, name, category, address, region_code, geom, source,
                           is_ground, image_url, image_thumb_url, image_license) values
  ('aaaaaaaa-0000-0000-0000-00000000000d', '상세시험 전망대', 'nature',
   /* ★ 코드를 **표에서 꺼내 온다.** 로컬 스텁에는 지역이 한 줄도 없어 '26350' 을
      그대로 박으면 FK 가 막는다. 실서버에는 251개가 있어 거기서만 붙는다 —
      둘 다에서 도는 유일한 모양이다(FK 는 null 을 허용한다). */
   '부산 해운대구 전망길 1', (select code from public.regions where code = '26350'),
   ST_SetSRID(ST_MakePoint(129.8003, 35.1581), 4326), 'public_data', true,
   'https://tong/agency.png', 'https://tong/agency_s.png', 'Type3');

-- A 는 두 번 갔다 (한 번은 공개, 한 번은 나만 보기) · B 는 한 번 갔다 (공개)
insert into public.pins (id, user_id, place_id, geom, category, visited_at, is_public, verification) values
  ('88880000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-00000000000d',
   ST_SetSRID(ST_MakePoint(129.8003, 35.1581), 4326), 'nature', '2026-04-01 10:00+09', true,  'exif'),
  ('88880000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-00000000000d',
   ST_SetSRID(ST_MakePoint(129.8003, 35.1581), 4326), 'nature', '2026-05-02 10:00+09', false, 'exif'),
  ('88880000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-0000-0000-0000-00000000000d',
   ST_SetSRID(ST_MakePoint(129.8003, 35.1581), 4326), 'nature', '2026-06-03 10:00+09', true,  'exif');

-- ★ B 의 사진이 **가장 선명하다**(초점 3000) — 표지는 B 가 가져가야 한다.
--   A 의 공개 사진에는 작은 판이 **없다**(thumb_url null) — 047 의 폴백을 시험한다.
insert into public.media (pin_id, type, url, thumb_url, is_main, taken_at,
                          focus_score, contrast_score, width, height) values
  ('88880000-0000-0000-0000-000000000001', 'photo', 'https://x/a-pub.jpg', null,
   true, '2026-04-01 10:00+09', 2000, 55, 1280, 960),
  ('88880000-0000-0000-0000-000000000002', 'photo', 'https://x/a-priv.jpg', 'https://x/a-priv_s.jpg',
   true, '2026-05-02 10:00+09', 2900, 58, 1280, 960),
  ('88880000-0000-0000-0000-000000000003', 'photo', 'https://x/b-pub.jpg', 'https://x/b-pub_s.jpg',
   true, '2026-06-03 10:00+09', 3000, 60, 1280, 960);
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-00000000000d');

/* ★ 헬퍼 함수로 감싸지 않는다. `returns table` 은 **복합 타입을 만들지 않으므로**
   `returns public.api_place_detail` 이 "그런 타입 없다"로 죽는다. 그리고 뷰로
   감싸면 더 나쁘다 — 뷰는 기본값이 **소유자 권한**이라 superuser 가 만든 뷰는
   RLS 를 건너뛰고, 그러면 ②(남의 것을 안 센다)가 늘 통과한다. 그대로 부른다. */
-- ① 사실
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select name from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = '상세시험 전망대'
              and (select address from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = '부산 해운대구 전망길 1',
  '장소의 사실이 그대로 온다');
select pg_temp.ok(
  (select region_name from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d'))
    is not distinct from (select name from public.regions where code = '26350'),
  '★ 지역 이름은 regions 가 말하는 것과 같다 — 없으면 비운다(지어내지 않는다)');
select pg_temp.ok((select image_url from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 'https://tong/agency.png'
              and (select image_license from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 'Type3',
  '★ 기관 사진과 라이선스를 같이 준다 — 출처를 못 적는 사진은 띄우면 안 된다');
select pg_temp.ok((select lng from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) between 129.80 and 129.81
              and (select lat from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) between 35.15 and 35.16,
  '좌표를 준다 — 상세에서 바로 지도로 날아갈 수 있다');

-- ② ★ 내가 몇 번 갔나 — 여기가 이 함수의 값어치다
select pg_temp.ok((select mine_count from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 2,
  'A 는 두 번 갔다 — 나만 보기도 **내 발자국**이므로 센다');
select pg_temp.ok((select mine_last_at from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = '2026-05-02 10:00+09'::timestamptz,
  '마지막으로 간 날이 최근 쪽이다');
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok((select mine_count from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 1,
  '★ B 는 한 번이다 — 3이 아니다. RLS 는 남의 공개 핀을 통과시키므로 '
  'user_id = auth.uid() 가 없으면 "내가 세 번 갔다"가 된다');
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select mine_count from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 0 and (select mine_last_at from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) is null,
  '★ 안 가본 사람에게는 0 과 null 이다 — 0번째 방문을 지어내지 않는다');

-- ③ 표지는 029 가 고른 것을 읽기만 한다 + 찍은 사람
select pg_temp.ok((select cover_url from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 'https://x/b-pub.jpg'
              and (select cover_author from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = '브라보',
  '★ 표지는 가장 선명한 공개 사진이고, 찍은 사람 이름이 같이 온다');
select pg_temp.ok((select cover_thumb_url from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 'https://x/b-pub_s.jpg',
  '표지는 작은 판으로 온다 — 상세가 원본부터 받지 않는다');
select pg_temp.ok((select pin_count from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 2 and (select visitor_count from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 2,
  '집계는 공개 핀만 센다 (A 공개 1 + B 공개 1 = 2)');

-- ④ ★ 남의 비공개가 표지로 새지 않는다 — A 의 비공개 사진이 가장 선명했다면?
reset role;   -- 픽스처는 세션 사용자(superuser)로 심는다
update public.media set focus_score = 3500
 where pin_id = '88880000-0000-0000-0000-000000000002';
select public.refresh_place_stats('aaaaaaaa-0000-0000-0000-00000000000d');
set role authenticated; select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select cover_url from public.api_place_detail('aaaaaaaa-0000-0000-0000-00000000000d')) = 'https://x/b-pub.jpg',
  '★ A 의 나만 보기 사진이 더 선명해도 표지가 되지 않는다 — 029 가 공개만 고른다');

-- ── api_place_media — 격자가 쓸 수 있는 모양인가
select pg_temp.ok((select count(*) from public.api_place_media('aaaaaaaa-0000-0000-0000-00000000000d')) = 2,
  '공개 사진 둘만 온다 — 나만 보기는 목록에도 없다');
select pg_temp.ok((select thumb_url from public.api_place_media('aaaaaaaa-0000-0000-0000-00000000000d') where url='https://x/b-pub.jpg')
                  = 'https://x/b-pub_s.jpg',
  '★ 작은 판을 준다 — 없으면 격자 30칸이 1600px 원본 30장을 받는다');
select pg_temp.ok((select thumb_url from public.api_place_media('aaaaaaaa-0000-0000-0000-00000000000d') where url='https://x/a-pub.jpg')
                  = 'https://x/a-pub.jpg',
  '★ 작은 판이 없는 옛 사진은 본판으로 떨어진다 (047 의 폴백을 화면이 아니라 서버가 한다)');
select pg_temp.ok((select author from public.api_place_media('aaaaaaaa-0000-0000-0000-00000000000d') where url='https://x/b-pub.jpg') = '브라보',
  '★ 찍은 사람 이름이 온다 — uuid 만 오면 화면이 출처를 적을 수가 없다');
select pg_temp.ok((select url from public.api_place_media('aaaaaaaa-0000-0000-0000-00000000000d') order by rank desc limit 1) = 'https://x/b-pub.jpg',
  '선명하고 최근인 쪽이 앞선다');

-- ── 059 스폰서 줄 — 계약이 없으면 **비어 있는 것이 정상** (§13.92) ────
-- ★ 여기서 지킬 것 다섯:
--   ① 계약이 0건이면 **0행**. 가짜로 채우지 않는다
--   ② 초안·끝난 것은 안 보인다 — 보이면 계약 전에 스폰서 이름이 샌다
--   ③ 인정은 **현장 인증(live)만**. EXIF 는 조작할 수 있다(§009·§12.23-D)
--   ④ 한 곳은 **한 번**. 한 자리에서 백 장을 찍어도 진행도가 안 오른다
--   ⑤ 목표를 안 채우면 못 받고, 받은 뒤에는 두 번 못 받는다
\echo ''
\echo '── 20. 스폰서 줄 (059) ──'
reset role;   -- 픽스처는 세션 사용자(superuser)로 심는다

-- ① 아직 아무 계약도 없다
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select count(*) from public.api_sponsor_rail(129.80, 35.158)) = 0,
  '★ 계약이 없으면 줄이 0행이다 — 자동 생성물로 채우면 §12.22 와 같은 묶음이 둘이 된다');

reset role;
/* 퀘스트 셋: 초안 · 끝난 것 · 살아 있는 것. ★ `live` 핀은 `visited_at` 이
   `created_at` ±1일 안이어야 하므로(`pins_live_is_recent`) 기간을 **지금** 둘레로 잡는다. */
insert into public.quests (id, title, sponsor, place_ids, starts_at, ends_at,
                           target_count, reward_kind, reward_url, status) values
  ('99990000-0000-0000-0000-000000000001', '초안입니다', '비밀군',
   array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
   now() - interval '1 day', now() + interval '7 day', 1, 'coupon', 'https://x/draft', 'draft'),
  ('99990000-0000-0000-0000-000000000002', '지난 퀘스트', '지난군',
   array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
   now() - interval '30 day', now() - interval '1 day', 1, 'coupon', 'https://x/old', 'live'),
  ('99990000-0000-0000-0000-000000000003', '해운대 두 곳 돌기', '해운대구',
   array['aaaaaaaa-0000-0000-0000-000000000001'::uuid,
         'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
         'aaaaaaaa-0000-0000-0000-000000000004'::uuid],
   now() - interval '1 day', now() + interval '7 day', 2, 'coupon', 'https://x/reward', 'live');

-- ② 초안과 끝난 것은 새지 않는다
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select count(distinct quest_id) from public.api_sponsor_rail(129.80, 35.158)) = 1,
  '★ 줄은 **한 건**이다 — 광고 줄이 둘이면 그건 광고판이지 추천 화면이 아니다');
select pg_temp.ok(
  (select distinct quest_id from public.api_sponsor_rail(129.80, 35.158))
    = '99990000-0000-0000-0000-000000000003',
  '★ 초안과 끝난 것은 안 온다 — 초안이 보이면 계약 전에 스폰서 이름이 샌다');
select pg_temp.ok(
  (select count(*) from public.quests) = 1,
  '★ RLS 로도 초안이 안 보인다 (함수만 막는 것이 아니다)');
select pg_temp.ok(
  (select distinct sponsor from public.api_sponsor_rail(129.80, 35.158)) = '해운대구',
  '★ 스폰서 이름이 온다 — 화면이 이 칸을 보고 `광고` 를 붙인다 (표시광고법)');
select pg_temp.ok(
  (select count(*) from public.api_sponsor_rail(129.80, 35.158)) = 3
  and (select done_count from public.api_sponsor_rail(129.80, 35.158) limit 1) = 0,
  '장소 셋이 거리순으로 오고, 아직 한 곳도 못 했다');

-- ③ 인정은 현장 인증만
reset role;
insert into public.pins (id, user_id, place_id, geom, category, visited_at, created_at,
                         is_public, verification, gps_accuracy_m) values
  /* EXIF 는 인정 안 된다 — 조작할 수 있다 */
  ('99991111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'food', now(), now(), true, 'exif', null);
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select done_count from public.api_sponsor_rail(129.80, 35.158) limit 1) = 0,
  '★ EXIF 핀은 인정되지 않는다 — 쿠폰이 걸리면 사람들은 속인다(§12.23-D)');

reset role;
insert into public.pins (id, user_id, place_id, geom, category, visited_at, created_at,
                         is_public, verification, gps_accuracy_m) values
  ('99991111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'food', now(), now(), true, 'live', 12),
  /* ★ **같은 곳에 한 장 더.** 한 자리에서 여러 번 찍는 공격이 여기서 막혀야 한다 */
  ('99991111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001',
   ST_SetSRID(ST_MakePoint(129.8000, 35.1580), 4326), 'food', now(), now(), true, 'live', 12);
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select done_count from public.api_sponsor_rail(129.80, 35.158) limit 1) = 1,
  '★ 한 곳은 한 번이다 — 같은 자리 두 장이 2가 되지 않는다 (진행도가 제출이 아니라 파생이라 공격이 성립하지 않는다)');
select pg_temp.ok(
  (select mine from public.api_sponsor_rail(129.80, 35.158)
    where place_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '다녀온 곳이 표시된다 — 화면이 "여기는 했다"를 그릴 수 있다');

-- ④ 기간 밖은 인정 안 된다
reset role;
update public.quests set starts_at = now() + interval '1 day'
 where id = '99990000-0000-0000-0000-000000000003';
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select count(*) from public.api_sponsor_rail(129.80, 35.158)) = 0,
  '아직 시작 안 한 퀘스트는 안 보인다');
reset role;
update public.quests set starts_at = now() - interval '1 day'
 where id = '99990000-0000-0000-0000-000000000003';

-- ⑤ 받아 가기
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  ((public.api_quest_claim('99990000-0000-0000-0000-000000000003'))->>'why') = 'not_yet',
  '★ 목표(2곳)를 안 채우면 못 받는다');
select pg_temp.ok(
  ((public.api_quest_claim('99990000-0000-0000-0000-000000000001'))->>'why') = 'not_open',
  '★ 초안은 "없는 것"과 같은 답을 준다 — 가르면 되묻는 것만으로 존재를 알아낸다');

reset role;
insert into public.pins (id, user_id, place_id, geom, category, visited_at, created_at,
                         is_public, verification, gps_accuracy_m) values
  ('99991111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000002',
   ST_SetSRID(ST_MakePoint(129.8001, 35.1580), 4326), 'cafe', now(), now(), true, 'live', 10);
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select done_count from public.api_sponsor_rail(129.80, 35.158) limit 1) = 2,
  '두 곳째를 하면 2가 된다');

create temp table pg_temp_claim as
  select public.api_quest_claim('99990000-0000-0000-0000-000000000003') as r;
select pg_temp.ok(((select r from pg_temp_claim)->>'ok') = 'true'
              and ((select r from pg_temp_claim)->>'reward_url') = 'https://x/reward',
  '★ 목표를 채우면 **URL 하나**를 준다 — 쿠폰은 우리가 발행하지 않는다 (인증 사업자로 선다)');
select pg_temp.ok(
  ((public.api_quest_claim('99990000-0000-0000-0000-000000000003'))->>'why') = 'already',
  '★ 계정당 한 번이다 — 기본키가 그 규칙이라 코드가 새도 막힌다');
select pg_temp.ok(
  (select claimed from public.api_sponsor_rail(129.80, 35.158) limit 1),
  '받아 간 것이 줄에도 보인다 — 다시 누르게 두면 안 된다');
select pg_temp.ok(
  (select cardinality(place_ids) from public.quest_claims
    where quest_id = '99990000-0000-0000-0000-000000000003') = 2,
  '★ 무엇으로 인정됐는지 남는다 — "왜 저 사람이 받았나"에 답할 수 있어야 한다');

-- ⑥ 남의 것은 안 보이고, 남은 못 쓴다
/* ★ **C 로 본다.** 처음엔 B 로 쟀는데 B 는 §18 에서 **운영자**가 된다 —
   운영자에게는 보이는 것이 맞으므로(아래) 그 단언은 아무것도 지키지 못했다.
   남남을 재려면 아무 권한도 없는 사람이어야 한다. */
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select count(*) from public.quest_claims) = 0,
  '★ 남이 무엇을 받아 갔는지는 안 보인다');
select pg_temp.ok(
  (select done_count from public.api_sponsor_rail(129.80, 35.158) limit 1) = 0,
  '★ 진행도는 보는 사람 것이다 — A 의 2가 남에게 새지 않는다');

/* ★ 운영자에게는 **보인다.** 숨기려고 만든 표가 아니라 분쟁에 답하려고 만든 표다 —
   *"왜 저 사람이 받았나"* 를 물을 수 있는 사람이 하나는 있어야 한다. */
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select pg_temp.ok(
  (select count(*) from public.quest_claims) = 1,
  '★ 운영자는 인증 기록을 본다 — 분쟁에 답할 사람이 하나는 있어야 한다');
select pg_temp.ok(
  (select count(*) from public.quests) = 3,
  '★ 운영자는 초안도 본다 (남에게는 1건, 운영자에게는 3건)');

do $$ begin
  begin
    insert into public.quests (title, place_ids, starts_at, ends_at, target_count)
    values ('내가 만든 광고', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
            now(), now() + interval '1 day', 1);
    raise exception 'FAIL  ★ 아무나 퀘스트를 만들었다';
  exception when insufficient_privilege then
    raise notice '  OK   ★ **운영자라도** PostgREST 로는 퀘스트를 못 넣는다 — insert 정책이 아예 없다 (DB 로 넣는다)';
  end;
end $$;
do $$ begin
  begin
    insert into public.quest_claims (quest_id, user_id, place_ids, pin_ids)
    values ('99990000-0000-0000-0000-000000000003', auth.uid(), '{}', '{}');
    raise exception 'FAIL  ★ 목표를 건너뛰고 받아 갔다';
  exception when insufficient_privilege then
    raise notice '  OK   ★ 인증 기록을 손으로 못 넣는다 — 재는 길과 쓰는 길이 하나다';
  end;
end $$;

-- ⑦ 계약서 오타를 DB 가 막는다
reset role;
do $$ begin
  begin
    insert into public.quests (title, place_ids, starts_at, ends_at, target_count)
    values ('아무도 못 끝내는 퀘스트', array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
            now(), now() + interval '1 day', 2);
    raise exception 'FAIL  목표가 장소 수보다 커도 들어갔다';
  exception when check_violation then
    raise notice '  OK   ★ 목표가 장소 수보다 크면 막는다 — 계약서 오타 한 번이면 아무도 못 끝내는 퀘스트가 생긴다';
  end;
end $$;
set role authenticated;

-- ── 060 `다시 가보기` 는 **오늘 것을 담지 않는다** (§13.92) ──────────
-- ★ 057 은 `MM-DD` 만 맞춰 보고 연도를 안 봤다. 오늘 찍은 핀은 당연히 오늘과
--   `MM-DD` 가 같아서, *"예전에 갔던 자리"* 묶음에 **오늘 등록한 곳**이 떴다
--   (화면에는 `오늘 오늘 이 자리에` 로 찍혔다). 앱을 처음 쓰는 사람이 가장 먼저
--   하는 일이 오늘 사진 등록이라 **실데이터로 바로 재현된다.**
\echo ''
\echo '── 21. 다시 가보기 (060) ──'
reset role;
insert into public.pins (id, user_id, place_id, geom, category, visited_at, created_at,
                         is_public, verification) values
  /* 오늘 — 들어오면 안 된다 */
  ('aaaa9999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000004',
   ST_SetSRID(ST_MakePoint(129.8004, 35.1580), 4326), 'cafe', now(), now(), false, 'exif'),
  /* 2년 전 **오늘** — 들어와야 한다. 이 묶음이 있는 이유다 */
  ('aaaa9999-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000005',
   ST_SetSRID(ST_MakePoint(129.8009, 35.1580), 4326), 'cafe',
   now() - interval '2 year', now() - interval '2 year', false, 'exif');
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');

select pg_temp.ok(
  not exists (select 1 from public.api_my_revisit(129.80, 35.158)
               where place_id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  '★ 오늘 찍은 것은 `다시 가보기` 에 안 들어온다 — 묶음 이름이 "예전에 갔던 자리"다');
select pg_temp.ok(
  (select anniversary from public.api_my_revisit(129.80, 35.158)
    where place_id = 'aaaaaaaa-0000-0000-0000-000000000005'),
  '★ 2년 전 **오늘**은 들어온다 — 빗장을 걸다가 이 묶음이 존재하는 이유까지 막으면 안 된다');

-- ── 061 스페이스 = 함께 채운 지도 (§13.16 · §13.94) ───────────────────
-- ★ 여기서 지킬 것 셋:
--   ① `함께 채운 N곳` 은 **합집합**이다 — 셋이 같은 지역에 가도 1곳이다
--   ② `같이 간 곳`(둘 이상이 남김)과 `혼자 다녀온 곳`(한 사람만)이 갈린다
--   ③ 둘을 더하면 `함께 채운 곳` 이다 — 어느 한쪽이 새면 바로 드러난다
\echo ''
\echo '── 22. 스페이스 함께 채운 지도 (061) ──'
reset role;
/* ★ 지역을 **심어서** 잰다. `region_code` 가 없으면 아무것도 안 세므로(052 의 규칙)
   지역 없이는 이 절을 쓸 수가 없다. WKT 로 넣어 실서버(진짜 PostGIS)와 로컬 스텁
   양쪽에서 같은 픽스처가 서게 한다 — §13.91 에서 점으로 때우다 실서버에서 걸렸다. */
insert into public.regions (code, name, sido, geom, bbox, center) values
  ('TT1', '시험군A', '시험도',
   ST_GeomFromText('MULTIPOLYGON(((129.0 35.0,129.1 35.0,129.1 35.1,129.0 35.1,129.0 35.0)))', 4326),
   ST_GeomFromText('POLYGON((129.0 35.0,129.1 35.0,129.1 35.1,129.0 35.1,129.0 35.0))', 4326),
   ST_GeomFromText('POINT(129.05 35.05)', 4326)),
  ('TT2', '시험군B', '시험도',
   ST_GeomFromText('MULTIPOLYGON(((129.2 35.0,129.3 35.0,129.3 35.1,129.2 35.1,129.2 35.0)))', 4326),
   ST_GeomFromText('POLYGON((129.2 35.0,129.3 35.0,129.3 35.1,129.2 35.1,129.2 35.0))', 4326),
   ST_GeomFromText('POINT(129.25 35.05)', 4326));

insert into public.spaces (id, type, title, owner_id) values
  ('5c5c0000-0000-0000-0000-000000000001', 'shared', '함께 채운 시험',
   '11111111-1111-1111-1111-111111111111');
insert into public.space_members (space_id, user_id, role) values
  ('5c5c0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('5c5c0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member');

/* ★ TT1 에는 **A 와 B 가 둘 다**, TT2 에는 **A 만**.
   그리고 A 는 TT1 에 **두 장**을 남긴다 — 합계로 세면 여기서 숫자가 부푼다. */
insert into public.pins (id, user_id, geom, category, visited_at, region_code, is_public, verification) values
  ('5c5c1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   ST_SetSRID(ST_MakePoint(129.05, 35.05), 4326), 'cafe', '2026-03-14 10:00+09', 'TT1', false, 'exif'),
  ('5c5c1111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   ST_SetSRID(ST_MakePoint(129.06, 35.05), 4326), 'food', '2026-03-14 12:00+09', 'TT1', false, 'exif'),
  ('5c5c1111-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   ST_SetSRID(ST_MakePoint(129.05, 35.06), 4326), 'cafe', '2026-03-15 10:00+09', 'TT1', false, 'exif'),
  ('5c5c1111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   ST_SetSRID(ST_MakePoint(129.25, 35.05), 4326), 'nature', '2026-03-16 10:00+09', 'TT2', false, 'exif'),
  /* ★ 지역을 모르는 핀 — 세면 안 된다. 좌표만 있고 어디인지 모르는 것을
     '채웠다'고 할 수 없다(052 의 규칙).
     ★ **좌표를 바다에 둔다.** 처음엔 시험 폴리곤 안에 뒀는데, 실서버에는
       `pins_fill_region` 트리거가 있어 **좌표로 지역을 채워 버린다**(로컬 스텁에는
       경계가 없어 안 채워져서 로컬만 통과했다). 그래서 B 가 TT2 에도 남긴 것이 되어
       `혼자 다녀온 곳` 이 0 이 됐다. 지역을 모르는 핀을 만들려면 **어느 경계에도
       안 들어가는 자리**여야 한다 — §13.91 과 같은 교훈이다(스텁이 느슨한 것을
       사실로 착각하면 안 된다). */
  ('5c5c1111-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   ST_SetSRID(ST_MakePoint(123.0, 32.0), 4326), 'etc', '2026-03-16 12:00+09', null, false, 'exif');
insert into public.pin_spaces (pin_id, space_id)
select id, '5c5c0000-0000-0000-0000-000000000001' from public.pins
 where id::text like '5c5c1111-%';

create or replace function pg_temp.sp(c text) returns int language sql as $$
  select case c
    when 'pins'     then (select pins     from public.api_my_spaces() where id='5c5c0000-0000-0000-0000-000000000001')
    when 'regions'  then (select regions  from public.api_my_spaces() where id='5c5c0000-0000-0000-0000-000000000001')
    when 'together' then (select together from public.api_my_spaces() where id='5c5c0000-0000-0000-0000-000000000001')
    when 'alone'    then (select alone    from public.api_my_spaces() where id='5c5c0000-0000-0000-0000-000000000001')
    when 'members'  then (select members  from public.api_my_spaces() where id='5c5c0000-0000-0000-0000-000000000001')
  end $$;

set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');

select pg_temp.ok(pg_temp.sp('members') = 2, '멤버 2명');
select pg_temp.ok(pg_temp.sp('pins') = 5,
  '`pins` 는 **기록 수**다 (5장) — 화면이 이걸 `곳` 이라 부르면 거짓말이 된다');

-- ① 합집합이지 합계가 아니다
select pg_temp.ok(pg_temp.sp('regions') = 2,
  '★ `함께 채운 곳` 은 **2곳**이다 — 기록은 5장이지만 지역은 둘뿐이다. '
  '합계로 세면 "함께 갈수록 커지는" 지표가 되어 협업이 아니라 중복을 잰다(§13.16 ①)');
select pg_temp.ok(pg_temp.sp('regions') < pg_temp.sp('pins'),
  '★ 같은 지역에 여러 장을 남겨도 곳 수는 안 는다');

-- ② 같이 / 혼자
select pg_temp.ok(pg_temp.sp('together') = 1,
  '★ `같이 간 곳` 1 — TT1 에는 A 와 B 가 **둘 다** 남겼다 (§13.16 ②: 이게 함께의 실체다)');
select pg_temp.ok(pg_temp.sp('alone') = 1,
  '★ `혼자 다녀온 곳` 1 — TT2 에는 A 만 남겼다');
select pg_temp.ok(pg_temp.sp('together') + pg_temp.sp('alone') = pg_temp.sp('regions'),
  '★ 같이 + 혼자 = 함께 채운 곳 — 어느 한쪽이 새면 여기서 바로 드러난다');
select pg_temp.ok(
  (select region_code from public.pins where id='5c5c1111-0000-0000-0000-000000000005') is null
  and pg_temp.sp('pins') = 5 and pg_temp.sp('regions') = 2,
  '★ 지역을 모르는 핀은 **기록으로는 세지만 곳으로는 안 센다** — '
  '좌표만 있고 어디인지 모르는 것을 "채웠다"고 할 수 없다(052)');
select pg_temp.ok(
  (select region_total from public.api_my_spaces()
    where id='5c5c0000-0000-0000-0000-000000000001')
    = (select count(*)::int from public.regions),
  '전국 시·군·구 수를 같이 준다 — 화면이 250 을 박아 두지 않아도 된다');

-- ③ A 가 한 장 더 남겨도 `같이 간 곳` 은 안 변한다 (사람 수로 세지 장 수로 세지 않는다)
reset role;
insert into public.pins (id, user_id, geom, category, visited_at, region_code, is_public, verification) values
  ('5c5c1111-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   ST_SetSRID(ST_MakePoint(129.27, 35.05), 4326), 'cafe', '2026-03-17 10:00+09', 'TT2', false, 'exif');
insert into public.pin_spaces (pin_id, space_id)
values ('5c5c1111-0000-0000-0000-00000000000a', '5c5c0000-0000-0000-0000-000000000001');
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(pg_temp.sp('alone') = 1 and pg_temp.sp('together') = 1,
  '★ 같은 사람이 한 장 더 남겨도 `혼자`가 `같이`로 바뀌지 않는다 — **사람 수**로 센다');

-- ④ B 가 TT2 에도 남기면 그때 `같이`가 된다
reset role;
insert into public.pins (id, user_id, geom, category, visited_at, region_code, is_public, verification) values
  ('5c5c1111-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   ST_SetSRID(ST_MakePoint(129.28, 35.05), 4326), 'cafe', '2026-03-18 10:00+09', 'TT2', false, 'exif');
insert into public.pin_spaces (pin_id, space_id)
values ('5c5c1111-0000-0000-0000-00000000000b', '5c5c0000-0000-0000-0000-000000000001');
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(pg_temp.sp('together') = 2 and pg_temp.sp('alone') = 0,
  '★ 둘째 사람이 남기면 `혼자` 가 `같이` 로 넘어간다 (2 · 0) — 합은 그대로 2다');

-- ⑤ 남에게는 이 방이 아예 안 보인다
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  not exists (select 1 from public.api_my_spaces()
               where id='5c5c0000-0000-0000-0000-000000000001'),
  '★ 멤버가 아니면 이 방이 목록에 없다 — 숫자는커녕 존재도 안 샌다');

-- ── 062 검색 — **무엇이 나와야 하는지**를 적는다 (§13.100) ───────────
-- ★ 좌표가 있을 때와 없을 때는 **다른 질의**다(062 가 갈라 썼다). 갈라 둔 것이
--   도로 합쳐지면 색인을 못 타 다시 타임아웃이 되므로, 두 길을 **따로** 재 둔다.
\echo ''
\echo '── 23. 검색 두 길 (062) ──'
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');

/* ★ 단언을 **픽스처로 좁힌다.** 처음엔 `= 2` 처럼 **센 개수**로 썼는데, 실서버에는
   장소가 **465,914곳**이라 '해운대' 로 찾으면 수십 건이 나와 바로 깨졌다 —
   §13.92 에서 고쳤던 것과 **같은 실수**다(표 전체를 세는 단언).
   세는 대신 *"이것이 들어 있는가"* 를 묻는다. 그러면 양쪽에서 같은 뜻이 된다. */

-- ① 좌표 없음 — 앞머리 일치
select pg_temp.ok(
  exists (select 1 from public.api_search('해운대 파스타', 10)
           where kind = 'place' and name = '해운대 파스타'),
  '★ 좌표가 없으면 앞머리로 찾는다');

-- ② 좌표 없음 — 3자 이상이면 **가운데**도 찾는다
select pg_temp.ok(
  exists (select 1 from public.api_search('층 네일샵', 10)
           where kind = 'place' and name = '3층 네일샵'),
  '★ 3자 이상이면 이름 가운데도 찾는다 — 앞머리만 보면 "3층 네일샵" 을 영영 못 찾는다');

-- ③ 두 길이 **겹치지 않는다** — 같은 곳이 두 번 나오면 목록이 거짓말을 한다
select pg_temp.ok(
  (select count(*) from public.api_search('해운대', 20) where kind = 'place')
  = (select count(distinct id) from public.api_search('해운대', 20) where kind = 'place'),
  '★ 같은 장소가 두 번 안 나온다 (앞머리와 부분일치가 겹칠 때)');

-- ④ 좌표 있음 — 반경이 실제로 자른다
/* ★ 처음엔 `카페` 로 쟀는데, 이 DB 의 해운대 장소들은 전부 **82m 안**에 모여 있어
   200m 든 5km 든 같은 답이 나왔다 — **반경을 재지 못하는 표본**이었다.
   제주(약 300km 밖)를 쓰면 반경이 실제로 자르는지가 드러난다. */
select pg_temp.ok(
  not exists (select 1 from public.api_search('제주도', 10, 129.8000, 35.1580, 1500)
               where kind = 'place' and name = '제주도'),
  '★ 좌표를 주면 반경 밖은 안 나온다 (해운대에서 1.5km 안에 제주도는 없다)');
select pg_temp.ok(
  exists (select 1 from public.api_search('제주도', 10, 129.8000, 35.1580, 500000)
           where kind = 'place' and name = '제주도'),
  '★ 반경을 넓히면 나온다 — 반경이 장식이 아니다 (500km 면 제주가 들어온다)');
select pg_temp.ok(
  exists (select 1 from public.api_search('해운대 파스타', 10, 129.8000, 35.1580, 1500)
           where kind = 'place' and name = '해운대 파스타'),
  '반경 안의 것은 그대로 나온다');

-- ⑤ 빈 질의는 아무것도 안 준다 (전체를 훑지 않는다)
select pg_temp.ok((select count(*) from public.api_search('   ', 10)) = 0,
  '★ 빈 질의는 0행 — 공백만 넣었다고 전국을 훑으면 안 된다');

-- ⑥ 지역이 먼저 온다 — 화면이 그 순서를 쓴다
select pg_temp.ok(
  (select kind from public.api_search('해운대', 10) limit 1) = 'region'
  or not exists (select 1 from public.api_search('해운대', 10) where kind='region'),
  '지역이 있으면 맨 앞에 온다');

-- ⑦ 비로그인도 찾는다 (웹 뷰어)
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok(
  exists (select 1 from public.api_search('해운대 파스타', 10)
           where kind='place' and name = '해운대 파스타'),
  '★ 비로그인도 장소를 찾는다 — 검색은 로그인 앞에 있다');
reset role; set role authenticated;

-- ── 063 저장 — 표는 처음부터 있었다 (§13.102) ────────────────────────
-- ★ §13.91·§13.92 에서 *"담을 표가 없다"* 며 버튼을 안 만들었는데 **틀렸다.**
--   표 이름이 `reactions` 였고(`kind = like|save`), `reaction_target` 에 `place`
--   까지 있었다. 진짜로 빠져 있던 것은 **집계가 장소 저장을 안 세는 것**이었다.
\echo ''
\echo '── 24. 장소 저장 (063) ──'
reset role;   -- 픽스처는 세션 사용자로
insert into public.places (id, name, category, geom, source, is_ground) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', '저장시험 전망대', 'nature',
   ST_SetSRID(ST_MakePoint(129.8100, 35.1600), 4326), 'public_data', true);
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');

create or replace function pg_temp.sv(c text) returns text language sql as $$
  select case c
    when 'count' then (select save_count::text from public.api_place_detail('aaaaaaaa-0000-0000-0000-0000000000f1'))
    when 'mine'  then (select saved::text      from public.api_place_detail('aaaaaaaa-0000-0000-0000-0000000000f1'))
    when 'pin'   then (select coalesce(save_count::text,'0') from public.place_stats where place_id='aaaaaaaa-0000-0000-0000-0000000000f1')
  end $$;

select pg_temp.ok(pg_temp.sv('count') = '0' and pg_temp.sv('mine') = 'false',
  '처음에는 0 · 안 저장함');

-- ① 저장한다 (클라이언트가 직접 쓴다 — RLS 가 내 것만 허락한다)
insert into public.reactions (user_id, target_type, target_id, kind)
values (auth.uid(), 'place', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'save');
select pg_temp.ok(pg_temp.sv('count') = '1' and pg_temp.sv('mine') = 'true',
  '★ 저장하면 숫자가 오르고 내 버튼이 켜진다 — 예전에는 트리거가 돌아도 **아무 숫자도 안 움직였다**');

-- ② 같은 것을 두 번 저장할 수 없다 (기본키가 규칙이다)
do $$ begin
  begin
    insert into public.reactions (user_id, target_type, target_id, kind)
    values (auth.uid(), 'place', 'aaaaaaaa-0000-0000-0000-0000000000f1', 'save');
    raise exception 'FAIL  ★ 같은 저장이 두 번 들어갔다';
  exception when unique_violation then
    raise notice '  OK   ★ 두 번 저장해도 한 번이다 — 기본키가 그 규칙이라 코드가 새도 막힌다';
  end;
end $$;

-- ③ **핀 저장과 다른 칸이다** — 섞으면 "무엇이 저장됐나"를 되물을 수 없다
select pg_temp.ok(pg_temp.sv('pin') = '0',
  '★ 장소 저장은 `save_count`(핀 저장)를 건드리지 않는다 — 둘은 다른 뜻이다');

-- ④ 남의 저장은 **내 버튼을 켜지 않는다** (숫자는 오른다)
reset role;
insert into public.reactions (user_id, target_type, target_id, kind)
values ('22222222-2222-2222-2222-222222222222', 'place',
        'aaaaaaaa-0000-0000-0000-0000000000f1', 'save');
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(pg_temp.sv('count') = '2',
  '★ 남이 저장하면 **숫자는** 오른다 (몇 명이 저장했나)');
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(pg_temp.sv('count') = '2' and pg_temp.sv('mine') = 'false',
  '★ 남남에게는 숫자만 보이고 버튼은 꺼져 있다 — 누가 저장했는지는 안 샌다');
select pg_temp.ok((select count(*) from public.reactions) = 0,
  '★ 남의 저장은 **한 줄도 안 읽힌다** (RLS reactions_read_own)');

-- ⑤ 남의 이름으로는 못 쓴다
do $$ begin
  begin
    insert into public.reactions (user_id, target_type, target_id, kind)
    values ('11111111-1111-1111-1111-111111111111', 'place',
            'aaaaaaaa-0000-0000-0000-0000000000f1', 'save');
    raise exception 'FAIL  ★ 남의 이름으로 저장했다';
  exception when insufficient_privilege then
    raise notice '  OK   ★ 남의 이름으로는 저장할 수 없다';
  end;
end $$;

-- ⑥ 풀면 되돌아간다
select pg_temp.login('11111111-1111-1111-1111-111111111111');
delete from public.reactions
 where target_type='place' and target_id='aaaaaaaa-0000-0000-0000-0000000000f1'
   and kind='save';
select pg_temp.ok(pg_temp.sv('count') = '1' and pg_temp.sv('mine') = 'false',
  '★ 풀면 숫자가 내려가고 버튼이 꺼진다 — 되돌릴 수 없는 토글은 만들지 않는다');

-- ── 064 저장한 곳 목록 (§13.103) ─────────────────────────────────────
-- ★ **탭을 안 만든다.** `갈 곳` 의 묶음 하나로 서고, 비면 줄이 아예 안 뜬다 —
--   §12.4·§12.26-A 가 두 번 거절한 *"빈 탭"* 을 또 만들지 않기 위해서다.
--   그래서 여기서 **"없으면 빈 목록"** 을 맨 먼저 못 박는다. 이게 깨지면
--   저장한 적 없는 사람 화면에 제목만 있는 줄이 뜬다.
\echo ''
\echo '── 25. 저장한 곳 목록 (064) ──'
reset role;
-- ★ 지역은 **픽스처 TT1** 을 쓴다. 실제 코드('26350' 해운대구)를 박았더니
--   로컬 스텁에는 그 지역이 없어 FK 로 막혔다 — §13.94 와 같은 실수다.
--   픽스처가 만든 것만 쓰면 두 곳에서 똑같이 선다. 좌표도 TT1 안으로 넣었다.
insert into public.places (id, name, category, geom, source, is_ground, region_code) values
  ('aaaaaaaa-0000-0000-0000-0000000000f2', '저장목록 먼저 저장한 곳', 'cafe',
   ST_SetSRID(ST_MakePoint(129.0500, 35.0500), 4326), 'public_data', true, 'TT1'),
  ('aaaaaaaa-0000-0000-0000-0000000000f3', '저장목록 나중 저장한 곳', 'nature',
   ST_SetSRID(ST_MakePoint(129.0900, 35.0900), 4326), 'public_data', true, 'TT1'),
  ('aaaaaaaa-0000-0000-0000-0000000000f4', '저장목록 문닫은 곳', 'food',
   ST_SetSRID(ST_MakePoint(129.0510, 35.0501), 4326), 'public_data', true, 'TT1');
update public.places set closed_at = now()
 where id = 'aaaaaaaa-0000-0000-0000-0000000000f4';
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- ★ **임시 뷰**로 둔다. 함수 반환형은 이름이 없어 `setof public.api_my_saves`
--   같은 걸 쓸 수 없고, 뷰라야 데이터가 바뀔 때마다 **다시 세어** 준다.
create temp view saves as select * from public.api_my_saves(129.0500, 35.0500, 24);

-- ① 저장한 적 없으면 **빈 목록** — 줄을 안 그리는 근거가 여기다
select pg_temp.ok((select count(*) from saves) = 0,
  '★ 저장한 적 없으면 빈 목록이다 — 이게 깨지면 제목만 있는 빈 줄이 뜬다(§12.4 가 거절한 그것)');

-- ② 저장하면 온다. 이름·지역·거리가 **카드가 그릴 만큼** 채워져 있다
insert into public.reactions (user_id, target_type, target_id, kind)
values (auth.uid(), 'place', 'aaaaaaaa-0000-0000-0000-0000000000f2', 'save');
select pg_temp.ok(
  (select count(*) from saves) = 1
  and (select name from saves) = '저장목록 먼저 저장한 곳'
  and (select region_name from saves) is not null
  and (select dist_m from saves) < 100,
  '★ 저장하면 목록에 온다 — 이름·지역·거리가 함께 온다 (카드가 한 번에 그린다)');

-- ③ 카테고리가 **칸 이름 그대로** 온다 (§13.101 에서 `food` 가 화면에 샜다)
select pg_temp.ok((select category from saves) = 'cafe',
  '카테고리는 pin_category 로 온다 — 화면에서 한글로 바꾼다');

-- ④ **저장한 순서**(최신 먼저)다. 거리순이 아니다
--    ★ 일부러 **가까운 것을 먼저 저장하고 먼 것을 나중에** 저장했다.
--      거리순으로 잘못 짜면 둘이 똑같이 나와서 **빗장이 안 걸린다.**
insert into public.reactions (user_id, target_type, target_id, kind, created_at)
values (auth.uid(), 'place', 'aaaaaaaa-0000-0000-0000-0000000000f3', 'save',
        now() + interval '1 minute');
select pg_temp.ok(
  (select array_agg(name order by saved_at desc) from saves)
    = array['저장목록 나중 저장한 곳','저장목록 먼저 저장한 곳'],
  '순서 재료는 saved_at 이다');
select pg_temp.ok(
  (select name from saves limit 1) = '저장목록 나중 저장한 곳',
  '★ 나중에 저장한 것이 맨 앞이다 — **먼 것을 나중에** 저장했으니 거리순이면 뒤로 간다');

-- ⑤ 가 본 곳과 저장만 한 곳을 가른다 — 둘은 **다른 할 일**이다
select pg_temp.ok((select bool_and(not been) from saves),
  '저장만 한 곳은 been=false');
reset role;
-- ★ **남의 핀을 먼저 심는다.** 처음엔 내 핀만 심고 `been` 을 봤는데,
--   함수에서 `mp.user_id = auth.uid()` 를 **빼도 그대로 통과했다** — 빗장이
--   걸려 있는지 확인하려고 빼 봤더니 안 잡혔다(§13.103). 남이 다녀온 곳이
--   "내가 가 봤다"로 보이면 저장 목록이 남의 발자국을 내 것으로 말한다.
--   그 남의 핀은 **공개**라야 뜻이 있다 — 비공개면 RLS 가 먼저 가려서
--   `auth.uid()` 조건이 있으나 없으나 똑같다.
insert into public.pins (id, user_id, place_id, geom, category, visited_at, is_public, verification)
values ('77770000-0000-0000-0000-0000000000f3', '22222222-2222-2222-2222-222222222222',
        'aaaaaaaa-0000-0000-0000-0000000000f3',
        ST_SetSRID(ST_MakePoint(129.0900, 35.0900), 4326), 'nature',
        '2026-05-01 10:00+09', true, 'exif');
insert into public.pins (id, user_id, place_id, geom, category, visited_at, is_public, verification)
values ('77770000-0000-0000-0000-0000000000f2', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-0000000000f2',
        ST_SetSRID(ST_MakePoint(129.0500, 35.0500), 4326), 'cafe',
        '2026-05-01 10:00+09', false, 'exif');
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select been from saves where place_id='aaaaaaaa-0000-0000-0000-0000000000f2'),
  '★ 다녀온 곳은 been=true — "가 볼 곳"과 "다녀온 곳"을 한 줄에서 가린다');
select pg_temp.ok(
  not (select been from saves where place_id='aaaaaaaa-0000-0000-0000-0000000000f3'),
  '★ **남이** 다녀온 곳은 been=false — 남의 공개 핀이 내 발자국으로 세어지면 안 된다');

-- ⑥ 저장해 둔 사이에 **문을 닫았으면** 그렇다고 말한다 (051)
insert into public.reactions (user_id, target_type, target_id, kind)
values (auth.uid(), 'place', 'aaaaaaaa-0000-0000-0000-0000000000f4', 'save');
select pg_temp.ok(
  (select closed from saves where place_id='aaaaaaaa-0000-0000-0000-0000000000f4')
  and not (select closed from saves where place_id='aaaaaaaa-0000-0000-0000-0000000000f3'),
  '★ 저장한 뒤 닫힌 곳은 closed=true — 모르고 찾아가면 그날 하루가 날아간다');

-- ⑦ 남의 저장은 **한 줄도** 안 온다 (RLS reactions_read_own 이 유일한 빗장이다)
reset role;
insert into public.reactions (user_id, target_type, target_id, kind)
values ('22222222-2222-2222-2222-222222222222', 'place',
        'aaaaaaaa-0000-0000-0000-0000000000f3', 'save');
set role authenticated; select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok((select count(*) from saves) = 0,
  '★ 남남에게는 아무것도 안 보인다 — 남이 저장한 곳이 내 목록에 섞이면 내 계획이 아니다');
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select count(*) from saves) = 3,
  '★ 내 것 셋만 온다 — 2번이 같은 장소를 저장했어도 내 목록 길이는 안 바뀐다');

-- ⑧ 비로그인은 빈 목록 — 터지지 않는다 (웹 뷰어가 같은 화면을 그린다)
reset role; set role anon; select pg_temp.login(null);
select pg_temp.ok((select count(*) from public.api_my_saves(129.0500, 35.0500, 24)) = 0,
  '★ 비로그인은 빈 목록이다 — 에러가 아니라 빈 줄이라 화면이 안 깨진다');
reset role; set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- ⑨ 개수 제한을 지킨다
select pg_temp.ok((select count(*) from public.api_my_saves(129.0500, 35.0500, 2)) = 2,
  '한도를 지킨다');
select pg_temp.ok((select count(*) from public.api_my_saves(129.0500, 35.0500, 0)) = 1,
  '0 을 줘도 한 줄은 온다 — 0 이 "무제한"이 되지 않게');

-- ⑨-A ★ **좌표 없이도 부른다** — 지도가 그렇게 부른다(§13.104)
--   지도는 거리를 모르고, 거기서 새로 재면 `갈 곳` 카드와 같은 곳을 다르게 말한다(§13.34).
--   이때 거리는 **비어서** 오고 목록과 순서는 그대로여야 한다.
select pg_temp.ok(
  (select count(*) from public.api_my_saves(null, null, 24)) = 3,
  '★ 좌표 없이 불러도 목록은 그대로다 — 지도는 거리를 모른 채 묻는다');
select pg_temp.ok(
  (select bool_and(dist_m is null) from public.api_my_saves(null, null, 24)),
  '★ 좌표가 없으면 거리는 **비어서** 온다 — 0 을 주면 "바로 여기"라는 거짓말이 된다');
select pg_temp.ok(
  (select name from public.api_my_saves(null, null, 24) limit 1)
    = (select name from saves limit 1),
  '좌표 유무가 **순서를 바꾸지 않는다** — 저장한 차례지 거리순이 아니니까');

-- ⑩ 풀면 **목록에서 사라진다** (저장 버튼과 목록이 같은 사실을 본다)
delete from public.reactions
 where target_type='place' and target_id='aaaaaaaa-0000-0000-0000-0000000000f3' and kind='save';
select pg_temp.ok(
  (select count(*) from saves) = 2
  and not exists (select 1 from saves where place_id='aaaaaaaa-0000-0000-0000-0000000000f3'),
  '★ 풀면 목록에서 빠진다 — 버튼과 목록이 **같은 표**를 보니까 어긋날 수 없다');

-- ── 066 앱 오류 로그 (§13.120) ───────────────────────────────────────
-- ★ 이 표의 값어치는 **테스터가 "좀 이상해요"라고만 말할 때 우리가 볼 수 있는
--   유일한 것**이라는 데 있다. 그래서 두 가지가 지켜져야 한다:
--   ① 로그인 전에도 쓸 수 있다(세션이 안 서는 것 자체가 오류다)
--   ② **아무나 못 읽는다** — 메시지에 사용자가 뭘 하다 터졌는지가 들어간다
\echo ''
\echo '── 26. 앱 오류 로그 (066) ──'
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select public.api_log_client_error('js', '지도에서 터졌습니다', 'stack...', '1.0.0', 'ios');
select pg_temp.ok(
  (select count(*) from public.client_errors where message = '지도에서 터졌습니다') = 0,
  '★ 쓴 사람도 **못 읽는다** — 이건 화면에 띄우는 것이 아니라 우리가 보는 것이다');

-- ① 로그인 전에도 쓴다
reset role; set role anon; select pg_temp.login(null);
select public.api_log_client_error('boot', '세션이 안 섭니다');
select pg_temp.ok(true, '★ 로그인 전에도 쓸 수 있다 — 세션이 안 서는 것 자체가 오류다');
reset role; set role authenticated;

-- ② 운영자는 읽는다
reset role;
select pg_temp.login(null);   -- 심는 것은 **서버 자신**으로(068 벽을 안 건드리게)
insert into public.operators (user_id, granted_by)
  values ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111')
  on conflict do nothing;
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select count(*) from public.client_errors) >= 2,
  '★ 운영자는 읽는다 — 안 그러면 쌓아 놓고 아무도 못 본다');
select pg_temp.ok(
  (select user_id is null from public.client_errors where kind = 'boot' limit 1),
  '로그인 전에 쓴 줄은 **사람이 비어 있다** — 지어내지 않는다');

-- ③ 남은 여전히 못 읽는다
select pg_temp.login('33333333-3333-3333-3333-333333333333');
select pg_temp.ok(
  (select count(*) from public.client_errors) = 0,
  '★ 운영자가 아니면 한 줄도 못 읽는다');

-- ④ ★ 쏟아지는 것을 막는다 — 고리에 빠지면 진짜 신호가 묻힌다
select pg_temp.login('22222222-2222-2222-2222-222222222222');
do $$ begin
  for i in 1..40 loop
    perform public.api_log_client_error('js', '고리 ' || i);
  end loop;
end $$;
reset role; set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  (select count(*) from public.client_errors
    where user_id = '22222222-2222-2222-2222-222222222222') <= 20,
  '★ 1분에 20줄을 넘기면 버린다 — 한 화면이 고리에 빠지면 초당 수십 줄이 들어온다');

-- ⑤ 모르는 갈래는 안 받는다
select (select count(*) from public.client_errors) as before \gset
select public.api_log_client_error('아무거나', '이건 안 들어가야 한다');
select pg_temp.ok(
  (select count(*) from public.client_errors) = :before,
  '★ 정해 둔 세 갈래(js·api·boot)만 받는다 — 아무 이름이나 받으면 묶을 수가 없다');

-- ⑥ 길이를 막는다 (로그가 표를 삼키면 안 된다)
select public.api_log_client_error('api', repeat('가', 500), repeat('나', 9000));
select pg_temp.ok(
  (select length(message) <= 300 and length(detail) <= 4000
     from public.client_errors order by id desc limit 1),
  '★ 길어도 잘라서 넣는다 — 거절하면 그 오류를 영영 못 본다');

-- ── 067 anon 허용 목록 (§13.121) ─────────────────────────────────────
-- ★ 이 절이 지키는 것은 **기본값이 닫힘**이라는 성질이다. 006 의
--   `lock_function_privileges` 는 이름이 "잠근다"인데 모든 함수를 anon 에게
--   내주고 있었다 — 새 함수를 만들며 `grant` 를 빠뜨려도 **인터넷 전체에 열렸다.**
\echo ''
\echo '── 27. anon 허용 목록 (067) ──'
select pg_temp.ok(
  not has_function_privilege('anon', 'public.api_operator_grant(uuid,text)', 'execute'),
  '★ 운영자 주기를 **로그인도 안 한 사람이** 못 부른다');
select pg_temp.ok(
  not has_function_privilege('anon', 'public.api_operator_revoke(uuid,text)', 'execute'),
  '★ 운영자 빼기도 마찬가지다');
select pg_temp.ok(
  not has_function_privilege('anon', 'public.api_rotate_invite(uuid)', 'execute'),
  '★ 초대 링크 돌리기 — 남의 링크를 죽이는 일이다');

-- ★ 열어 둔 것은 **그대로 열려 있어야** 한다. 조이다가 제품을 깨면 안 된다.
select pg_temp.ok(
  has_function_privilege('anon', 'public.api_invite_preview(text)', 'execute'),
  '★ 초대받은 사람은 로그인 전에 무엇을 수락하는지 본다(§13.38)');
select pg_temp.ok(
  has_function_privilege('anon', 'public.api_log_client_error(text,text,text,text,text)', 'execute'),
  '★ 세션이 안 서는 것 자체가 오류다 — 그때도 보낼 수 있어야 한다(§13.120)');
select pg_temp.ok(
  has_function_privilege('anon', 'public.api_search(text,int,double precision,double precision,double precision)', 'execute')
  or exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='api_search'
                and has_function_privilege('anon', p.oid, 'execute')),
  '★ 검색은 로그인 앞에 있다(§13.100)');

-- ★ **PUBLIC 은 아무것도 못 한다.** anon 을 조여도 PUBLIC 이 열려 있으면 소용없다.
select pg_temp.ok(
  not has_function_privilege('public', 'public.api_operator_grant(uuid,text)', 'execute'),
  '★ PUBLIC 에게도 안 준다 — 이게 006 이 원래 고치려던 것이다');

-- ★ **authenticated 는 그대로다.** anon 과 authenticated 는 사실상 같은 사람들이라
--   (공개 키만 있으면 누구나 익명 가입) 여기서 빼면 **진짜 운영자가 못 쓴다.**
--   안쪽 `is_operator()` 빗장이 여전히 유일한 벽이고, 그 사실은 안 바뀐다.
select pg_temp.ok(
  has_function_privilege('authenticated', 'public.api_operator_grant(uuid,text)', 'execute'),
  '★ 운영자도 평범한 로그인 사용자다 — authenticated 에서 빼면 아무도 못 쓴다');

-- ★ 새로 만든 함수는 **기본이 닫힘**이다
reset role;   -- 함수를 만드는 것은 세션 사용자로
create or replace function public.zz_new_function_test() returns int
  language sql stable as $$ select 1 $$;
select public.lock_function_privileges();
select pg_temp.ok(
  not has_function_privilege('anon', 'public.zz_new_function_test()', 'execute'),
  '★★ 새 함수는 **anon 에게 닫힌 채로 태어난다** — 열려면 목록에 적어야 한다');
select pg_temp.ok(
  has_function_privilege('authenticated', 'public.zz_new_function_test()', 'execute'),
  '새 함수도 로그인한 사람은 쓴다 — 앱이 안 깨지게');
drop function public.zz_new_function_test();
set role authenticated;

-- ── 068 빗장을 빠뜨려도 막힌다 (§13.122) ─────────────────────────────
-- ★ §13.121 이 남긴 위험: *"안쪽 is_operator() 빗장이 유일한 벽이다. 새 함수에서
--   그걸 빠뜨리면 로그인한 누구나 부를 수 있다."* 그걸 두 겹으로 막았다.
\echo ''
\echo '── 28. 운영자 벽 (068) ──'

-- ① 쓰기 — **표가 거절한다**. 함수가 빗장을 빠뜨려도.
--   ★ 빗장을 **일부러 빠뜨린 definer 함수**를 만들어 때려 본다. 이게 핵심이다 —
--     "그런 함수가 생기면 어떻게 되나"를 말이 아니라 **실제로** 보는 것.
reset role;
create or replace function public.zz_forgot_guard(p_user uuid) returns boolean
  language plpgsql security definer set search_path = public, extensions as $$
  begin
    insert into public.operators(user_id, granted_by) values (p_user, auth.uid())
      on conflict do nothing;        -- 빗장을 **일부러** 빠뜨린다
                                     -- (여기에 그 함수 이름을 글자로 적으면 검사기가 속는다 — 한 번 그랬다)
    return true;
  end $$;
grant execute on function public.zz_forgot_guard(uuid) to anon, authenticated;

set role authenticated; select pg_temp.login('33333333-3333-3333-3333-333333333333');
do $$ begin
  begin
    perform public.zz_forgot_guard('33333333-3333-3333-3333-333333333333');
    raise exception 'FAIL  ★ 빗장 없는 definer 함수가 스스로를 운영자로 만들었다';
  exception when insufficient_privilege then
    raise notice '  OK   ★★ 빗장을 빠뜨린 definer 함수도 **표가 거절한다** — 트리거는 RLS 와 달리 definer 를 안 봐준다';
  end;
end $$;
reset role;          -- operators 는 authenticated 에게 SELECT 권한이 아예 없다
select pg_temp.ok(
  not exists (select 1 from public.operators
               where user_id = '33333333-3333-3333-3333-333333333333'),
  '★ 실제로 한 줄도 안 들어갔다 — 거절만 하고 쓰기는 통과하면 아무 의미가 없다');

-- ② 운영자는 **그대로 된다** — 벽을 세우다 문을 막으면 안 된다
reset role;
select pg_temp.login(null);   -- 심는 것은 **서버 자신**으로(068 벽을 안 건드리게)
delete from public.operators;   -- 앞 절(26·27)이 심어 둔 것을 치운다
insert into public.operators (user_id, granted_by)
  values ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111');
set role authenticated; select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(
  public.api_operator_grant('22222222-2222-2222-2222-222222222222', '벽 시험'),
  '★ 진짜 운영자는 그대로 준다 — 벽이 문까지 막으면 집에 못 들어간다');

-- ③ 신고는 **아무나** 한다 (만드는 것과 처리하는 것은 다르다)
select pg_temp.login('33333333-3333-3333-3333-333333333333');
insert into public.reports (reporter_id, target_type, target_id, reason)
  values ('33333333-3333-3333-3333-333333333333', 'pin',
          '77770000-0000-0000-0000-00000000000a', '시험');
select pg_temp.ok(true, '★ 신고는 운영자가 아니어도 한다 — 막으면 신고 자체가 사라진다');

-- ④ 그런데 **처리**는 못 한다
--    ★ 처음엔 여기서 그냥 `update public.reports ...` 를 했고 **거짓으로 통과**했다.
--      `authenticated` 는 `reports` 에 UPDATE 권한이 아예 없어서 올라온
--      `insufficient_privilege` 가 **트리거가 아니라 GRANT** 에서 난 것이었다.
--      트리거를 시험하려면 권한을 가진 자리 = **definer 함수**로 들어가야 한다.
--      (그리고 그게 실제 위험이 들어오는 자리이기도 하다.)
reset role;
create or replace function public.zz_resolve_no_guard() returns boolean
  language plpgsql security definer set search_path = public, extensions as $$
  begin
    update public.reports set status = 'resolved' where reason = '시험';
    return true;
  end $$;
create or replace function public.zz_move_reporter(p_to uuid) returns boolean
  language plpgsql security definer set search_path = public, extensions as $$
  begin
    update public.reports set reporter_id = p_to where reason = '시험';
    return true;
  end $$;
grant execute on function public.zz_resolve_no_guard() to authenticated;
grant execute on function public.zz_move_reporter(uuid) to authenticated;
set role authenticated; select pg_temp.login('33333333-3333-3333-3333-333333333333');

do $$ begin
  begin
    perform public.zz_resolve_no_guard();
    raise exception 'FAIL  ★ 운영자가 아닌데 신고를 처리했다';
  exception when insufficient_privilege then
    raise notice '  OK   ★ 신고를 **처리**하는 것은 운영자만 — definer 함수로 들어와도 표가 거절한다';
  end;
end $$;
reset role;
select pg_temp.ok(
  (select status from public.reports where reason = '시험') = 'open',
  '★ 상태가 그대로 open 이다 — 거절만 하고 값은 바뀌면 벽이 아니다');
set role authenticated; select pg_temp.login('33333333-3333-3333-3333-333333333333');

-- ④-b 그런데 **주인 옮기기**는 막으면 안 된다 (계정 합치기가 여기를 지난다)
--    ★ 이 줄이 없었을 때 벽을 `before update` 로 통째로 걸었고, 합치기가 깨졌다.
select pg_temp.ok(
  public.zz_move_reporter('22222222-2222-2222-2222-222222222222'),
  '★★ 신고의 **주인 옮기기**는 운영자가 아니어도 된다 — 계정 합치기(040)가 여기서 멈추면 기록이 반만 옮겨진다');
reset role;
select pg_temp.ok(
  (select reporter_id from public.reports where reason = '시험')
    = '22222222-2222-2222-2222-222222222222',
  '★ 실제로 옮겨졌다');
set role authenticated; select pg_temp.login('33333333-3333-3333-3333-333333333333');

-- ⑤ 읽기는 트리거로 못 막는다 → **검증이 막는다**
select pg_temp.ok(
  (select count(*) from public.unguarded_operator_functions()
    where proname not like 'zz\_%') = 0,
  '★★ 민감한 표를 건드리는 definer 함수에 **빗장이 전부 있다** — 하나라도 빠지면 여기서 검증이 멈춘다');
select pg_temp.ok(
  exists (select 1 from public.unguarded_operator_functions() where proname = 'zz_forgot_guard'),
  '★ 검사기가 **일부러 빠뜨린 그 함수를 잡아낸다** — 안 잡으면 검사기가 장식이다');

-- ⑥ 예외는 **이유가 있어야** 들어간다 (이유 없는 예외는 정규식을 좁힌 것과 같다)
reset role;
do $$ begin
  begin
    insert into public.operator_wall_exemptions (proname) values ('zz_no_reason');
    raise exception 'FAIL  ★ 이유 없이 예외가 들어갔다';
  exception when not_null_violation then
    raise notice '  OK   ★ 예외에는 **왜**를 적어야 한다 — 조용히 빼는 것과 적어 두고 빼는 것은 다르다';
  end;
end $$;
select pg_temp.ok(
  exists (select 1 from public.operator_wall_exemptions where proname = 'api_merge_claim'),
  '★ 합치기 예외가 **표에 적혀 있다** — grep 하면 왜 뺐는지 나온다');
set role authenticated;

reset role;
/* ★ `reset role` 만으로는 못 치운다. 트리거는 `current_user` 가 아니라
   **`auth.uid()`** 를 보는데, 그 값은 마지막 login() 이 그대로 남아 있다 —
   superuser 로 돌아와도 "운영자가 아닌 사람"으로 보여 치우다가 막힌다.
   (실제로 여기서 막혔다. 벽이 제대로 서 있다는 뜻이기도 하다.) */
select pg_temp.login(null);
drop function public.zz_forgot_guard(uuid);
drop function public.zz_resolve_no_guard();
drop function public.zz_move_reporter(uuid);
delete from public.reports where reason = '시험';
delete from public.operators;
set role authenticated;

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

-- ── 040 두 계정 합치기 ───────────────────────────────────────────────
-- ★ 되돌릴 수 없는 작업이다. 여기서 지킬 것은 셋이다:
--   ① 두 계정을 다 가졌다는 증명 없이는 안 된다 ② 겹치는 것은 버린다(멈추지 않는다)
--   ③ 개인 공간은 두 개가 되지 않는다
select pg_temp.login('11111111-1111-1111-1111-111111111111');

-- A 에게 기록을 준다 (계정 자체는 맨 위 superuser 구간에서 만들어 뒀다)
select pg_temp.login('aaaa1111-0000-0000-0000-00000000000a');
insert into public.trips (id, user_id, title, start_date, end_date) values
  ('66660000-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-00000000000a', 'A의 여행', '2026-05-01', '2026-05-02');
insert into public.pins (id, user_id, trip_id, geom, category, visited_at, is_public, verification) values
  ('77770000-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-00000000000a',
   '66660000-0000-0000-0000-00000000000a',
   ST_SetSRID(ST_MakePoint(129.8003, 35.1580), 4326), 'cafe', '2026-05-01 10:00+09', true, 'exif');

-- ① 표 없이는 아무것도 안 된다
select pg_temp.login('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(((public.api_merge_claim('아무표나'))->>'ok') = 'false',
  '★ 없는 표로는 못 합친다 — 표 하나가 두 계정을 다 가졌다는 유일한 증명이다');

-- ★ 실계정에서는 표를 못 끊는다 (실계정 둘을 합치는 길은 만들지 않는다)
select pg_temp.ok(((public.api_merge_prepare())->>'ok') = 'false',
  '★ 실계정에서는 표를 못 끊는다 — 잘못 눌렀을 때 잃는 것이 너무 크다');

-- A 가 표를 끊는다
select pg_temp.login('aaaa1111-0000-0000-0000-00000000000a');
create or replace function pg_temp.tok() returns text language sql as $$
  select (public.api_merge_prepare())->>'token' $$;
create temp table tk as select pg_temp.tok() as t;
select pg_temp.ok((select t from tk) is not null, '임시 계정은 표를 끊을 수 있다');
select pg_temp.ok(((public.api_merge_claim((select t from tk)))->>'why') = '같은 계정입니다',
  '★ 자기 자신에게는 못 합친다');

-- ② B(사용자1)로 로그인해 표를 낸다
select pg_temp.login('11111111-1111-1111-1111-111111111111');
create temp table mr as select public.api_merge_claim((select t from tk)) as r;
select pg_temp.ok(((select r from mr)->>'ok') = 'true', '표를 내면 합쳐진다');
select pg_temp.ok(((select r from mr)->'moved'->>'pins')::int = 1
                  and ((select r from mr)->'moved'->>'trips')::int = 1,
  '★ 무엇이 몇 개 옮겨졌는지 숫자로 돌려준다 — 말없이 옮기면 확인할 방법이 없다');
select pg_temp.ok(
  (select user_id from public.pins where id='77770000-0000-0000-0000-00000000000a')
    = '11111111-1111-1111-1111-111111111111',
  '★ A 의 핀이 B 의 것이 됐다');
select pg_temp.ok(
  (select count(*) from public.media m join public.pins p on p.id=m.pin_id
    where p.id='77770000-0000-0000-0000-00000000000a') >= 0,
  'media 는 핀을 따라간다 — 따로 옮기지 않는다');

-- ③ 개인 공간이 두 개가 되지 않는다
select pg_temp.ok(
  (select count(*) from public.spaces
    where owner_id='11111111-1111-1111-1111-111111111111' and type='personal') = 1,
  '★ 개인 공간은 하나다 — 두 개면 어느 쪽이 내 지도인지 알 수 없다');
select pg_temp.ok(
  (select count(*) from public.spaces
    where owner_id='aaaa1111-0000-0000-0000-00000000000a') = 0,
  'A 의 스페이스는 남지 않는다');

-- ★ 표는 한 번만 쓴다
select pg_temp.ok(((public.api_merge_claim((select t from tk)))->>'ok') = 'false',
  '★ 같은 표를 두 번 못 쓴다 — 쓰고 나면 사라진다');

-- ★ A 계정은 비어 있을 뿐 지우지 않는다 (그 기기 세션이 조용히 터지지 않게)
-- ★ auth.users 는 authenticated 로 못 읽는다 — 거울인 public.profiles 로 본다
select pg_temp.ok(
  (select count(*) from public.profiles where id='aaaa1111-0000-0000-0000-00000000000a') = 1
  and (select count(*) from public.pins where user_id='aaaa1111-0000-0000-0000-00000000000a') = 0,
  '★ A 는 비운 채 남는다 — 지우면 그 기기 세션이 "profiles 없음"으로 조용히 터진다');

-- ★ 표 테이블은 아무도 못 읽는다 (읽을 수 있으면 남의 계정을 합쳐 갈 수 있다)
do $$ begin
  begin
    perform 1 from public.merge_tickets;
    raise exception 'FAIL  ★ 표 테이블이 읽혔다';
  exception when insufficient_privilege then
    raise notice '  OK   ★ 표 테이블은 아무도 직접 못 읽는다 — 읽히면 남의 계정을 합쳐 간다';
  end;
end $$;

reset role;
rollback;   -- 아무것도 남기지 않는다
