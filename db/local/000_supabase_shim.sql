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
  created_at         timestamptz not null default now()
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
