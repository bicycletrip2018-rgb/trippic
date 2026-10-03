/** 손가락이 무엇을 먼저 보는가 (§13.116) */
const { tapLayers, regionFallback, SAVE_FIRST_MAX } = require("../build-test/tapRule.js");
let n = 0, bad = 0;
const eq = (got, want, why) => {
  n++;
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${a} / 기대 ${b}`);
};
const ok = (c, why) => { n++; if (!c) { bad++; console.log(`  FAIL ${why}`); } };

// ── 확대된 줌: 전부 본다 (§13.98 그대로) ──
for (const z of [9, 12, 14, 18]) {
  const L = tapLayers(z, 0);
  ok(L.includes("pin-dot") && L.includes("place-dot") && L.includes("save-dot"),
     `z${z}: 핀·상호·저장을 다 본다`);
  ok(!regionFallback(z), `z${z}: 지역으로 안 빠진다`);
}

// ── ★ 집계 줌: 저장만 앞에 ──
eq(tapLayers(5.6, 3), ["save-dot", "save-label"],
   "★ 집계 줌에서는 **저장만** 앞에 선다");
ok(!tapLayers(5.6, 3).includes("pin-dot"),
   "★ 핀은 앞세우지 않는다 — 300개면 화면을 통째로 가로챈다");
ok(regionFallback(5.6), "못 맞히면 지역으로 간다");

// ── 저장이 없으면 예전 그대로 (바로 지역) ──
eq(tapLayers(5.6, 0), [], "★ 저장이 없으면 볼 것이 없다 — 예전처럼 바로 지역이다");

// ── ★ 한도 ──
eq(tapLayers(5.6, SAVE_FIRST_MAX), ["save-dot", "save-label"], "한도까지는 앞세운다");
eq(tapLayers(5.6, SAVE_FIRST_MAX + 1), [],
   "★ 한도를 넘으면 안 앞세운다 — 많이 저장한 사람만 지역 이동을 잃으면 안 된다");
ok(SAVE_FIRST_MAX >= 50, "★ §13.103 이 말한 '쉰 개' 는 덮어야 한다");

// ── 경계는 Z_REGION(9) ──
eq(tapLayers(8.999, 5), ["save-dot", "save-label"], "9 바로 아래는 집계 줌");
ok(tapLayers(9, 5).includes("pin-dot"), "9 부터는 전부 본다");
ok(regionFallback(8.999) && !regionFallback(9), "경계가 한 곳이다");

console.log(bad ? `\n실패 ${bad}/${n}` : `\n손가락 규칙 ${n}건 통과`);
process.exit(bad ? 1 : 0);
