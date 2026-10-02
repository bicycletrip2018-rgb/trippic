/**
 * 지도에서 **무엇이 탭을 가져가는가** (§13.98)
 *
 * ★ `MapTab` 에서 갈라 냈다. 화면으로는 못 잡는 종류다 — 틀려도 **무언가는 열리기**
 *   때문이다. 엉뚱한 것이 열려도 사용자는 *"내가 잘못 눌렀나"* 로 읽고 넘어가고,
 *   우리는 영영 모른다. 순수 함수로 두고 숫자로 잰다
 *   (`course.ts` · `pendingCount.ts` · `fitBox.ts` 와 같은 이유).
 */

/** 손가락 하나가 덮는 반지름(pt). 애플 기준 최소 타깃 44pt 의 절반이다. */
export const TAP_SLOP = 22;

export type Cand = {
  /** `pin` = 내 기록, `place` = 상호 */
  kind: "pin" | "place";
  id: string;
  lng: number;
  lat: number;
};

/**
 * 누른 자리에서 **가장 가까운 것**을 고른다.
 *
 * ★ 예전에는 *"핀을 먼저 본다 — 내 기록이 배경에 묻히면 안 된다"* 로 **무조건**
 *   핀이 이겼다. 점을 정확히 찍어야 했을 때는 그 규칙이 안전했다. 그런데 여유를
 *   주고 나면(44pt) 그 규칙이 **분명히 상호를 노린 탭까지 가져간다** — 20px 떨어진
 *   내 핀이 2px 옆의 상호를 이긴다.
 *
 * ★ 그래서 **가까운 쪽**이 이기고, **똑같이 가까우면 핀**이 이긴다.
 *   핀은 대개 상호와 **같은 좌표**에 있으므로(그 장소에 꽂은 것이다) 실제로 가장
 *   흔한 경우가 동점이고, 거기서는 예전 규칙과 같은 답이 나온다 —
 *   **규칙은 느슨해졌는데 익숙한 자리에서는 답이 안 바뀐다.**
 *
 * ★ 경도는 위도에 따라 좁아진다. 보정 없이 재면 북쪽으로 갈수록 가로 거리를
 *   과대평가해 **왼쪽/오른쪽 것이 불리해진다**(서울에서 경도 1도는 위도 1도의 0.8배).
 */
export function pickNearest(
  cands: Cand[], lng: number, lat: number,
): Cand | null {
  if (!cands.length) return null;
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: Cand | null = null;
  let bestD = Infinity;
  for (const c of cands) {
    const dx = (c.lng - lng) * kx;
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    /* `<` 로 비교하므로 **먼저 온 것이 동점에서 이긴다** — 부르는 쪽이 핀을
       앞에 넣어 그 규칙을 만든다. 여기서 종류를 다시 보지 않는다(규칙이 한 곳에). */
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
