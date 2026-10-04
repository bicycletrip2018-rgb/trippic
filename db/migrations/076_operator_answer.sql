-- =====================================================================
-- 076 **거절은 거절이라고 말한다** (§13.146)
--
-- 어드민 화면을 처음 띄우자마자 잡혔다: **운영자가 아닌 계정이 들어왔는데
-- "운영자로 들어와 있습니다" 가 떴다.**
--
-- 원인은 072 의 `api_report_queue` 다. 운영자가 아니면 **빈 결과**를 돌려준다 —
-- 예외가 아니다. 화면은 *"예외가 안 났으니 운영자구나"* 로 읽었고,
-- 그 다음 줄에 *"처리할 신고가 없습니다"* 를 띄웠다.
--
-- ★ `api_mod_view_log` 에서 **방금 고친 것과 똑같은 결함**이다(§13.145).
--   그때는 내 새 코드였고 이번엔 072 가 원래 그랬다. 같은 모양이 두 번 나왔으니
--   취향이 아니라 **규칙**으로 적는다:
--
--     *"볼 수 없다"* 와 *"볼 것이 없다"* 는 **다른 답이다.**
--     하나로 뭉치면 부른 쪽이 고장과 빈손을 구별하지 못한다.
--
-- ── 두 가지를 고친다 ───────────────────────────────────────────────
--   ① `api_report_queue` — 운영자가 아니면 **거절한다**(빈손이 아니라)
--   ② `api_am_i_operator()` — 화면이 **물어볼 자리**를 준다.
--      이건 보호할 자원이 아니라 **질문**이므로 예외가 아니라 true/false 다.
--      (자기 상태를 묻는 것까지 거절하면 화면이 무엇을 그릴지 못 정한다)
-- =====================================================================

create or replace function public.api_am_i_operator()
returns boolean
language sql stable security definer
set search_path = public, extensions as $$
  /* ★ 여기서는 **거절하지 않는다.** 묻는 것 자체는 비밀이 아니고,
     답이 false 인 것이 곧 답이다. 로그인조차 안 했으면 false 다. */
  select public.is_operator();
$$;

comment on function public.api_am_i_operator() is
  '지금 로그인한 사람이 운영자인가. 화면이 무엇을 그릴지 정하는 데 쓴다(§13.146).';

/* ② 큐는 거절한다 — 072 의 본문을 그대로 두고 **빗장만 앞에 세운다** */
create or replace function public.api_report_queue(
  p_status public.report_status default 'open',
  p_limit  int default 50
) returns table (
  target_type public.reaction_target,
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
language plpgsql stable security definer
set search_path = public, extensions as $$
begin
  if not public.is_operator() then
    raise exception '운영자만 볼 수 있습니다' using errcode = '42501';
  end if;
  return query
  select r.target_type,
         r.target_id,
         string_agg(distinct r.reason, ' / ')::text,
         count(*)::int,
         min(r.created_at),
         max(r.created_at),
         array_agg(r.id),
         coalesce(pl.name, pl2.name, '(이름 없음)')::text,
         coalesce(pl.address, pl2.address)::text,
         null::real,
         coalesce(pl.region_code, pl2.region_code)::text,
         false,
         0
  from public.reports r
  left join public.pins   pi  on r.target_type = 'pin'   and pi.id = r.target_id
  left join public.places pl  on pl.id = pi.place_id
  left join public.places pl2 on r.target_type = 'place' and pl2.id = r.target_id
  where r.status = p_status
  group by r.target_type, r.target_id, pl.name, pl2.name,
           pl.address, pl2.address, pl.region_code, pl2.region_code
  order by max(r.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.api_am_i_operator() from public, anon;
grant execute on function public.api_am_i_operator() to authenticated, anon;
