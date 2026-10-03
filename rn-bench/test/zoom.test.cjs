/** 줌 버튼이 어디로 가는가 (§13.105) */
const { zoomIn, zoomOut, canZoomIn, canZoomOut, Z_MIN, Z_MAX } =
  require("../build-test/zoomStep.js");
let n = 0, bad = 0;
const eq = (got, want, why) => {
  n++;
  if (Math.abs(got - want) < 1e-9) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${got} / 기대 ${want}`);
};
const ok = (c, why) => { n++; if (!c) { bad++; console.log(`  FAIL ${why}`); } };

// ── 정수에서는 그냥 한 단계 ──
eq(zoomIn(14), 15, "정수에서 확대는 한 단계");
eq(zoomOut(14), 13, "정수에서 축소는 한 단계");

// ── ★ 소수에서는 **정수로 맞춘다** ──
eq(zoomIn(5.6), 6, "★ 5.6 에서 확대하면 6 — 6.6 이 아니다");
eq(zoomOut(5.6), 5, "★ 5.6 에서 축소하면 5 — 4.6 이 아니다");
eq(zoomIn(13.2), 14,
   "★ 13.2 에서 한 번 누르면 **상호가 켜지는 14** 에 정확히 선다 (핀치로는 못 하는 일)");
eq(zoomOut(9.3), 9,
   "★ 9.3 에서 한 번 누르면 **집계 줌 9** 에 정확히 선다");

// ── ★ 죽은 눌림을 만들지 않는다 ──
eq(zoomIn(13.99), 15,
   "★ 13.99 에서 14 로 가면 0.01 만 움직여 화면이 그대로다 — 한 단계 더 간다");
eq(zoomOut(14.01), 13,
   "★ 14.01 에서 14 로 가면 마찬가지다 — 한 단계 더 간다");
ok(zoomIn(13.9) - 13.9 >= 0.15, "확대는 늘 눈에 보일 만큼 움직인다");
ok(14.1 - zoomOut(14.1) >= 0.15, "축소도 마찬가지다");

// ── 경계를 넘지 않는다 ──
eq(zoomIn(Z_MAX), Z_MAX, "위쪽 끝에서는 더 안 간다");
eq(zoomIn(17.9), Z_MAX, "끝 바로 아래에서 눌러도 끝을 넘지 않는다");
eq(zoomOut(Z_MIN), Z_MIN, "아래쪽 끝에서는 더 안 간다");
eq(zoomOut(3.05), Z_MIN, "끝 바로 위에서 눌러도 끝을 넘지 않는다");
eq(zoomIn(25), Z_MAX, "★ 핀치로 범위 밖까지 간 상태에서도 **되돌아올 뿐** 더 밀지 않는다");
eq(zoomOut(1), Z_MIN, "아래쪽도 같다");

// ── 흐리게 할지 ──
ok(!canZoomIn(Z_MAX) && canZoomIn(Z_MAX - 0.1), "★ 위쪽 끝에서 (+) 는 흐려진다");
ok(!canZoomOut(Z_MIN) && canZoomOut(Z_MIN + 0.1), "★ 아래쪽 끝에서 (−) 는 흐려진다");
ok(canZoomIn(10) && canZoomOut(10), "가운데서는 둘 다 산다");

// ── ★ 왕복이 제자리로 온다 (정수에서) ──
for (const z of [5, 9, 13, 14, 15, 17]) {
  eq(zoomOut(zoomIn(z)), z, `${z} 에서 확대했다 축소하면 제자리다`);
}

// ── 한 번에 한 단계를 넘지 않는다 (죽은 눌림 보정 빼고) ──
for (const z of [5.5, 7.2, 10.8, 12.4, 16.3]) {
  ok(zoomIn(z) - z <= 1.0001, `${z}: 확대가 한 단계를 넘지 않는다`);
  ok(z - zoomOut(z) <= 1.0001, `${z}: 축소가 한 단계를 넘지 않는다`);
}

console.log(bad ? `\n실패 ${bad}/${n}` : `\n줌 버튼 ${n}건 통과`);
process.exit(bad ? 1 : 0);
