-- =====================================================================
-- TRIPPIC · 023 신고 처리 기록을 따로 뺀다
--
-- 020의 api_report_resolve는 처리 메모를 **reason에 이어 붙였다**:
--   reason = reason || ' / 처리: ' || note
--
-- ★ 이건 두 가지가 잘못됐다.
--   ① **원래 신고 사유가 훼손된다.** 사용자가 고른 사유와 운영자가 쓴 메모가 한 칸에 섞인다.
--      나중에 사유별로 세거나 통계를 내려면 문자열을 다시 갈라야 한다.
--   ② **한 번밖에 못 남는다.** 두 번 손대면 계속 길어지고, 누가 언제 했는지는 어디에도 없다.
--
-- → 처리는 신고의 '상태'가 아니라 **일어난 일**이다. 일어난 일은 줄로 쌓아야 한다.
--   운영자 추가·해제를 operator_log로 뺀 것과 같은 이유다(021).
--
-- ★ 되돌리기(reopen)가 이제 가능해진다. 상태만 있을 때는 "왜 다시 열었는지"를
--   적을 데가 없어 되돌리기 자체를 막아 뒀었다.
-- =====================================================================

create table if not exists public.report_actions (
  id        bigserial primary key,
  report_id uuid not null references public.reports(id) on delete cascade,
  actor_id  uuid references public.profiles(id),   -- null이면 DB 직접 조작
  action    text not null check (action in ('resolve', 'reject', 'reopen', 'note')),
  note      text,
  at        timestamptz not null default now()
);
create index if not exists report_actions_report_idx on public.report_actions (report_id, at desc);
comment on table public.report_actions is
  '신고에 일어난 일. reason은 사용자가 고른 사유 그대로 두고, 운영자가 한 일은 여기 쌓는다.';

alter table public.report_actions enable row level security;
revoke all on public.report_actions from anon, authenticated;

-- ---------------------------------------------------------------------
-- 처리 — reason을 건드리지 않는다
-- ---------------------------------------------------------------------
create or replace function public.api_report_resolve(
  p_ids uuid[], p_status report_status, p_note text default null
) returns int language plpgsql security definer
set search_path = public, extensions as $$
declare n int;
begin
  if not public.is_operator() then
    raise exception 'not an operator' using errcode = '42501';
  end if;
  if p_status = 'open' then
    raise exception '되돌리려면 api_report_reopen을 쓴다' using errcode = '22023';
  end if;
  update public.reports
     set status = p_status, resolved_at = now()
   where id = any(p_ids) and status = 'open';
  get diagnostics n = row_count;

  insert into public.report_actions(report_id, actor_id, action, note)
  select r.id, auth.uid(),
         case when p_status = 'resolved' then 'resolve' else 'reject' end, p_note
  from public.reports r
  where r.id = any(p_ids) and r.resolved_at is not null and r.status = p_status;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 되돌리기 — 잘못 닫은 것을 다시 연다
-- ★ 왜 필요한가: 반려를 쉽게 만든 이상(§10.45) **잘못 반려하는 일도 쉬워진다.**
--   되돌릴 길이 없으면 운영자는 반려를 망설이게 되고, 그러면 다시 "일단 내리기"로 돌아간다.
-- ---------------------------------------------------------------------
create or replace function public.api_report_reopen(p_ids uuid[], p_note text default null)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare n int;
begin
  if not public.is_operator() then
    raise exception 'not an operator' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception '되돌리는 이유를 적어야 한다' using errcode = '23514';
  end if;
  update public.reports set status = 'open', resolved_at = null
   where id = any(p_ids) and status <> 'open';
  get diagnostics n = row_count;
  insert into public.report_actions(report_id, actor_id, action, note)
  select r.id, auth.uid(), 'reopen', p_note
  from public.reports r where r.id = any(p_ids) and r.status = 'open';
  return n;
end $$;

-- 상태를 바꾸지 않고 메모만 남긴다 (확인 중·보류 등)
create or replace function public.api_report_note(p_ids uuid[], p_note text)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare n int;
begin
  if not public.is_operator() then
    raise exception 'not an operator' using errcode = '42501';
  end if;
  if p_note is null or btrim(p_note) = '' then
    raise exception '메모가 비어 있다' using errcode = '23514';
  end if;
  insert into public.report_actions(report_id, actor_id, action, note)
  select r.id, auth.uid(), 'note', p_note from public.reports r where r.id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- 한 신고에 일어난 일 전부
create or replace function public.api_report_history(p_ids uuid[])
returns table (at timestamptz, action text, actor text, note text, report_id uuid)
language sql stable security definer set search_path = public, extensions as $$
  select a.at, a.action, coalesce(p.handle, '(직접 조작)'), a.note, a.report_id
  from public.report_actions a
  left join public.profiles p on p.id = a.actor_id
  where public.is_operator() and a.report_id = any(p_ids)
  order by a.at desc, a.id desc;
$$;

revoke execute on function public.api_report_reopen(uuid[], text) from public;
revoke execute on function public.api_report_note(uuid[], text) from public;
revoke execute on function public.api_report_history(uuid[]) from public;
grant execute on function public.api_report_reopen(uuid[], text) to authenticated;
grant execute on function public.api_report_note(uuid[], text) to authenticated;
grant execute on function public.api_report_history(uuid[]) to authenticated;

select public.lock_function_privileges();
revoke all on public.report_actions from anon, authenticated;
