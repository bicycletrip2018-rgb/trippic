/** 문서 주소 만들기 — `npm run test:site` (§13.136) */
const { sitePage } = require("../build-test/siteLinks.js");
let n = 0, bad = 0;
const eq = (got, want, why) => {
  n++; if (got === want) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${got}\n       기대 ${want}`);
};

const B = "https://u.github.io/trippic-web/invite.html";
eq(sitePage(B, "terms"),   "https://u.github.io/trippic-web/terms.html",   "같은 폴더의 약관");
eq(sitePage(B, "privacy"), "https://u.github.io/trippic-web/privacy.html", "개인정보처리방침");
eq(sitePage(B, "support"), "https://u.github.io/trippic-web/support.html", "문의");

/* ★ 물음표·앵커가 붙어 있어도 파일 이름만 바꾼다 */
eq(sitePage(B + "?invite=abc#x", "terms"), "https://u.github.io/trippic-web/terms.html",
   "★ 초대 코드가 붙어 있어도 그 코드를 약관 주소로 끌고 가지 않는다");

/* ★ 경로가 없는 주소 — 그냥 붙이면 `https:/terms.html` 이 된다 */
eq(sitePage("https://trippic.app", "terms"), "https://trippic.app/terms.html",
   "★ 경로가 없어도 깨진 주소를 만들지 않는다");
eq(sitePage("https://trippic.app/", "terms"), "https://trippic.app/terms.html",
   "★ 끝에 슬래시가 있어도 같다");

/* ★ 못 믿을 주소에서는 **아무것도 만들지 않는다** — null 이면 화면이 링크를 안 그린다 */
for (const bad2 of ["http://x.io/a.html", "localhost:3012/index.html", "", null, undefined,
                    "https://127.0.0.1/a.html"]) {
  eq(sitePage(bad2, "terms"), null, `★ 못 쓸 주소(${String(bad2)})에서는 null`);
}

console.log(bad ? `\n실패 ${bad}/${n}` : `\n문서 주소 ${n}건 통과`);
process.exit(bad ? 1 : 0);
