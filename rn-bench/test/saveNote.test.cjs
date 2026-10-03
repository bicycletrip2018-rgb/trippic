/** 저장한 곳 카드의 한 줄 (§13.103) */
const { saveNote } = require("../build-test/saveNote.js");
let n = 0, bad = 0;
const eq = (got, want, why) => {
  n++;
  if (got === want) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`);
};

// ── 평범한 경우 ──
eq(saveNote({ closed: false, been: false, saved_at: "2026-10-03T11:20:00+09:00" }),
   "2026.10.03 저장", "저장만 해 둔 곳은 저장한 날을 말한다");

// ── 다녀온 곳 ──
eq(saveNote({ closed: false, been: true, saved_at: "2026-10-03T11:20:00+09:00" }),
   "이미 다녀온 곳", "다녀온 곳은 날짜 대신 그 사실을 말한다");

// ── ★ 순서가 규칙이다 ──
eq(saveNote({ closed: true, been: false, saved_at: "2026-10-03T11:20:00+09:00" }),
   "문 닫았다고 신고된 곳", "닫힌 곳은 저장한 날보다 닫힘을 먼저 말한다");
eq(saveNote({ closed: true, been: true, saved_at: "2026-10-03T11:20:00+09:00" }),
   "문 닫았다고 신고된 곳",
   "★ 다녀온 적 있어도 **닫힘이 먼저**다 — 다시 가려는 사람에게 급한 것은 닫혔다는 쪽이다");

// ── 셋을 겹쳐 쓰지 않는다 ──
const both = saveNote({ closed: true, been: true, saved_at: "2026-10-03T11:20:00+09:00" });
eq(both.includes("·"), false,
   "★ 한 줄에 둘을 붙이지 않는다 — 다 적으면 읽는 사람에게 할 일을 하나도 안 준다");
eq(both.includes("2026"), false, "닫힘을 말할 때 날짜는 섞지 않는다");

// ── 날짜 모양 ──
eq(saveNote({ closed: false, been: false, saved_at: "2026-01-09T00:00:00Z" }),
   "2026.01.09 저장", "한 자리 월·일도 두 자리로 온다 (서버가 ISO 로 준다)");
eq(saveNote({ closed: false, been: false, saved_at: "2025-12-31" }),
   "2025.12.31 저장", "시각이 없어도 깨지지 않는다");

console.log(bad ? `\n실패 ${bad}/${n}` : `\n저장 한 줄 ${n}건 통과`);
process.exit(bad ? 1 : 0);
