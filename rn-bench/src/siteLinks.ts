/**
 * 약관·개인정보·문의 **주소를 만든다** (§13.136)
 *
 * ★ 왜 따로 받지 않고 만드나 — 주소를 환경변수로 더 받으면 **넷이 따로 논다.**
 *   하나만 안 바꾸면 그 링크만 404 가 되고, 404 는 **눌러 본 사람만** 안다.
 *   초대 주소(`INVITE_BASE`)와 **같은 폴더**에 있는 파일들이므로 거기서 만든다.
 *
 * ★ 그런데 "만든다"는 **조용히 틀릴 수 있는 종류**다. 그래서
 *   ① 순수 함수로 꺼내고 ② 단위 시험을 붙인다(`npm run test:site`).
 *   `inviteBase.ts` 를 꺼냈을 때와 같은 이유다(§13.113).
 *
 * ★ **https 가 아니면 안 만든다.** 약관을 평문으로 띄울 이유가 없고,
 *   localhost 를 심사에 내면 반려된다.
 */
import { inviteProblem } from "./inviteBase";

export type SitePage = "terms" | "privacy" | "support";

/**
 * 초대 주소와 **같은 폴더**의 문서 주소. 못 만들면 `null`.
 *
 *   https://x.github.io/trippic-web/invite.html + terms
 *     → https://x.github.io/trippic-web/terms.html
 */
export function sitePage(base: string | null | undefined, page: SitePage): string | null {
  const s = (base ?? "").trim();
  if (inviteProblem(s)) return null;           // https·호스트 검사를 **그대로 쓴다**
  /* 물음표·앵커를 떼고, 마지막 조각(파일 이름)만 바꾼다 */
  const noTail = s.split("#")[0].split("?")[0];
  const cut = noTail.lastIndexOf("/");
  if (cut < 0) return null;
  const dir = noTail.slice(0, cut);
  /* ★ `https://host` 처럼 **경로가 없는** 주소면 `dir` 이 `https:/` 가 된다 —
     그대로 붙이면 깨진 주소가 조용히 나간다. 그 경우는 호스트 뒤에 붙인다. */
  if (/^https?:\/?$/i.test(dir)) return `${noTail.replace(/\/+$/, "")}/${page}.html`;
  return `${dir}/${page}.html`;
}
