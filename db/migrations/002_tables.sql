-- =====================================================================
-- TRIPPIC · 002 테이블
-- 계층: Space(누구와) → Trip(언제 어디) → Pin(한 장소 방문) → Media
--       Region(시군구) → Place(POI) ← Pin
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 마스터 — 행정경계 (VWorld/SGIS 임포트)
-- ---------------------------------------------------------------------
create table public.regions (
  code        text primary key,                       -- '11010'
  name        text not null,                          -- '종로구'
  name_eng    text,
  sido        text not null,                          -- '서울특별시'
  geom        geometry(MultiPolygon, 4326) not null,
  bbox        geometry(Polygon, 4326) not null,        -- 임포트 시 ST_Envelope로 채움
  center      geometry(Point, 4326) not null,
  updated_at  timestamptz not null default now()
);
comment on table public.regions is '시·군·구 229개. 커버리지 집계 단위이자 폴리곤 색칠 단위.';

-- ---------------------------------------------------------------------
-- 2. 신원
-- ---------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  handle            text not null,                    -- '@minji' 의 minji
  nickname          text not null,
  profile_img       text,
  personal_space_id uuid,                             -- FK는 spaces 생성 후 추가
  theme             text not null default 'noir',
  -- 자택 추정 좌표. 공개 등록 시 경고를 띄우는 용도로만 쓴다.
  -- 어떤 API로도 절대 밖으로 내보내지 않는다. PLAN §8
  home_geom         geometry(Point, 4326),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint profiles_handle_fmt check (handle ~ '^[a-z0-9_]{3,20}$')
);

-- ---------------------------------------------------------------------
-- 3. 스페이스 — 관계 단위. 여행마다 새로 만들지 않는다. PLAN §6.7
-- ---------------------------------------------------------------------
create table public.spaces (
  id             uuid primary key default gen_random_uuid(),
  type           space_type not null default 'shared',
  title          text not null,                       -- '지은이와', '대학 동기들', '가족'
  cover_media_id uuid,                                -- FK는 media 생성 후 추가
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  invite_code    text not null default encode(gen_random_bytes(9), 'hex'),
  visibility     space_visibility not null default 'private',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index spaces_invite_code_key on public.spaces (invite_code);

alter table public.profiles
  add constraint profiles_personal_space_fk
  foreign key (personal_space_id) references public.spaces(id) on delete set null;

create table public.space_members (
  space_id  uuid not null references public.spaces(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

-- ---------------------------------------------------------------------
-- 4. 여행 — 스페이스와 기록 사이의 층. 자동 생성 후 이름만 수정. PLAN §6.7
-- ---------------------------------------------------------------------
create table public.trips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  title          text not null,                       -- '지은이랑 강릉'
  note           text,                                -- 여행의 취지 한두 줄. 선택
  cover_media_id uuid,
  start_date     date not null,
  end_date       date not null,
  auto_generated boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint trips_dates check (end_date >= start_date),
  constraint trips_note_len check (note is null or length(note) <= 300)
);
comment on column public.trips.note is
  '여행 취지. 한 번 쓰면 그 여행의 모든 사진에 맥락이 붙는다 — 글 중 효율이 가장 좋다.';

-- 한 여행을 여러 스페이스에 공유 (가족여행에 친구 합류 등)
create table public.trip_spaces (
  trip_id   uuid not null references public.trips(id) on delete cascade,
  space_id  uuid not null references public.spaces(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (trip_id, space_id)
);

-- ---------------------------------------------------------------------
-- 5. 장소 — 공공데이터로 사전 구축하는 자체 자산. PLAN §10
-- ---------------------------------------------------------------------
create table public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    pin_category not null default 'etc',
  address     text,
  region_code text references public.regions(code),
  geom        geometry(Point, 4326) not null,
  source      place_source not null,
  source_ref  text,                                   -- 원천 고유 ID. 재임포트 멱등성
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index places_source_ref_key
  on public.places (source, source_ref) where source_ref is not null;

-- ---------------------------------------------------------------------
-- 6. 기록 — user 소유. space에 종속되지 않는다. PLAN §6 / §7
--    공개 범위는 Pin의 속성이고, 지도에 그려지는 것은 Place다.
-- ---------------------------------------------------------------------
create table public.pins (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  trip_id      uuid references public.trips(id) on delete set null,   -- 낱개 기록 허용
  place_id     uuid references public.places(id) on delete set null,  -- 매칭 실패 허용
  region_code  text references public.regions(code),
  geom         geometry(Point, 4326) not null,
  category     pin_category not null default 'etc',
  memo         text,
  visited_at   timestamptz not null,                  -- 소급 제한 없음. 2005년도 허용
  date_source  date_source not null default 'exif',
  verification verification_level not null default 'manual',
  is_public    boolean not null default false,        -- 기본값은 '나만'
  like_count   int not null default 0,
  save_count   int not null default 0,
  media_count  int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,                           -- 공유 타임라인에 구멍이 나면 안 된다
  constraint pins_memo_len check (memo is null or length(memo) <= 200),
  constraint pins_visited_sane check (visited_at > timestamptz '1990-01-01')
);

-- Pin ↔ Space N:M. 같은 사진이 내 지도·스페이스·모두의 지도에 동시에 존재한다
create table public.pin_spaces (
  pin_id    uuid not null references public.pins(id) on delete cascade,
  space_id  uuid not null references public.spaces(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (pin_id, space_id)
);

-- ---------------------------------------------------------------------
-- 7. 미디어 — 업로드 무제한, 노출만 제한. PLAN §8
-- ---------------------------------------------------------------------
create table public.media (
  id           uuid primary key default gen_random_uuid(),
  pin_id       uuid not null references public.pins(id) on delete cascade,
  type         media_type not null default 'photo',
  url          text not null,
  poster_url   text,                                  -- video 첫 프레임
  duration_sec numeric(4,1),
  width        int,
  height       int,
  is_main      boolean not null default false,        -- 폴리곤·핀 커버로 승격될 1장
  sort_order   int not null default 0,
  caption      text,
  taken_at     timestamptz,
  exif_geom    geometry(Point, 4326),
  bytes        bigint,
  created_at   timestamptz not null default now(),
  constraint media_caption_len check (caption is null or length(caption) <= 120),
  -- 15초 클립 한정. 트랜스코딩 서버 없이 R2에 mp4 직서빙. PLAN §8
  constraint media_video_len check (
    type <> 'video' or (duration_sec is not null and duration_sec > 0 and duration_sec <= 15)),
  constraint media_video_poster check (type <> 'video' or poster_url is not null)
);
-- 대표 사진은 핀당 1장
create unique index media_one_main_per_pin on public.media (pin_id) where is_main;

alter table public.spaces
  add constraint spaces_cover_fk foreign key (cover_media_id)
  references public.media(id) on delete set null;
alter table public.trips
  add constraint trips_cover_fk foreign key (cover_media_id)
  references public.media(id) on delete set null;

-- ---------------------------------------------------------------------
-- 8. 반응
-- ---------------------------------------------------------------------
create table public.reactions (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  target_type reaction_target not null,
  target_id   uuid not null,
  kind        reaction_kind not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id, kind)
);

-- ---------------------------------------------------------------------
-- 9. 집계 캐시
-- ---------------------------------------------------------------------

-- 커버리지. 매번 COUNT 하지 않는다. PLAN §7
create table public.region_progress (
  scope_type        scope_type not null,
  scope_id          uuid not null,                    -- user_id 또는 space_id
  region_code       text not null references public.regions(code),
  first_unlocked_at timestamptz not null,
  pin_count         int not null default 0,
  media_count       int not null default 0,
  cover_media_id    uuid references public.media(id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (scope_type, scope_id, region_code)
);

-- 장소 노출 점수. 반응 수만 보면 인스타와 같은 구조가 되어 협찬이 들어온다. PLAN §8.5
create table public.place_stats (
  place_id      uuid primary key references public.places(id) on delete cascade,
  pin_count     int not null default 0,
  visitor_count int not null default 0,               -- 서로 다른 사람 수 ← 가중치 최상
  live_count    int not null default 0,               -- 현장 인증 수
  note_count    int not null default 0,               -- 글이 있는 기록 수
  save_count    int not null default 0,
  like_count    int not null default 0,
  top_media_id  uuid references public.media(id) on delete set null,
  score         real not null default 0,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 10. 신고
-- ---------------------------------------------------------------------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type reaction_target not null,
  target_id   uuid not null,
  reason      text not null,
  status      report_status not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
