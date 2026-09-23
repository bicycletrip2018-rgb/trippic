/**
 * 하루 코스 복원 검사 — `npm run test:course`
 *
 * ★ 화면으로는 못 보는 것들이다: 날짜 경계(KST 자정), 입력 순서 뒤집기,
 *   제주↔뭍 구간. 시뮬레이터에서 이걸 만들어 보려면 사진을 매번 새로 지어야 한다.
 *   **순수 함수라서 이렇게 잡는 것이 가장 싸다.**
 */
const { buildCourses, legOf, dur } = require("../build-test/course.js");
// 서버(035)의 네 줄짜리 표를 그대로 흉내 낸다
const LM = {"50110":"jeju","50130":"jeju","47940":"ulleung","28720":"unknown"};
const lm = (rc) => LM[rc] || "mainland";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };
const pin = (id, iso, stay, lng, lat) =>
  ({ id, visited_at: iso, stay_sec: stay, lng, lat });

console.log("── 하루 코스 복원 ──");
// 서울 하루 2곳 + 다음날 1곳
const cs = buildCourses([
  pin("a", "2024-05-10T01:12:00Z", 420, 126.9770, 37.5796),   // KST 10:12
  pin("b", "2024-05-10T04:40:00Z", 720, 126.9830, 37.5826),   // KST 13:40
  pin("c", "2024-05-11T03:05:00Z", 1020, 126.9905, 37.5715),  // 다음날 1곳
]);
ok(cs.length === 1, `하루 1개만 코스가 된다 (${cs.length}개) — 1곳짜리 날은 순서가 없어 코스가 아니다`);
ok(cs[0].stops.length === 2, "그 하루는 2곳이다");
ok(cs[0].stops[0].id === "a", "★ 방문 시각 순이다 — 등록 순서가 아니다");
ok(cs[0].staySec === 1140, `머문 시간은 실측 합이다 (${cs[0].staySec}초 = 19분)`);
ok(cs[0].gapSec > 0 && Math.abs(cs[0].spanSec - (cs[0].staySec + cs[0].moveSec + cs[0].gapSec)) < 1,
   `★ 덮은 시간 = 머문 + 이동 + 모르는 시간 (${Math.round(cs[0].gapSec/60)}분이 설명되지 않는다)`);

// 순서를 거꾸로 넣어도 같은 코스가 나오는가
const rev = buildCourses([
  pin("b", "2024-05-10T04:40:00Z", 720, 126.9830, 37.5826),
  pin("a", "2024-05-10T01:12:00Z", 420, 126.9770, 37.5796),
]);
ok(rev[0].stops.map(s=>s.id).join() === "a,b", "★ 입력 순서가 뒤바뀌어도 시각으로 다시 세운다");

// 날짜 경계 — KST 자정 직전/직후는 다른 날이다
const mid = buildCourses([
  pin("x", "2024-05-10T14:50:00Z", 60, 127, 37),   // KST 05-10 23:50
  pin("y", "2024-05-10T15:10:00Z", 60, 127, 37),   // KST 05-11 00:10
], 1);
ok(mid.length === 2, `★ KST 자정으로 갈린다 (${mid.length}일) — UTC 로 자르면 한국의 하루가 반으로 잘린다`);

console.log("── 체류를 모를 때 ──");
const unk = buildCourses([
  pin("a", "2024-05-10T01:12:00Z", null, 126.977, 37.5796),
  pin("b", "2024-05-10T04:40:00Z", 720, 126.983, 37.5826),
]);
ok(unk[0].stayUnknown === 1, "사진 1장짜리는 '모른다'로 센다");
ok(dur(null) === null && dur(0) === null, "★ 0분을 쓰지 않는다 — 모르는 것은 0 이 아니다");

console.log("── 바다를 건널 때 (행정구역 → 육로 덩어리) ──");
const at = (id, rc, lng, lat) => ({ ...pin(id,"2024-01-01T00:00:00Z",0,lng,lat), regionCode: rc });
const sea = legOf(at("j","50110",126.53,33.50), at("b","26350",129.08,35.17), lm);
ok(sea.crossSea && sea.moveSec === null,
   "★ 제주↔뭍은 차 시간을 안 낸다 — 직선×1.4 는 바다 위에서 거짓말이다");
const land = legOf(at("s","11110",126.977,37.5796), at("g","26350",129.08,35.17), lm);
ok(!land.crossSea && land.moveSec > 0, "육지끼리는 차 시간을 낸다");
const inJeju = legOf(at("a","50110",126.53,33.50), at("b","50130",126.56,33.25), lm);
ok(!inJeju.crossSea, "★ 제주시↔서귀포시는 같은 섬이라 차로 간다 — 위도로 가르면 여기가 틀린다");
const ull = legOf(at("u","47940",130.90,37.50), at("g","26350",129.08,35.17), lm);
ok(ull.crossSea && ull.moveSec === null,
   "★ 울릉도도 걸린다 — 위도 한 줄로는 안 걸려서 '차로 3시간'이 찍혔다");
const mixed = legOf(at("w","28720",124.71,37.96), at("i","28110",126.70,37.45), lm);
ok(mixed.crossSea && mixed.moveSec === null,
   "★ 덩어리를 모르는 곳(옹진: 배와 연륙교가 섞임)도 시간을 말하지 않는다");
ok(!legOf(at("x","11110",126.9,37.5), at("y","11110",126.99,37.57)).crossSea,
   "표가 없으면 전부 본토로 본다 (옛 동작과 같다)");

console.log(fail ? `\n=== 실패 ${fail}건 / 통과 ${pass}건 ===` : `\n=== 전부 통과 (${pass}건) ===`);
process.exit(fail ? 1 : 0);
