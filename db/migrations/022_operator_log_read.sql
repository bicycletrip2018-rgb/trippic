-- =====================================================================
-- TRIPPIC · 022 운영자 기록을 볼 수 있게 한다
--
-- 021에서 operator_log를 만들고 **읽는 길을 안 만들었다.**
-- 테이블 권한을 회수해 뒀으니 운영자도 못 본다 —
-- "누가 누구를 넣고 뺐는지 남긴다"는 목적이 성립하지 않았다.
-- (021의 시험에서 `permission denied for table operator_log`로 드러났다)
--
-- ★ 테이블을 열지 않는다. 021과 같은 이유다 — 함수로만 연다.
-- =====================================================================

create or replace function public.api_operator_log(p_limit int default 100)
returns table (
  at        timestamptz,
  action    text,
  actor     text,      -- 한 사람 (null이면 DB에 직접 손댄 것)
  target    text,
  note      text
)
language sql stable security definer set search_path = public, extensions as $$
  select l.at, l.action,
         coalesce(a.handle, '(직접 조작)') as actor,
         coalesce(t.handle, l.target_id::text) as target,
         l.note
  from public.operator_log l
  left join public.profiles a on a.id = l.actor_id
  left join public.profiles t on t.id = l.target_id
  where public.is_operator()
  order by l.at desc, l.id desc
  limit greatest(1, least(p_limit, 500));
$$;

comment on function public.api_operator_log is
  '운영자 추가·해제 기록. operators 행이 사라져도 여기 남는다 — 되돌릴 근거가 된다.';

revoke execute on function public.api_operator_log(int) from public;
grant execute on function public.api_operator_log(int) to authenticated;

select public.lock_function_privileges();
revoke all on public.operators, public.operator_log from anon, authenticated;
