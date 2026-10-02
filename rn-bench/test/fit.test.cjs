/**
 * 상자 맞추기 검사 — `npm run test:fit`
 *
 * ★ 이 함수가 틀려도 **화면은 안 깨진다.** 지도는 멀쩡히 그려지고 다만 엉뚱한
 *   자리를 비춘다 — 그래서 눈으로는 *"데이터가 없나 보다"* 로 읽힌다.
 *   §13.94 에서 실제로 그렇게 넘어갔다(스페이스 `지도 ›` 가 빈 화면에 떨어졌다).
 */
const { zoomForBBox, padPinBox, unionBox, Z_REGION } = require("../build-test/fitBox.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };
const W = 402, H = 874;                     // iPhone 17 Pro 포인트

console.log("── 상자 맞추기 (§13.94) ──");

/* ★ 실측 상자: 강릉(51150) · 해운대(26350) · 통영(48220) 에 걸친 스페이스 */
const rows = [
  { bw: 129.173, bs: 35.167, be: 129.173, bn: 35.167 },
  { bw: 128.400, bs: 34.605, be: 128.400, bn: 34.605 },
  { bw: 128.956, bs: 37.780, be: 128.956, bn: 37.780 },
];
const box = unionBox(rows);
ok(box[0] === 128.4 && box[1] === 34.605 && box[3] === 37.78,
   "세 지역의 상자를 합친다");

const z = zoomForBBox(padPinBox(box), W, H, true);
ok(z < 8.5,
   `★ 세 지역에 걸친 스페이스는 **줌 ${z.toFixed(2)}** 로 물러난다 — ` +
   "예전에는 하한 9.3 이 밀어 올려 핀이 하나도 안 보였다(§13.67 이 만든 길이 반대로 돌았다)");

/* 담기는지 직접 본다 — 줌 z 에서 화면이 덮는 위도 폭이 상자보다 넓어야 한다 */
const mercY = (lat) => Math.log(Math.tan(Math.PI/4 + lat*Math.PI/360))/Math.PI/2 + 0.5;
const covered = (H / 256 / Math.pow(2, z));                 // 메르카토르 단위
const need = Math.abs(mercY(box[3]) - mercY(box[1]));
ok(covered >= need,
   `★ 그 줌에서 세 곳이 **실제로 화면에 담긴다** (덮는 폭 ${covered.toFixed(4)} ≥ 필요 ${need.toFixed(4)})`);

/* 한 곳뿐일 때는 여전히 바짝 들어간다 — 하한을 푼 것이 이쪽을 망치면 안 된다 */
const one = zoomForBBox(padPinBox([129.173, 35.167, 129.173, 35.167]), W, H, true);
ok(one === 16.5,
   `★ 한 곳뿐이면 상한 16.5 까지 들어간다 (${one}) — 점짜리 상자는 padPinBox 가 막는다`);

/* 행정구역 상자는 **하한을 그대로 둔다** — "눌렀으면 집계 줌에 머물지 않는다" */
const wideRegion = zoomForBBox([126.0, 34.0, 130.0, 38.0], W, H, false);
ok(wideRegion === Z_REGION + 0.3,
   `★ 행정구역 상자에는 하한이 그대로 있다 (${wideRegion}) — 지역을 눌렀으면 들어가야 한다`);
const smallRegion = zoomForBBox([129.10, 35.15, 129.20, 35.20], W, H, false);
ok(smallRegion <= 12.5,
   `행정구역 상한은 12.5 다 (${smallRegion.toFixed(2)})`);

ok(unionBox([]) === null && unionBox([{ bw: NaN, bs: 1, be: 2, bn: 3 }]) === null,
   "★ 쓸 상자가 없으면 null — 날아가지 않는다(보던 자리를 안 빼앗는다)");

/* ── 가려지는 만큼 빼고 맞추기 (§13.95) ── */
const { fitView, invMercY } = require("../build-test/fitBox.js");
const INS = { top: 116, bottom: 182 };          // 상단 칩 두 줄 · 바텀시트(peek)

ok(Math.abs(invMercY(mercY(35.1)) - 35.1) < 1e-9,
   "★ mercY 의 역함수가 제자리로 돌아온다 — 중심을 옮기려면 되돌릴 수 있어야 한다");

const full = zoomForBBox(padPinBox(box), W, H, true);
const fit = fitView(padPinBox(box), W, H, INS, true);
ok(fit.zoom < full,
   `★ 가려지는 만큼 빼면 **더 물러난다** (${full.toFixed(2)} → ${fit.zoom.toFixed(2)}) — ` +
   "전체 높이로 맞추면 위아래 끝이 칩과 시트 밑으로 들어간다");

/* 그 줌에서 **보이는 띠**가 상자를 덮는가 */
const visH = H - INS.top - INS.bottom;
const coveredVis = visH / 256 / Math.pow(2, fit.zoom);
ok(coveredVis >= need,
   `★ 보이는 띠 안에 다 담긴다 (띠가 덮는 폭 ${coveredVis.toFixed(4)} ≥ 필요 ${need.toFixed(4)})`);

/* ★ 중심도 옮겨야 한다 — 시트가 칩보다 두꺼우므로 카메라는 **남쪽**으로 내려간다 */
/* ★ `padPinBox` 는 **도 단위**로 넓히므로 메르카토르 중앙이 살짝 달라진다 —
   비교 대상은 **맞출 때 쓴 바로 그 상자**여야 한다(처음엔 패딩 전 상자로 쟀다). */
const pb = padPinBox(box);
const mid = invMercY((mercY(pb[1]) + mercY(pb[3])) / 2);
ok(fit.center[1] < mid,
   `★ 카메라 중심이 상자 한가운데보다 **남쪽**이다 (${fit.center[1].toFixed(3)} < ${mid.toFixed(3)}) — ` +
   "줌만 고치고 중심을 그대로 두면 위로 치우친 띠에 안 맞아 더 틀린다");
ok(Math.abs(fit.center[0] - (pb[0] + pb[2]) / 2) < 1e-9,
   "좌우는 가리는 것이 없으므로 중심이 그대로다");

/* 위아래가 같으면 중심은 안 움직인다 — 옮기는 것은 **치우침 때문**이다 */
const even = fitView(padPinBox(box), W, H, { top: 150, bottom: 150 }, true);
ok(Math.abs(even.center[1] - mid) < 1e-9,
   "★ 위아래가 같으면 중심은 그대로다 — 무조건 내리는 것이 아니다");

console.log("");
if (fail) { console.log(`=== 실패 ${fail}건 / 통과 ${pass}건 ===`); process.exit(1); }
console.log(`=== 전부 통과 (${pass}건) ===`);
