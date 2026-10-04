-- =====================================================================
-- 072 **신고와 차단** (§13.135)
--
-- App Store 가이드라인 1.2 는 사용자 콘텐츠가 있는 앱에 넷을 요구한다:
--   ① 불쾌한 콘텐츠를 거르는 수단  ② 신고  ③ 문제 사용자 차단  ④ 공개 연락처
--
-- ★ 서버에 **절반은 이미 있었다** — `reports` 표·`reports_insert` 정책(006)·
--   운영자 큐(020)·조치 기록(023). 없던 것은 **앱에서 부를 길**과 **차단**이다.
--   *"신고는 있다"* 고 적었다가 코드를 열어 보고 고쳤다 — 앱의 `신고` 는 전부
--   *장소가 문을 닫았다*는 뜻이었다(§13.134).
--
-- ── 어디를 걸러야 하나 ──────────────────────────────────────────────
-- 차단은 **한 자리만 막으면 안 된다.** 소식에서 안 보이는데 지도에서 보이면
-- 차단이 아니다. 그런데 자리가 여럿이고, 어디가 새는지 **짐작하면 빠뜨린다.**
--
--   · `security invoker` 경로 — RLS 를 지난다 → **정책 한 줄로 전부 덮인다**
--     (소식 탭은 PostgREST 로 `pins` 를 **직접** 읽으므로 여기 포함된다)
--   · `security definer` 경로 — RLS 를 **건너뛴다** → 함수마다 따로 막아야 한다
--
-- → 그래서 **스모크가 모든 표면을 두드리게** 해 두고, 실패하는 자리만 고친다.
--   (이 파일은 ①번 층이다. 새는 definer 함수는 073 에서 이어 막는다.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 차단
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
comment on table public.blocks is '내가 안 보기로 한 사람. 상대는 모른다(§13.135).';

alter table public.blocks enable row level security;
drop policy if exists blocks_own on public.blocks;
/* ★ **내 줄만** 본다. 남이 나를 차단했는지는 알 수 없다 — 알 수 있으면
   차단이 **신호**가 되어 괴롭힘의 도구가 된다. */
create policy blocks_own on public.blocks for all
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

/* ★ **배열로 한 번에** 낸다. 정책에 `is_blocked(user_id)` 처럼 행마다 부르는
   함수를 쓰면 **행 수만큼** 돈다. 인자 없는 `stable` 함수는 플래너가
   **질의당 한 번**만 평가한다(InitPlan).
   ★ `security definer` 여야 한다 — 정책 안에서 `blocks` 를 읽는데 그 표에도
     RLS 가 있어서, invoker 면 정책이 자기를 다시 부른다. */
create or replace function public.my_blocks()
returns uuid[] language sql stable security definer
set search_path = public, extensions as $$
  select coalesce(array_agg(blocked_id), '{}')
  from public.blocks where blocker_id = auth.uid();
$$;
comment on function public.my_blocks is '내가 차단한 사람들. 정책·함수가 질의당 한 번만 읽는다(§13.135).';

/* ── ★ 모든 invoker 경로를 한 줄로 덮는다 ───────────────────────────
   소식 탭은 `pins` 를 직접 읽고(PostgREST), `api_pins_in_bbox`·
   `api_place_covers`·`api_pin_publish_summary` 는 invoker 다. 전부 여기를 지난다. */
drop policy if exists pins_read on public.pins;
create policy pins_read on public.pins for select
  using (
    deleted_at is null
    and (is_public or user_id = auth.uid() or public.pin_shared_with_me(id))
    /* ★ **내 것은 안 가린다.** 자기를 차단할 수는 없지만(제약), 혹시라도
       걸리면 자기 기록이 사라져 앱이 고장 난 것처럼 보인다. */
    and (user_id = auth.uid() or not (user_id = any(public.my_blocks())))
  );

/* ★ **RLS 를 걸었다고 권한이 생기는 게 아니다.** 둘은 따로다 — 정책은
   *"어느 줄을"*, GRANT 는 *"그 표를 만질 수 있나"* 를 정한다. 처음에 정책만
   걸고 끝낸 줄 알았는데 `permission denied for table blocks` 로 멈췄다. */
grant select, insert, delete on public.blocks to authenticated;
/* 신고는 **넣을 수 있어야** 한다 — 024 가 select 만 줬다(운영자 화면용) */
grant insert on public.reports to authenticated;

create or replace function public.api_block(p_user uuid)
returns boolean language plpgsql security invoker
set search_path = public, extensions as $$
begin
  if auth.uid() is null then return false; end if;
  if p_user = auth.uid() then return false; end if;      -- 자기를 못 막는다
  insert into public.blocks (blocker_id, blocked_id)
  values (auth.uid(), p_user) on conflict do nothing;
  return true;
end $$;

create or replace function public.api_unblock(p_user uuid)
returns boolean language plpgsql security invoker
set search_path = public, extensions as $$
begin
  if auth.uid() is null then return false; end if;
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user;
  return true;
end $$;

/* 차단 목록 — 푸는 화면에 쓴다. 닉네임을 같이 낸다(아이디만으론 누군지 모른다) */
create or replace function public.api_blocks()
returns table (user_id uuid, nickname text, created_at timestamptz)
language sql stable security definer
set search_path = public, extensions as $$
  select b.blocked_id, p.nickname, b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc;
$$;

-- ---------------------------------------------------------------------
-- 신고
-- ---------------------------------------------------------------------
/* ★ 표와 정책은 **이미 있다**(002·006). 없던 것은 앱에서 부를 함수다.
   ★ `reaction_target` 은 `('pin','place')` 뿐이고 그걸로 **충분하다** —
     댓글은 앱에 화면이 없고(§13.113), 사람 자체는 **차단**이 맡는다.
   ★ 횟수를 제한한다. 안 하면 한 사람이 신고로 큐를 묻어 버릴 수 있고,
     그러면 **진짜 신고가 안 보인다**(066 의 오류 로그와 같은 이유). */
create or replace function public.api_report_create(
  p_target_type reaction_target,
  p_target_id   uuid,
  p_reason      text
)
returns boolean language plpgsql security invoker
set search_path = public, extensions as $$
declare n int;
begin
  if auth.uid() is null then return false; end if;
  if coalesce(btrim(p_reason), '') = '' then return false; end if;

  select count(*) into n from public.reports
   where reporter_id = auth.uid() and created_at > now() - interval '1 hour';
  if n >= 20 then return false; end if;       -- 한 시간에 스무 건까지

  /* 같은 것을 두 번 신고해도 한 줄이다 — 중복이 큐를 부풀리면 운영이 못 돈다 */
  if exists (select 1 from public.reports
              where reporter_id = auth.uid()
                and target_type = p_target_type and target_id = p_target_id
                and status = 'open') then
    return true;
  end if;

  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (auth.uid(), p_target_type, p_target_id, left(btrim(p_reason), 500));
  return true;
end $$;

comment on function public.api_report_create is
  '신고 한 줄. 한 시간에 20건·같은 대상은 한 번(§13.135).';

-- ---------------------------------------------------------------------
-- ★ `security definer` 경로 — **정책이 안 닿는다**
--
-- 차단을 정책 한 줄로 끝낸 줄 알았는데, 장소 상세의 사진 격자는
-- `security definer` 라 RLS 를 통째로 건너뛴다. **소식에서는 사라지는데
-- 장소 상세에서는 그대로 보였다** — 그건 차단이 아니다.
--
-- ★ 스모크에 사진을 **심고 나서야** 드러났다. 처음엔 사진이 없어 단언이
--   공허하게 통과하고 있었다(`fn=0` 을 진단으로 찍어서 알았다).
--   준비물이 없으면 시험은 **통과한다. 아무것도 안 재면서.**
--
-- ★ 집계만 내는 함수(`api_map_clusters`·`api_map_overview`)는 **안 가린다.**
--   숫자는 콘텐츠가 아니다 — 차단한 사람 때문에 지역 집계가 1 줄어드는 것은
--   막을 일이 아니고, 막으면 "왜 숫자가 다르지"가 생긴다.
-- ---------------------------------------------------------------------
create or replace function public.api_place_media(
  p_place uuid,
  p_orientation text default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  media_id uuid, pin_id uuid, url text, thumb_url text, poster_url text,
  type media_type, orientation text, width int, height int,
  crop_x real, crop_y real, crop_scale real,
  caption text, taken_at timestamptz,
  user_id uuid, author text, like_count int, save_count int, rank real
)
language sql stable security definer set search_path = public, extensions as $$
  select m.id, p.id, m.url,
         coalesce(m.thumb_url, m.url), m.poster_url,
         m.type, m.orientation, m.width, m.height,
         m.crop_x, m.crop_y, m.crop_scale,
         m.caption, m.taken_at,
         p.user_id, public.display_name(p.user_id),
         p.like_count, p.save_count,
         public.media_rank(p.like_count, p.save_count,
                           coalesce(m.taken_at, p.visited_at), m.focus_score) as rank
  from public.media m
  join public.pins p on p.id = m.pin_id
  where p.place_id = p_place
    and p.deleted_at is null
    and p.is_public
    and m.public_ok and m.quality_ok
    and (p_orientation is null or m.orientation = p_orientation)
    /* ★ **차단한 사람의 사진은 안 준다**(§13.135). 이 함수는 `security definer`
       라 `pins_read` 정책이 안 닿는다 — 소식에서는 사라졌는데 장소 상세에서는
       그대로 보였다. 스모크가 사진을 심고서야 드러났다. */
    and not (p.user_id = any(public.my_blocks()))
  order by rank desc, m.id
  limit greatest(1, least(p_limit, 100)) offset greatest(p_offset, 0);
$$;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
