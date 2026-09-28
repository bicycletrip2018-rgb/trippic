/**
 * 사진 화질 측정 — **온디바이스** (010 · 011 · §13.76)
 *
 * ★ 010 이 이렇게 정해 뒀다: *"측정은 온디바이스에서 한다. DB 는 판정 결과만 받는다."*
 *   그런데 **앱이 한 번도 측정하지 않았다.** 011 의 트리거는 insert 마다 판정하고,
 *   `media_quality_ok` 는 측정값이 없으면 false 를 낸다 —
 *   실측: media 29장 중 `quality_ok` **0장**, 전부 `exclude_reason='unmeasured'`.
 *
 *   그 하나가 아래를 **전부** 막고 있었다:
 *     quality_ok=false → `refresh_place_stats` 가 핀을 안 셈
 *       → `place_stats.top_media_id` 가 영영 null
 *         → 갈 곳의 표지가 영영 관광공사 사진 (§12.25-A 가 못 켜진다)
 *         → `모두의 지도` 공개 자격도 안 생긴다 (009)
 *   기능을 아무리 붙여도 **재료가 안 만들어지고 있었다.**
 *
 * ★ 기준을 **다시 정하지 않는다.** `db/analysis/image_quality.py` 가 실제 여행
 *   사진 131장 + 흐리게 만든 대조군 60장으로 정한 값이 이미 있다(초점 200 · 대비 18).
 *   여기서 새로 계산식을 지어내면 **같은 사진을 서버와 앱이 다르게 판정한다.**
 *   → 아래는 그 파이썬의 **한 줄씩 옮긴 것**이다. 다른 점이 있으면 그건 버그다.
 */
import { Skia } from "@shopify/react-native-skia";

/** 참조 구현이 `sips -Z 320` 으로 줄여 잰다 — 해상도 영향을 여기서 상쇄한다. */
export const MEASURE_EDGE = 320;
const TILES = 8;

export type Quality = { focus: number; contrast: number; w: number; h: number };

/* 4-이웃 라플라시안. 가장자리는 빼고 안쪽만 (파이썬의 `g[1:-1,1:-1]` 과 같다). */
function laplacianAbs(g: Float64Array, w: number, h: number) {
  const iw = w - 2, ih = h - 2;
  const out = new Float64Array(Math.max(0, iw * ih));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = -4 * g[y * w + x] + g[(y - 1) * w + x] + g[(y + 1) * w + x]
                + g[y * w + x - 1] + g[y * w + x + 1];
      out[(y - 1) * iw + (x - 1)] = Math.abs(v);
    }
  }
  return { out, w: iw, h: ih };
}

const variance = (a: number[]) => {
  if (!a.length) return 0;
  let m = 0; for (const v of a) m += v; m /= a.length;
  let s = 0; for (const v of a) s += (v - m) * (v - m);
  return s / a.length;                      // numpy .var() 는 모분산(ddof=0)이다
};

/** numpy.percentile 의 기본(선형 보간)과 같게 — 반올림하면 값이 달라진다. */
function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * ★ **전역 라플라시안 분산을 쓰지 않는다.** 그건 초점이 아니라 **내용**을 잰다.
 *   실측(010): 131장 중 최하위였던 사진은 흐린 게 아니라 *흐린 날 해변*이었다 —
 *   하늘이 화면 대부분이라 분산이 낮았을 뿐 모래와 깃발은 또렷했다.
 *   그대로 갔으면 안개·바다·설경 같은 미니멀한 풍경이 통째로 막혔다.
 * → 초점이 맞은 사진은 **어딘가는 선명하다.** 타일 분산의 90분위를 본다.
 */
function focusScore(g: Float64Array, w: number, h: number) {
  const { out: l, w: lw, h: lh } = laplacianAbs(g, w, h);
  const th = Math.max(Math.floor(lh / TILES), 1);
  const tw = Math.max(Math.floor(lw / TILES), 1);
  const vals: number[] = [];
  for (let y = 0; y + th <= lh; y += th) {
    for (let x = 0; x + tw <= lw; x += tw) {
      const tile: number[] = [];
      for (let yy = y; yy < y + th; yy++)
        for (let xx = x; xx < x + tw; xx++) tile.push(l[yy * lw + xx]);
      vals.push(variance(tile));
    }
  }
  vals.sort((a, b) => a - b);
  return percentile(vals, 90);
}

/**
 * 파일 하나를 잰다. **실패하면 null** — 못 잰 것을 0 으로 적으면
 * 그 사진은 '흔들린 사진'으로 판정되어 영영 공개되지 않는다.
 * 모르는 것은 보내지 않는다(서버가 기존 값을 유지한다).
 */
export async function measurePhoto(
  uri: string, srcW?: number | null, srcH?: number | null,
): Promise<Quality | null> {
  try {
    const IM = await import("expo-image-manipulator");

    /* ★ **긴 변**을 320 으로 맞춘다. 참조 구현이 `sips -Z 320` 을 쓰는데 그건
       긴 변 기준이다. 너비만 320 으로 잡으면 세로 사진이 320×480 이 되어
       가로 사진(320×214)보다 픽셀이 두 배가 되고, 타일 크기가 달라져
       **같은 장면도 방향에 따라 다른 점수**를 받는다.
       ★ 크기를 모르면 한 번 더 읽어서 알아낸다 — 모르는 채로 가정하면
         그 가정이 판정에 그대로 들어간다. */
    let w0 = srcW ?? 0, h0 = srcH ?? 0;
    if (!(w0 > 0 && h0 > 0)) {
      const probe = await IM.manipulateAsync(uri, [], { compress: 1 });
      w0 = probe.width; h0 = probe.height;
    }
    const resize = w0 >= h0 ? { width: MEASURE_EDGE } : { height: MEASURE_EDGE };

    const small = await IM.manipulateAsync(uri, [{ resize }],
      { compress: 1, format: IM.SaveFormat.PNG, base64: true });
    if (!small.base64) return null;

    const data = Skia.Data.fromBase64(small.base64);
    const img = Skia.Image.MakeImageFromEncoded(data);
    if (!img) return null;
    const w = img.width(), h = img.height();
    const px = img.readPixels();            // RGBA8888
    if (!px) return null;

    const g = new Float64Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      // 파이썬과 같은 가중치 — 눈이 느끼는 밝기다
      g[i] = px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114;
    }
    let m = 0; for (let i = 0; i < g.length; i++) m += g[i]; m /= g.length;
    let s = 0; for (let i = 0; i < g.length; i++) s += (g[i] - m) * (g[i] - m);

    return {
      focus: focusScore(g, w, h),
      contrast: Math.sqrt(s / g.length),
      w, h,
    };
  } catch {
    return null;                            // 측정 실패가 업로드를 막지는 않는다
  }
}
