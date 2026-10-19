-- =====================================================================
-- 099 모두가 **@user** 였다 (§13.180 의 꼬리)
--
-- 098 로 *"이 기록을 누가 올렸나"* 를 보여 줄 길을 냈는데, 실제로 찍어 보니
-- 올린이가 **`user`** 로 나왔다. 버그가 아니다 — 가입할 때 자동으로 지어 준
-- 이름이 그대로였고, **바꿀 길이 없다.**
--
--     profiles.nickname :  user0c5c · user      ← 계정 둘 다 자동 생성값
--     profiles_update_self (UPDATE 정책) :  있다
--     바꾸는 함수 / 화면                 :  **없다**
--
-- 정책은 열려 있는데 **아무도 그 문을 안 만들었다.** 그래서 「모두의 지도」를
-- 열어도 사진마다 `@user` 가 붙는다 — 그건 이름이 아니라 **빈칸**이다.
--
-- ★ 화면은 11월에(빌드가 필요하다). 서버는 **지금** 만들어 둔다.
-- ★ 길이·공백만 본다. **중복은 막지 않는다** — 같은 이름을 쓰는 사람이 있어도
--   되는 것이 닉네임이고(고유한 것은 `handle` 이다), 막으면 흔한 이름을 먼저
--   차지한 사람이 이긴다.
-- =====================================================================

/* 2~20자. 한 글자는 누구인지 말하지 못하고, 20자가 넘으면 지도 카드·댓글 줄에서
   잘린다. ★ 제약을 **표에** 건다 — 함수에만 두면 다른 길로 들어온 값이 샌다. */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_nickname_len' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_nickname_len
      check (char_length(btrim(nickname)) between 2 and 20);
  end if;
end $$;

create or replace function public.api_set_nickname(p_name text)
returns text
language plpgsql security invoker set search_path = public, extensions as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  /* ★ **줄바꿈·탭을 공백 하나로.** 안 그러면 한 줄짜리 자리에 여러 줄이 들어와
     옆 글자를 밀어낸다. 길이는 표의 제약이 본다(두 곳에서 세지 않는다). */
  v := regexp_replace(v, '\s+', ' ', 'g');

  update public.profiles
     set nickname = v, updated_at = now()
   where id = auth.uid() and deleted_at is null;

  if not found then
    raise exception '프로필을 찾을 수 없습니다';
  end if;
  return v;
end $$;

comment on function public.api_set_nickname is
  '닉네임을 바꾼다(099). 2~20자. **중복은 안 막는다** — 고유한 것은 handle 이고,
   닉네임까지 선착순으로 만들면 흔한 이름을 먼저 차지한 사람이 이긴다.';

grant execute on function public.api_set_nickname(text) to authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
