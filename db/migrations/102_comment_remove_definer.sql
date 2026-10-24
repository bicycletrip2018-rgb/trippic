-- =====================================================================
-- 102 내 댓글을 **못 지웠다** — soft delete 가 읽기 정책에 막힌다 (§13.188)
--
-- 098 의 `api_comment_remove` 는 invoker 이고 `update comments set deleted_at = now()`
-- 를 한다. 그런데 읽기 정책(`comments_read_space`, 028)이 `deleted_at is null` 인 줄만
-- 보여 준다. PostgreSQL 은 UPDATE 가 WHERE 로 줄을 읽을 때, **바뀐 뒤의 줄도 읽기
-- 정책을 통과해야** 한다 — 지운 줄은 정의상 통과하지 못한다.
--
--     new row violates row-level security policy for table "comments"
--
-- smoke 36절에서 실제 사용자로 불러 처음 봤다. RETURNING 을 빼도, 함수 없이 표에
-- 직접 update 해도 같다. **098 이후 운영에서도 내 댓글 지우기는 늘 실패했다** — 화면이
-- 없어서 아무도 못 겪었을 뿐이다. §13.185 의 `api_set_nickname` 과 같은 모양이다:
-- 관리자 권한으로는 되고, 사용자 권한으로는 안 된다.
--
-- ★ 고치는 길은 둘이었다.
--   (가) 읽기 정책을 넓혀 «내가 지운 줄» 도 보이게 — 정책을 고치면 api_comments·피드·
--       댓글 수가 같이 그 정책을 받는다. 바꾸는 면이 넓다.
--   (나) 지우는 함수만 definer 로 — **자기 줄만**(`user_id = auth.uid()`) 고친다.
--   → (나). 100 이 `api_set_nickname` 에 쓴 것과 같은 모양이고, 바뀌는 것은 이 함수 하나다.
-- ★ 남의 댓글은 여전히 false 다. 전에는 정책이 막았고, 이제는 함수의 WHERE 가 막는다.
-- =====================================================================

create or replace function public.api_comment_remove(p_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare n int;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  update public.comments
     set deleted_at = now()
   where id = p_id
     and user_id = auth.uid()
     and deleted_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/* ★ 101 의 상태 태그를 **유지한다.** comment on 은 덮어쓰므로 태그를 다시 적는다
   (화면이 붙으면 그때 태그를 지운다). */
comment on function public.api_comment_remove is
  E'[화면 대기] 11월 댓글 화면이 부를 것.\n'
  '내 댓글을 지운다(098·102). definer — 자기 줄만(user_id = auth.uid()). 남의 것은 false.
   invoker 였을 때는 읽기 정책(deleted_at is null)에 막혀 **내 것도 못 지웠다**(§13.188).
   줄을 **안 지운다** — 센 숫자와 대화의 앞뒤가 어긋나지 않게 한다.';

/* 101 이 api_comment_add 태그에 적은 «스페이스 밖 핀에서 RLS 거부가 정상인지 못 쟀다» 를
   지운다 — smoke 36절이 쟀다: 방 밖은 정책이 막고(맞다), 방 안 멤버는 함수로 단다. */
comment on function public.api_comment_add is
  E'[화면 대기] 11월 댓글 화면이 부를 것.\n'
  '댓글을 단다(098). 스페이스 멤버가 아니면 **정책이 막는다** — 함수가 따로 검사하지
   않는다. 검사를 두 곳에 두면 한쪽을 고칠 때 다른 쪽이 조용히 남는다.
   실제 사용자로 재 봤다(smoke 36절, §13.188): 방 안은 달리고 방 밖은 막힌다.';

grant execute on function public.api_comment_remove(uuid) to authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
