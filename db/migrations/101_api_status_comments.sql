-- =====================================================================
-- 101 앱도 웹도 안 부르는 `api_*` 30개에 **«지금 무엇인가»** 를 한 줄씩 붙인다
--
-- `STATUS.md` 1절이 «아무도 안 부르는 `api_*` 30개» 를 센다. 그런데 그 30개는
-- 같은 것이 아니다 — 화면만 기다리는 것, 다른 함수가 안에서 부르는 것,
-- 한 번도 붙은 적 없는 것이 섞여 있다. 새 사람이 «이게 현역인가» 를 판단할 수 없다는
-- 것이 비용이다(§13.182 7번). 지우는 것보다 싸고 되돌릴 일이 없다.
--
-- 분류는 **재서** 정했다(2026-10-24, §13.186):
--   · 앱(rn-bench/src)·웹(website/) 호출 — bin/probe.sh 의 api_called
--   · git 이력 전체에서 앱·웹·prototype 이 그 이름을 쓴 적이 있나 — `git log -S`
--   · DB 안에서 다른 함수가 부르나 — 마이그레이션 grep
--   · 적재·분석 스크립트가 부르나 — db/import · db/analysis
--
-- ★ `comment on function` 은 기존 주석을 **덮어쓴다.** 기존 주석에는 설계 근거가
--   들어 있으므로 지우지 않고 **앞에 태그만 붙인다.** 그래서 정적 문장이 아니라
--   지금 주석을 읽어 이어 붙인다. 이미 `[` 로 시작하면 건너뛴다(두 번 붙지 않게).
-- ★ 화면을 붙이거나 기능을 되살릴 때는 **태그를 같이 지운다.** 안 지우면 태그가
--   거짓말을 시작한다 — 그건 `STATUS.md` 가 «호출됨» 으로 바뀌는 것으로 드러난다.
-- =====================================================================

do $$
declare
  r record;
  f regprocedure;
  old text;
begin
  for r in
    select * from (values
      -- ① 화면 대기 — 서버는 끝났고 앱 화면만 없다
      ('api_comments',            '[화면 대기] 11월 댓글 화면(공유 스페이스)이 부를 것.'),
      ('api_comment_add',         '[화면 대기] 11월 댓글 화면이 부를 것. ★ 스페이스 밖 핀에서 RLS 거부가 정상인지 아직 못 쟀다(§13.185).'),
      ('api_comment_remove',      '[화면 대기] 11월 댓글 화면이 부를 것.'),
      ('api_pin_detail',          '[화면 대기] 11월 «남의 기록 하나 보기» 가 부를 것.'),
      ('api_pin_media',           '[화면 대기] 11월 «남의 기록 하나 보기» 가 부를 것.'),
      ('api_set_nickname',        '[화면 대기] 11월 닉네임 편집 화면이 부를 것.'),
      ('api_join_space',          '[화면 대기] 앱에 초대를 받는 길이 없다 — 보내기만 있다(DECISIONS D-8).'),
      ('api_rotate_invite',       '[화면 대기] 스페이스 탭을 내린 뒤(§13.114) 링크를 돌릴 화면이 없다(DECISIONS D-8).'),
      -- ② 운영 화면 없음 — website/admin.html 이 안 부른다. prototype/upload.js 의 운영 화면은 **흉내**였다
      ('api_operator_grant',      '[운영 화면 없음] admin.html 이 안 부른다. prototype 운영 화면은 목업이었다.'),
      ('api_operator_revoke',     '[운영 화면 없음] admin.html 이 안 부른다. prototype 운영 화면은 목업이었다.'),
      ('api_operator_list',       '[운영 화면 없음] admin.html 이 안 부른다. prototype 운영 화면은 목업이었다.'),
      ('api_operator_log',        '[운영 화면 없음] admin.html 이 안 부른다. prototype 운영 화면은 목업이었다.'),
      ('api_report_history',      '[운영 화면 없음] admin.html 이 안 부른다. prototype 운영 화면은 목업이었다.'),
      ('api_report_note',         '[운영 화면 없음] admin.html 이 안 부른다.'),
      ('api_report_reopen',       '[운영 화면 없음] admin.html 이 안 부른다. prototype 운영 화면은 목업이었다.'),
      ('api_mod_unsuspend_user',  '[운영 화면 없음] admin.html 에 정지(api_mod_suspend_user)는 있고 **해제는 없다.**'),
      -- ③ 안에서 쓰인다 — 앱이 안 부를 뿐 현역이다
      ('api_mod_remove_pin',      '[내부용] api_mod_enforce(077) 가 안에서 부른다. 현역이다.'),
      ('api_mark_closed',         '[스크립트용] db/import/load_merge.sql 이 적재 때 부른다. 현역이다.'),
      ('api_orientation_mix',     '[분석용] 사진 방향 기본값을 데이터로 정하려고 둔 측정 함수(013). 앱용이 아니다.'),
      -- ④ 대체됨 — 같은 일을 지금은 다른 함수가 한다. 앱·웹이 부른 적이 **한 번도 없다**(git 이력)
      ('api_place_search',        '[대체됨] 앱의 이름 검색은 api_search(062·081·094)가 한다. 앱이 부른 적 없음.'),
      ('api_map_places',          '[대체됨] 앱 지도는 api_pins_in_bbox(031)·api_places_in_bbox(051)로 만들어졌다. 앱이 부른 적 없음. api_places_near 가 안에서 부른다.'),
      ('api_map_clusters',        '[대체됨] 앱 지도는 api_pins_in_bbox(031)·api_places_in_bbox(051)로 만들어졌다. 앱이 부른 적 없음.'),
      ('api_map_overview',        '[대체됨] 앱 지도는 api_pins_in_bbox(031)·api_places_in_bbox(051)로 만들어졌다. 앱이 부른 적 없음.'),
      -- ⑤ 붙은 적 없는 기능 — 서버만 먼저 만들고 앱에 기능 자체가 없다. 앱·웹이 부른 적 **한 번도 없다**
      ('api_is_near_home',        '[미연결 기능] 공개 직전 «집 근처» 경고. 앱이 home_geom 을 받지도 않는다(운영 DB 0명).'),
      ('api_pin_publish_summary', '[미연결 기능] 업로드 화면의 «N장 중 M장만 모두의 지도에». 앱에 그 줄이 없다.'),
      ('api_record_pick',         '[미연결 기능] 장소 후보 선택을 학습한다(place_picks). 앱이 기록하지 않아 학습이 안 쌓인다.'),
      ('api_place_months',        '[미연결 기능] 장소의 월별 사진 달력. 앱 장소 시트에 없다.'),
      ('api_trips_in_view',       '[미연결 기능] 여행별 체크박스 필터의 목록. 앱에 그 필터가 없다(features.tsv tripfilter).'),
      ('api_places_near',         '[미연결 기능] 기준점 반경 «숙소에서 얼마나 먼지»(PLAN §6.6). 앱이 부른 적 없음.'),
      ('api_villages_in_bbox',    '[예비] 리 경계를 상자로 받는 길(088). 지금은 089 의 집계가 경계까지 준다.')
    ) t(fn, tag)
  loop
    for f in
      select p.oid::regprocedure from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = r.fn
    loop
      old := obj_description(f::oid, 'pg_proc');
      continue when old like '[%';
      execute format('comment on function %s is %L', f,
                     r.tag || coalesce(E'\n' || old, ''));
    end loop;
  end loop;
end $$;
