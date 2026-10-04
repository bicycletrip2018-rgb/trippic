-- =====================================================================
-- 069 067·068 을 **한 검사로** 묶는다 (§13.123)
--
-- §13.122 가 "남은 것"에 이렇게 적었다:
--   *"`anon` 이 트리거를 지나는 구멍은 067 이 막는다 — 067 을 느슨하게 하면
--     068 도 같이 느슨해진다. 둘은 **하나처럼** 봐야 한다."*
--
-- 그런데 검사는 **둘로 나뉘어 있었다.** 067 은 "anon 이 뭘 부를 수 있나"를 보고,
-- 068 은 "빗장이 있나"를 봤다. 각각은 통과하면서 **사이로 빠지는 조합**이 있다:
--
--     anon 이 부를 수 있는 definer 함수 + 그 안에 빗장이 없다
--       → 067: "열려 있는 건 허용 목록에 있는 것뿐" ✅ 통과
--       → 068: "빗장 없는 함수" ❌ 잡음 ... 인데 **예외표에 적혀 있으면** 통과한다
--       → 그리고 트리거는 `auth.uid()` 가 비면 **그냥 보낸다**(068 이 인정한 구멍)
--     = 세 검사가 다 통과하는데 **뚫린다.**
--
-- 사이를 없애려면 **한 문장**이어야 한다:
--
--   ★ 민감한 표(`operators`·`operator_log`·`reports`)에 닿는 모든 자리는
--     ① `is_operator()` 빗장이 있거나 **이유를 적은 예외**이고,
--     ② `anon` 에서 **닿지 않는다.**
--
--   ②가 067 의 몫이고 ①이 068 의 몫인데, **둘 다 깨져야만 뚫리는 게 아니라
--   한쪽만 깨져도 반쪽짜리**라서 한 번에 센다.
-- =====================================================================

create or replace function public.operator_wall_holes()
returns table (proname text, layer text, why text)
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  reachable text[];
  called    text[];
begin
  /* ── anon 이 **닿을 수 있는** 함수 전부 ────────────────────────────
     시작점은 추측이 아니라 **실제 권한**이다(`has_function_privilege`) —
     067 의 허용 목록을 여기서 다시 적으면 둘이 어긋날 수 있다.

     넓히는 규칙이 요점이다:
       · `security invoker` 함수의 도우미는 **부르는 사람 권한**으로 돌아서
         anon 이 따로 권한을 가져야 한다 → 이미 시작점에 들어 있다. 안 넓힌다.
       · `security definer` 함수의 도우미는 **주인 권한**으로 돈다 →
         anon 권한이 없어도 **닿는다.** 여기만 넓힌다.
     그래서 definer 를 통해서만 넓힌다. 넓게 잡으면 멀쩡한 함수가 걸리고,
     좁게 잡으면 구멍이 빠진다. */
  select coalesce(array_agg(p.proname::text), '{}') into reachable
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and has_function_privilege('anon', p.oid, 'execute');

  loop
    select coalesce(array_agg(distinct x.nm), '{}') into called
    from (
      select m[1] as nm
      from pg_proc p1 join pg_namespace n1 on n1.oid = p1.pronamespace
      cross join lateral (
        select regexp_matches(coalesce(p1.prosrc, ''), '([a-z_][a-z0-9_]*)[(]', 'g') as m) t
      where n1.nspname = 'public'
        and p1.prosecdef                     -- ★ definer 를 통해서만 넓어진다
        and p1.proname = any(reachable)
    ) x
    where exists (select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                   where n2.nspname = 'public' and p2.proname = x.nm
                     and not exists (select 1 from pg_depend d2
                                      where d2.objid = p2.oid and d2.deptype = 'e'));
    exit when called <@ reachable;
    reachable := array(select distinct unnest(reachable || called));
  end loop;

  return query
  with sensitive as (
    select p.proname::text as nm,
           p.prosecdef     as definer,
           (p.prosrc ~ 'is_operator')                           as has_bar,
           exists (select 1 from public.operator_wall_exemptions e
                    where e.proname = p.proname)                as exempt,
           (p.proname = any(reachable))                         as anon_reach
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      /* 벽 자신과 검사기 자신은 뺀다 — 검사가 자기를 고발하면 아무도 못 고친다 */
      and p.proname not in ('tg_operator_only', 'is_operator',
                            'operator_wall_holes', 'lock_function_privileges')
      and p.prosrc ~ '\m(operators|operator_log|reports)\M'
  )
  /* ① 안쪽 빗장 — `security definer` 만 RLS 를 지나간다 */
  select s.nm, '① 빗장(068)'::text,
         '민감한 표를 건드리는 definer 함수인데 is_operator() 빗장도 없고 적어 둔 예외도 아니다'::text
    from sensitive s
   where s.definer and not s.has_bar and not s.exempt
  union all
  /* ② anon 차단 — 트리거는 `auth.uid()` 가 비면 **그냥 보낸다** */
  select s.nm, '② anon 차단(067)'::text,
         'anon 에서 닿는데 빗장이 없다 — 트리거는 auth.uid() 가 비면 그냥 보내므로 067 이 유일한 벽이다'::text
    from sensitive s
   where s.anon_reach and not s.has_bar
   order by 2, 1;
end $$;

comment on function public.operator_wall_holes is
  '067(anon 차단)과 068(안쪽 빗장)을 **한 문장으로** 본다. 스모크가 이걸 세고 0이 아니면 검증을 실패시킨다(§13.123).';

/* ★ 예외표는 ①만 면제한다. ②는 **아무도 면제 못 한다** —
   anon 이 닿는 자리에 빗장이 없으면 그건 이유가 있고 없고의 문제가 아니다. */
comment on table public.operator_wall_exemptions is
  '빗장 검사(①)의 예외. anon 차단(②)은 면제 대상이 아니다(§13.123).';

/* 068 의 반쪽 검사기는 치운다 — 두 개를 두면 하나만 보고 안심하게 된다 */
drop function if exists public.unguarded_operator_functions();

select public.lock_function_privileges();

notify pgrst, 'reload schema';
