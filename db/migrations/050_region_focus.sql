-- =====================================================================
-- 050 지역을 누르면 **기록이 있는 곳**으로 간다 (§13.61)
--
-- ★ 지금은 행정구역 **bbox 한가운데**로 날아간다. 그래서 해운대구를 누르면
--   장산 산지에 떨어진다 — 내 기록도, 상호도, 아무것도 없는 곳이다.
--   *"지역을 눌렀다"* 는 *"거기 뭐가 있는지 보자"* 는 뜻이지
--   *"그 행정구역의 기하학적 중심을 보자"* 가 아니다.
--
-- ★ 그러면 어디로 가야 하나 — **그 지역에서 지금 스코프로 보이는 핀 전부가
--   들어오는 상자**다. 한 곳이면 그 한 곳으로, 여럿이면 다 담기게.
--   집계를 읽을 때 **같이** 계산한다: 탭할 때 또 물으면 그만큼 지도가 늦게 움직인다.
--
-- ★ 0곳 지역은 애초에 돌려주지 않으므로(042) 상자가 null 인 줄은 없다.
--   화면은 집계에 없는 지역을 누르면 예전처럼 bbox 로 떨어뜨린다.
-- =====================================================================

drop function if exists public.api_pins_by_region(text, pin_category, uuid);

create or replace function public.api_pins_by_region(
  p_scope text default 'mine_all',
  p_cat   pin_category default null,
  p_space uuid default null
)
returns table (
  region_code text, n int, n_mine int, n_shared int,
  bw double precision, bs double precision, be double precision, bn double precision
)
language sql stable security invoker set search_path = public, extensions as $$
  select s.region_code,
         count(*)::int,
         count(*) filter (where s.is_mine)::int,
         count(*) filter (where s.shared_with_me and not s.is_mine)::int,
         /* 이 지역에서 **지금 보이는 핀들**이 차지하는 상자 */
         min(ST_X(s.geom)), min(ST_Y(s.geom)),
         max(ST_X(s.geom)), max(ST_Y(s.geom))
  from public.pin_scoped s
  where s.region_code is not null
    and (p_cat is null or s.category = p_cat)
    and (p_space is null or exists (
          select 1 from public.pin_spaces ps
          where ps.pin_id = s.id and ps.space_id = p_space))
    and case p_scope
          when 'mine'     then s.is_mine
          when 'public'   then s.is_public
          when 'shared'   then s.shared_with_me
          when 'mine_all' then (s.is_mine or s.shared_with_me)
          else true
        end
  group by s.region_code
$$;

comment on function public.api_pins_by_region(text, pin_category, uuid) is
  '지역별 핀 수 + 그 핀들이 차지하는 상자(bw/bs/be/bn). 상자는 지역을 눌렀을 때 어디로 갈지에 쓴다 — 행정구역 한가운데는 대개 산이다.';

grant execute on function public.api_pins_by_region(text, pin_category, uuid) to anon, authenticated;

select public.lock_function_privileges();
