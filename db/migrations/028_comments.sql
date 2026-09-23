-- =====================================================================
-- TRIPPIC · 028 댓글 — **스페이스 안에서만**
--
-- §12.6은 댓글을 접었다: *"모더레이션 비용이 급증한다. 운영자가 0명이다."*
-- 그 이유는 지금도 맞다. **그런데 그건 공개 기록에만 해당한다.**
-- 스페이스는 서로 아는 사람들의 닫힌 방이라 모르는 사람이 들어와 쓸 수 없다 —
-- 신고·운영자를 부를 일이 애초에 안 생긴다. (§13.7)
--
-- ★ 그리고 이게 초대할 이유를 만든다. §3이 *"초대 수락률이 핵심 지표"*라고 했는데
--   지금 스페이스에 초대해서 할 수 있는 일은 "같이 사진 올리기"뿐이었다.
--   말을 주고받을 수 있어야 방이다.
--
-- ★ 규칙은 **서버가 건다.** 화면에서 댓글칸을 숨기는 것은 권한이 아니다(§020과 같은 원칙).
--   공개 기록에 댓글이 안 달리는 것은 정책의 결과이지 UI의 결과가 아니다 —
--   스페이스에 안 묶인 핀은 아래 정책의 exists 를 아무도 통과하지 못한다.
-- =====================================================================

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  pin_id     uuid not null references public.pins(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,                    -- 대화에 구멍이 나면 안 된다. soft delete
  constraint comments_body_len check (length(btrim(body)) between 1 and 300)
);

comment on table public.comments is
  '스페이스에 공유된 기록에만 달린다. 공개 기록에는 안 달린다 — 운영할 수 있는 만큼만 연다(§12.6·§13.7).';

create index if not exists comments_pin_idx on public.comments (pin_id, created_at);

alter table public.comments enable row level security;

-- ★ push.sh 는 마이그레이션을 다시 돌린다. 정책은 `create or replace` 가 없으므로
--   먼저 내린다 — 안 그러면 두 번째 실행에서 배포가 통째로 멈춘다.
drop policy if exists comments_read_space   on public.comments;
drop policy if exists comments_write_space  on public.comments;
drop policy if exists comments_delete_own   on public.comments;

-- 볼 수 있는 사람 = 그 핀이 공유된 스페이스의 멤버
create policy comments_read_space on public.comments
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.pin_spaces ps
      join public.space_members sm on sm.space_id = ps.space_id
      where ps.pin_id = comments.pin_id and sm.user_id = auth.uid()
    )
  );

-- 쓸 수 있는 사람 = 같은 조건 + 본인 이름으로만
create policy comments_write_space on public.comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.pin_spaces ps
      join public.space_members sm on sm.space_id = ps.space_id
      where ps.pin_id = comments.pin_id and sm.user_id = auth.uid()
    )
  );

-- 지우기는 **본인 것만**. 수정은 안 연다 — 대화가 뒤에서 바뀌면 기록이 아니다.
create policy comments_delete_own on public.comments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ★ 정책은 GRANT 위에서만 산다. §024에서 겪은 그대로 —
--   SELECT 정책이 있어도 SELECT 권한이 없으면 정책은 **평가되지 않는다**(죽은 정책).
grant select, insert on public.comments to authenticated;
grant update (deleted_at) on public.comments to authenticated;

-- 핀마다 댓글 수 — 목록에서 N개를 보여주려면 매번 세면 안 된다
alter table public.pins
  add column if not exists comment_count int not null default 0;

create or replace function public.bump_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pins p
     set comment_count = (select count(*) from public.comments c
                           where c.pin_id = p.id and c.deleted_at is null)
   where p.id = coalesce(new.pin_id, old.pin_id);
  return null;
end $$;

drop trigger if exists comments_count_trg on public.comments;
create trigger comments_count_trg
  after insert or update or delete on public.comments
  for each row execute function public.bump_comment_count();
