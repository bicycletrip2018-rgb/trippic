-- =====================================================================
-- 098 댓글은 **표만 있고 길이 없었다** + 남의 기록 하나 보기 (§13.180)
--
-- ★ 댓글을 만들려다 **이미 있는 것**을 먼저 찾았다. 네 번째다
--   (§13.153 flyToAgg · §13.159 places(name) · §13.166 리 집계 ·
--    §13.171 api_place_media).
--
--     public.comments      028 이 만들어 뒀다 (본문 1~300자 제약까지)
--     bump_comment_count   핀의 comment_count 를 갱신하는 트리거도 있다
--     RLS 정책 셋          읽기·쓰기·지우기 전부 걸려 있다
--
--   없던 것은 **두 가지**였다:
--     ① `authenticated` 에게 **표 권한이 한 줄도 없다.** 정책은 *"어느 줄을"* 을
--        정하고 GRANT 는 *"그 표를 만질 수 있나"* 를 정한다 — 072 가 똑같은 데서
--        `permission denied for table blocks` 로 멈췄다고 적어 뒀는데 **또 걸렸다.**
--     ② 읽고 쓰는 **함수가 없다.** 그래서 화면을 만들 수가 없었고, 핀의
--        `comment_count` 는 영영 0 이었다.
--
-- ★ **「모두의 지도」에는 안 연다.** 028 의 정책이 «공유 스페이스 멤버» 로 좁혀
--   놓았고, 무엇보다 **소식 탭이 사용자에게 그렇게 적어 두었다**:
--     *"댓글은 없습니다 — 운영할 수 있는 만큼만 엽니다."*
--   그 약속을 서버에서 뒤집으면 화면과 서버가 서로 다른 말을 하게 된다.
--   → 정책은 **한 줄도 안 바꾼다.** 함수는 invoker 라 그 정책을 그대로 받는다.
--
-- ★ 그리고 **남의 기록 하나를 볼 길**이 없었다. 「모두의 지도」에서 장소는 열리는데
--   *"이 사진을 누가 왜 올렸나"* 를 보는 화면이 없고, 그건 함수가 없어서였다.
-- =====================================================================

-- ── ① 권한. 정책이 있어도 이게 없으면 못 만진다 ──────────────────
grant select, insert on public.comments to authenticated;
/* 지우기는 **soft delete** 라 update 다. 정책(`comments_delete_own`)이 제 것만 받는다 */
grant update (deleted_at) on public.comments to authenticated;

-- ── ② 댓글 읽기 ─────────────────────────────────────────────────
create or replace function public.api_comments(
  p_pin uuid, p_limit int default 50, p_offset int default 0
)
returns table (
  id uuid, body text, created_at timestamptz,
  user_id uuid, author text, is_mine boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.body, c.created_at,
         c.user_id, public.display_name(c.user_id), (c.user_id = auth.uid())
  from public.comments c
  where c.pin_id = p_pin
    and c.deleted_at is null
  /* ★ 오래된 것부터. 댓글은 **대화**라 시간 순서가 뜻을 만든다 —
     최신순으로 뒤집으면 답이 질문보다 위에 온다. */
  order by c.created_at, c.id
  limit greatest(1, least(p_limit, 100)) offset greatest(p_offset, 0)
$$;

comment on function public.api_comments is
  '핀 하나의 댓글(098). 공유 스페이스 멤버만 보인다 — 정책(028)이 정하고 이 함수는
   invoker 라 그대로 받는다. 「모두의 지도」에는 댓글이 없다(사용자에게 그렇게 적었다).';

-- ── ③ 댓글 쓰기 ─────────────────────────────────────────────────
create or replace function public.api_comment_add(p_pin uuid, p_body text)
returns table (id uuid, body text, created_at timestamptz, author text)
language plpgsql security invoker set search_path = public, extensions as $$
declare v_id uuid;
begin
  /* 길이는 **표의 제약**(028)이 본다 — 여기서 또 검사하면 두 곳이 어긋난다.
     다만 앞뒤 공백은 여기서 턴다. 공백만 적은 댓글은 제약에 걸려 거절된다. */
  insert into public.comments (pin_id, user_id, body)
  values (p_pin, auth.uid(), btrim(p_body))
  returning comments.id into v_id;

  return query
    select c.id, c.body, c.created_at, public.display_name(c.user_id)
    from public.comments c where c.id = v_id;
end $$;

comment on function public.api_comment_add is
  '댓글을 단다(098). 스페이스 멤버가 아니면 **정책이 막는다** — 함수가 따로 검사하지
   않는다. 검사를 두 곳에 두면 한쪽을 고칠 때 다른 쪽이 조용히 남는다.';

-- ── ④ 내 댓글 지우기 (soft delete) ──────────────────────────────
create or replace function public.api_comment_remove(p_id uuid)
returns boolean
language sql volatile security invoker set search_path = public, extensions as $$
  with d as (
    update public.comments set deleted_at = now()
    where id = p_id and deleted_at is null
    returning 1
  )
  select exists (select 1 from d)
$$;

comment on function public.api_comment_remove is
  '내 댓글을 지운다(098). 남의 것은 정책(`comments_delete_own`)이 막아 false 가 온다.
   줄을 **안 지운다** — 센 숫자와 대화의 앞뒤가 어긋나지 않게 한다.';

-- ── ⑤ 기록 하나 보기 ────────────────────────────────────────────
/* ★ invoker 다. 보이는 범위는 `pins_read`(072)가 정한다 —
     공개이거나 · 내 것이거나 · 내 스페이스의 것. 차단도 거기서 걸린다.
   ★ 좌표를 준다. 공개한 기록이라면 **어디였는지**가 그 기록의 절반이다. */
create or replace function public.api_pin_detail(p_pin uuid)
returns table (
  id uuid, lng double precision, lat double precision,
  category pin_category, memo text, place_label text,
  visited_at timestamptz, stay_sec int,
  verification verification_level, is_public boolean, is_mine boolean,
  user_id uuid, author text,
  place_id uuid, place_name text, place_address text, region_name text,
  comment_count int, like_count int, save_count int, media_count int
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.id, ST_X(p.geom), ST_Y(p.geom),
         p.category, p.memo, p.place_label,
         p.visited_at, p.stay_sec,
         p.verification, p.is_public, (p.user_id = auth.uid()),
         p.user_id, public.display_name(p.user_id),
         p.place_id, pl.name, pl.address, rg.name,
         p.comment_count, p.like_count, p.save_count, p.media_count
  from public.pins p
  left join public.places  pl on pl.id = p.place_id
  left join public.regions rg on rg.code = p.region_code
  where p.id = p_pin and p.deleted_at is null
$$;

comment on function public.api_pin_detail is
  '기록 하나(098). 보이는 범위는 `pins_read`(072)가 정한다 — 공개·내 것·내 스페이스.
   차단한 사람의 기록은 그 정책에서 이미 걸린다.';

-- ── ⑥ 그 기록의 사진들 ──────────────────────────────────────────
create or replace function public.api_pin_media(p_pin uuid)
returns table (
  media_id uuid, url text, thumb_url text, poster_url text,
  type media_type, width int, height int,
  caption text, taken_at timestamptz
)
language sql stable security invoker set search_path = public, extensions as $$
  select m.id, m.url, coalesce(m.thumb_url, m.url), m.poster_url,
         m.type, m.width, m.height, m.caption, m.taken_at
  from public.media m
  join public.pins p on p.id = m.pin_id
  where m.pin_id = p_pin
    /* ★ **남의 기록이면 공개 가능한 것만.** 내 기록은 품질에 걸린 사진도 내가
       올린 것이라 보여 준다 — 031 이 지도 카드에서 쓰는 규칙과 같다. */
    and (p.user_id = auth.uid() or (m.public_ok and m.quality_ok))
  order by m.is_main desc, m.sort_order, m.created_at
$$;

comment on function public.api_pin_media is
  '기록 하나의 사진(098). 남의 것은 공개 가능한 장만 — 내 것은 전부(내가 올린 것이다).';

grant execute on function public.api_comments(uuid, int, int) to authenticated;
grant execute on function public.api_comment_add(uuid, text) to authenticated;
grant execute on function public.api_comment_remove(uuid) to authenticated;
grant execute on function public.api_pin_detail(uuid) to anon, authenticated;
grant execute on function public.api_pin_media(uuid) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
