/**
 * 초대 링크를 **보내도 되는 주소인가** (§13.113)
 *
 * ★ 왜 이런 게 필요한가 — `INVITE_BASE` 가 **`http://localhost:3012/index.html`** 이었다.
 *   친구에게 보낸 링크가 **내 컴퓨터 주소**라 받는 사람은 절대 못 연다.
 *   §3 이 *"초대 수락률이 핵심 지표"* 라고 적어 뒀는데, 밖으로 나가는 **유일한
 *   산출물**이 죽어 있었다. 그리고 앱은 그걸 **아무 말 없이 보냈다** —
 *   실패한 줄도 모르고, 받은 사람이 "안 열린다"고 말해 줘야 알게 된다.
 *
 * ★ **https 여야 한다.** 초대 코드가 주소에 실려 간다(`?invite=…`).
 *   평문 http 로 보내면 중간에서 코드를 주워 **남의 스페이스에 들어올 수 있다**.
 *   "일단 되게" 하려고 http 를 허용하면, 그 허용이 그대로 배포로 간다.
 *
 * ★ 막는 것이 **보내는 것보다 낫다.** 죽은 링크를 보내면 받는 사람이 우리 앱을
 *   한 번 믿었다가 실망하고, 보낸 사람은 그 사실조차 모른다.
 */

/** 못 보낼 이유. 보낼 수 있으면 `null` */
export function inviteProblem(base: string | null | undefined): string | null {
  const s = (base ?? "").trim();
  if (!s) return "empty";

  /* ★ RN 에는 `URL` 이 있지만 구현이 기기마다 달라 믿지 않는다 — 우리가 보는 것은
     **머리글과 호스트** 둘뿐이라 직접 가른다. */
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(s);
  if (!m) return "not_url";                       // 상대 주소·빈 문자열·오타
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");

  if (scheme !== "https") return "not_https";

  /* 내 컴퓨터·사내망 — 받는 사람에게는 **없는 주소**다 */
  if (host === "localhost" || host.endsWith(".localhost")) return "local";
  if (host === "::1" || host === "0.0.0.0") return "local";
  if (host.endsWith(".local") || host.endsWith(".test") || host.endsWith(".invalid")) return "local";
  if (/^127\./.test(host)) return "local";
  if (/^10\./.test(host)) return "local";
  if (/^192\.168\./.test(host)) return "local";
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return "local";

  /* 점이 없는 이름은 공개 주소가 아니다(`example` 같은 사내 이름) */
  if (!host.includes(".")) return "local";

  return null;
}

export const canSendInvite = (base: string | null | undefined) =>
  inviteProblem(base) === null;

/**
 * 사용자에게 보일 한 줄.
 * ★ **우리 설정 문제를 사용자 화면에 떠넘기지 않는다**(§13.41 이 소셜 로그인에서
 *   정한 것과 같다). *"INVITE_BASE 가 localhost 입니다"* 는 사용자가 할 수 있는
 *   일이 하나도 없는 문구다. 지금 무엇이 안 되는지만 말한다.
 */
export function inviteWhy(base: string | null | undefined): string | null {
  return inviteProblem(base) === null
    ? null
    : "아직 초대 링크를 보낼 수 없습니다 — 받는 분이 열 주소가 준비되지 않았습니다.";
}
