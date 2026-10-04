-- =====================================================================
-- 074 **운영자가 실제로 지울 수 있게 한다** (§13.144)
--
-- ── 왜 ──────────────────────────────────────────────────────────────
-- 앱 첫 화면이 **모든 사용자에게** 이렇게 약속한다(§13.136):
--
--     "신고가 들어오면 24시간 안에 확인하고 **지우거나 계정을 정지**합니다."
--
-- 그런데 072 가 만든 운영자 API 는 `queue · resolve · note · reopen · history`
-- 뿐이고, **내용을 건드리는 길이 하나도 없다.** `api_report_resolve` 는 신고 줄의
-- `status` 만 바꾼다. `pins`·`media` 정책에 `is_operator` 절도 **없다**(확인함).
--
-- ★ 즉 지금은 저 약속을 **대시보드에서 손으로** 지켜야 한다. 사람 손에 기대는
--   약속은 지켜지지 않는 날이 온다 — 그리고 그날은 앱스토어 1.2 가 묻는 날이다.
--   **글로 쓴 약속은 코드가 지키게 한다.**
--
-- ── 파일이 더 급하다 ────────────────────────────────────────────────
-- `photos` 버킷은 `public = true` 다. 직접 재 봤다(§13.144):
--   · 인증 헤더 **없이** GET → 200, 내용 일치
--   · 주인이 지운 직후에도 CDN 이 **+30초까지** 내줬고 +90초 안에 사라졌다
-- 그래서 `pins.deleted_at` 만 찍는 것은 **반쪽짜리다.** 줄은 숨지만 파일은
-- 주소를 아는 사람에게 계속 간다. **파일까지 지워야 지운 것이다.**
--
-- ── 그래서 세 가지 ─────────────────────────────────────────────────
--   ① `api_mod_remove_pin`  — 기록을 내리고 **파일 경로를 돌려준다**
--   ② 스토리지 삭제 정책    — 운영자가 **남의 파일도** 지울 수 있게
--   ③ `api_mod_suspend_user`— 계정 정지 (`auth.users.banned_until`)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ⓪ 새 동작에 **이름을 내준다**
--
-- ★ `operator_log.action` 과 `report_actions.action` 은 둘 다 CHECK 로 값을
--   묶어 두었다(`grant|revoke`, `resolve|reject|reopen|note`). 좋은 벽이다 —
--   덕분에 새 동작을 **몰래** 못 적는다. 실제로 이 마이그레이션이 거기서 멎었다.
--   늘릴 때는 늘린다고 적는다.
-- ---------------------------------------------------------------------
alter table public.operator_log  drop constraint if exists operator_log_action_check;
alter table public.operator_log  add  constraint operator_log_action_check
  check (action = any (array['grant','revoke','remove_pin','suspend','unsuspend']));

alter table public.report_actions drop constraint if exists report_actions_action_check;
alter table public.report_actions add  constraint report_actions_action_check
  check (action = any (array['resolve','reject','reopen','note','remove_pin']));

-- ---------------------------------------------------------------------
-- ① 기록을 내린다
-- ---------------------------------------------------------------------
create or replace function public.api_mod_remove_pin(
  p_pin   uuid,
  p_why   text,
  p_report uuid default null
) returns text[]
language plpgsql security definer
set search_path = public, extensions as $$
declare
  me      uuid := auth.uid();
  owner   uuid;
  paths   text[];
begin
  /* ★ 빗장. definer 라 RLS 를 통째로 지나가므로 **이 줄이 유일한 벽**이다.
     068 의 트리거는 `operators`·`operator_log`·`reports` 에만 걸려 있어서
     `pins` 를 건드리는 이 함수는 트리거가 안 잡는다 — 그래서 더 중요하다. */
  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다' using errcode = '42501';
  end if;
  if p_why is null or btrim(p_why) = '' then
    raise exception '왜 지우는지 적어야 합니다' using errcode = '22023';
  end if;

  select user_id into owner from public.pins where id = p_pin;
  if owner is null then
    raise exception '그런 기록이 없습니다' using errcode = 'P0002';
  end if;

  /* ★ **파일 경로를 먼저 모은다.** 줄을 내린 뒤에 모으려 하면 늦는다 —
     `deleted_at` 이 찍힌 줄을 다시 읽을 수 있느냐는 정책에 달려 있고,
     그 정책이 바뀌면 **조용히 빈 배열**이 돌아온다. 073 에서 한 번 겪었다. */
  select coalesce(array_agg(distinct q), '{}') into paths
  from (
    select substring(m.url         from '/public/photos/(.+)$') as q from public.media m where m.pin_id = p_pin
    union all
    select substring(m.poster_url  from '/public/photos/(.+)$')      from public.media m where m.pin_id = p_pin and m.poster_url is not null
    union all
    select substring(m.thumb_url   from '/public/photos/(.+)$')      from public.media m where m.pin_id = p_pin and m.thumb_url  is not null
  ) t where q is not null;

  /* ★ **지우지 않고 내린다**(soft). 신고 처리의 근거가 남아야 하고,
     `pins_read` 가 이미 `deleted_at is null` 로 거르므로 **누구에게도 안 보인다.**
     ★ `is_public` 도 같이 내린다 — 나중에 누가 `deleted_at` 을 되돌리면
       **공개 상태로 되살아난다.** 두 칸 다 내려 두면 그 사고가 안 난다. */
  update public.pins
     set deleted_at = now(), is_public = false
   where id = p_pin;

  insert into public.operator_log (actor_id, target_id, action, note)
  values (me, owner, 'remove_pin', p_why || ' (pin=' || p_pin || ')');

  if p_report is not null then
    insert into public.report_actions (report_id, actor_id, action, note)
    values (p_report, me, 'remove_pin', p_why);
  end if;

  /* ★ 경로를 **돌려준다.** 파일은 여기서 못 지운다 — SQL 은 스토리지에
     손이 닿지 않는다. 부른 쪽이 이 경로들을 지워야 **진짜로** 지워진다.
     073 의 계정 삭제와 같은 모양이다. */
  return paths;
end $$;

comment on function public.api_mod_remove_pin(uuid, text, uuid) is
  '운영자가 신고된 기록을 내리고 지울 파일 경로를 돌려준다. 부른 쪽이 파일을 지워야 끝난다(§13.144).';

-- ---------------------------------------------------------------------
-- ② 운영자가 **남의 파일도** 지울 수 있게
--
-- ★ 지금 `photos_delete` 는 `foldername[1] = auth.uid()` — **주인만**이다.
--   그래서 ① 이 경로를 돌려줘도 운영자는 **지우지 못했다.** 정책을 더한다.
--
-- ★★ 이 정책은 운영자에게 **버킷 전체 삭제 권한**을 준다. 좁힐 방법이 없다 —
--    스토리지 정책에서는 "이 파일이 신고된 기록의 것인가"를 알 수 없다
--    (경로만 보이고 `media` 와 조인할 수 없다). 운영자는 `api_operator_grant`
--    로 한 명씩 들이는 짧은 명단이고, 모든 삭제는 ① 이 `operator_log` 에
--    남긴다. **권한은 넓고 흔적은 남는다** — 그렇다고 적어 둔다.
-- ---------------------------------------------------------------------
-- ★ 로컬 검증 DB 에는 storage 스키마가 없다(030 과 같은 이유). 없으면 건너뛴다 —
--   이것 하나 때문에 마이그레이션 전체가 멈추면 안 된다. 스모크 31-⑦ 이
--   **진짜 Supabase 에서는** 이 정책이 있는지 센다.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice '074: storage 스키마 없음 — 정책 건너뜀 (로컬 검증)';
    return;
  end if;
  execute 'drop policy if exists photos_delete_operator on storage.objects';
  execute $p$
    create policy photos_delete_operator on storage.objects
      for delete to authenticated
      using (bucket_id = 'photos' and public.is_operator())
  $p$;
end $$;

-- ---------------------------------------------------------------------
-- ③ 계정 정지
-- ---------------------------------------------------------------------
create or replace function public.api_mod_suspend_user(
  p_user uuid,
  p_days int,
  p_why  text
) returns timestamptz
language plpgsql security definer
set search_path = public, extensions as $$
declare
  me  uuid := auth.uid();
  til timestamptz;
begin
  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다' using errcode = '42501';
  end if;
  if p_why is null or btrim(p_why) = '' then
    raise exception '왜 정지하는지 적어야 합니다' using errcode = '22023';
  end if;
  if p_days is null or p_days < 1 then
    raise exception '며칠인지 적어야 합니다(1 이상)' using errcode = '22023';
  end if;

  /* ★ **운영자는 정지하지 못한다.** 계정 하나가 넘어가면 나머지 운영자를
     전부 잠가 버릴 수 있다 — 그러면 되돌릴 사람이 없다. 운영자를 내리는 것은
     `api_operator_revoke` 가 먼저다(그쪽도 운영자만 쓴다). */
  if exists (select 1 from public.operators o where o.user_id = p_user) then
    raise exception '운영자는 정지할 수 없습니다. 먼저 권한을 내리십시오' using errcode = '42501';
  end if;

  til := now() + make_interval(days => p_days);
  update auth.users set banned_until = til where id = p_user;
  if not found then
    raise exception '그런 사용자가 없습니다' using errcode = 'P0002';
  end if;

  insert into public.operator_log (actor_id, target_id, action, note)
  values (me, p_user, 'suspend', p_why || ' (' || p_days || '일)');
  return til;
end $$;

create or replace function public.api_mod_unsuspend_user(
  p_user uuid,
  p_why  text
) returns boolean
language plpgsql security definer
set search_path = public, extensions as $$
declare me uuid := auth.uid();
begin
  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다' using errcode = '42501';
  end if;
  update auth.users set banned_until = null where id = p_user;
  if not found then
    raise exception '그런 사용자가 없습니다' using errcode = 'P0002';
  end if;
  insert into public.operator_log (actor_id, target_id, action, note)
  values (me, p_user, 'unsuspend', coalesce(nullif(btrim(p_why), ''), '(사유 없음)'));
  return true;
end $$;

comment on function public.api_mod_suspend_user(uuid, int, text) is
  '운영자가 계정을 정지한다. auth.users.banned_until 을 찍으면 토큰이 안 나간다(§13.144).';

revoke all on function public.api_mod_remove_pin(uuid, text, uuid)   from public, anon;
revoke all on function public.api_mod_suspend_user(uuid, int, text)  from public, anon;
revoke all on function public.api_mod_unsuspend_user(uuid, text)     from public, anon;
grant execute on function public.api_mod_remove_pin(uuid, text, uuid)  to authenticated;
grant execute on function public.api_mod_suspend_user(uuid, int, text) to authenticated;
grant execute on function public.api_mod_unsuspend_user(uuid, text)    to authenticated;
