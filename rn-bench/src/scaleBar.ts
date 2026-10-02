/**
 * 축척 막대 — **이 화면이 몇 km 인가** (§13.97 ② · §13.99)
 *
 * ★ 지금 거리 감각은 `갈 곳` 카드의 `차로 N분` 뿐이고 **지도에는 없다.**
 *   네이버에는 오른쪽 아래에 `5km` 막대가 늘 있다 — 한 줄짜리인데 *"이게 동네인가
 *   도 단위인가"* 에 답한다.
 *
 * ★ 숫자를 **지어내지 않는다.** 막대 길이는 **고른 거리에 맞춰 줄인다** —
 *   "100px 막대에 3.7km" 라고 쓰면 읽는 사람이 그 길이로 다른 거리를 가늠할 수 없다.
 *   그래서 **1·2·5 계열**에서 고르고 막대를 그만큼만 그린다(지도의 오랜 관례다).
 */
import { WORLD_TILE } from "./fitBox";

/** 적도 둘레(m). WGS84 */
const EQUATOR_M = 40075016.686;

/**
 * 그 줌·그 위도에서 **1픽셀이 몇 m** 인가.
 * ★ `WORLD_TILE` 은 **실측값**이다(§13.99) — 256 으로 두면 전부 2배로 틀린다.
 */
export const metersPerPx = (zoom: number, lat: number) =>
  (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_TILE * Math.pow(2, zoom));

/** 1·2·5 계열. m 단위 */
const NICE = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1000, 2000, 5000, 10000, 20000, 50000,
  100000, 200000, 500000, 1000000, 2000000,
];

export type Scale = { meters: number; px: number; label: string };

/**
 * `maxPx` 를 넘지 않는 **가장 큰 1·2·5 거리**를 고른다.
 *
 * ★ 넘지 않는 것 중 가장 큰 것이다 — 작은 쪽으로 붙이면 막대가 늘 짧아 보이고,
 *   큰 쪽으로 붙이면 막대가 화면 밖으로 나간다.
 * ★ 1m 보다 더 좁힐 수 없을 만큼 확대했으면 **가장 작은 것**을 준다. 그때도
 *   막대는 `maxPx` 보다 길어질 수 있는데, 그건 *"더 쪼갤 눈금이 없다"* 는 뜻이라
 *   길이를 거짓말하느니 그대로 둔다.
 */
export function pickScale(mPerPx: number, maxPx = 92): Scale {
  let chosen = NICE[0]!;
  for (const m of NICE) {
    if (m / mPerPx <= maxPx) chosen = m;
    else break;
  }
  return {
    meters: chosen,
    px: Math.round(chosen / mPerPx),
    label: chosen >= 1000 ? `${chosen / 1000}km` : `${chosen}m`,
  };
}
