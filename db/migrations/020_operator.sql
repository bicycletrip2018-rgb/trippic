-- =====================================================================
-- TRIPPIC · 020 운영자와 신고 처리
--
-- 지금까지 `reports`는 **넣기만** 됐다(§10.44). RLS가 `reports_read_own`뿐이라
-- 아무도 남의 신고를 볼 수 없다 — 들어오기만 하고 아무도 처리할 수 없는 상태였다.
--
-- ★ 운영자를 profiles의 컬럼으로 두지 않는다.
--   profiles는 다른 사용자에게 보이는 테이블이다. 거기에 is_operator를 두면
--   **누가 운영자인지가 공개된다.** 표적이 된다. 별도 테이블로 둔다.
--
-- ★ 조회·처리는 전부 security definer 함수로만 연다.
--   테이블을 직접 열면 RLS 정책을 하나 잘못 써서 신고함이 통째로 새는 순간이 온다.
-- =====================================================================

create table if not exists public.operators (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note       text
);
comment on table public.operators is
  '신고를 처리할 수 있는 계정. profiles에 두지 않는 이유는 누가 운영자인지 감추기 위해서다.';

alter table public.operators enable row level security;
-- 어떤 정책도 두지 않는다 = 아무도 직접 못 읽는다. 아래 함수로만 쓴다.
revoke all on public.operators from anon, authenticated;

create or replace function public.is_operator()
returns boolean language sql stable security definer
set search_path = public, extensions as $$
  select exists (select 1 from public.operators o where o.user_id = auth.uid())
$$;
revoke execute on function public.is_operator() from public;
grant execute on function public.is_operator() to authenticated;

-- ---------------------------------------------------------------------
-- 신고함 — **판단에 필요한 근거를 같이 실어 보낸다**
--
-- ★ 신고를 보고 다시 조회하게 만들면 처리가 느려진다.
--   "위치가 다릅니다"가 들어왔을 때 geom_offset_m(018)이 옆에 있으면 진위가 바로 갈린다.
--   "중복입니다"는 반경 200m 안 같은 이름 수가 답한다.
-- ★ 같은 대상·같은 사유는 **묶어서** 보여준다. 10명이 신고한 것과 1명이 신고한 것은 다르다.
-- ---------------------------------------------------------------------
create or replace function public.api_report_queue(
  p_status report_status default 'open',
  p_limit  int default 50
)
returns table (
  target_type reaction_target,
  target_id   uuid,
  reason      text,
  reporters   int,
  first_at    timestamptz,
  last_at     timestamptz,
  report_ids  uuid[],
  label       text,
  address     text,
  geom_offset_m real,
  region      text,
  hidden_from_candidates boolean,
  dup_nearby  int
)
language sql stable security definer set search_path = public, extensions as $$
  with g as (
    select r.target_type, r.target_id, r.reason,
           count(*)::int as reporters,
           min(r.created_at) as first_at, max(r.created_at) as last_at,
           array_agg(r.id) as report_ids
    from public.reports r
    where public.is_operator() and r.status = p_status
    group by r.target_type, r.target_id, r.reason
  )
  select g.target_type, g.target_id, g.reason, g.reporters, g.first_at, g.last_at, g.report_ids,
         coalesce(pl.name, '(사진)') as label,
         pl.address,
         pl.geom_offset_m,
         rg.sido || ' ' || rg.name as region,
         -- 019: 좌표가 1km 넘게 어긋난 장소는 이미 후보에서 빠져 있다
         (coalesce(pl.geom_offset_m, 0) > 1000) as hidden_from_candidates,
         (select count(*)::int from public.places q
           where pl.id is not null and q.id <> pl.id and q.name = pl.name
             and ST_DWithin(q.geom::geography, pl.geom::geography, 200)) as dup_nearby
  from g
  left join public.places pl on g.target_type = 'place' and pl.id = g.target_id
  left join public.regions rg on rg.code = pl.region_code
  order by g.reporters desc, g.first_at
  limit greatest(1, least(p_limit, 200));
$$;

-- ---------------------------------------------------------------------
-- 처리 — 묶음 단위로 닫는다
-- ★ 같은 대상·같은 사유를 하나씩 닫게 하면 10건짜리에서 9건이 남는다.
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
    raise exception 'open으로는 되돌릴 수 없다' using errcode = '22023';
  end if;
  update public.reports
     set status = p_status,
         resolved_at = now(),
         reason = case when p_note is null or p_note = '' then reason
                       else reason || ' / 처리: ' || p_note end
   where id = any(p_ids) and status = 'open';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.api_report_queue(report_status, int) from public;
revoke execute on function public.api_report_resolve(uuid[], report_status, text) from public;
grant execute on function public.api_report_queue(report_status, int) to authenticated;
grant execute on function public.api_report_resolve(uuid[], report_status, text) to authenticated;

select public.lock_function_privileges();
revoke all on public.operators from anon, authenticated;
