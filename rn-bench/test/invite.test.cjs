/** 초대 링크를 보내도 되는 주소인가 (§13.113) */
const { inviteProblem, canSendInvite, inviteWhy } = require("../build-test/inviteBase.js");
let n = 0, bad = 0;
const eq = (got, want, why) => {
  n++;
  if (got === want) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`);
};

// ── ★ 실제로 들어 있던 값 ──
eq(inviteProblem("http://localhost:3012/index.html"), "not_https",
   "★ 코드에 박혀 있던 그 주소 — 막힌다");
eq(canSendInvite("http://localhost:3012/index.html"), false,
   "★ 그 주소로는 못 보낸다");

// ── 보낼 수 있는 것 ──
eq(inviteProblem("https://trippic.app/"), null, "공개 https 주소는 보낸다");
eq(inviteProblem("https://trippic.pages.dev/index.html"), null, "경로가 붙어도 보낸다");
eq(inviteProblem("https://a.b.co.kr:8443/i"), null, "포트가 붙어도 공개면 보낸다");

// ── ★ https 가 아니면 안 된다 (초대 코드가 주소에 실린다) ──
eq(inviteProblem("http://trippic.app/"), "not_https",
   "★ 공개 주소라도 http 면 막는다 — 코드가 평문으로 나간다");

// ── 내 컴퓨터·사내망 ──
/* ★ `a.localhost` 는 **점이 있어서** "점 없는 이름" 규칙에 안 걸린다 —
   `localhost` 하나만 넣어 두면 전용 빗장을 빼도 테스트가 통과한다(실제로 그랬다). */
for (const h of ["https://localhost/", "https://a.localhost/", "https://web.localhost:8080/",
                 "https://127.0.0.1/", "https://10.0.0.5/",
                 "https://192.168.0.2/", "https://172.16.3.4/", "https://[::1]/",
                 "https://my-mac.local/", "https://app.test/", "https://intranet/"]) {
  eq(inviteProblem(h), "local", `받는 사람에게 없는 주소: ${h}`);
}
eq(inviteProblem("https://172.15.0.1/"), null,
   "★ 172.15 는 사설 대역이 **아니다** — 16~31 만 막는다");
eq(inviteProblem("https://172.32.0.1/"), null, "172.32 도 사설이 아니다");

// ── 주소가 아예 아닌 것 ──
eq(inviteProblem(""), "empty", "빈 값");
eq(inviteProblem(null), "empty", "null");
eq(inviteProblem(undefined), "empty", "undefined");
eq(inviteProblem("   "), "empty", "공백만");
eq(inviteProblem("trippic.app"), "not_url", "머리글이 없으면 주소가 아니다");
eq(inviteProblem("/index.html"), "not_url", "상대 주소");

// ── ★ 사용자에게 보일 말 ──
eq(inviteWhy("https://trippic.app/"), null, "보낼 수 있으면 할 말이 없다");
const w = inviteWhy("http://localhost:3012/index.html");
eq(typeof w === "string" && w.length > 0, true, "못 보내면 한 줄을 준다");
eq(/localhost|INVITE_BASE|http/.test(w), false,
   "★ 우리 설정 문제를 사용자 화면에 떠넘기지 않는다 — 사용자가 할 수 있는 일이 없는 말은 안 쓴다");

console.log(bad ? `\n실패 ${bad}/${n}` : `\n초대 주소 ${n}건 통과`);
process.exit(bad ? 1 : 0);
