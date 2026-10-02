/**
 * 남은 일 셈 검사 — `npm run test:pending`
 *
 * ★ 여기서 틀리면 **배지와 알림이 같이 틀린다.** 그리고 둘 다 "틀린 숫자"가
 *   아니라 "그럴듯한 숫자"로 틀리므로 화면을 봐서는 못 잡는다 —
 *   §12.27 이 웹에서 찾은 거짓말이 꼭 그런 모양이었다(배지 N, 제목 M, 둘 다 말이 됨).
 */
const { pendingOf, EMPTY } = require("../build-test/pendingCount.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m); } };

const trip = (id, stops, photos, isOrphan) => ({
  id, title: id, region: "", start: 0, end: 0,
  items: Array.from({ length: photos }, (_, i) => ({ id: `${id}-p${i}` })),
  stops: Array.from({ length: stops }, (_, i) => ({ id: `${id}-s${i}` })),
  placeCount: 0, ...(isOrphan ? { isOrphan: true } : {}),
});

console.log("── 남은 일 셈 (§13.93) ──");

const none = pendingOf([]);
ok(none.cards === 0 && none.trips === 0,
   "아무것도 없으면 전부 0 — 배지가 안 뜬다");

/* 여행 2개 + 낱장 묶음 1개 = 화면에 카드 3장 */
const mixed = pendingOf([
  trip("t1", 2, 4), trip("t2", 3, 9), trip("orphan", 2, 14, true),
]);
ok(mixed.cards === 3,
   "★ 배지는 **카드 수**를 센다 (여행 2 + 낱장 묶음 1 = 3) — 눌러서 나오는 것과 같아야 한다");
ok(mixed.trips === 2,
   "★ 알림은 **여행 수**만 센다 (3이 아니라 2) — 제목이 `아직 지도에 없는 여행 N개`다");
ok(mixed.stops === 5 && mixed.photos === 13,
   `★ 정거장·사진도 낱장을 뺀다 (${mixed.stops}곳 · ${mixed.photos}장) — ` +
   "알림이 시간을 그 정거장으로 재므로, 더하면 `여행 1개 · 12분`이 된다 (§13.80)");

/* 낱장만 남은 경우 — 할 일은 있는데 '여행'은 0이다 */
const onlyOrphan = pendingOf([trip("orphan", 2, 14, true)]);
ok(onlyOrphan.cards === 1,
   "★ 낱장 묶음만 남아도 배지는 1 — 할 일이 있는데 0이면 그게 거짓말이다");
ok(onlyOrphan.trips === 0 && onlyOrphan.stops === 0,
   "★ 그런데 알림은 안 건다 (여행 0) — `여행 0개`라고 부르면 누를 이유가 없다");

/* 등록하면 즉시 줄어야 한다 — §12.27 이 웹 스모크에 박아 둔 문장 */
const before = pendingOf([trip("t1", 2, 4), trip("t2", 3, 9)]);
const after = pendingOf([trip("t2", 3, 9)]);
ok(before.cards === 2 && after.cards === 1,
   "★ 하나 등록하면 배지가 바로 1 줄어든다 — 등록했는데 숫자가 그대로면 거짓말이다");

ok(EMPTY.cards === 0 && EMPTY.at === 0,
   "아직 한 번도 안 잰 상태는 at=0 — 화면이 `새 사진이 있나`를 묻지 않는다");

console.log("");
if (fail) { console.log(`=== 실패 ${fail}건 / 통과 ${pass}건 ===`); process.exit(1); }
console.log(`=== 전부 통과 (${pass}건) ===`);
