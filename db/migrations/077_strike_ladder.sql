-- =====================================================================
-- 077 **조치 사다리와 알림** (§13.147)
--
-- ── 지금의 문제 ────────────────────────────────────────────────────
-- 운영자가 할 수 있는 것이 **내리기**와 **정지**, 둘뿐이다(074).
--   · 처음 실수한 사람과 **열 번째 반복범이 같은 벌**을 받는다
--   · 며칠 정지할지는 **그때그때 운영자 기분**이다 — 같은 잘못에 다른 벌이 나간다
--   · 무엇보다 **내려간 사람은 아무것도 모른다.** 기록이 조용히 사라진다
--
-- ★ 마지막이 제일 나쁘다. 말 없이 지우면 **고치지 않는다** — 뭘 잘못했는지
--   모르니까. 그리고 돌아오지도 않는다. 유튜브·메타가 '알림 + 이의 제기'를
--   두는 이유가 벌주기가 아니라 **고칠 기회를 주기 위해서**다(MODERATION.md).
--
-- ── 사다리 ─────────────────────────────────────────────────────────
--   1회  경고      기록만 내린다. 계정은 그대로
--   2회  7일 정지
--   3회~ 영구 정지
--
-- ★ **180일 창**으로 센다. 2년 전 한 번을 오늘 세 번째로 치면 사다리가 아니라
--   덫이다. 유튜브가 90일로 비우는 것과 같은 생각이고, 우리는 사용자가 적어
--   표본이 작으므로 좀 더 길게 잡았다 — **재고 나서 줄인다.**
--
-- ★★ 횟수는 **`operator_log` 에서 센다.** 따로 칸을 두면 둘이 어긋난다(§13.37).
--    이미 모든 조치가 거기 남는다 — 세는 자리를 하나로 둔다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① 알림함 — **사용자가 읽는 곳**
-- ---------------------------------------------------------------------
create table if not exists public.user_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('warned','suspended','banned')),
  title      text not null,
  body       text not null,
  pin_id     uuid,                      -- 어떤 기록이었나(이미 내려갔을 수 있다)
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists user_notices_mine on public.user_notices (user_id, created_at desc);

alter table public.user_notices enable row level security;

/* ★ **읽기는 본인만.** 남의 징계 내역이 보이면 그 자체가 2차 피해다. */
drop policy if exists notices_read on public.user_notices;
create policy notices_read on public.user_notices
  for select to authenticated using (user_id = auth.uid());

/* ★ **읽음 표시만** 고칠 수 있다. 내용을 고치게 두면 "못 받았다"가 된다.
   ★★ 정책만으로는 **안 막힌다.** 처음에 `for update using(본인)` 만 써 놓고
      주석에 "읽음 표시만" 이라고 적었는데, 그건 **거짓말이었다** — 스모크가
      당사자로 `body` 를 고쳐 보고 성공했다. RLS 는 *어느 줄*을 고칠지는 정하지만
      *어느 칸*을 고칠지는 정하지 않는다. 칸은 **권한**이 정한다.
      → 아래 `grant update (read_at)` 가 진짜 벽이다. */
drop policy if exists notices_mark on public.user_notices;
create policy notices_mark on public.user_notices
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

/* ★ **쓰기 정책이 없다 = 아무도 직접 못 넣는다.** 넣는 길은 아래 definer 함수뿐이다.
   사용자가 자기에게 "경고 없음" 을 적어 넣을 수 있으면 기록이 아니라 낙서다. */
revoke all on public.user_notices from public, anon, authenticated;
grant select on public.user_notices to authenticated;
/* ★★ **칸 하나만 연다.** 이것이 "읽음 표시만 고칠 수 있다"를 실제로 지키는 줄이다. */
grant update (read_at) on public.user_notices to authenticated;

-- ---------------------------------------------------------------------
-- ② 몇 번째인가
-- ---------------------------------------------------------------------
/* ★ **`security invoker` 다.** 처음엔 definer 로 썼다가 068 의 벽이 잡았다 —
   *"민감한 표를 건드리는 definer 인데 빗장이 없다"*. 맞는 지적이었다:
   definer 면 **아무나 남의 징계 횟수를 물어볼 수 있다.**

   ★ invoker 로 두면 `operator_log` 권한이 없는 사람에게는 **그대로 거절된다**
     (그 표는 authenticated 에 권한이 없다). 그리고 `api_mod_enforce`(definer)
     **안에서 부를 때는 그 함수의 권한으로 돈다** — 필요한 자리에서는 열리고
     밖에서는 닫힌다. 빗장을 하나 더 다는 것보다 **애초에 못 닿게** 하는 쪽이다. */
create or replace function public.strike_count(p_user uuid, p_days int default 180)
returns int language sql stable security invoker
set search_path = public, extensions as $$
  select count(*)::int
  from public.operator_log l
  where l.target_id = p_user
    and l.action = 'remove_pin'
    and l.at > now() - make_interval(days => greatest(1, p_days));
$$;

-- ---------------------------------------------------------------------
-- ③ 사다리를 밟는다 — 내리고 · 벌을 정하고 · **알린다**
-- ---------------------------------------------------------------------
create or replace function public.api_mod_enforce(
  p_pin    uuid,
  p_why    text,
  p_report uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  me     uuid := auth.uid();
  owner  uuid;
  paths  text[];
  n      int;
  act    text;
  til    timestamptz;
  t      text;
  b      text;
begin
  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다' using errcode = '42501';
  end if;

  select user_id into owner from public.pins where id = p_pin;
  if owner is null then
    raise exception '그런 기록이 없습니다' using errcode = 'P0002';
  end if;

  /* ★ 내리는 것은 074 를 **그대로 부른다.** 같은 일을 두 번 쓰면 둘이 갈라진다.
     (definer 안에서 definer 를 불러도 `auth.uid()` 는 그대로다 — 068 이
      `current_user` 가 아니라 `auth.uid()` 로 가르는 이유와 같은 성질이다) */
  paths := public.api_mod_remove_pin(p_pin, p_why, p_report);

  /* ★ **내린 뒤에** 센다. 방금 것이 포함돼야 "이번이 몇 번째"가 된다. */
  n := public.strike_count(owner);

  /* ★ 운영자는 정지하지 않는다(074 와 같은 이유). 내용은 내리되 거기서 멈춘다 —
     예외로 터뜨리면 **이미 내린 것까지 되돌아간다.** */
  if exists (select 1 from public.operators o where o.user_id = owner) then
    act := 'warned';
    t := '기록이 내려갔습니다';
    b := '운영자 계정이라 정지는 걸지 않았습니다. 사유: ' || p_why;
  elsif n <= 1 then
    act := 'warned';
    t := '기록이 내려갔습니다 (경고)';
    b := '올리신 기록 하나가 운영 규정에 맞지 않아 내려갔습니다. 사유: ' || p_why
      || E'\n이번에는 경고로 끝냅니다. 다시 반복되면 계정 이용이 7일간 멈춥니다.';
  elsif n = 2 then
    til := now() + interval '7 days';
    act := 'suspended';
    t := '7일간 이용이 멈춥니다';
    b := '두 번째입니다. 사유: ' || p_why
      || E'\n' || to_char(til, 'YYYY-MM-DD') || ' 까지 로그인할 수 없습니다.';
    update auth.users set banned_until = til where id = owner;
  else
    /* ★ '영구' 라고 쓰지만 칸은 시각 하나뿐이다. 100년을 넣고 **그렇다고 적는다** —
       나중에 푸는 길(api_mod_unsuspend_user)이 있으므로 진짜 영구는 아니다. */
    til := now() + interval '100 years';
    act := 'banned';
    t := '계정 이용이 멈췄습니다';
    b := '반복해서 규정을 어기셨습니다(' || n || '회). 사유: ' || p_why
      || E'\n이의가 있으시면 bicycletrip2018@gmail.com 으로 알려 주십시오.';
    update auth.users set banned_until = til where id = owner;
  end if;

  if act <> 'warned' then
    insert into public.operator_log (actor_id, target_id, action, note)
    values (me, owner, case when act = 'banned' then 'suspend' else 'suspend' end,
            p_why || ' (사다리 ' || n || '회 → ' || act || ')');
  end if;

  /* ★ **알린다.** 이 한 줄이 이 마이그레이션의 이유다. */
  insert into public.user_notices (user_id, kind, title, body, pin_id)
  values (owner, act, t, b, p_pin);

  return jsonb_build_object(
    'paths', to_jsonb(paths), 'strike', n, 'action', act, 'until', til);
end $$;

comment on function public.api_mod_enforce(uuid, text, uuid) is
  '신고된 기록을 내리고 횟수에 따라 경고/7일/영구를 매기고 사용자에게 알린다(§13.147).';

-- ---------------------------------------------------------------------
-- ④ 사용자가 읽는 자리
-- ---------------------------------------------------------------------
create or replace function public.api_my_notices(p_limit int default 20)
returns table (id uuid, kind text, title text, body text,
               created_at timestamptz, read_at timestamptz)
language sql stable security invoker
set search_path = public, extensions as $$
  select n.id, n.kind, n.title, n.body, n.created_at, n.read_at
  from public.user_notices n          -- ★ RLS 가 본인 것만 준다(invoker 다)
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

create or replace function public.api_notice_read(p_ids uuid[])
returns int language sql security invoker
set search_path = public, extensions as $$
  with u as (
    update public.user_notices set read_at = now()
     where id = any(coalesce(p_ids, '{}')) and read_at is null
     returning 1)
  select count(*)::int from u;
$$;

revoke all on function public.api_mod_enforce(uuid, text, uuid) from public, anon;
revoke all on function public.strike_count(uuid, int)           from public, anon;
grant execute on function public.api_mod_enforce(uuid, text, uuid) to authenticated;
grant execute on function public.api_my_notices(int)               to authenticated;
grant execute on function public.api_notice_read(uuid[])           to authenticated;
