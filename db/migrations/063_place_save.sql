-- =====================================================================
-- 063 **저장** — 표는 처음부터 있었다 (§13.97 ④ · §13.102)
--
-- ★ **내가 틀렸던 것을 먼저 적는다.** §13.91(장소 상세)과 §13.92(스폰서 줄)에서
--   저장 버튼을 안 만들며 이렇게 적었다:
--
--   > *"`place_stats.save_count` 칸은 있는데 **그 칸을 쓰는 표가 없다.**
--   >   담을 곳이 없으니 버튼은 숫자를 못 올린다."*
--
--   **표는 있었다.** 이름이 `reactions` 다(`kind = like | save`).
--   `save|like|bookmark|favor` 로 **표 이름만 찾아보고** 없다고 결론 내렸다 —
--   이름으로 찾아 못 찾은 것을 *"없다"* 로 적은 것이다. 게다가 그 표는
--   `reaction_target` 에 **`place` 까지 들어 있고**, RLS·권한·집계 트리거까지
--   다 갖춰져 있었다. 두 절에서 "죽은 버튼"을 피한 판단 자체는 맞았지만
--   **근거가 틀렸다**(없어서가 아니라, 세는 곳이 비어 있어서였다).
--
-- ── 진짜로 빠져 있던 것 ──────────────────────────────────────────
-- `reactions` 에 `target_type='place'` 로 넣으면 트리거가
-- `refresh_place_stats(place_id)` 를 부른다. 그런데 그 함수는 **핀의 저장만** 센다:
--
--     coalesce(sum(p.save_count), 0)   -- pins 의 save_count 합
--
-- 즉 **장소를 저장해도 아무 숫자도 안 움직였다.** 문은 났는데 손잡이가 없는
-- §13.67 과 같은 모양이다.
--
-- ★ **칸을 새로 만든다.** 기존 `save_count` 에 더하지 않는다 — 둘은 **다른 뜻**이다:
--     `save_count`       = 이 장소의 **기록(핀)** 을 저장한 수
--     `place_save_count` = **이 장소 자체** 를 저장한 수 (네이버의 ★)
--   한 칸에 섞으면 *"무엇이 저장됐는가"* 를 영영 되물을 수 없고,
--   `compute_place_score` 가 그 합을 한 입력으로 먹는다.
--
-- ★ **점수식은 건드리지 않는다.** 장소 저장을 순위에 넣을지는 **재 보고** 정할 일이다
--   (지금은 0건이라 어느 쪽이 나은지 알 길이 없다). 숫자부터 쌓는다.
-- =====================================================================

alter table public.place_stats
  add column if not exists place_save_count int not null default 0;
comment on column public.place_stats.place_save_count is
  '이 장소 **자체** 를 저장한 사람 수. 핀을 저장한 수(save_count)와 다른 뜻이다(§13.102).';

-- ── 집계가 장소 저장을 세게 한다 ──────────────────────────────────
-- ★ **029 판 위에 얹는다.** 처음에 004 판을 베꼈다가 스모크가 바로 잡았다
--   (*"축소 화면은 공개 핀만 센다"* 가 깨졌다) — 이 함수는 **여섯 번** 고쳐졌고
--   (004→008→009→010→011→029) 004 를 복사하는 순간 공개 자격·화질·대표 사진
--   고르기·`public_pin_count` 갱신이 **통째로 되돌아간다.**
--   여러 번 고쳐 쓴 함수는 **가장 최근 판을 찾아서** 거기에 더해야 한다.
create or replace function public.refresh_place_stats(p_place uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  v_top uuid;
  v_has_score boolean := false;
  v_psave int;
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

  /* ★ 늘어난 한 줄(§13.102) — **장소 자체** 를 저장한 수.
     `security definer` 라 RLS 를 지나지 않는다. 여기서는 그것이 맞다: 이 숫자는
     *"몇 명이 저장했나"* 라 **남의 저장도 세야** 하고, 누가 했는지는 안 남긴다. */
  select count(*)::int into v_psave
  from public.reactions r
  where r.target_type = 'place' and r.target_id = p_place and r.kind = 'save';

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
     save_count, like_count, media_count, place_save_count, top_media_id, score, updated_at)
  values (p_place, s.pin_count, s.visitor_count, s.live_count, s.note_count,
          s.save_count, s.like_count, s.media_count, v_psave, v_top,
          public.compute_place_score(s.visitor_count, s.live_count, s.pin_count,
                                     s.save_count, s.like_count, s.note_count),
          now())
  on conflict (place_id) do update set
    pin_count = excluded.pin_count, visitor_count = excluded.visitor_count,
    live_count = excluded.live_count, note_count = excluded.note_count,
    save_count = excluded.save_count, like_count = excluded.like_count,
    media_count = excluded.media_count,
    place_save_count = excluded.place_save_count,
    top_media_id = excluded.top_media_id, score = excluded.score,
    updated_at = now();

  -- ★ 011이 하던 일. 이걸 빠뜨려 축소 화면이 0을 셌다.
  update public.places
     set public_pin_count = s.pin_count
   where id = p_place and public_pin_count is distinct from s.pin_count;
end $$;

-- ── 장소 상세가 **저장 상태**를 같이 준다 ─────────────────────────
-- ★ 돌려주는 칸이 늘면 `create or replace` 가 안 된다 — 먼저 지운다(058 과 같다).
drop function if exists public.api_place_detail(uuid);

create or replace function public.api_place_detail(p_place uuid)
returns table (
  place_id        uuid,
  name            text,
  category        pin_category,
  address         text,
  region_name     text,
  lng             double precision,
  lat             double precision,
  image_url       text,
  image_thumb_url text,
  image_license   text,
  event_start     date,
  event_end       date,
  concept         text,
  closed_at       timestamptz,
  cover_url       text,
  cover_thumb_url text,
  cover_author    text,
  pin_count       int,
  visitor_count   int,
  media_count     int,
  mine_count      int,
  mine_last_at    timestamptz,
  /** 이 장소를 저장한 사람 수 */
  save_count      int,
  /** ★ **내가** 저장했는가. 버튼이 켜졌는지를 이 칸이 정한다 */
  saved           boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.id, p.name, p.category, p.address, rg.name,
         ST_X(p.geom), ST_Y(p.geom),
         p.image_url, p.image_thumb_url, p.image_license,
         p.event_start, p.event_end, p.concept, p.closed_at,
         cm.url,
         coalesce(cm.thumb_url, cm.url),
         public.display_name(cp.user_id),
         coalesce(st.pin_count, 0), coalesce(st.visitor_count, 0),
         coalesce(st.media_count, 0),
         mine.n, mine.last_at,
         coalesce(st.place_save_count, 0),
         /* ★ RLS(`reactions_read_own`)가 **내 것만** 준다 — 여기서 또 거르지 않는다.
            남의 저장 여부는 애초에 읽히지 않는다(§10 home_geom 과 같은 원칙). */
         exists (select 1 from public.reactions r
                  where r.target_type = 'place' and r.target_id = p.id
                    and r.kind = 'save')
  from public.places p
  left join public.regions     rg on rg.code = p.region_code
  left join public.place_stats st on st.place_id = p.id
  left join public.media       cm on cm.id = st.top_media_id
  left join public.pins        cp on cp.id = cm.pin_id
  left join lateral (
    select count(*)::int as n, max(mp.visited_at) as last_at
    from public.pins mp
    where mp.place_id = p.id
      and mp.user_id = auth.uid()
      and mp.deleted_at is null
  ) mine on true
  where p.id = p_place;
$$;
comment on function public.api_place_detail is
  '장소 한 곳의 상세 — 사실·표지·집계·내가 가 봤는지·내가 저장했는지(§13.102).';

grant execute on function public.api_place_detail(uuid) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 나중에 할 것 (지금 하면 추측이 된다)
--   · **저장한 곳 목록** — 어디에 둘지는 몇 개나 저장하는지 보고 정한다.
--     0건인 지금 탭을 늘리면 §12.4·§12.26-A 가 두 번 거절한 "빈 탭"이 또 생긴다
--   · 점수식에 장소 저장을 넣을지 — 넣기 전에 **얼마나 쌓이는지** 센다
--   · 지도에 저장한 곳 표시 — 목록보다 이쪽이 먼저일 수도 있다. 역시 재고 정한다
-- ---------------------------------------------------------------------
