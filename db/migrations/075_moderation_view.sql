-- =====================================================================
-- 075 **신고된 것만** 운영자가 본다 (§13.145)
--
-- ── 074 가 남긴 구멍 ───────────────────────────────────────────────
-- 운영자는 이제 지울 수 있다. 그런데 **무엇을 지우는지 보지 못한다.**
-- `api_report_queue` 가 주는 것은 `target_id · reason · label · address` 뿐이고
-- **사진은 안 준다**. 지금은 대시보드를 따로 열어야 보인다 —
-- *"24시간 안에 확인하고"* 의 **확인**이 제품 밖에 있다.
--
-- ── 왜 '전부 보기' 가 아니라 '신고된 것만' 인가 ────────────────────
-- 기술적으로는 `pins_read` 에 `or is_operator()` 한 줄이면 **모든 비공개 기록**이
-- 운영자에게 열린다. 두 줄도 안 된다. 그런데 그러면:
--
--   · 방침에 그런 열람을 한다고 **안 적혀 있다.** 적지 않고 보는 것은
--     개인정보보호법의 목적 외 이용이다.
--   · 적으면 *"운영자가 내 사진을 다 본다"* 가 되어 **쓸 이유가 줄어든다.**
--     이 앱의 기본값이 '나만 보기' 인 이유가 바로 그것이다(§13.136).
--
-- ★ 그래서 **열람 범위를 신고로 묶는다.** 신고가 있어야 열리고, 열 때마다
--   **누가 무엇을 언제 열었는지** 남는다. 권한이 아니라 **사유**가 문을 연다.
--
-- ★★ 이 벽은 **앱 안에서만** 유효하다. 대시보드·서비스 키를 쥔 사람은 어차피
--    전부 본다. 그건 어떤 SQL 로도 못 막는다 — **막은 척하지 않는다.**
--    여기서 막는 것은 *"제품 기능으로 상시 열람을 만들지 않는다"* 뿐이다.
-- =====================================================================

-- 'view' 를 동작 목록에 올린다(074 가 늘린 그 CHECK).
alter table public.operator_log drop constraint if exists operator_log_action_check;
alter table public.operator_log add  constraint operator_log_action_check
  check (action = any (array['grant','revoke','remove_pin','suspend','unsuspend','view']));

create or replace function public.api_mod_reported_pin(p_pin uuid)
returns table (
  pin_id      uuid,
  owner_id    uuid,
  memo        text,
  is_public   boolean,
  deleted_at  timestamptz,
  visited_at  timestamptz,
  place_name  text,
  media_id    uuid,
  media_type  text,
  url         text,
  thumb_url   text,
  poster_url  text,
  reports     int,
  reasons     text[]
)
language plpgsql security definer
set search_path = public, extensions as $$
declare
  me   uuid := auth.uid();
  n    int;
begin
  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다' using errcode = '42501';
  end if;

  /* ★ **신고가 문을 연다.** 신고가 없으면 운영자여도 못 본다 —
     이 한 줄이 '전부 보기' 와 '신고된 것만' 을 가른다.
     ★ 처리된 신고(resolved)도 센다. 이미 판단한 건을 다시 들여다봐야 할 때가
       있고(이의 제기·재조사), 그때 못 보면 판단을 못 뒤집는다. */
  select count(*) into n
  from public.reports r
  where r.target_type = 'pin' and r.target_id = p_pin;

  if n = 0 then
    raise exception '신고된 기록이 아닙니다 — 신고가 있어야 열립니다'
      using errcode = '42501';
  end if;

  /* ★ **열기 전에 적는다.** 뒤에 적으면 예외가 나거나 중간에 끊겼을 때
     본 사실이 안 남는다. 본 것은 돌이킬 수 없으므로 기록도 돌이킬 수 없어야 한다. */
  insert into public.operator_log (actor_id, target_id, action, note)
  select me, pi.user_id, 'view', '신고 확인 (pin=' || p_pin || ')'
  from public.pins pi where pi.id = p_pin;

  return query
  select pi.id, pi.user_id, pi.memo, pi.is_public, pi.deleted_at, pi.visited_at,
         pl.name,
         m.id, m.type::text, m.url, m.thumb_url, m.poster_url,
         n,
         (select array_agg(distinct r2.reason) from public.reports r2
           where r2.target_type = 'pin' and r2.target_id = p_pin)
  from public.pins pi
  left join public.places pl on pl.id = pi.place_id
  left join public.media  m  on m.pin_id = pi.id
  where pi.id = p_pin
  order by m.is_main desc nulls last, m.sort_order nulls last;
end $$;

comment on function public.api_mod_reported_pin(uuid) is
  '신고된 기록 하나를 운영자가 본다. 신고가 없으면 열리지 않고, 열 때마다 operator_log 에 남는다(§13.145).';

/* ★ 운영자가 **자기가 무엇을 열었는지** 돌아볼 수 있어야 한다. 감사는 남이
   하는 것이기도 하지만, 먼저 **자기가 보는 것**이다. */
create or replace function public.api_mod_view_log(p_limit int default 100)
returns table (at timestamptz, actor uuid, target uuid, action text, note text)
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  /* ★ 처음엔 `where public.is_operator()` 한 줄로 썼다가 **거짓말이 됐다** —
     그건 거절이 아니라 **빈 결과**다. 부른 쪽은 *"기록이 아직 없구나"* 와
     *"너는 볼 수 없다"* 를 **구별하지 못한다.** 스모크가 첫 판에 잡았다.
     거절은 거절이라고 말해야 한다. */
  if not public.is_operator() then
    raise exception '운영자만 볼 수 있습니다' using errcode = '42501';
  end if;
  return query
    select l.at, l.actor_id, l.target_id, l.action, l.note
    from public.operator_log l
    order by l.at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

revoke all on function public.api_mod_reported_pin(uuid) from public, anon;
revoke all on function public.api_mod_view_log(int)      from public, anon;
grant execute on function public.api_mod_reported_pin(uuid) to authenticated;
grant execute on function public.api_mod_view_log(int)      to authenticated;
