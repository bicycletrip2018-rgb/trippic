/**
 * 축척 막대 검사 — `npm run test:scale`
 *
 * ★ 축척은 **틀려도 그럴듯하게 보인다.** `5km` 라고 적힌 막대가 실제로 10km 여도
 *   화면은 멀쩡하다 — 숫자로만 잡힌다(§13.99 의 교훈을 그대로 적용한다).
 */
const { metersPerPx, pickScale } = require("../build-test/scaleBar.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };

console.log("── 축척 막대 (§13.99) ──");

/* ★ 브라우저에서 **실측한 값**과 맞춘다 (위도 35.16, 폭 402px)
     z8 249.965 · z10 62.491 · z12 15.623 · z14 3.906 m/px */
const near = (a, b) => Math.abs(a - b) / b < 0.001;
ok(near(metersPerPx(8, 35.16), 249.965), `z8 에서 249.97 m/px (실측과 일치: ${metersPerPx(8,35.16).toFixed(3)})`);
ok(near(metersPerPx(12, 35.16), 15.623), `z12 에서 15.62 m/px (${metersPerPx(12,35.16).toFixed(3)})`);
ok(near(metersPerPx(14, 35.16), 3.906), `★ 실측값과 맞는다 — 256 으로 두면 전부 2배로 틀린다 (${metersPerPx(14,35.16).toFixed(3)})`);

/* 고른 거리는 막대 안에 들어가야 한다 */
for (const z of [6, 8, 10, 12, 14, 16, 18]) {
  const mpp = metersPerPx(z, 35.16);
  const s = pickScale(mpp, 92);
  ok(s.px <= 92 && s.px > 0, `z${z}: ${s.label} = ${s.px}px — 막대 안에 들어간다`);
}

/* ★ 1·2·5 계열만 나온다 — "3.7km" 같은 숫자는 가늠에 쓸 수 없다 */
let bad = null;
for (let z = 4; z <= 20; z += 0.25) {
  const s = pickScale(metersPerPx(z, 35.16), 92);
  const head = s.meters / Math.pow(10, Math.floor(Math.log10(s.meters)));
  if (![1, 2, 5].includes(Math.round(head))) { bad = `z${z} → ${s.meters}`; break; }
}
ok(!bad, `★ 어느 줌에서도 1·2·5 계열만 나온다 ${bad ? "(" + bad + ")" : ""}`);

/* 라벨 단위가 바뀌는 자리 */
ok(pickScale(10, 92).label.endsWith("m") && !pickScale(10, 92).label.endsWith("km"),
   `촘촘할 때는 m 로 적는다 (${pickScale(10,92).label})`);
ok(pickScale(2000, 92).label.endsWith("km"),
   `넓을 때는 km 로 적는다 (${pickScale(2000,92).label})`);

/* ★ 넘지 않는 것 중 **가장 큰 것** — 작은 쪽으로 붙으면 막대가 늘 짧아 보인다 */
const s1 = pickScale(10, 92);        // 92px 이면 920m 까지 → 500m 가 맞다
ok(s1.meters === 500, `★ 들어가는 것 중 가장 큰 것을 고른다 (${s1.label}, ${s1.px}px) — 1000m 는 100px 라 넘친다`);

console.log("");
if (fail) { console.log(`=== 실패 ${fail}건 / 통과 ${pass}건 ===`); process.exit(1); }
console.log(`=== 전부 통과 (${pass}건) ===`);
