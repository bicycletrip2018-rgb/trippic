-- =====================================================================
-- 066 **앱에서 난 오류를 서버가 받는다** (§13.120)
--
-- ★ 왜 필요한가 — MVP 테스트에서 **가장 잃기 쉬운 것**은 네이티브 크래시가 아니다.
--   크래시는 앱이 꺼지니 테스터가 말해 준다. 못 건지는 것은 **조용한 실패**다:
--   빈 화면, 안 끝나는 동그라미, 눌러도 아무 일 없는 버튼. 테스터는 *"좀 이상해요"*
--   라고만 말하고 우리는 **재현도 못 한다.** 그 자리를 이 표가 받는다.
--
-- ★ **Sentry 를 안 쓴다**(지금은). 네이티브 의존성이 늘고 다시 빌드해야 하며
--   계정이 하나 더 생긴다. 지금 필요한 것은 *"테스터 다섯 명이 어디서 막혔나"* 이고
--   그건 이 표 하나로 된다. **네이티브 크래시는 못 받는다 — 그건 솔직히 적어 둔다.**
--   빌드 파이프라인이 생기면 그때 Sentry 로 올린다.
-- =====================================================================

create table if not exists public.client_errors (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  at          timestamptz not null default now(),
  /* js = 안 잡힌 예외 · api = 서버 호출 실패 · boot = 켜는 중 실패 */
  kind        text not null check (kind in ('js', 'api', 'boot')),
  /* ★ 한 줄 요약. **묶는 기준**이라 길면 안 된다 — 같은 버그가 다른 줄로 보인다 */
  message     text not null check (length(message) between 1 and 300),
  /* 스택·요청 주소 같은 것. 길이를 막는다 — 로그가 표를 삼키면 안 된다 */
  detail      text check (detail is null or length(detail) <= 4000),
  app_version text check (app_version is null or length(app_version) <= 40),
  platform    text check (platform is null or length(platform) <= 20)
);

comment on table public.client_errors is
  '앱에서 난 오류. 테스터가 "좀 이상해요"라고만 말할 때 우리가 볼 수 있는 유일한 것(§13.120). 네이티브 크래시는 안 들어온다.';

create index if not exists client_errors_at_idx on public.client_errors (at desc);
create index if not exists client_errors_user_idx on public.client_errors (user_id, at desc);

alter table public.client_errors enable row level security;

/* ★ **아무나 쓸 수 있고, 운영자만 읽는다.**
   - 쓰기: 오류는 로그인 전에도 난다(세션이 안 서는 것 자체가 오류다). 그래서 anon 도 쓴다.
   - 읽기: 메시지에 **사용자가 뭘 하다 터졌는지**가 들어간다. 남이 읽으면 안 된다.
     쓴 사람 자신도 읽을 이유가 없다 — 이건 우리가 보는 것이지 화면에 띄우는 것이 아니다. */
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated with check (true);

drop policy if exists client_errors_read_operator on public.client_errors;
create policy client_errors_read_operator on public.client_errors
  for select to authenticated using (public.is_operator());

grant insert on public.client_errors to anon, authenticated;
grant select on public.client_errors to authenticated;
grant usage, select on sequence public.client_errors_id_seq to anon, authenticated;

-- ---------------------------------------------------------------------
-- 쓰는 문
-- ★ **쏟아지는 것을 막는다.** 오류는 고리에 빠지기 쉽다 — 한 번 터진 화면이
--   다시 그려지며 또 터지면 **초당 수십 줄**이 들어온다. 그러면 표가 커지는 것보다
--   **진짜 신호가 묻히는 것**이 더 나쁘다.
--   → 같은 사람이 **1분 안에 20줄**을 넘기면 조용히 버린다(앱에는 성공이라고 답한다 —
--     로그를 못 썼다고 앱이 또 오류를 내면 그게 고리다).
-- ---------------------------------------------------------------------
create or replace function public.api_log_client_error(
  p_kind text, p_message text,
  p_detail text default null, p_version text default null, p_platform text default null
)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if p_kind not in ('js', 'api', 'boot') then return; end if;

  select count(*) into n
  from public.client_errors
  where at > now() - interval '1 minute'
    and user_id is not distinct from auth.uid();
  if n >= 20 then return; end if;          -- 조용히 버린다

  insert into public.client_errors (user_id, kind, message, detail, app_version, platform)
  values (auth.uid(), p_kind,
          left(coalesce(nullif(trim(p_message), ''), '(빈 메시지)'), 300),
          left(p_detail, 4000), left(p_version, 40), left(p_platform, 20));
end $$;

comment on function public.api_log_client_error is
  '앱 오류 한 줄. 로그인 전에도 쓸 수 있다 — 세션이 안 서는 것 자체가 오류이기 때문이다(§13.120).';

grant execute on function public.api_log_client_error(text, text, text, text, text)
  to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
