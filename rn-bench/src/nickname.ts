/**
 * 닉네임 — 화면이 서버에 보내기 **전과 후** (099 · 100 · §13.185)
 *
 * ★ 규칙의 주인은 **서버**다. 길이(2~20)는 표 제약, 운영자 행세 금지는
 *   `nickname_reserved()` 하나가 정한다. 화면이 금칙어 목록을 따로 들면 둘이
 *   어긋난다 — 그래서 여기에는 **목록이 없다.**
 * ★ 화면이 하는 일은 둘뿐이다.
 *   ① 보내기 전에 **서버와 같은 방식으로** 공백을 정리하고, 길이만 미리 말한다
 *      (한 글자를 보내고 서버 오류를 기다리게 하지 않는다).
 *   ② 서버가 거절하면 그 **이유를 사람 말로** 바꾼다. 원문(`… 23514 {"code":…`)을
 *      그대로 보이면 사용자는 앱이 고장 난 줄 안다.
 * ★ 순수 함수로 꺼내 단위 시험을 붙인다(`npm run test:nickname`).
 */

/** 서버(`api_set_nickname`)와 같은 정리 — 앞뒤 공백을 떼고 연속 공백을 하나로. */
export function tidyNickname(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

/** 보내기 전에 말할 수 있는 문제. 없으면 `null`. 길이 기준은 099 의 표 제약과 같다. */
export function nicknameProblem(v: string | null | undefined): string | null {
  const n = [...tidyNickname(v)].length;          // ★ 글자 수 — 이모지가 2로 세지지 않게
  if (n < 2) return "두 글자 이상 적어 주세요";
  if (n > 20) return "스무 글자까지 적을 수 있습니다";
  return null;
}

/**
 * 서버 오류를 사람 말로. `api.ts` 의 `req` 가 만드는 오류 문자열은
 * `"/rest/v1/rpc/api_set_nickname 400 {"code":"22023",…"` 모양이다 — **코드**로 가른다.
 * 본문이 120자에서 잘리므로 메시지 끝까지 오리라고 믿지 않는다.
 */
export function nicknameWhy(error: string | null | undefined): string {
  const e = String(error ?? "");
  if (e.includes('"22023"')) return "운영자로 오해받을 수 있는 이름은 쓸 수 없습니다";
  if (e.includes("profiles_nickname_reserved")) return "운영자로 오해받을 수 있는 이름은 쓸 수 없습니다";
  if (e.includes('"23514"') || e.includes("profiles_nickname_len")) return "두 글자에서 스무 글자 사이로 적어 주세요";
  if (e.includes(" 401 ") || e.includes('"42501"')) return "다시 로그인한 뒤 바꿔 주세요";
  return "바꾸지 못했습니다 — 잠시 뒤 다시 해 주세요";
}
