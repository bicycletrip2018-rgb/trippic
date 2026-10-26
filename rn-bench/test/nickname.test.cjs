/** 닉네임 정리·사유 — `npm run test:nickname` (§13.185 · §13.189) */
const { tidyNickname, nicknameProblem, nicknameWhy } = require("../build-test/nickname.js");
let n = 0, bad = 0;
const eq = (got, want, why) => {
  n++; if (got === want) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${got}\n       기대 ${want}`);
};

/* ★ 서버(api_set_nickname)와 **같은 정리**여야 한다 — 다르면 화면이 보여 준 이름과
     저장된 이름이 다르다 */
eq(tidyNickname("  여행  좋아  "), "여행 좋아", "앞뒤 공백을 떼고 연속 공백을 하나로");
eq(tidyNickname("김\n\t여행"), "김 여행", "줄바꿈·탭도 공백 하나로(한 줄 자리에 여러 줄이 안 들어오게)");
eq(tidyNickname(null), "", "없으면 빈 글자");

/* 길이 — 099 의 표 제약(2~20)과 같은 기준 */
eq(nicknameProblem("훈"), "두 글자 이상 적어 주세요", "한 글자는 미리 말한다");
eq(nicknameProblem("   훈   "), "두 글자 이상 적어 주세요", "공백을 뗀 뒤 센다");
eq(nicknameProblem("여행"), null, "두 글자는 된다");
eq(nicknameProblem("가".repeat(20)), null, "스무 글자는 된다");
eq(nicknameProblem("가".repeat(21)), "스무 글자까지 적을 수 있습니다", "스물한 글자는 미리 말한다");
eq(nicknameProblem("🏖️🏖️"), null, "★ 이모지를 두 칸으로 세서 막지 않는다");

/* ★ 금칙어는 화면이 판정하지 **않는다** — 서버 한 곳만 정한다(100) */
eq(nicknameProblem("트립픽 운영팀"), null, "★ 금칙어는 화면이 막지 않는다 — 서버가 막는다");

/* 서버 오류 → 사람 말. `req` 가 만드는 실제 모양으로 넣는다 */
const P = "/rest/v1/rpc/api_set_nickname";
eq(nicknameWhy(`${P} 400 {"code":"22023","details":null,"hint":null,"message":"운영자로 오해받을`),
   "운영자로 오해받을 수 있는 이름은 쓸 수 없습니다", "운영자 행세(22023)");
eq(nicknameWhy(`${P} 400 {"code":"23514","details":"Failing row contains (`),
   "두 글자에서 스무 글자 사이로 적어 주세요", "길이 제약(23514)");
eq(nicknameWhy(`${P} 401 {"code":"PGRST301","message":"JWT expired"}`),
   "다시 로그인한 뒤 바꿔 주세요", "로그인 만료");
eq(nicknameWhy("Network request failed"),
   "바꾸지 못했습니다 — 잠시 뒤 다시 해 주세요", "★ 모르는 오류는 원문을 보이지 않는다");
eq(nicknameWhy(undefined), "바꾸지 못했습니다 — 잠시 뒤 다시 해 주세요", "오류가 비어도 말한다");

console.log(bad ? `\n실패 ${bad}/${n}` : `\n닉네임 ${n}건 통과`);
process.exit(bad ? 1 : 0);
