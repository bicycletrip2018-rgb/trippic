-- =====================================================================
-- 067 **빠뜨리면 닫히게** 한다 — `anon` 은 허용 목록만 (§13.121)
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────
-- `lock_function_privileges()`(006)는 이름이 *"잠근다"* 인데 하는 일이 이랬다:
--
--     revoke execute ... from public;                 -- 맞다
--     grant  execute ... to anon, authenticated;      -- ★ **전부 내준다**
--
-- PUBLIC 을 막으려다 **anon 에게 통째로 넘겼다.** 그래서 `api_operator_grant` ·
-- `api_report_resolve` 까지 **로그인도 안 한 사람이 부를 수 있었다.**
--
-- ★ 지금 당장 뚫린 것은 **아니다** — 함수마다 안에 빗장이 있다(실제로 익명 키로
--   때려 보니 `42501 not an operator` 로 전부 거절했다, §13.119).
--   문제는 **기본값이 열려 있다**는 것이다: 다음에 누가 함수를 새로 만들면서
--   `grant` 를 안 적어도 **인터넷 전체에 열린다.** 빠뜨렸을 때 **닫히는 쪽**이어야 한다.
--
-- ── 무엇을 바꾸고 무엇을 안 바꾸나 ───────────────────────────────────
-- ★ `anon` 과 `authenticated` 는 **사실상 같은 사람들**이다 — 공개 키만 있으면
--   누구나 익명 계정을 만든다. 그러니 운영자 함수를 `authenticated` 에서 빼면
--   **진짜 운영자가 못 쓴다**(운영자도 평범한 로그인 사용자다).
--   → `authenticated` 는 그대로 두고, **안쪽 빗장이 유일한 벽이라는 사실도 그대로**다.
--     이 마이그레이션이 주는 것은 **두 가지**다:
--       ① 로그인 안 한 사람이 닿는 면이 48개 → **9개**로 준다
--       ② 새 함수는 **기본이 닫힘**이다 — 열려면 이 목록에 적어야 한다
-- =====================================================================

create or replace function public.lock_function_privileges()
returns void language plpgsql security definer as $$
declare
  f record;
  policy_fns text[];
  open_fns   text[];
  called     text[];
  /* ★ **로그인 없이 부를 수 있는 것 전부.** 여기 없으면 못 부른다.
     목록은 추측이 아니라 **스모크가 `set role anon` 으로 실제 부르는 것**에서 왔다 —
     즉 이미 내려 둔 제품 결정들이다. 늘리려면 **여기에 적고 이유를 남겨야 한다.** */
  anon_ok constant text[] := array[
    'api_invite_preview',   -- 받는 사람은 로그인 전에 **무엇을 수락하는지** 본다(§13.38)
    'api_log_client_error', -- 세션이 안 서는 것 자체가 오류다 — 그때도 보내야 한다(§13.120)
    'api_search',           -- 검색은 로그인 앞에 있다(§13.100)
    'api_place_search',     --   〃
    'api_place_candidates', --   〃 (등록 전 후보 찾기)
    'api_map_overview',     -- 비로그인 지도
    'api_map_places',       --   〃
    'api_record_pick',      -- 비로그인도 고르는 화면까지는 간다
    'api_my_saves'          -- 비로그인은 **빈 목록**이 와야 한다 — 거절이면 화면이 깨진다(§13.103)
  ];
begin
  /* ★ **정책이 부르는 함수는 자동으로 연다.** RLS 정책은 **부르는 사람의 권한**으로
     돌기 때문에, 정책 안에서 `pin_shared_with_me()` 를 쓰면 anon 도 그 함수를
     실행할 수 있어야 `pins` 를 읽을 수 있다 — 아니면 조회가 통째로 거절된다.
     (손으로 적다가 실제로 빠뜨렸고 스모크가 바로 잡았다.)
     ★ 손 목록에 더하지 않고 **정책에서 끌어온다.** 정책이 늘어도 따로 고칠 데가 없다. */
  /* ── 열어야 할 것을 **계산한다** ─────────────────────────────────
     손으로 적으면 반드시 빠뜨린다(실제로 세 번 빠뜨렸고 스모크가 세 번 다 잡았다).
     세 가지를 더해 **더 이상 안 늘어날 때까지** 넓힌다:
       ① 위 허용 목록
       ② **정책이 부르는 함수** — RLS 는 **부르는 사람의 권한**으로 돌아서,
          정책 안의 `pin_shared_with_me()` 를 anon 이 못 부르면 조회가 통째로 거절된다
       ③ ①②가 **본문에서 부르는 우리 함수** — `security invoker` 함수가 도우미를
          부르면 그 도우미도 부르는 사람 권한으로 돈다
     ★ 넓게 잡혀도 해롭지 않다 — 도우미는 **판단**이지 행동이 아니고, 어차피 067
       이전에는 전부 anon 에게 열려 있었다. 여기서 빠지는 것은 `api_operator_*` ·
       `api_report_*` 처럼 **아무도 anon 으로 부를 일이 없는 것**들이다. */
  select coalesce(array_agg(distinct x.nm), '{}') into policy_fns
  from (
    select m[1] as nm
    from pg_policy pol
    cross join lateral (
      select regexp_matches(
               coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
               '([a-z_][a-z0-9_]*)[(]', 'g') as m) t
  ) x
  where exists (select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                 where n2.nspname = 'public' and p2.proname = x.nm
                   and not exists (select 1 from pg_depend d2
                                    where d2.objid = p2.oid and d2.deptype = 'e'));

  open_fns := anon_ok || policy_fns;
  loop
    select coalesce(array_agg(distinct x.nm), '{}') into called
    from (
      select m[1] as nm
      from pg_proc p1
      join pg_namespace n1 on n1.oid = p1.pronamespace
      cross join lateral (
        select regexp_matches(coalesce(p1.prosrc, ''), '([a-z_][a-z0-9_]*)[(]', 'g') as m) t
      where n1.nspname = 'public' and p1.proname = any(open_fns)
    ) x
    where exists (select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                   where n2.nspname = 'public' and p2.proname = x.nm
                     and not exists (select 1 from pg_depend d2
                                      where d2.objid = p2.oid and d2.deptype = 'e'));
    exit when called <@ open_fns;              -- 더 안 늘어나면 끝
    open_fns := array(select distinct unnest(open_fns || called));
  end loop;

  for f in
    select p.oid::regprocedure as sig, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype <> 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    /* ★ 매번 **지우고 다시 준다.** 안 지우면 목록에서 뺀 함수가 예전 권한을 들고
       남는다 — 목록을 고쳐도 아무 일이 안 일어나면 목록이 거짓말이 된다. */
    execute format('revoke execute on function %s from public', f.sig);
    execute format('revoke execute on function %s from anon', f.sig);
    execute format('grant  execute on function %s to authenticated', f.sig);
    if f.name = any(open_fns) then
      execute format('grant execute on function %s to anon', f.sig);
    end if;
  end loop;
end $$;

comment on function public.lock_function_privileges is
  'PUBLIC 을 막고, authenticated 에 주고, anon 은 **허용 목록만**(§13.121). 새 함수는 기본이 닫힘이다 — 열려면 목록에 적는다.';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
