/**
 * 남은 일을 **세는 곳 하나** (§12.27 · §13.93)
 *
 * ★ `pending.ts` 에서 **갈라 냈다.** 저장은 `expo-file-system` 이 필요하지만 셈은
 *   순수 함수라, 갈라 두면 `course.ts` 처럼 노드에서 그대로 잴 수 있다
 *   (`npm run test:pending`). 그리고 **여기서 틀리면 배지와 알림이 같이 틀린다** —
 *   화면으로 잡기 가장 어려운 종류의 버그라 순수 함수로 두는 값이 크다.
 *
 * ★ 왜 숫자가 둘인가. §12.27 이 웹에서 찾은 거짓말이 정확히 이 구분이었다:
 *   배지는 *"발견된 여행 수"* 를 달았는데 화면 제목은 *"아직 지도에 없는 여행 N개"*
 *   였다. 두 숫자가 **다른 것을 세고 있었다.**
 *   → 이제 한 함수가 둘 다 낸다. 무엇을 세는지는 칸 이름에 적는다.
 */
import type { Trip } from "./cluster";

export type Pending = {
  /** 정리 화면에 **설 카드 수** = 미등록 여행 + 낱장 묶음. **배지**가 쓰는 숫자다 */
  cards: number;
  /** 미등록 **여행**만 (낱장 묶음 제외). **알림 제목**이 쓰는 숫자다 */
  trips: number;
  stops: number;
  photos: number;
  /** 언제 잰 것인가. 그 뒤에 찍은 사진은 안 들어 있다 */
  at: number;
};

export const EMPTY: Pending = { cards: 0, trips: 0, stops: 0, photos: 0, at: 0 };

/**
 * ★ `trips`·`stops`·`photos` 는 **낱장 묶음을 뺀다** — 알림이
 *   *"여행 N개 · M분"* 이라고 부르는데 거기에 묶이지 않은 낱장까지 더하면
 *   한 문장 안의 두 숫자가 서로 다른 것을 세게 된다
 *   (§13.80 에서 실제로 겪었다: *"여행 1개 · 12분"* — 12분 중 대부분이 그 여행이 아니었다).
 * ★ `cards` 만 **전부**를 센다 — 배지를 누르면 그 카드들이 그대로 보이기 때문이다.
 *   배지가 3인데 열어서 2장이면 그것도 거짓말이다.
 */
export function pendingOf(list: Trip[], now = Date.now()): Pending {
  const real = list.filter((t) => !t.isOrphan);
  return {
    cards: list.length,
    trips: real.length,
    stops: real.reduce((n, t) => n + t.stops.length, 0),
    photos: real.reduce((n, t) => n + t.items.length, 0),
    at: now,
  };
}
