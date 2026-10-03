/**
 * 시·군·구 코드 → 이름·중심·상자 (§13.115)
 *
 * ★ 왜 따로 뺐나 — `MapTab` 이 컴포넌트 **안에서** 251개를 매번 다시 세우고 있었고,
 *   `소식` 도 같은 표가 필요해졌다. 두 번째 자리가 생기는 순간이 떼어 낼 때다 —
 *   한쪽만 고쳐 놓고 다른 쪽은 안 고친 줄도 모르게 되기 전에(§13.37).
 *
 * ★ **한 번만 센다.** 모듈이 처음 쓰일 때 만들고 들고 있는다. 경계 파일은 앱이
 *   사는 동안 안 바뀐다 — 렌더마다 다시 세울 이유가 없었다.
 */
const SGG = require("../assets/korea-regions.json") as GeoJSON.FeatureCollection;

export type RegionInfo = { name: string; cx: number; cy: number; bbox: number[] };

let TABLE: Record<string, RegionInfo> | null = null;

function table(): Record<string, RegionInfo> {
  if (!TABLE) {
    TABLE = {};
    for (const f of SGG.features as any[]) {
      TABLE[f.properties.code] = {
        name: f.properties.name,
        cx: f.properties.cx, cy: f.properties.cy,
        bbox: f.properties.bbox as number[],
      };
    }
  }
  return TABLE;
}

export const regionInfo = (code?: string | null): RegionInfo | null =>
  (code ? table()[code] ?? null : null);

/** 이름만. ★ **모르면 `null` 이다** — `"알 수 없음"` 같은 말을 지어내지 않는다 */
export const regionName = (code?: string | null): string | null =>
  regionInfo(code)?.name ?? null;
