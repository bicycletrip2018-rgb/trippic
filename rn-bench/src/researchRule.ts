/**
 * 재검색을 **언제 세는가** (§13.9 규칙 3 · §13.101)
 *
 * §13.9 가 못 박아 둔 것:
 *
 * > *"**재검색은 보여 준 적 있을 때만.** 처음 찾는 사람까지 감점하면
 * >   **신호가 아니라 잡음**이다. 30분 안에 다시 찾았을 때만."*
 *
 * ★ 이 신호는 점수에서 **-2** 다(`SIG = { like:1, save:3, open:0.4, research:-2 }`).
 *   가장 무거운 감점이라 **헛나가면 멀쩡한 표지를 끌어내린다** — 그런데 화면에는
 *   아무것도 안 보인다. 순위가 조금 이상해질 뿐이다. 그래서 숫자로만 지킬 수 있다.
 *
 * ★ `coverLog` 안에 두지 않고 갈라 냈다. 거기는 `expo`·서버를 들고 있어 노드에서
 *   못 돌린다 — 규칙은 규칙대로 잴 수 있어야 한다(`tapPick` · `scaleBar` 와 같다).
 */

/** 보여 준 뒤 이만큼 안에 다시 찾으면 **재검색**이다 */
export const RESEARCH_WINDOW_MS = 30 * 60 * 1000;

/**
 * @param lastShownAt 그 장소를 마지막으로 **화면에 보여 준** 시각(ms). 없으면 `undefined`
 * @param now         지금(ms)
 */
export function shouldCountResearch(
  lastShownAt: number | undefined, now: number,
): boolean {
  /* ★ 보여 준 적이 **없으면** 세지 않는다 — 이것이 규칙의 핵심이다.
     처음 검색하는 사람을 감점하면 새 장소가 영원히 못 올라온다. */
  if (!lastShownAt) return false;
  const dt = now - lastShownAt;
  /* 시계가 뒤로 간 경우(기기 시각 변경)는 **안 센다.** 모르는 것을 셈에 넣지 않는다 */
  if (dt < 0) return false;
  return dt <= RESEARCH_WINDOW_MS;
}
