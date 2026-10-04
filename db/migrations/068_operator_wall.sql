-- =====================================================================
-- 068 **빗장을 빠뜨려도 막힌다** (§13.122)
--
-- §13.121 이 남긴 위험:
--   *"안쪽 `is_operator()` 빗장은 여전히 유일한 벽이다. 새 운영자 함수를 만들 때
--     그걸 빠뜨리면 **로그인한 누구나** 부를 수 있다 — 권한으로는 못 막는다."*
--
-- ── 왜 권한으로 못 막나 (다시) ──────────────────────────────────────
-- 운영자도 **평범한 로그인 사용자**다. `authenticated` 에서 빼면 진짜 운영자가
-- 못 쓴다. 그리고 `security definer` 함수는 **RLS 를 통째로 건너뛴다** —
-- `operators` 표에 정책이 하나도 없어(= 전부 거절) 직접 접근은 이미 막혀 있는데,
-- definer 함수 하나가 그 벽을 그냥 지나간다.
--
-- ── 그래서 두 겹으로 ───────────────────────────────────────────────
--   ① **쓰기** — 표에 **트리거**를 건다. 트리거는 `security definer` 든 RLS 든
--      **상관없이 돈다.** 함수가 빗장을 빠뜨려도 **표가 거절한다.**
--   ② **읽기** — 트리거는 SELECT 에 안 걸린다. 읽기까지 막을 자리는 함수 안밖에
--      없으므로, **검증이 막는다**: 민감한 표를 건드리는 `security definer` 함수에
--      빗장이 없으면 `verify.sh` 가 **실패한다**(스모크 27-B).
--      → 런타임이 아니라 **배포 전에** 걸린다. 그게 이 층이 할 수 있는 전부이고,
--        **그렇다고 적어 둔다.**
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① 쓰기 벽 — 표가 스스로 거절한다
-- ---------------------------------------------------------------------
create or replace function public.tg_operator_only()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
begin
  /* ★ **`current_user` 로 가르면 안 된다**(실제로 그렇게 썼다가 뚫렸다).
     `security definer` 함수 안에서는 `current_user` 가 **함수 주인**으로 바뀐다 —
     그래서 *"클라이언트 롤일 때만 막는다"* 가 **definer 함수를 그대로 통과시킨다.**
     막으려던 바로 그것을 못 막는다. 스모크가 첫 판에 잡았다.

     → **`auth.uid()` 로 가른다.** 이건 JWT 에서 오는 값이라 definer 가 안 바꾼다.
       비어 있으면 **서버 자신**(마이그레이션·배치)이고, 그때까지 막으면 벽이
       문까지 막아 집에 못 들어간다. */
  if auth.uid() is null then
    /* ★ **구멍 하나를 인정하고 적어 둔다.** 로그인 안 한 클라이언트(anon)도
       `auth.uid()` 가 비어 있어 여기를 지난다. 그 자리는 **067 이 막는다** —
       새 함수는 anon 에게 닫힌 채로 태어나므로 anon 은 애초에 못 부른다.
       **두 층이 겹쳐야 성립한다.** 한 층만 보고 안전하다고 하면 안 된다. */
    return coalesce(new, old);
  end if;
  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다 (%)', tg_table_name
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

comment on function public.tg_operator_only is
  '운영자가 아니면 거절한다. 트리거라서 security definer 함수도 못 지나간다(§13.122).';

/* `operators` · `operator_log` — 모든 쓰기 */
drop trigger if exists operators_operator_only on public.operators;
create trigger operators_operator_only
  before insert or update or delete on public.operators
  for each row execute function public.tg_operator_only();

drop trigger if exists operator_log_operator_only on public.operator_log;
create trigger operator_log_operator_only
  before insert or update or delete on public.operator_log
  for each row execute function public.tg_operator_only();

/* ★ `reports` 는 **만드는 것과 처리하는 것이 다르다.** 신고는 **아무나** 한다
   (`reports_insert` 정책이 그렇게 정해 뒀다) — 그걸 막으면 신고 자체가 사라진다.
   막는 것은 **처리**뿐이다.

   ★★ 그리고 `update` 전부가 아니라 **판정 칸(status·resolved_at)** 만이다.
   처음엔 `before update` 로 통째로 걸었다가 **계정 합치기가 깨졌다** —
   `api_merge_claim`(040)이 `reports.reporter_id` 를 B 로 옮긴다. 그건 신고를
   *처리*하는 게 아니라 *주인을 옮기는* 일이고, 표를 낸 사람은 두 계정을 다
   가졌다는 증명을 이미 냈다. 벽이 거기까지 막으면 합치기가 중간에 멈춰
   **기록이 반만 옮겨진 계정**이 남는다. 벽은 좁게 세운다. */
drop trigger if exists reports_resolve_operator_only on public.reports;
create trigger reports_resolve_operator_only
  before update of status, resolved_at or delete on public.reports
  for each row execute function public.tg_operator_only();

-- ---------------------------------------------------------------------
-- ② 읽기는 트리거로 못 막는다 — **검증이 막는다**
--
-- 민감한 표를 건드리는 `security definer` 함수에 빗장이 있는지 센다.
-- 스모크가 이 함수를 불러 0 이 아니면 **검증을 실패시킨다.**
-- ★ 런타임 벽이 아니다. **배포 전에** 걸리는 벽이고, 읽기에 대해서는
--   그게 이 층이 할 수 있는 전부다 — 그렇다고 적어 둔다.
-- ---------------------------------------------------------------------
/* ★ 예외는 **이유를 적어야만** 통한다.
   검사기를 넓게 두면 정당한 함수도 걸린다(`api_merge_claim`). 그때
   정규식을 좁혀서 조용히 빼면 **다음에 생길 진짜 구멍도 같이 빠진다.**
   그래서 예외를 표로 받는다 — 한 줄에 **왜**를 적게 하고, grep 하면 다 보인다. */
create table if not exists public.operator_wall_exemptions (
  proname text primary key,
  why     text not null
);
comment on table public.operator_wall_exemptions is
  '읽기 검사기(unguarded_operator_functions)의 예외. 이유 없이는 못 넣는다(§13.122).';
revoke all on public.operator_wall_exemptions from public, anon, authenticated;

insert into public.operator_wall_exemptions (proname, why) values
  ('api_merge_claim',
   'reports 를 건드리지만 is_operator 가 아니라 **15분 만료 merge 표**로 가른다. '
   '표는 두 계정을 다 가졌다는 증명이고, 건드리는 범위도 from_user 의 줄뿐이다(040).')
on conflict (proname) do update set why = excluded.why;

create or replace function public.unguarded_operator_functions()
returns table (proname text, why text)
language sql stable security definer set search_path = public, extensions as $$
  select p.proname::text,
         '민감한 표를 건드리는데 is_operator() 빗장이 없다'::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef                                   -- definer 만 RLS 를 지나간다
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    /* 벽 자신과 검사기 자신은 뺀다 — 검사가 자기를 고발하면 아무도 못 고친다 */
    and p.proname not in ('tg_operator_only', 'unguarded_operator_functions', 'is_operator')
    and p.prosrc ~ '\m(operators|operator_log|reports)\M'
    and p.prosrc !~ 'is_operator'
    and not exists (select 1 from public.operator_wall_exemptions e
                     where e.proname = p.proname)
  order by 1;
$$;

comment on function public.unguarded_operator_functions is
  '빗장을 빠뜨린 운영자 함수. 스모크가 이걸 세고 0이 아니면 검증을 실패시킨다(§13.122).';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
