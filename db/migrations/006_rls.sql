-- =====================================================================
-- TRIPPIC · 006 Row Level Security
-- 원칙: 기본은 '나만'. 공개는 언제나 명시적 선택의 결과다. PLAN §8
-- =====================================================================

alter table public.profiles       enable row level security;
alter table public.spaces         enable row level security;
alter table public.space_members  enable row level security;
alter table public.trips          enable row level security;
alter table public.trip_spaces    enable row level security;
alter table public.pins           enable row level security;
alter table public.pin_spaces     enable row level security;
alter table public.media          enable row level security;
alter table public.reactions      enable row level security;
alter table public.region_progress enable row level security;
alter table public.reports        enable row level security;

-- ---------------------------------------------------------------------
-- ★ 권한부터 좁힌다
--   Supabase는 public 스키마의 기본권한으로 anon·authenticated에게
--   모든 테이블 all 권한을 준다. RLS만 방어선으로 두지 않는다.
--   여기서 전부 회수하고, 아래에서 필요한 것만 다시 준다.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- 참조 데이터는 전부 공개 읽기 (쓰기는 service_role만)
alter table public.regions     enable row level security;
alter table public.places      enable row level security;
alter table public.place_stats enable row level security;

create policy regions_read     on public.regions     for select using (true);
create policy places_read      on public.places      for select using (true);
create policy place_stats_read on public.place_stats for select using (true);

-- 사용자가 없는 장소를 직접 추가하는 경로 (source='user'). PLAN §6.5 B
create policy places_insert_own on public.places for insert
  with check (auth.uid() is not null and source = 'user' and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- 프로필 — 공개 읽기(프로필 지도 때문에), 본인만 수정
--   home_geom은 절대 노출하면 안 되므로 컬럼 권한으로 막는다
-- ---------------------------------------------------------------------
create policy profiles_read on public.profiles for select
  using (deleted_at is null);
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

revoke select on public.profiles from anon, authenticated;
grant select (id, handle, nickname, profile_img, personal_space_id, theme, created_at)
  on public.profiles to anon, authenticated;
grant update (handle, nickname, profile_img, theme, home_geom)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 스페이스 — 멤버만. 링크 공개 스페이스는 웹 뷰어가 service_role로 읽는다
-- ---------------------------------------------------------------------
create policy spaces_read on public.spaces for select
  using (deleted_at is null and (owner_id = auth.uid() or public.is_space_member(id)));
create policy spaces_insert on public.spaces for insert
  with check (owner_id = auth.uid());
create policy spaces_update_owner on public.spaces for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy space_members_read on public.space_members for select
  using (user_id = auth.uid() or public.is_space_member(space_id));
-- 초대 수락: 본인 행만 넣을 수 있다. 초대 코드 검증은 RPC에서 한다
create policy space_members_join on public.space_members for insert
  with check (user_id = auth.uid());
create policy space_members_leave on public.space_members for delete
  using (user_id = auth.uid()
         or exists (select 1 from public.spaces s
                    where s.id = space_id and s.owner_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 여행 — 본인 것 + 스페이스로 공유된 것
-- ---------------------------------------------------------------------
create or replace function public.trip_shared_with_me(p_trip uuid)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.trip_spaces ts
    join public.space_members m on m.space_id = ts.space_id
    where ts.trip_id = p_trip and m.user_id = auth.uid());
$$;

create policy trips_read on public.trips for select
  using (deleted_at is null and (user_id = auth.uid() or public.trip_shared_with_me(id)));
create policy trips_write on public.trips for insert with check (user_id = auth.uid());
create policy trips_update on public.trips for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy trips_delete on public.trips for delete using (user_id = auth.uid());

create policy trip_spaces_read on public.trip_spaces for select
  using (public.is_space_member(space_id)
         or exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
create policy trip_spaces_write on public.trip_spaces for insert
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
              and public.is_space_member(space_id));
create policy trip_spaces_delete on public.trip_spaces for delete
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 기록 — 이 앱의 핵심 경계
--   공개된 것 / 내 것 / 내가 속한 스페이스에 공유된 것
-- ---------------------------------------------------------------------
create policy pins_read on public.pins for select
  using (
    deleted_at is null
    and (is_public or user_id = auth.uid() or public.pin_shared_with_me(id))
  );
create policy pins_insert on public.pins for insert with check (user_id = auth.uid());
create policy pins_update on public.pins for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 실제 삭제는 앱에서 deleted_at 갱신으로 한다 (공유 타임라인 보호)
create policy pins_delete on public.pins for delete using (user_id = auth.uid());

create policy pin_spaces_read on public.pin_spaces for select
  using (public.is_space_member(space_id)
         or exists (select 1 from public.pins p where p.id = pin_id and p.user_id = auth.uid()));
create policy pin_spaces_write on public.pin_spaces for insert
  with check (exists (select 1 from public.pins p where p.id = pin_id and p.user_id = auth.uid())
              and public.is_space_member(space_id));
create policy pin_spaces_delete on public.pin_spaces for delete
  using (exists (select 1 from public.pins p where p.id = pin_id and p.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 미디어 — 핀의 가시성을 그대로 따른다
--   하위 질의에도 RLS가 걸리므로 보이는 핀의 미디어만 통과한다
-- ---------------------------------------------------------------------
create policy media_read on public.media for select
  using (exists (select 1 from public.pins p where p.id = pin_id));
create policy media_write on public.media for insert
  with check (exists (select 1 from public.pins p
                      where p.id = pin_id and p.user_id = auth.uid()));
create policy media_update on public.media for update
  using (exists (select 1 from public.pins p
                 where p.id = pin_id and p.user_id = auth.uid()));
create policy media_delete on public.media for delete
  using (exists (select 1 from public.pins p
                 where p.id = pin_id and p.user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 반응 — 집계는 공개, 누가 눌렀는지는 본인만
-- ---------------------------------------------------------------------
create policy reactions_read_own on public.reactions for select
  using (user_id = auth.uid());
create policy reactions_write on public.reactions for insert
  with check (user_id = auth.uid());
create policy reactions_delete on public.reactions for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 커버리지 — 본인 것 + 내가 속한 스페이스
-- ---------------------------------------------------------------------
create policy region_progress_read on public.region_progress for select
  using (
    (scope_type = 'user'  and scope_id = auth.uid())
    or (scope_type = 'space' and public.is_space_member(scope_id))
  );

-- ---------------------------------------------------------------------
-- 신고 — 본인이 낸 것만 조회
-- ---------------------------------------------------------------------
create policy reports_insert on public.reports for insert
  with check (reporter_id = auth.uid());
create policy reports_read_own on public.reports for select
  using (reporter_id = auth.uid());

-- ---------------------------------------------------------------------
-- 익명 사용자에게 열어줄 것
--   비로그인 웹 뷰어는 `모두의 지도`와 `@누구의 지도`를 읽을 수 있어야 한다. PLAN §6
--   pins_read의 is_public 분기가 이를 허용한다. 쓰기는 전부 막힌다.
-- ---------------------------------------------------------------------
-- ★ 함수는 기본적으로 PUBLIC에 EXECUTE가 열려 있다.
--   grant ... to authenticated 만으로는 anon을 막지 못한다. 먼저 회수한다.
--   단, 확장(pgcrypto 등)이 심어둔 함수는 건드리면 안 된다.
--   spaces.invite_code 기본값이 gen_random_bytes를 쓴다.
--
--   방침: 함수 실행권한으로 접근을 통제하지 않는다. 통제는 RLS가 한다.
--   api_* 는 전부 security invoker이므로 내부 헬퍼(lens_predicate, blur_coord,
--   compute_place_score …)까지 호출자 권한으로 실행된다. 헬퍼를 하나라도
--   빠뜨리면 지도가 통째로 안 열린다. 그래서 **회수는 PUBLIC에만** 하고
--   anon·authenticated에는 다시 전부 준다. 쓰기 성격의 security definer 함수만
--   개별적으로 되-회수한다 (007의 api_record_pick).
--
--   ★ 함수로 만들어 두는 이유: Supabase의 "Automatically expose new tables"는
--   **새 테이블이 생길 때마다** anon·authenticated에 권한을 준다.
--   마이그레이션이 006 이후에 테이블을 더 만들면(007의 place_picks) 그 테이블은
--   이 회수를 안 거친다. 그래서 마지막 마이그레이션 끝에서 한 번 더 부른다.
create or replace function public.lock_function_privileges()
returns void language plpgsql security definer as $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', f.sig);
    execute format('grant  execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;

select public.lock_function_privileges();
alter default privileges in schema public revoke execute on functions from public;

grant usage on schema public to anon, authenticated;
grant select on public.regions, public.places, public.place_stats to anon, authenticated;
grant select on public.pins, public.media to anon, authenticated;
grant execute on function public.api_map_places(
  double precision, double precision, double precision, double precision,
  text, uuid, pin_category, uuid[], timestamptz, timestamptz,
  double precision, double precision, double precision, int) to anon, authenticated;
grant execute on function public.api_map_clusters(
  double precision, double precision, double precision, double precision,
  int, text, uuid, pin_category, int) to anon, authenticated;
grant execute on function public.api_search(text, int) to anon, authenticated;
grant execute on function public.api_places_near(
  double precision, double precision, double precision,
  text, uuid, pin_category, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 로그인 사용자의 쓰기 권한
--   RLS 정책만 있고 GRANT가 없으면 앱은 한 줄도 못 쓴다. 둘 다 필요하다.
--   행 단위 판정은 위의 정책이, 테이블 단위 판정은 여기가 한다.
-- ---------------------------------------------------------------------
-- 읽기부터. RLS 정책이 행을 걸러주므로 테이블 권한은 넉넉히 줘도 된다.
--
-- ★ anon에게도 준다. api_map_places는 security invoker라 **호출자 권한으로**
--   pin_spaces를 조인한다. anon에게 권한이 없으면 지도가 통째로
--   "permission denied for table pin_spaces"로 죽는다 — 비로그인 웹 뷰어(§6)가
--   전부 막힌다. 행은 RLS가 막는다: 위 정책들은 auth.uid()가 null이면
--   전부 false라 anon에게는 0행이 나온다. 권한을 준다고 새는 게 아니다.
grant select on
  public.spaces, public.space_members, public.trips, public.trip_spaces,
  public.pin_spaces, public.reactions, public.region_progress
  to anon, authenticated;
grant insert, update, delete on
  public.spaces, public.space_members, public.trips, public.trip_spaces,
  public.pins, public.pin_spaces, public.media, public.reactions
  to authenticated;
grant insert on public.places, public.reports to authenticated;
grant insert, update, delete on public.region_progress to authenticated;
