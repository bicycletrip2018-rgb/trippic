/**
 * 앨범 스캔 — 사진에서 **촬영 시각과 좌표만** 읽는다 (§2 최소 수집)
 *
 * ★ 밖으로 나가는 것: 사용자가 직접 고른 사진 한 장씩. 그것뿐이다.
 *   파일명·얼굴·앨범 이름·썸네일은 **읽지도, 보내지도 않는다.** 판정에 필요 없다 —
 *   필요 없는 것을 읽으면 "왜 읽었냐"에 답할 말이 없어진다.
 *
 * ★ 비용의 정체: iOS 에서 좌표는 `getAssetsAsync` 가 안 준다. 사진마다
 *   `getAssetInfoAsync` 를 한 번 더 불러야 한다 — 5,000장이면 5,000번이다.
 *   그래서 ① 최근 것부터 잘라 읽고 ② 동시에 여러 개를 돌리고 ③ 진행률을 보여 준다.
 *   "멈춘 것처럼 보이는 30초"가 스캔을 포기하게 만든다.
 */
import * as ML from "expo-media-library/legacy";
import type { Photo } from "./cluster";

export const SCAN_MAX = 1200;     // 최근 1,200장. 7년치 전체는 첫 화면에서 할 일이 아니다
const CONC = 8;

/* ★ **정확도는 우리가 모른다.** iOS MediaLibrary 는 horizontalAccuracy 를 안 준다.
   이 값은 **후보 조회 전용**이다 — 정거장 묶기에는 쓰지 않는다(cluster.ts 가 자기 규칙을 갖는다).
   처음에 15m 라고 적었는데, 그건 측정이 아니라 지어낸 값이었고 그 값이
   `candidate_radius`(007: 3.5σ, 50~300m 클램프)를 52m 로 만들어 **후보를 0개**로 만들었다.

   실측 — 실제 랜드마크 5곳(지도에서 읽은 좌표, DB 값이 아니다)에 46만 곳 DB 로 질의:
     반경  52m  빈 목록 3/5   (경복궁·성산일출봉·협재해변)
     반경 105m  빈 목록 2/5
     반경 210m  빈 목록 0/5   ← 채택
     반경 300m  빈 목록 0/5   1순위는 210m 와 동일, 후보 수만 늘어난다

   ★ 원인이 GPS 오차가 아니다 — 장소의 등록 좌표는 **주소 중심점**인데 사람은
     그 안이나 밖에서 찍는다 (성산일출봉 112m · 협재 110m). 007 의 반경 공식은
     GPS 오차만 모델링하고 **장소의 크기**를 안 본다. 그 차이를 여기서 메운다.
   ★ 넓혀도 상위가 안 흔들린다는 것이 위 실측의 핵심이다: 도심(익선동 9m·북촌 22m)은
     반경을 4배로 늘려도 1순위가 그대로였다. 서버가 순위를 매기고 limit 10 이 자른다.
     빈 목록은 **등록 자체를 막지만**, 목록이 조금 긴 것은 한 번 더 보면 된다. */
export const UNKNOWN_ACC_M = 60;   // → candidate_radius(60) = 210m                   // 동시 8개 — 아이폰에서 이 위로는 거의 안 빨라졌다

export async function ensurePermission() {
  const cur = await ML.getPermissionsAsync();
  if (cur.granted || cur.status === "granted") return cur;
  return ML.requestPermissionsAsync();
}

/**
 * 그 시각 뒤에 찍은 사진이 **몇 장인가** (§13.93)
 *
 * ★ **권한을 묻지 않는다.** `getPermissionsAsync` 만 본다 — 배지 하나 때문에 앱을
 *   켜자마자 사진 권한 창을 띄우면 안 된다(§13.62: *"누른 그 순간에 묻는다"*).
 *   허락이 없으면 0 을 돌려주고, 화면은 배지를 안 그린다.
 * ★ **EXIF 를 안 읽는다.** `getAssetsAsync` 의 개수만 본다 — 1,200장을 다시 읽는 것은
 *   앱을 켤 때 할 일이 아니다. 여기서 아는 것은 *"더 있다"* 뿐이고,
 *   **몇 개의 여행이 되는지는 모른다.** 화면은 그래서 숫자 대신 `+` 를 붙인다.
 */
export async function newPhotosSince(at: number): Promise<number> {
  if (!at) return 0;
  try {
    const cur = await ML.getPermissionsAsync();
    if (!cur.granted && cur.status !== "granted") return 0;
    const page = await ML.getAssetsAsync({
      first: 1, mediaType: ["photo"], createdAfter: at,
    });
    return page.totalCount ?? 0;
  } catch { return 0; }
}

/* 좌표가 있는 사진만 판정에 쓸 수 있다. 없는 사진도 목록에는 들어간다 —
   빼 버리면 사용자는 "내 사진이 왜 없지"를 겪는다(§6.5 4단계). */
export async function scanAlbum(
  onProgress?: (done: number, total: number) => void,
  max = SCAN_MAX,
): Promise<Photo[]> {
  const page = await ML.getAssetsAsync({
    first: max, mediaType: ["photo"], sortBy: [["creationTime", false]],
  });
  const assets = page.assets;
  const out: Photo[] = new Array(assets.length);
  let done = 0, next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= assets.length) return;
      const a = assets[i];
      let gps: Photo["gps"] = null;
      let uri = a.uri;
      try {
        // shouldDownloadFromNetwork:false — iCloud 원본을 당겨오면 스캔이 몇 분이 된다
        const info = await ML.getAssetInfoAsync(a, { shouldDownloadFromNetwork: false });
        /* ★ **숫자로 바꿔서 받는다.** expo-media-library 가 좌표를 문자열로 줬고,
           클러스터의 누적 평균(`c.lng + (p.lng - c.lng)/n`)이 조용히 **문자열 결합**이
           되어 `"126.977" + 0.0001499` 같은 값이 서버까지 갔다 (400 · 22P02).
           타입 선언이 `number` 라고 해서 런타임이 그렇다는 뜻은 아니다 —
           경계에서 한 번 바꾸면 안쪽 계산 전부가 안전해진다. */
        if (info?.location) {
          const la = Number(info.location.latitude), lo = Number(info.location.longitude);
          if (Number.isFinite(la) && Number.isFinite(lo)) gps = { lat: la, lng: lo };
        }
        if (info?.localUri) uri = info.localUri;
      } catch { /* 한 장이 실패해도 스캔 전체를 멈추지 않는다 */ }
      out[i] = {
        id: a.id, ts: Number(a.creationTime) || Number(a.modificationTime) || Date.now(),
        gps, uri, w: a.width, h: a.height,
        /* ★ 비워 둔다. 모르는 것을 숫자로 적으면 그 숫자가 계산에 참여한다 —
           정거장 반경은 `stopRadius` 의 자기 폴백(60m)이 맡고, 후보 반경은
           호출하는 쪽이 UNKNOWN_ACC_M 을 명시한다. 두 값은 근거가 다르다. */
        acc: undefined,
      };
      if (onProgress && ++done % 25 === 0) onProgress(done, assets.length);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  onProgress?.(assets.length, assets.length);
  return out.filter(Boolean);
}
