-- =====================================================================
-- 073 **계정과 기록 지우기** (§13.138)
--
-- App Store 가이드라인 **5.1.1(v)**: *"계정을 만들 수 있는 앱은 **앱 안에서
-- 계정 삭제**도 제공해야 한다."* 우리 앱은 첫 실행에 익명 계정을 자동으로
-- 만들고 카카오를 이어 둘 수도 있다 — **메일로 받는 것으로는 안 된다.**
--
-- ★ 그리고 개인정보처리방침에 *"받는 즉시 지웁니다 — 사진·기록·계정이 함께
--   사라집니다"* 라고 적었다. **적은 대로 되어야 한다**(§13.137).
--
-- ── 사진은 DB 가 아니라 저장소에 있다 ───────────────────────────────
-- `auth.users` 를 지우면 `profiles` 가 cascade 로 따라가고 그 아래 여섯 표가
-- 또 cascade 다. **그런데 버킷의 파일은 안 따라간다.** 행만 지우면
-- *"사진이 사라졌다"* 가 거짓이 된다 — 주소를 아는 사람은 계속 볼 수 있다.
--
-- → **순서가 중요하다**: ① 경로를 받아서 ② 앱이 파일을 지우고 ③ 계정을 지운다.
--   ③을 먼저 하면 토큰이 죽어서 **파일을 지울 수 없게 된다.**
--   (저장소 정책은 `본인 폴더만` 지우게 돼 있다 — 030. 그래서 앱이 지운다.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ★★ 운영자 벽(068)이 **계정 삭제를 막고 있었다**
--
-- `auth.users` 를 지우면 `profiles` 가 따라가고, 그 아래 `reports`(신고한 사람)
-- 와 `operators`(운영자였다면)도 cascade 로 지워진다. 그런데 068 이 그 두 표의
-- **모든 DELETE 를 운영자만** 하게 막아 뒀다 — 그래서 **내 계정을 내가 못 지운다.**
--
--     ERROR: 운영자만 할 수 있습니다 (reports)
--
-- ★ 벽을 **느슨하게 하지 않는다.** `auth.uid()` 를 비워서 지나가는 길이 있지만
--   (068 이 적어 둔 그 구멍), 그걸 definer 함수가 쓰기 시작하면 **벽이 장식이
--   된다.** 대신 규칙을 **정확하게** 적는다:
--
--     · 신고를 **처리**(status·resolved_at)하는 것은 그대로 운영자만
--     · 그런데 **내가 낸 신고를 내가 지우는 것**은 운영이 아니다 — 허용한다
--     · `operators` 에서 **나를 빼는 것**도 마찬가지다
--
-- ★ 바꿔 말하면 **"남의 줄"에만 벽을 세운다.** 자기 줄을 치우는 것은
--   개인정보를 지우는 일이고, 그걸 막으면 5.1.1(v) 를 만족할 수 없다.
-- ---------------------------------------------------------------------
create or replace function public.tg_operator_only()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare me uuid := auth.uid();
begin
  /* `current_user` 로 가르면 안 된다 — `security definer` 가 바꾼다(§13.122).
     비어 있으면 서버 자신(마이그레이션·배치)이고, 그 자리는 067 이 막는다. */
  if me is null then return coalesce(new, old); end if;

  /* ★ **자기 줄을 치우는 것은 운영이 아니다.** 계정을 지울 때 cascade 로
     들어오는 길이 여기다(§13.138). 지우는 것(DELETE)에만 연다 —
     신고를 **고치는 것**은 아래 빗장이 그대로 받는다. */
  /* ★ 분기를 **중첩한다.** `tg_table_name = 'reports' and old.reporter_id = me`
     처럼 한 줄로 쓰면 안 된다 — plpgsql 은 그 조건을 **SQL 식 하나**로 넘기고
     SQL 은 `and` 를 **단락평가하지 않는다.** 그래서 `operator_log` 에서
     `record "old" has no field "reporter_id"` 로 터진다. 실제로 터뜨리고 알았다. */
  if tg_op = 'DELETE' then
    if tg_table_name = 'reports' then
      if old.reporter_id = me then return old; end if;
    elsif tg_table_name = 'operators' then
      if old.user_id = me then return old; end if;
    end if;
  end if;

  if not public.is_operator() then
    raise exception '운영자만 할 수 있습니다 (%)', tg_table_name
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

/* 내 사진의 **저장소 경로**. `{user_id}/{media_id}.{ext}` 꼴이다(030). */
create or replace function public.api_my_media_paths()
returns text[] language sql stable security invoker
set search_path = public, extensions as $$
  /* ★ `url` 에서 뽑는다. 저장소를 바꾸면 이 조각만 고치면 된다 —
     경로를 따로 적어 두면 `url` 과 **둘이 어긋난다**(§13.37). */
  select coalesce(array_agg(distinct p), '{}')
  from (
    select substring(m.url from '/public/photos/(.+)$') as p
    from public.media m
    join public.pins pi on pi.id = m.pin_id
    where pi.user_id = auth.uid()
    union all
    select substring(m.poster_url from '/public/photos/(.+)$')
    from public.media m
    join public.pins pi on pi.id = m.pin_id
    where pi.user_id = auth.uid() and m.poster_url is not null
    union all
    select substring(m.thumb_url from '/public/photos/(.+)$')
    from public.media m
    join public.pins pi on pi.id = m.pin_id
    where pi.user_id = auth.uid() and m.thumb_url is not null
  ) t where p is not null;
$$;

/* ── 기록 **하나** 지우기. 지울 파일 경로를 돌려준다. ────────────────
   ★★ **`security definer` 여야 한다.** `security invoker` 로 썼다가 막혔다:

     update public.pins set deleted_at = now() …
       → ERROR: new row violates row-level security policy for table "pins"

   `pins_read`(006)가 **`deleted_at is null`** 을 달고 있어서, 지운 표시를
   다는 순간 **새 행이 자기 정책에 안 보이게 되고** 거절된다.
   같은 행에 `memo` 나 `is_public` 을 바꾸는 것은 **된다** — `deleted_at` 만
   안 된다(쪼개서 돌려 보고 알았다).

   ★ 즉 **주인도 자기 기록을 못 지우는 상태였다.** 006 부터 그랬고, 지우는
     길이 **아예 없어서** 아무도 못 봤다(§13.137 에서 "지우는 화면이 없다"를
     찾은 그 자리다). 기능이 없으면 그 기능의 버그도 안 보인다.

   ★ 정책을 고치는 대신 **이 함수만 definer 로** 둔다. 정책에서 `deleted_at
     is null` 을 빼면 지운 기록이 목록·집계에 다시 섞일 수 있고, 그건 훨씬
     넓은 변경이다. 대신 **주인 확인을 함수가 직접 한다**(아래 `if not exists`).
   ★ 그래서 이 함수는 **인자로 받은 핀이 내 것인지 반드시 먼저 본다.**
     definer 는 RLS 가 안 봐주므로 그 한 줄이 유일한 벽이다. */
create or replace function public.api_delete_pin(p_pin uuid)
returns text[] language plpgsql security definer
set search_path = public, extensions as $$
declare paths text[];
begin
  if auth.uid() is null then return '{}'; end if;
  /* ★ 내 것만. 남의 기록을 내리는 것은 **신고 → 운영자** 경로다(§13.135). */
  if not exists (select 1 from public.pins
                  where id = p_pin and user_id = auth.uid() and deleted_at is null) then
    return '{}';
  end if;

  select coalesce(array_agg(x), '{}') into paths from (
    select substring(m.url from '/public/photos/(.+)$') as x from public.media m where m.pin_id = p_pin
    union all
    select substring(m.poster_url from '/public/photos/(.+)$') from public.media m
     where m.pin_id = p_pin and m.poster_url is not null
    union all
    select substring(m.thumb_url from '/public/photos/(.+)$') from public.media m
     where m.pin_id = p_pin and m.thumb_url is not null
  ) t where x is not null;

  delete from public.media where pin_id = p_pin;
  /* ★ 핀은 **지운 표시만** 한다(002 가 그렇게 정했다) — 함께 쓰는 타임라인에
     구멍이 나면 안 된다. 사진은 진짜로 지우고, 자리만 남긴다. */
  update public.pins set deleted_at = now() where id = p_pin;
  return paths;
end $$;

-- ---------------------------------------------------------------------
-- ★★ 참조 둘이 **계정 삭제를 막고 있었다**
--
-- `profiles` 를 참조하는 외래키를 세어 보니 둘이 `no action` 이었다:
--
--     operators.granted_by      ← 남에게 운영자를 **준 적**이 있으면
--     report_actions.actor_id   ← 신고를 **처리한 적**이 있으면
--
-- 그러면 그 사람은 **자기 계정을 영영 못 지운다.** 평범한 사용자는 안 걸리니
-- 스모크도 통과했다 — **빗장을 빼 보다가** 드러났다(삭제를 넓히니 FK 가 터졌다).
--
-- ★ 두 칸 다 **`null` 이 이미 뜻을 갖고 있다** — `actor_id` 에는
--   *"null이면 DB 직접 조작"* 이라고 적혀 있다. 그러니 `set null` 이 맞다.
--   지운 사람의 **행적은 남고 이름만 빠진다** — 운영 기록은 지키면서
--   개인정보는 지우는 것이 둘 다 하는 유일한 방법이다.
-- ---------------------------------------------------------------------
alter table public.report_actions drop constraint if exists report_actions_actor_id_fkey;
alter table public.report_actions add constraint report_actions_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.operators drop constraint if exists operators_granted_by_fkey;
alter table public.operators add constraint operators_granted_by_fkey
  foreign key (granted_by) references public.profiles(id) on delete set null;

/* ── ★ 계정 지우기 — **되돌릴 수 없다** ────────────────────────────
   `auth.users` 를 지우면 아래가 전부 따라간다(cascade):
     profiles → pins · media · trips · spaces 멤버십 · reactions · reports …
   ★ `security definer` 여야 한다 — `authenticated` 는 `auth.users` 를 못 만진다.
   ★ **`auth.uid()` 말고는 아무도 못 지운다.** 인자를 안 받는 이유가 그것이다 —
     인자를 받으면 언젠가 거기에 남의 id 가 들어간다. */
create or replace function public.api_delete_account()
returns boolean language plpgsql security definer
set search_path = public, extensions, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then return false; end if;
  delete from auth.users where id = me;
  return true;
end $$;

comment on function public.api_delete_account is
  '내 계정을 지운다. 되돌릴 수 없다. 사진은 앱이 먼저 지운다(§13.138).';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
