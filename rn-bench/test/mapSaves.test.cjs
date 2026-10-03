/** 지도에서 저장한 곳과 상호를 가르는 규칙 (§13.104) */
const { splitMapSaves } = require("../build-test/mapSaves.js");
let n = 0, bad = 0;
const ok = (c, why) => { n++; if (!c) { bad++; console.log(`  FAIL ${why}`); } };
const ids = (a) => a.map((x) => x.id ?? x.place_id).sort().join(",");

const PLACES = [
  { id: "p1", category: "food" },
  { id: "p2", category: "nature" },
  { id: "p3", category: "cafe" },
];
const SAVES = [
  { place_id: "p1", category: "food" },
  { place_id: "p2", category: "nature" },
  { place_id: "zz", category: "food" },   // 화면 밖이라 상호에는 없는 저장
];

// ── 갈래를 안 골랐을 때 ──
{
  const r = splitMapSaves(PLACES, SAVES, null);
  ok(ids(r.saveShown) === "p1,p2,zz", "갈래가 없으면 저장은 전부 그린다");
  ok(ids(r.placeShown) === "p3", "★ 저장으로 그린 자리는 상호에서 뺀다 — 한 자리에 점 둘이면 테두리가 겹친다");
}

// ── 갈래를 골랐을 때 ──
{
  const r = splitMapSaves(PLACES, SAVES, "food");
  ok(ids(r.saveShown) === "p1,zz", "★ 저장도 갈래 칩을 탄다 — 맛집만 보겠다는데 찜한 산이 남으면 필터가 약속을 깬다");
  ok(ids(r.placeShown) === "p2,p3",
     "★ 갈래에 걸러진 저장(p2)은 상호를 **안** 지운다 — 지우면 그 자리가 아무 층에도 없는 구멍이 된다");
}

// ── 화면 밖 저장은 상호를 건드릴 것이 없다 ──
{
  const r = splitMapSaves([], SAVES, null);
  ok(r.placeShown.length === 0 && r.saveShown.length === 3,
     "상호가 없어도 저장은 그대로 그린다 — 저장은 뷰포트를 따라다니지 않는다");
}

// ── 저장이 없으면 상호는 그대로 ──
{
  const r = splitMapSaves(PLACES, [], null);
  ok(ids(r.placeShown) === "p1,p2,p3", "저장이 없으면 상호는 한 곳도 안 빠진다");
  ok(r.saveShown.length === 0, "저장이 없으면 금테도 없다");
}

// ── 아무것과도 안 맞는 갈래 ──
{
  const r = splitMapSaves(PLACES, SAVES, "stay");
  ok(r.saveShown.length === 0, "맞는 저장이 없으면 금테는 하나도 없다");
  ok(ids(r.placeShown) === "p1,p2,p3", "★ 그때 상호는 **하나도 안 빠진다**");
}

// ── 원본을 건드리지 않는다 ──
{
  splitMapSaves(PLACES, SAVES, "food");
  ok(PLACES.length === 3 && SAVES.length === 3, "넘겨받은 배열을 바꾸지 않는다");
}

console.log(bad ? `\n실패 ${bad}/${n}` : `\n지도 저장 가르기 ${n}건 통과`);
process.exit(bad ? 1 : 0);
