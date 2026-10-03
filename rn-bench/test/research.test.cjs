/**
 * 재검색을 언제 세는가 — `npm run test:research`
 *
 * ★ 이 신호는 점수에서 **-2** 다. 헛나가면 멀쩡한 표지를 끌어내리는데
 *   화면에는 아무것도 안 보인다 — 순위가 조금 이상해질 뿐이다(§13.101).
 */
const { shouldCountResearch, RESEARCH_WINDOW_MS } = require("../build-test/researchRule.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };
const NOW = 1_700_000_000_000;
const min = (n) => n * 60 * 1000;

console.log("── 재검색 셈 (§13.9 규칙 3) ──");

ok(RESEARCH_WINDOW_MS === min(30), "창은 30분 — §13.9 가 정한 값");
ok(shouldCountResearch(undefined, NOW) === false,
   "★ 보여 준 적이 **없으면 안 센다** — 처음 찾는 사람을 감점하면 새 장소가 영원히 못 올라온다");
ok(shouldCountResearch(NOW - min(1), NOW) === true, "1분 전에 보여 줬으면 센다");
ok(shouldCountResearch(NOW - min(29), NOW) === true, "29분 전도 센다");
ok(shouldCountResearch(NOW - min(30), NOW) === true, "정확히 30분은 **포함**한다 (경계를 적어 둔다)");
ok(shouldCountResearch(NOW - min(31), NOW) === false,
   "★ 31분 전은 안 센다 — 한참 뒤의 검색은 '다시 찾은 것'이 아니라 새 질문이다");
ok(shouldCountResearch(NOW + min(5), NOW) === false,
   "★ 시계가 뒤로 간 경우는 안 센다 — 모르는 것을 셈에 넣지 않는다");
ok(shouldCountResearch(0, NOW) === false, "0(= 기억 없음)도 안 센다");

console.log("");
if (fail) { console.log(`=== 실패 ${fail}건 / 통과 ${pass}건 ===`); process.exit(1); }
console.log(`=== 전부 통과 (${pass}건) ===`);
