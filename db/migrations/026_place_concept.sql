-- =====================================================================
-- TRIPPIC · 026 장소·행사의 **컨셉 태그**
--
-- 배경(§12.17): 축제를 필터로 나누려는데 TourAPI 원본 분류가 쓸 수 없었다.
--   · `lclsSystm3` 18종 중 **EV010200(220) + EV010600(117) = 337건(37%)이 사실상 "일반"**이다.
--   · 제목 키워드만으로는 35%밖에 안 붙고, 느슨한 단어(산·들·항)를 넣으면
--     `가든 나이트 마켓`·`경산카페축제`·`고흥우주항공축제`가 **'꽃·자연'으로 오분류**된다
--     (실측: 208건 중 145건이 오분류였다).
--   · 코드 + 엄격한 키워드를 합쳐야 **48%(433/910)**다.
--
-- ★ 그래서 자동 분류를 정답으로 두지 않는다. **48%를 깔고 사람이 다듬는다.**
--   축제는 **910건뿐이다. 사람이 하루면 훑는 양이다.**
--   자동 분류율을 90%로 올리려 애쓰는 것보다, 운영자가 고치는 길을 여는 편이 싸고 정확하다.
--   (§10.27에서 여행/일상 판정에 내린 것과 같은 판단 — 기준을 정교하게 만드는 대신
--    틀렸을 때 고치는 비용을 낮춘다)
--
-- ★ `concept_source`로 **자동인지 사람이 고친 것인지** 구분한다.
--   재수집할 때 사람이 고친 것을 덮어쓰면 안 된다.
-- =====================================================================

alter table public.places add column if not exists concept text;
alter table public.places add column if not exists concept_source text
  check (concept_source is null or concept_source in ('auto', 'manual'));

comment on column public.places.concept is
  '사용자 언어의 컨셉 태그: 꽃·자연 / 음식·특산물 / 전통·야행 / 불꽃·빛·야경 / '
  '바다·해변 / 공연·영화 / 전시·마켓 / 체험·가족 / 겨울·눈';
comment on column public.places.concept_source is
  'auto=규칙으로 붙임 · manual=운영자가 고침. ★ 재수집이 manual을 덮어쓰면 안 된다.';

create index if not exists places_concept_idx on public.places (concept)
  where concept is not null;
