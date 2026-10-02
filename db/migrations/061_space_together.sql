-- =====================================================================
-- 061 스페이스 = **함께 채운 지도** — 같이 간 곳과 혼자 다녀온 곳 (§13.16 · §13.94)
--
-- §13.16 이 웹에서 이 화면을 만들며 **규칙 둘**을 적어 뒀다. RN 에는 둘 다 없다.
--
-- ── ① `함께 채운 N곳` 은 **합집합이지 합계가 아니다** ─────────────────
-- > *"셋이 같은 곳에 갔으면 3곳이 아니라 1곳이다. 합계로 세면 '같이 간 여행'이
-- >   세 배로 부풀어 **숫자가 거짓말을 한다** — 함께 갈수록 커지는 지표는
-- >   협업을 재는 게 아니라 중복을 재는 것이다."*
--
-- ★ RN 화면이 **정확히 그 거짓말을 하고 있었다**: `함께 채운 ${sp.pins}곳`.
--   `pins` 는 052 가 세는 **기록 수**(`count(*) from pin_spaces`)인데 화면이 `곳` 이라
--   불렀다. 셋이 같은 카페에 핀을 꽂으면 *"함께 채운 3곳"* 이 된다.
--   052 의 주석은 *"함께 채운 **기록 수**"* 라고 맞게 적혀 있었다 —
--   **서버는 맞았고 화면이 이름을 바꿔 달았다.**
--
-- ── ② `같이 간 곳` 과 `혼자 다녀온 곳` 을 가른다 ─────────────────────
-- > *"★ 이게 '함께'의 실체다. 혼자 다 채운 스페이스와 셋이 나눠 채운 스페이스는
-- >   **완전히 다른 관계**인데, 총량만 보면 똑같아 보인다.
-- >   공유 지도 앱만 보여줄 수 있는 구별이다."*
--
-- ★ 웹과 **같은 단위**로 센다 — 시·군·구(`prototype/spaces.js: spaceCoverage()`).
--   거기서는 `byRegion[지역] = Set(작성자)` 를 만들고 `size >= 2` 를 `together` 로 친다.
--   단위가 갈라지면 같은 스페이스를 두 화면이 다르게 말한다(§13.37).
--
-- ★ **무엇을 증명하는지 정확히 적는다.** `together` 는 *"그 시·군·구에 **둘 이상이**
--   기록을 남겼다"* 이지 *"같은 날 같이 갔다"* 가 아니다. 더 좁히려면 같은 여행·같은
--   날까지 봐야 하는데, 그건 재 보고 정할 일이지 지금 지어낼 것이 아니다.
--   (화면도 그래서 숫자 옆에 단위를 적는다.)
--
-- ★ 클라이언트가 세지 않는다. 세려면 그 스페이스의 핀을 **전부** 내려받아야 하고,
--   목록 한 줄을 그리자고 수백 줄을 받는 일이 된다(§13.67 이 `regions` 에서 한 판단).
-- =====================================================================

-- 돌려주는 칸이 늘었다 → `create or replace` 로는 안 된다. 먼저 지운다(047·058 과 같다).
drop function if exists public.api_my_spaces();

create or replace function public.api_my_spaces()
returns table (
  id uuid, title text, auto_title boolean,
  members int,
  /** 이 방에 공유된 **기록 수**. `곳` 이 아니다 — 화면이 그렇게 부르면 안 된다 */
  pins int,
  /** 함께 닿은 시·군·구 수 = **합집합** */
  regions int,
  /** 그중 **둘 이상이** 기록을 남긴 시·군·구 */
  together int,
  /** 그중 **한 사람만** 남긴 시·군·구 */
  alone int,
  /** 전국 시·군·구 수 — 화면이 `N / 251` 을 적을 수 있게. 250 을 박아 두지 않는다 */
  region_total int
)
language sql stable security invoker set search_path = public, extensions as $$
  select s.id,
         case when s.auto_title then public.space_display_name(s.id) else s.title end,
         s.auto_title,
         (select count(*)::int from public.space_members m where m.space_id = s.id),
         (select count(*)::int from public.pin_spaces ps
            join public.pins p on p.id = ps.pin_id
           where ps.space_id = s.id and p.deleted_at is null),
         cv.regions, cv.together, cv.alone,
         (select count(*)::int from public.regions)
  from public.spaces s
  /* ★ 지역별로 **몇 사람이** 남겼는지를 한 번만 세고 셋을 같이 낸다.
     together/alone 을 따로 물으면 같은 묶음을 두 번 센다. */
  left join lateral (
    select count(*)::int                            as regions,
           count(*) filter (where n >= 2)::int      as together,
           count(*) filter (where n = 1)::int       as alone
    from (
      select p.region_code, count(distinct p.user_id) as n
      from public.pin_spaces ps
      join public.pins p on p.id = ps.pin_id
      where ps.space_id = s.id
        and p.deleted_at is null
        /* ★ `region_code` 가 없는 핀은 **안 센다** — 좌표만 있고 어느 지역인지
           모르는 것을 '채웠다'고 할 수 없다(052 가 정한 규칙을 그대로 지킨다). */
        and p.region_code is not null
      group by p.region_code
    ) g
  ) cv on true
  where s.type = 'shared' and s.deleted_at is null
    /* RLS(spaces_read)가 이미 내 것만 준다. 여기서 또 확인하지 않는다(§13.37). */
  order by s.created_at desc
  limit 100
$$;
comment on function public.api_my_spaces is
  '내 공유 스페이스 + 함께 채운 시·군·구(합집합)와 같이/혼자 구분. pins 는 기록 수이지 곳이 아니다(§13.94).';

grant execute on function public.api_my_spaces() to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 나중에 할 것 (지금 하면 추측이 된다)
--   · 멤버별 기여(§13.16 의 `도현 157 · 서연 152`) — 목록 한 줄에는 안 들어간다.
--     스페이스 상세 화면이 생기는 날 같이 붙인다
--   · `같이 간` 을 **같은 날**까지 좁히기 — 지금은 *"둘 이상이 남겼다"* 다.
--     좁히면 숫자가 얼마나 줄어드는지 **재 보고** 정한다
--   · 스페이스 탭 안의 합산 지도 — §13.67 이 *"지도를 한 벌 더 그리지 않는다"* 로
--     정했다(§13.37). 뒤집으려면 그 이유부터 뒤집어야 한다
-- ---------------------------------------------------------------------
