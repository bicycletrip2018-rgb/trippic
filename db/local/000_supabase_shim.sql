-- =====================================================================
-- 로컬 검증 전용 셰임 (Supabase 흉내)
--
-- 마이그레이션은 Supabase를 전제로 쓰여 있다.
--   - auth.users 테이블
--   - auth.uid() 함수
--   - anon / authenticated 롤
-- 로컬 PostgreSQL에는 이것들이 없으므로 최소한만 만들어 둔다.
--
-- ★ 이 파일은 Supabase에 올리지 않는다. 로컬에서 문법·구조를 검증하는 용도다.
--   실제 Supabase에서는 이 객체들이 이미 존재하며 동작이 다르다
--   (auth.uid()는 JWT에서 읽고, RLS는 롤에 따라 달라진다).
-- =====================================================================

create schema if not exists auth;

-- Supabase의 auth.users 중 마이그레이션이 참조하는 컬럼만
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  -- ★ 익명 로그인 여부. 040(계정 합치기)이 "임시 계정에서만 옮길 수 있다"를
  --   이 컬럼으로 판단한다 — 없으면 그 규칙 자체를 로컬에서 검증할 수 없다.
  is_anonymous       boolean not null default false,
  created_at         timestamptz not null default now()
);
alter table auth.users add column if not exists is_anonymous boolean not null default false;
/* ★ 정지 기한. 074 가 여기에 찍고, GoTrue 가 이 값이 미래면 **토큰을 안 내준다.**
   로컬 shim 에 없으면 "운영자가 계정을 정지할 수 있나"를 **로컬에서 못 잰다** —
   실제로 거기서 멎었다. 진짜 Supabase 에는 원래 있는 칸이다(확인함). */
alter table auth.users add column if not exists banned_until timestamptz;

-- ★ `auth.identities` — 소셜을 **얹었을 때** 한 줄이 생기는 표다(044·045).
--   이게 없어서 044 가 트리거 생성에서 죽었고, 같은 파일 뒤쪽의
--   `spaces.auto_title` 이 영영 안 붙어 **052 까지 같이 넘어졌다.**
--   한 파일이 중간에서 죽으면 뒤의 문장은 조용히 사라진다 — 그게 두 번째 실패의
--   정체였고, 실패 3건이 원인 3개로 보여 한참 헤맸다.
--   → 044 가 들어온 뒤로 **045~058 열넷은 로컬에서 한 번도 검사된 적이 없었고**,
--     동작 검증(smoke)은 그 앞에서 `exit 1` 이라 아예 돌지 않았다(§13.91).
--     스텁은 마이그레이션이 늘 때 **같이** 늘어야 한다.
create table if not exists auth.identities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- 현재 사용자. 로컬에서는 세션 변수로 흉내낸다.
--   select set_config('request.jwt.claim.sub', '<uuid>', false);
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- 롤
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
