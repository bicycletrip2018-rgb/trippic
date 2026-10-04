/**
 * 지도 도형이 **제 일을 하는가** (§13.131)
 *
 * ★ 지키는 것 하나: *"지명을 좌표로 가르다가 **남한 지명을 잃는 일**"*.
 *   `tools/map_shapes.py` 를 다시 돌릴 때마다 모양이 바뀐다 — 단순화 값을
 *   한 번만 건드려도 해안·섬의 점이 울타리 밖으로 떨어지고, 그러면 그 지명이
 *   **조용히** 사라진다. 눈으로는 "원래 그런가 보다"로 읽힌다.
 *
 * ★ 파이썬 도구도 같은 것을 재지만, 그건 **사람이 돌려야** 돈다.
 *   이쪽은 CI 가 매번 돈다(§13.124).
 */
const outline = require("../assets/south-outline.json");
const cover   = require("../assets/north-cover.json");
const sgg     = require("../assets/korea-regions.json");

let n = 0, bad = 0;
const ok = (c, why) => { n++; if (!c) { bad++; console.log(`  FAIL ${why}`); } };

/** 광선 쏘기. 고리 하나 안에 있나 */
function inRing(x, y, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
/** 겉고리 안이고 구멍 안이 아니면 안이다 */
function inside(x, y, geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.some((rings) => inRing(x, y, rings[0]) &&
                               !rings.slice(1).some((h) => inRing(x, y, h)));
}

/* ── ★ 시군구 251개의 중심이 **전부** 울타리 안에 있어야 한다 ── */
const out = sgg.features.filter(
  (f) => !inside(f.properties.cx, f.properties.cy, outline.geometry));
ok(out.length === 0,
   `★★ 울타리 밖으로 떨어진 시군구가 있다 — 그 동네 지명이 지도에서 사라진다: ` +
   out.slice(0, 8).map((f) => f.properties.name).join(", "));

/* ── ★ **같은 이름을 쓰는 바깥 자리**는 전부 울타리 밖이어야 한다 ──
   이름으로 거르던 시절(§13.130)에 타일에서 찾아낸 것들이다. 한자는 달라도
   `name:ko` 가 같아서, 이름으로는 **원리상** 못 갈랐다. 좌표로는 갈린다. */
const OUTSIDE = {
  "鞍山市(=경기 안산시)":  [122.99, 41.12],
  "安阳市(=경기 안양시)":  [114.39, 36.10],
  "麗水市(=전남 여수시)":  [119.92, 28.45],
  "순천시(평남)":          [125.95, 39.42],
  "김화(북)":              [127.42, 38.52],
  "평양":                  [125.75, 39.02],
  "단둥":                  [124.39, 40.12],
  "후쿠오카":              [130.40, 33.59],
};
for (const [name, [x, y]] of Object.entries(OUTSIDE)) {
  ok(!inside(x, y, outline.geometry),
     `★★ ${name} 이 울타리 **안**에 든다 — 좌표로 가르는 의미가 없어진다`);
}

/* ── ★ 울타리 안에 있어야 할 남한의 끝들 (단순화가 섬을 먹는지 본다) ── */
const KOREA_EDGES = {
  "마라도": [126.27, 33.11], "독도": [131.87, 37.24], "울릉도": [130.90, 37.50],
  "백령도": [124.71, 37.96], "제주시": [126.53, 33.50], "부산":   [129.08, 35.18],
};
for (const [name, [x, y]] of Object.entries(KOREA_EDGES)) {
  ok(inside(x, y, outline.geometry), `★ ${name} 이 울타리 밖이다 — 단순화가 먹었다`);
}

/* ── ★ 북한 덮개는 남한을 안 덮는다 (중심으로 본다) ── */
const eaten = sgg.features.filter(
  (f) => inside(f.properties.cx, f.properties.cy, cover.geometry));
ok(eaten.length === 0,
   `★★ 북한 덮개가 남한 시군구를 덮는다: ${eaten.map((f) => f.properties.name).join(", ")}`);

console.log(bad ? `\n실패 ${bad}/${n}` : `\n지도 도형 ${n}건 통과 (시군구 ${sgg.features.length}개 · 바깥 ${Object.keys(OUTSIDE).length}곳)`);
process.exit(bad ? 1 : 0);
