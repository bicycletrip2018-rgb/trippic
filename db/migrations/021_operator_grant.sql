-- =====================================================================
-- TRIPPIC · 021 운영자를 추가·해제한다
--
-- ★ 이것은 **권한이 스스로를 늘리는 경로**다. 셋을 같이 건다.
--
--   ① 흔적을 남긴다 — operators 행은 해제하면 사라진다. 사라진 뒤에도
--      "누가 언제 누구를 넣고 뺐는지"가 남아야 한다. operator_log는 지우지 않는다.
--   ② 마지막 한 명은 못 뺀다 — 전부 빼면 신고함을 아무도 못 연다.
--      되돌리려면 DB에 직접 손대야 하는데, 그건 사고다.
--   ③ 첫 운영자는 **손으로 넣는다** — 부트스트랩을 함수로 열면
--      "아무도 운영자가 아닐 때는 누구나 운영자가 될 수 있다"가 된다.
--
-- ★ 해제를 서로 막지는 않았다. 나쁜 운영자를 빼려면 누군가는 뺄 수 있어야 한다.
--   대신 **전부 기록되고**, 남은 운영자가 로그를 보고 되돌릴 수 있다.
--
-- 첫 운영자 넣기 (DB 소유자가 한 번만):
--   insert into public.operators(user_id, note) values ('<uuid>', '첫 운영자');
-- =====================================================================

alter table public.operators add column if not exists granted_by uuid references public.profiles(id);

create table if not exists public.operator_log (
  id        bigserial primary key,
  actor_id  uuid,                      -- 한 일을 한 사람 (null이면 DB 직접 조작)
  target_id uuid not null,
  action    text not null check (action in ('grant', 'revoke')),
  note      text,
  at        timestamptz not null default now()
);
comment on table public.operator_log is
  '운영자 추가·해제 기록. operators 행은 해제하면 사라지지만 이 표는 남는다. 지우지 않는다.';
alter table public.operator_log enable row level security;
revoke all on public.operator_log from anon, authenticated;

-- ---------------------------------------------------------------------
create or replace function public.api_operator_grant(p_user uuid, p_note text default null)
returns boolean language plpgsql security definer
set search_path = public, extensions as $$
declare added boolean;
begin
  if not public.is_operator() then
    raise exception 'not an operator' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and deleted_at is null) then
    raise exception '그런 사용자가 없다' using errcode = '23503';
  end if;
  insert into public.operators(user_id, granted_by, note)
  values (p_user, auth.uid(), p_note)
  on conflict (user_id) do nothing;          -- 여러 번 불러도 같다
  added := found;
  if added then
    insert into public.operator_log(actor_id, target_id, action, note)
    values (auth.uid(), p_user, 'grant', p_note);
  end if;
  return added;
end $$;

create or replace function public.api_operator_revoke(p_user uuid, p_note text default null)
returns boolean language plpgsql security definer
set search_path = public, extensions as $$
declare removed boolean;
begin
  if not public.is_operator() then
    raise exception 'not an operator' using errcode = '42501';
  end if;
  -- ★ 마지막 한 명은 못 뺀다. 전부 빠지면 신고함을 아무도 못 연다.
  if (select count(*) from public.operators) <= 1
     and exists (select 1 from public.operators where user_id = p_user) then
    raise exception '마지막 운영자는 해제할 수 없다' using errcode = '23514';
  end if;
  delete from public.operators where user_id = p_user;
  removed := found;
  if removed then
    insert into public.operator_log(actor_id, target_id, action, note)
    values (auth.uid(), p_user, 'revoke', p_note);
  end if;
  return removed;
end $$;

create or replace function public.api_operator_list()
returns table (user_id uuid, handle text, nickname text,
               granted_at timestamptz, granted_by_handle text, note text)
language sql stable security definer set search_path = public, extensions as $$
  select o.user_id, p.handle, p.nickname, o.granted_at, g.handle, o.note
  from public.operators o
  join public.profiles p on p.id = o.user_id
  left join public.profiles g on g.id = o.granted_by
  where public.is_operator()
  order by o.granted_at;
$$;

revoke execute on function public.api_operator_grant(uuid, text) from public;
revoke execute on function public.api_operator_revoke(uuid, text) from public;
revoke execute on function public.api_operator_list() from public;
grant execute on function public.api_operator_grant(uuid, text) to authenticated;
grant execute on function public.api_operator_revoke(uuid, text) to authenticated;
grant execute on function public.api_operator_list() to authenticated;

select public.lock_function_privileges();
revoke all on public.operators, public.operator_log from anon, authenticated;
