-- =====================================================================
-- 100 닉네임으로 **운영자 행세**를 못 하게 + 소셜 연결이 이름 때문에 깨지지 않게
--
-- 099 로 닉네임을 바꾸는 길을 냈는데, 규칙은 2~20자·공백 정리뿐이었다.
-- 그대로 화면을 붙이면 누구나 «트립픽 운영팀» 이 된다(§13.182 5번 · DECISIONS D-7).
-- 신고는 사후 처리다 — 사칭은 **보이는 순간** 피해가 나므로 막는 쪽에 둔다.
--
-- ★ 고치다가 **이미 깨져 있던 것**을 찾았다.
--   044 의 트리거는 카카오·애플을 이을 때 그쪽 이름을 닉네임으로 가져온다.
--   그런데 099 가 표에 2~20자 제약을 건 뒤로, 그 이름이 **1글자이거나 20자를 넘으면**
--   트리거의 update 가 제약에 걸리고 → `auth.identities` insert 가 통째로 실패한다.
--   로컬에서 재현했다(「훈」·「Christopher Alexander Montgomery」 둘 다 실패).
--   **이름 하나 때문에 로그인이 막힌다.** 여기에 금칙어까지 더하면 막히는 이름이 는다.
--   → 트리거는 **못 쓰는 이름이면 건너뛴다.** 닉네임은 자동 handle 로 남고, 사람이
--     나중에 직접 고친다. 로그인보다 중요한 닉네임은 없다.
--
-- 규칙은 **한 함수**(`nickname_reserved`)에만 둔다. 표의 제약·저장 함수·트리거가
-- 전부 그것을 부른다 — 목록을 세 군데 적으면 셋이 어긋난다.
-- =====================================================================

/* 운영자·서비스로 읽히는 이름인가.
   ★ 공백·기호를 **빼고** 대소문자를 무시한 뒤 본다 — 「트 립 픽」·「Trip-Pic」 도 걸린다.
   ★ 영어 `admin`·`staff` 는 **앞뒤에 붙을 때만** 본다. 가운데까지 보면
     `badminton` 이 걸린다. 나머지는 단어 안 어디에 있어도 걸린다.
   ★ 닮은 글자(`tr1ppic`·`0fficial`)까지는 쫓지 않는다. 그건 끝이 없고,
     신고(072·074)가 맡는다. */
create or replace function public.nickname_reserved(p_name text)
returns boolean
language sql immutable parallel safe set search_path = public as $$
  with n as (
    select lower(regexp_replace(coalesce(p_name, ''), '[^0-9A-Za-z가-힣]', '', 'g')) as v
  )
  select exists (
           select 1 from unnest(array[
             '운영자', '운영팀', '운영진', '관리자', '트립픽', '공식', '고객센터', '스태프',
             'trippic', 'official', 'moderator'
           ]) w
           where position(w in n.v) > 0)
      or n.v ~ '^(admin|staff)'
      or n.v ~ '(admin|staff)$'
    from n
$$;

comment on function public.nickname_reserved is
  '운영자·서비스로 읽히는 닉네임인가(100). 공백·기호를 빼고 대소문자 무시. 표 제약·api_set_nickname·소셜 연결 트리거가 같이 쓴다.';

/* 표에 건다 — 099 와 같은 이유로, 함수에만 두면 다른 길(PostgREST 직접 update)로 샌다.
   ★ 지금 있는 닉네임은 `user`·`user0c5c` 둘이라 걸리는 줄이 없다(2026-10-24 운영 DB 확인).
     걸리는 줄이 있으면 이 줄이 실패하고 트랜잭션 전체가 안 남는다 — 조용히 넘어가지 않는다. */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_nickname_reserved' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_nickname_reserved
      check (not public.nickname_reserved(nickname));
  end if;
end $$;

/* 099 를 다시 쓴다. 바뀐 것 둘:
   ① **못 쓰는 이름을 먼저 말해 준다.** 표 제약에만 맡기면 앱이
      `violates check constraint` 를 그대로 받는다.
   ② ★ **099 는 실제 사용자로 부르면 늘 실패했다.** invoker 인데 `updated_at` 을
      쓰고 `deleted_at` 을 읽는다 — `authenticated` 에게는 둘 다 권한이 없다(006 은
      nickname 같은 몇 칸만 열었다). 운영 DB 에서 `has_column_privilege` 로 확인했다
      (updated_at UPDATE = f · deleted_at SELECT = f). 099 를 시험할 때 관리자 권한으로
      바꿔 봐서 안 보였다 — smoke 에 이 함수를 **authenticated 로** 부르는 줄이 없었다.
      → definer 로 바꾸고 **자기 줄만**(`id = auth.uid()`) 고친다. 칸 권한을 넓히는 것보다
        좁다: 열리는 것은 이 함수가 쓰는 한 줄뿐이다. */
create or replace function public.api_set_nickname(p_name text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  v := regexp_replace(v, '\s+', ' ', 'g');

  if public.nickname_reserved(v) then
    raise exception '운영자로 오해받을 수 있는 이름은 쓸 수 없습니다'
      using errcode = '22023';
  end if;

  update public.profiles
     set nickname = v, updated_at = now()
   where id = auth.uid() and deleted_at is null;

  if not found then
    raise exception '프로필을 찾을 수 없습니다';
  end if;
  return v;
end $$;

comment on function public.api_set_nickname is
  '닉네임을 바꾼다(099·100). 2~20자, 운영자 행세 금지. **중복은 안 막는다** — 고유한 것은 handle 이고,
   닉네임까지 선착순으로 만들면 흔한 이름을 먼저 차지한 사람이 이긴다.';

/* 044 를 다시 쓴다. ★ **못 쓰는 이름이면 건너뛴다** — 실패시키지 않는다.
   길이 기준은 099 의 제약과 같은 값이다(2~20). 여기서 다르게 세면 다시 깨진다. */
create or replace function public.tg_on_identity_linked()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text;
begin
  v_name := nullif(btrim(regexp_replace(coalesce(
    new.identity_data->>'full_name',
    new.identity_data->>'name',
    new.identity_data->>'preferred_username', ''), '\s+', ' ', 'g')), '');
  if v_name is null
     or char_length(v_name) not between 2 and 20
     or public.nickname_reserved(v_name) then
    return new;
  end if;

  /* 사람이 지은 이름은 덮지 않는다(044 그대로). */
  update public.profiles
     set nickname = v_name, updated_at = now()
   where id = new.user_id and nickname = handle;
  return new;
end $$;

comment on function public.tg_on_identity_linked is
  '소셜을 이어 두면 그 닉네임을 profiles 로 가져온다(044). 100: 못 쓰는 이름이면 건너뛴다 — 이름 때문에 로그인이 막히면 안 된다.';

grant execute on function public.api_set_nickname(text) to authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
