-- =====================================================================
-- 059 **스폰서 줄** (§12.23 · §12.26-A · §13.92)
--
-- §12.26-A 가 `퀘스트` 탭을 접으면서 적어 둔 자리다:
--   *"퀘스트는 탭이 아니다. 사용자가 생긴 뒤 `갈 곳` 안의 스폰서 줄로 들어온다.
--     §12.23 의 인증·부정대책·스키마는 그대로 살려 두되 탭 한 칸을 주지 않는다."*
--
-- ── 여기서 **안 만든 것 ①: 자동 생성 퀘스트(1·2겹)** ─────────────────
-- ★ §12.23-C 는 계약이 0건일 때 *"우리가 자동 생성한 퀘스트"* 로 채우자고 했다.
--   **그걸 따르지 않는다.** §12.26-A 가 퀘스트를 탭에서 내린 **이유 자체**가 그것이다:
--     *"다시 보니 그건 §12.22 마이의 `아직 안 간 곳`에 옷만 갈아입힌 것이다.
--       같은 묶음 두 개는 하나보다 나쁘다."*
--   게다가 2겹(*"이번 달 열리는 축제"*)은 이미 `갈 곳` 의 `지금 하는 행사` ·
--   `곧 시작합니다` 줄이다(056). 채우려고 그걸 또 그리면 **같은 줄이 두 개**가 된다.
--   → **계약이 없으면 줄이 아예 안 뜬다.** 빈 자리를 가짜로 메우지 않는다.
--     그게 §12.7(빈 피드)에서 배운 것을 **반대로 적용하는 유일한 자리**다 —
--     거기서는 *"공급자가 없어도 첫날부터 찬다"* 가 맞았지만, 광고 줄은
--     **광고가 없을 때 비어 있는 것이 정상**이다.
--
-- ── 안 만든 것 ②: 운영 화면 ──────────────────────────────────────
-- ★ 계약은 **몇 건 단위**다(지자체 영업). 0건인데 CMS 를 먼저 만드는 것은 추측이다.
--   퀘스트는 운영자가 SQL 로 넣는다. 화면이 필요해지는 날 — 즉 계약이 몇 건
--   쌓여 손으로 넣는 것이 아파지는 날 — 그때 만든다.
--
-- ── 안 만든 것 ③: 쿠폰 ───────────────────────────────────────────
-- ★ §12.23-D 가 못 박은 것: *"쿠폰은 우리가 발행하지 않는다. 인증 결과만 넘기고
--   발행·정산은 그쪽에서 한다. 우리는 **인증 사업자**로 선다."*
--   그래서 보상은 **URL 하나**다. 앱은 쿠폰을 모른다.
-- =====================================================================

-- ── ① 퀘스트 ────────────────────────────────────────────────────
create table if not exists public.quests (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  /* ★ `sponsor` 가 null 이면 우리가 만든 것, 있으면 **유료**다 — §12.23-E 의
     *"컬럼 하나로 갈린다"*. 화면이 이 칸 하나를 보고 `광고` 를 붙인다.
     표시광고법은 광고임을 **명확히** 알리라고 한다. 묻어 두면 안 된다. */
  sponsor       text,
  region_code   text references public.regions(code),
  place_ids     uuid[] not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  target_count  int not null,
  reward_kind   text,
  reward_url    text,
  status        text not null default 'draft',
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint quests_status_ck   check (status in ('draft', 'live', 'ended')),
  constraint quests_period_ck   check (ends_at > starts_at),
  constraint quests_places_ck   check (cardinality(place_ids) between 1 and 50),
  /* ★ 목표가 장소 수보다 크면 **아무도 못 끝내는 퀘스트**가 된다. 계약서에
     오타 한 번이면 생기는 일이라 DB 가 막는다. */
  constraint quests_target_ck   check (target_count between 1 and cardinality(place_ids)),
  /* ★ 보상을 걸었으면 받을 곳이 있어야 한다 */
  constraint quests_reward_ck   check (reward_kind is null or reward_url is not null)
);
comment on table public.quests is
  '스폰서 줄의 재료. sponsor 가 null 이 아니면 유료다 — 화면이 그 칸을 보고 광고 표시를 붙인다(§13.92).';

create index if not exists quests_live_idx
  on public.quests (ends_at) where status = 'live';

-- ── ② 인증 기록 ─────────────────────────────────────────────────
-- ★ **제출 표가 아니다.** 진행도는 핀에서 **파생**한다(아래 ③) — §12.23-G 가
--   *"퀘스트 전용 사진 업로드 경로를 또 만들지 않는다"* 고 적었고, 경로를 안 만들면
--   제출이라는 것 자체가 없어 **조작할 표면이 사라진다.**
--   이 표는 *"받아 갔다"* 한 줄이다 — 지자체에 넘길 **인증 사업자의 기록**이다.
create table if not exists public.quest_claims (
  quest_id   uuid not null references public.quests(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  /* 무엇으로 인정됐는지 남긴다. 나중에 *"왜 저 사람이 받았나"* 를 답할 수 있어야 한다 */
  place_ids  uuid[] not null,
  pin_ids    uuid[] not null,
  /* ★ **계정당 1회**(§12.23-D). 기본키가 그 규칙이다 — 코드로 막으면 언젠가 샌다 */
  primary key (quest_id, user_id)
);
comment on table public.quest_claims is
  '보상을 받아 간 기록. 진행도는 핀에서 파생하므로 제출 표가 아니다 — 계정당 한 줄(§13.92).';

alter table public.quests       enable row level security;
alter table public.quest_claims enable row level security;

/* 살아 있는 퀘스트만 보인다. 초안과 끝난 것은 운영자만 본다 —
   초안이 보이면 계약 전에 스폰서 이름이 샌다. */
drop policy if exists quests_read on public.quests;
create policy quests_read on public.quests for select using (
  (status = 'live' and now() between starts_at and ends_at) or public.is_operator()
);

/* 내 것만. 남이 무엇을 받아 갔는지는 알 바가 아니다 */
drop policy if exists quest_claims_read on public.quest_claims;
create policy quest_claims_read on public.quest_claims for select using (
  user_id = auth.uid() or public.is_operator()
);

grant select on public.quests, public.quest_claims to anon, authenticated;
/* ★ insert/update 정책을 **안 만든다.** PostgREST 로는 아무도 못 쓴다 —
   퀘스트는 운영자가 넣고, 받아 가는 것은 아래 함수만 쓴다. */

-- ── ③ 줄 하나를 내준다 ──────────────────────────────────────────
-- ★ **한 건만** 돌려준다. 광고 줄이 둘이면 그건 광고판이지 추천 화면이 아니다.
--   가까운 것 → 먼저 끝나는 것 순으로 하나를 고른다.
-- ★ `security invoker` — 진행도(`mine`)는 **보는 사람마다 달라야** 하고,
--   살아 있는 퀘스트만 보이는 것은 RLS 가 이미 한다(055·058 과 같은 선택).
create or replace function public.api_sponsor_rail(
  p_lng double precision,
  p_lat double precision,
  p_radius_m double precision default 80000
)
returns table (
  quest_id     uuid,
  title        text,
  sponsor      text,          -- null 이 아니면 화면이 `광고` 를 붙인다
  ends_at      timestamptz,
  target_count int,
  reward_url   text,
  done_count   int,           -- 내가 인정받은 곳 수 (파생)
  claimed      boolean,       -- 이미 받아 갔는가
  place_id     uuid,
  name         text,
  category     pin_category,
  lng          double precision,
  lat          double precision,
  dist_m       double precision,
  image_url    text,
  thumb_url    text,
  region_name  text,
  mine         boolean        -- 이 곳은 내가 **현장 인증**으로 남겼는가
)
language sql stable security invoker set search_path = public, extensions as $$
  with me as (select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g),
  /* ★ 기준점을 CTE **스칼라로 넘기지 않는다** — §13.81 에서 그러다 106ms 가
     2,286ms 가 됐다. 여기서는 퀘스트가 한 자릿수라 대상이 애초에 작지만,
     같은 모양을 두 번 쓰면 다음 사람이 그 함정을 복사한다. */
  pick as (
    select q.*
    from public.quests q
    where q.status = 'live'
      and now() between q.starts_at and q.ends_at
      /* 퀘스트 장소 중 **하나라도** 반경 안이면 보여 준다 — 전부일 필요는 없다 */
      and exists (
        select 1 from public.places p
        where p.id = any(q.place_ids)
          and ST_DWithin(p.geom::geography,
                         ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
                         p_radius_m)
      )
    order by (
      select min(ST_Distance(p.geom::geography,
                             ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography))
      from public.places p where p.id = any(q.place_ids)
    ), q.ends_at
    limit 1
  ),
  /* ★ 인정 기준 — §12.23-D 를 그대로 옮긴 곳이다.
       · `verification = 'live'` — **현장 인증만.** EXIF 는 조작할 수 있다(§009)
       · 퀘스트 **기간 안에** 간 것만 — 3년 전 사진으로 쿠폰이 나오면 퀘스트가 아니다
       · `distinct place_id` — 한 자리에서 백 장을 찍어도 **한 곳은 한 번**이다.
         §12.23-D 가 *"같은 좌표·같은 분 연속 제출 차단"* 을 만들 것으로 적어 뒀는데,
         진행도를 **제출이 아니라 파생**으로 두니 그 공격 자체가 성립하지 않는다 —
         막는 코드를 더하는 대신 **막을 것이 없는 모양**을 골랐다. */
  done as (
    select distinct pn.place_id
    from pick q
    join public.pins pn on pn.place_id = any(q.place_ids)
    where pn.user_id = auth.uid()
      and pn.deleted_at is null
      and pn.verification = 'live'
      and pn.visited_at between q.starts_at and q.ends_at
  )
  select q.id, q.title, q.sponsor, q.ends_at, q.target_count, q.reward_url,
         (select count(*)::int from done),
         exists (select 1 from public.quest_claims c
                  where c.quest_id = q.id and c.user_id = auth.uid()),
         p.id, p.name, p.category,
         ST_X(p.geom), ST_Y(p.geom),
         ST_Distance(p.geom::geography, (select g from me)),
         p.image_url, coalesce(p.image_thumb_url, p.image_url),
         rg.name,
         p.id in (select place_id from done)
  from pick q
  join public.places p on p.id = any(q.place_ids)
  left join public.regions rg on rg.code = p.region_code
  order by ST_Distance(p.geom::geography, (select g from me));
$$;
comment on function public.api_sponsor_rail is
  '갈 곳의 스폰서 줄 — 살아 있는 퀘스트 한 건과 그 장소들. 계약이 없으면 0행이다(§13.92).';

-- ── ④ 받아 가기 ─────────────────────────────────────────────────
-- ★ `security definer` — `quest_claims` 에 쓰는 유일한 길이고, **쓰기 전에 재야**
--   하기 때문이다. invoker 로 두고 insert 정책을 열면 *"목표를 안 채우고 넣기"* 가
--   정책 하나에 걸리게 된다. 쓰는 길이 하나면 규칙도 하나다.
create or replace function public.api_quest_claim(p_quest uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare q public.quests; v_places uuid[]; v_pins uuid[]; v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'why', 'need_login');
  end if;

  select * into q from public.quests
   where id = p_quest and status = 'live' and now() between starts_at and ends_at;
  if not found then
    /* ★ *"없는 퀘스트"* 와 *"끝난 퀘스트"* 를 **가르지 않는다** — 가르면 되묻는
       것만으로 초안의 존재를 알아낸다(038 초대 코드에서 쓴 것과 같은 규칙). */
    return jsonb_build_object('ok', false, 'why', 'not_open');
  end if;

  if exists (select 1 from public.quest_claims where quest_id = p_quest and user_id = v_me) then
    return jsonb_build_object('ok', false, 'why', 'already');
  end if;

  /* 인정 기준은 ③ 과 **같은 것**이어야 한다. 둘이 갈라지면 화면은 "다 했다"고
     하는데 받으려 하면 거절당한다. */
  select array_agg(d.place_id), array_agg(d.pin_id)
    into v_places, v_pins
  from (
    select distinct on (pn.place_id) pn.place_id, pn.id as pin_id
    from public.pins pn
    where pn.place_id = any(q.place_ids)
      and pn.user_id = v_me
      and pn.deleted_at is null
      and pn.verification = 'live'
      and pn.visited_at between q.starts_at and q.ends_at
    order by pn.place_id, pn.visited_at
  ) d;

  if coalesce(cardinality(v_places), 0) < q.target_count then
    return jsonb_build_object('ok', false, 'why', 'not_yet',
      'done', coalesce(cardinality(v_places), 0), 'target', q.target_count);
  end if;

  insert into public.quest_claims (quest_id, user_id, place_ids, pin_ids)
  values (p_quest, v_me, v_places, v_pins);

  /* ★ 쿠폰이 아니라 **URL** 이다. 앱은 쿠폰을 모른다(§12.23-D). */
  return jsonb_build_object('ok', true, 'reward_url', q.reward_url,
                            'reward_kind', q.reward_kind);
end $$;
comment on function public.api_quest_claim is
  '목표를 채웠으면 인증 기록 한 줄을 남기고 보상 URL 을 준다. 쿠폰은 발행하지 않는다(§13.92).';

grant execute on function public.api_sponsor_rail(double precision, double precision, double precision)
  to anon, authenticated;
grant execute on function public.api_quest_claim(uuid) to authenticated;

select public.lock_function_privileges();

/* ★ `lock_function_privileges` 가 **전부에게 다시 grant** 하므로, 좁히는 것은
   반드시 그 **뒤에** 온다(021 이 같은 순서로 적어 뒀다). */
revoke execute on function public.api_quest_claim(uuid) from anon;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 나중에 할 것 (지금 하면 추측이 된다)
--   · 운영 화면 — 계약이 손으로 넣기 아파질 만큼 쌓이면
--   · 노출·클릭 집계 — 스폰서는 보고서를 요구한다. `cover_events`(027) 와 같은
--     모양이면 되지만, **무엇을 보고할지는 계약서가 정한다.** 계약 전에 만들면
--     안 쓰는 칸이 남는다
--   · 완주 카드 — §12.23-F 가 §12.22 공유 카드와 같은 틀이라고 적었다.
--     공유 카드가 먼저 서야 한다
--   · 여러 건이 동시에 살아 있을 때의 순서 — 지금은 가까운 것 하나다.
--     계약이 둘 이상 겹쳐 본 적이 없으므로 규칙을 지어내지 않는다
-- ---------------------------------------------------------------------
