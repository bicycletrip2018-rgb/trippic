-- =====================================================================
-- 055 `갈 곳` 의 표지를 **사용자 사진으로** (§12.25-A · §13.74)
--
-- ★ 원래 §12.25-A 는 이렇게 적혀 있었다:
--     *"그 장소에 우리 사용자의 공개 A컷이 **한 장이라도** 있으면, 그게 표지다."*
--   **그 규칙은 029 가 이미 뒤집었다.** 029 의 말:
--     *"사용자 사진이 하나라도 있으면 무조건 이긴다 — 그건 경쟁이 아니라
--       저울에 손을 얹은 것이다(§13.8)."*
--   → 그래서 여기서 표지를 **다시 고르지 않는다.** `place_stats.top_media_id`
--     하나를 읽어 온다. 표지를 정하는 곳은 **029 한 군데뿐이어야 한다.**
--     (아무도 안 본 장소에서는 029 의 폴백이 곧 §12.25-A 와 같은 답을 낸다.
--      그래서 첫날에도 사용자 사진이 표지가 되고, 데이터가 쌓이면 §13.8 이 맡는다.)
--
-- ★ 탭2 가 못 하던 일은 *"표지를 고르는 것"* 이 아니라 **"이미 고른 표지를 읽는 것"**
--   이었다. 씨앗(`feed-seed.json`)의 관광공사 사진만 그리고 있었다 —
--   §12.25-B 가 *"첫인상이 관공서 포스터로 결정된다"* 고 예측한 바로 그 상태다.
--
-- ★ **출처를 같이 내려준다.** `@민지의 사진` 과 `한국관광공사` 는 보는 마음이
--   다르다. 출처를 못 적으면 사용자 사진을 써도 *"내 사진이 그 장소의 얼굴이
--   된다"* 는 동기가 안 생긴다 — 그게 이 기능의 절반이다.
-- =====================================================================

/* ── 닉네임 한 개만 꺼내는 좁은 창구 ────────────────────────────────
   ★ `profiles` 는 anon·authenticated 에서 **select 가 취소돼 있다**(006).
     그래서 표지 함수 전체를 `security definer` 로 만들고 싶어지는데, 그러면
     핀·미디어의 RLS 까지 통째로 우회한다. **필요한 만큼만 올린다** —
     닉네임 한 칸만 definer 로 열고, 공개 여부 판정은 invoker 인 아래 함수가
     RLS 그대로 받는다. 044 의 `space_display_name` 과 같은 모양이다. */
create or replace function public.display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select p.nickname from public.profiles p
   where p.id = p_user and p.deleted_at is null
$$;

comment on function public.display_name is
  '공개 화면에 적을 닉네임 하나. profiles 는 직접 못 읽으므로(006) 이 칸만 연다.';

drop function if exists public.api_place_covers(uuid[]);

create or replace function public.api_place_covers(p_ids uuid[])
returns table (
  place_id  uuid,
  url       text,
  thumb_url text,
  author    text,     -- 사용자 사진일 때만 채운다. null 이면 화면이 기관 출처로 적는다
  pin_count int
)
language sql stable security invoker set search_path = public, extensions as $$
  select st.place_id,
         m.url,
         /* 047 이 작은 판을 올린다. 없으면 본판으로 떨어진다 —
            `coalesce` 를 화면이 아니라 여기서 한다(§13.47과 같은 규칙). */
         coalesce(m.thumb_url, m.url),
         public.display_name(p.user_id),
         st.pin_count
  from public.place_stats st
  join public.media m on m.id = st.top_media_id
  join public.pins  p on p.id = m.pin_id
  /* ★ 한 번에 묻는 개수를 **막는다.** 탭2 는 묶음 몇 개 × 12장이라 60 안쪽인데,
     막아 두지 않으면 어느 날 화면이 커질 때 이 함수가 조용히 무거워진다. */
  where st.place_id = any(p_ids[1:80])
    and st.top_media_id is not null
$$;

comment on function public.api_place_covers is
  '장소들의 표지 사진과 찍은 사람. 표지를 고르지는 않는다 — 029 가 고른 top_media_id 를 읽기만 한다(§12.25-A·§13.74).';

grant execute on function public.display_name(uuid) to anon, authenticated;
grant execute on function public.api_place_covers(uuid[]) to anon, authenticated;

select public.lock_function_privileges();
