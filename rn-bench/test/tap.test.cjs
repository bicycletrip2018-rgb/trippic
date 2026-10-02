/**
 * 탭이 무엇을 여는가 — `npm run test:tap`
 *
 * ★ 틀려도 **무언가는 열린다.** 엉뚱한 것이 열려도 사용자는 "내가 잘못 눌렀나"로
 *   읽고 넘어가므로 화면으로는 못 잡는다(§13.98).
 */
const { pickNearest, TAP_SLOP } = require("../build-test/tapPick.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };

console.log("── 탭 고르기 (§13.98) ──");

ok(TAP_SLOP === 22, "손가락 반지름 22pt — 애플 최소 타깃 44pt 의 절반");
ok(pickNearest([], 129, 35) === null, "후보가 없으면 null — 빈 곳을 누른 것이다");

/* 해운대 둘레. 상호가 2px 쯤, 내 핀이 20px 쯤 떨어진 상황 */
const near = { kind: "place", id: "p", lng: 129.1600, lat: 35.1600 };
const far  = { kind: "pin",   id: "n", lng: 129.1620, lat: 35.1620 };
ok(pickNearest([far, near], 129.16005, 35.16005).id === "p",
   "★ 분명히 상호를 노린 탭은 **상호가 가져간다** — 예전에는 핀이 무조건 이겨 20px 떨어진 내 기록이 열렸다");

/* 같은 자리(그 장소에 꽂은 내 기록) — 가장 흔한 경우 */
const samePin   = { kind: "pin",   id: "n2", lng: 129.16, lat: 35.16 };
const samePlace = { kind: "place", id: "p2", lng: 129.16, lat: 35.16 };
ok(pickNearest([samePin, samePlace], 129.16, 35.16).id === "n2",
   "★ 같은 좌표면 **핀이 이긴다** — 부르는 쪽이 핀을 앞에 넣어 그 규칙을 만든다");
ok(pickNearest([samePlace, samePin], 129.16, 35.16).id === "p2",
   "순서를 뒤집으면 앞의 것이 이긴다 — 규칙이 한 곳(부르는 쪽)에만 있다");

/* ★ 경도 보정이 **답을 바꾸는** 표본 (서울, 위도 37.5 → cos = 0.793)
     동쪽 0.01도 = 0.883km · 북쪽 0.0095도 = 1.050km → **실제로는 동쪽이 가깝다**
     보정을 빼면 0.01 > 0.0095 라 북쪽이 이긴다 — 즉 **지리적으로 틀린 답**이 나온다. */
const east  = { kind: "place", id: "e",  lng: 127.01, lat: 37.50 };
const north = { kind: "place", id: "n3", lng: 127.00, lat: 37.5095 };
ok(pickNearest([east, north], 127.00, 37.50).id === "e",
   "★ 경도를 cos(위도)로 보정한다 — 동쪽 0.883km 가 북쪽 1.050km 보다 가깝다. " +
   "보정을 빼면 북쪽이 이겨 **지리적으로 틀린 것**이 열린다");
/* 보정이 없으면 반대가 나온다는 것을 숫자로 못 박는다 */
ok(0.0095 * 0.0095 < 0.01 * 0.01,
   "   (보정 없는 셈으로는 북쪽이 이긴다 — 그래서 이 단언이 보정을 지킨다)");

console.log("");
if (fail) { console.log(`=== 실패 ${fail}건 / 통과 ${pass}건 ===`); process.exit(1); }
console.log(`=== 전부 통과 (${pass}건) ===`);
