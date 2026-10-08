-- =====================================================================
-- 089 리 집계가 **경계까지 같이** 준다 (§13.165)
--
-- 088 은 둘을 갈라 뒀다 — 숫자는 `api_pins_by_village`, 경계는
-- `api_villages_in_bbox`. 그런데 **우리가 그리는 것은 «가 본 리» 뿐**이다
-- (087 에서 읍면동을 그렇게 고쳤다 — §13.164).
--
-- 화면 상자로 경계를 받으면 안 그릴 것까지 받는다:
--   리 하나가 30m 단순화에 약 1~3 KB → 상자 안 120개면 **150~350 KB**
--   지도를 밀 때마다 그만큼이 오간다. 정작 그리는 것은 한두 개다.
--
-- → **숫자를 주는 함수가 경계도 같이 준다.** 그러면 받는 것이 정확히
--   그리는 것과 같아진다. 한 번에 끝나고, 안 쓰는 바이트가 0이다.
--
-- ★ `api_villages_in_bbox`(088)는 **지우지 않는다.** 나중에 *"주변에 어떤 리가
--   있나"* 를 묻게 되면 그때 쓴다. 다만 지금 화면은 안 쓴다.
-- =====================================================================

drop function if exists public.api_pins_by_village(text, text, pin_category, uuid);

create or replace function public.api_pins_by_village(
  p_region text,
  p_scope  text default 'mine_all',
  p_cat    pin_category default null,
  p_space  uuid default null
)
returns table (
  village_code text, name text, n int, n_mine int, n_shared int,
  cx double precision, cy double precision,
  geojson text
)
language sql stable security invoker set search_path = public, extensions as $$
  with agg as (
    select p.village_code as vc,
           count(*)::int as n,
           count(*) filter (where s.is_mine)::int as nm,
           count(*) filter (where s.shared_with_me and not s.is_mine)::int as ns
    from public.pin_scoped s
    join public.pins p on p.id = s.id
    where p.village_code is not null
      and s.region_code = p_region
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
    group by p.village_code
  )
  select a.vc, v.name, a.n, a.nm, a.ns,
         ST_X(v.center), ST_Y(v.center),
         ST_AsGeoJSON(v.geom, 5)
  from agg a
  join public.villages v on v.code = a.vc
$$;

comment on function public.api_pins_by_village is
  '한 시군구 안에서 **내가 가 본 리**의 수와 경계(089). 받는 것이 그리는 것과
   같다 — 상자로 받으면 안 그릴 것까지 받는다.';

grant execute on function public.api_pins_by_village(text, text, pin_category, uuid)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
