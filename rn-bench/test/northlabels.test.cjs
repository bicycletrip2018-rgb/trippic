/**
 * 북쪽 지명 목록이 **남한을 깎지 않는가** (§13.129)
 *
 * ★ 이 시험이 지키는 것 하나: *"이름으로 지우다가 남한 라벨을 지우는 일"*.
 *   목록을 다시 뽑을 때마다(`tools/north_labels.py`) 저쪽 데이터가 바뀌므로
 *   **새 겹침이 언제든 생길 수 있다.** 그때 조용히 사라지는 대신 여기서 멈춘다.
 */
const labels = require("../assets/north-labels.json");
const sgg    = require("../assets/korea-regions.json");

let n = 0, bad = 0;
const ok = (c, why) => { n++; if (!c) { bad++; console.log(`  FAIL ${why}`); } };

const drop = new Set(labels.names);
const sggName = new Set(sgg.features.map((f) => f.properties.name));
const sido    = new Set(sgg.features.map((f) => f.properties.sido));

ok(drop.size > 100, "목록이 비어 있지 않다 — 뽑기가 통째로 실패하면 여기서 걸린다");
ok(Array.isArray(labels.kept_shared), "뺀 공통 이름을 적어 둔다");
ok(labels.classes.join() === "city,town",
   "★ city·town 만 지운다 — 넓히면 뽑지 않은 종류에서 남한 라벨이 조용히 사라진다");

/* ── ★ 핵심: 남한 시군구·시도 이름이 **한 개도** 목록에 없어야 한다 ── */
const hitSgg  = [...drop].filter((x) => sggName.has(x));
const hitSido = [...drop].filter((x) => sido.has(x));
ok(hitSgg.length === 0,
   `★★ 남한 시군구 이름이 지움 목록에 있다 — 그 지역이 지도에서 사라진다: ${hitSgg}`);
ok(hitSido.length === 0,
   `★★ 남한 시도 이름이 지움 목록에 있다: ${hitSido}`);

/* ── ★ 실제로 겹쳤던 것들이 **빠져 있어야** 한다 (§13.129 에서 셋 나왔다) ── */
for (const name of ["순천시", "김화읍", "영광읍"]) {
  ok(!drop.has(name),
     `★ ${name} 은 남북이 같이 쓴다 — 지우면 남한 쪽도 사라진다`);
}
ok(labels.kept_shared.includes("순천시"),
   "★ 뺀 이유가 파일에 남아 있다 — 다음 사람이 '왜 빠졌지' 하고 다시 넣지 않게");

/* ── 목록 자체가 성한가 ── */
ok([...drop].every((x) => typeof x === "string" && x.length > 0), "빈 이름이 없다");
ok(new Set(drop).size === labels.names.length,
   "★ 중복이 없다 — MapLibre 의 match 는 같은 값이 두 번 나오면 스타일이 통째로 깨진다");

console.log(bad ? `\n실패 ${bad}/${n}` : `\n북쪽 지명 ${n}건 통과 (지움 ${drop.size}개 · 뺀 공통 ${labels.kept_shared.length}개)`);
process.exit(bad ? 1 : 0);
