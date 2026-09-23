-- =====================================================================
-- TRIPPIC · 029 표지를 **노출 대비**로 고른다 + 사진 수 채우기
--
-- 011의 `refresh_place_stats`는 표지를 이렇게 골랐다:
--     order by m.focus_score desc, p.like_count desc, p.save_count desc, ...
--
-- ★ 반응 부분이 전부 **누적**이다. 셋이 잘못된다:
--   1. 오래 걸려 있었다는 이유로 이긴다 — 노출이 많았을 뿐이다
--   2. 한 번 표지가 되면 노출이 늘어 영영 안 바뀐다 (되먹임이 끊긴다)
--   3. 기관 사진(§12.16)이 아예 후보가 아니다 — 사용자 사진이 하나라도 있으면
--      무조건 진다. 그건 경쟁이 아니라 저울에 손을 얹은 것이다 (§13.8)
--
-- → `cover_candidates`(027)의 Wilson 점수를 **1순위**로 쓰고,
--   점수가 없을 때(아무도 아직 안 본 장소)만 옛 기준으로 떨어진다.
--
-- ★ 011이 하던 일을 **하나도 빼지 않는다.**
--   `public_pin_count` 갱신·`public_ok`/`quality_ok` 필터·`compute_place_score` —
--   이 함수를 004판에서 베껴 쓰다가 `public_pin_count` 갱신을 통째로 날려
--   축소 화면이 0을 세는 것을 동작 검증이 잡았다. 함수를 갈아끼울 때는
--   **가장 최근 정의**를 읽고 시작한다.
-- =====================================================================

create or replace function public.refresh_place_stats(p_place uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  v_top uuid;
  v_has_score boolean := false;
begin
  if p_place is null then return; end if;

  -- 공개 가능한 사진이 1장 이상 있는 공개 핀만 센다 (011)
  select count(*)::int                                         as pin_count,
         count(distinct p.user_id)::int                        as visitor_count,
         count(*) filter (where p.verification = 'live')::int   as live_count,
         count(*) filter (where p.memo is not null
                            and length(btrim(p.memo)) > 0)::int as note_count,
         coalesce(sum(p.save_count), 0)::int                    as save_count,
         coalesce(sum(p.like_count), 0)::int                    as like_count,
         coalesce(sum(p.media_count), 0)::int                   as media_count
    into s
  from public.pins p
  where p.place_id = p_place and p.deleted_at is null and p.is_public
    and exists (select 1 from public.media m
                 where m.pin_id = p.id and m.public_ok and m.quality_ok);

  /* ★ 표지 1순위 — 노출 대비 점수. 실제로 **본 사람이 있을 때만** 쓴다.
     ★ 기관 사진(media_id is null)이 이기면 top_media_id 는 null 로 남는다.
       그건 "표지가 없다"가 아니라 **"기관 사진이 이겼다"**는 뜻이다 —
       화면은 places.image_url 로 떨어지면 된다 (§12.16). */
  select cc.media_id, true into v_top, v_has_score
  from public.cover_candidates cc
  where cc.place_id = p_place and cc.imp > 0
  order by cc.score desc, cc.imp desc
  limit 1;

  /* 아직 아무도 안 본 장소 — 옛 기준으로 하나 고른다. 첫날 화면이 비면 안 된다.
     ★ `select ... into` 가 0행이면 대상 변수는 false 가 아니라 **NULL** 이 된다.
       `if not v_has_score` 는 `not NULL` = NULL 이라 **분기가 통째로 안 돈다** —
       폴백이 영영 실행되지 않아 대표 사진이 비었다. coalesce 로 못 박는다. */
  if not coalesce(v_has_score, false) then
    select m.id into v_top
    from public.pins p
    join public.media m on m.pin_id = p.id
    where p.place_id = p_place and p.deleted_at is null and p.is_public
      and m.public_ok and m.quality_ok
    order by m.focus_score desc nulls last,
             p.like_count desc, p.save_count desc, m.is_main desc, m.sort_order asc
    limit 1;
  end if;

  insert into public.place_stats as ps
    (place_id, pin_count, visitor_count, live_count, note_count,
     save_count, like_count, media_count, top_media_id, score, updated_at)
  values (p_place, s.pin_count, s.visitor_count, s.live_count, s.note_count,
          s.save_count, s.like_count, s.media_count, v_top,
          public.compute_place_score(s.visitor_count, s.live_count, s.pin_count,
                                     s.save_count, s.like_count, s.note_count),
          now())
  on conflict (place_id) do update set
    pin_count = excluded.pin_count, visitor_count = excluded.visitor_count,
    live_count = excluded.live_count, note_count = excluded.note_count,
    save_count = excluded.save_count, like_count = excluded.like_count,
    media_count = excluded.media_count,
    top_media_id = excluded.top_media_id, score = excluded.score,
    updated_at = now();

  -- ★ 011이 하던 일. 이걸 빠뜨려 축소 화면이 0을 셌다.
  update public.places
     set public_pin_count = s.pin_count
   where id = p_place and public_pin_count is distinct from s.pin_count;
end $$;

comment on function public.refresh_place_stats(uuid) is
  '장소 집계. 표지는 본 사람이 있으면 cover_candidates 의 노출 대비 Wilson 점수로, 없으면 focus_score 로 고른다 — 기관 사진도 이길 수 있다(§13.8).';
