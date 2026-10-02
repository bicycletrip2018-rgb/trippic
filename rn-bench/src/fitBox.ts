/**
 * 상자 하나를 화면에 **맞추는 줌** (§13.61 · §13.67 · §13.94)
 *
 * ★ `MapTab.tsx` 에서 꺼냈다. 숫자만으로 돌아가는 순수 함수인데, **틀려도 화면이
 *   안 깨진다** — 지도는 멀쩡히 그려지고 다만 엉뚱한 자리를 비춘다. 그래서
 *   눈으로는 *"데이터가 없나 보다"* 로 읽히고 넘어간다. 실제로 그렇게 넘어갔다.
 *   (`course.ts` · `pendingCount.ts` 와 같은 이유로 갈라 둔다 — `npm run test:fit`)
 */

/** 웹 메르카토르의 세로 좌표(0~1). 위도는 선형이 아니라 이걸로 재야 한다 */
export const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) / Math.PI / 2 + 0.5;

/* 전국 집계 줌. `MapTab` 의 `Z_REGION` 과 같은 값이어야 한다 */
export const Z_REGION = 9;

export function zoomForBBox(b: number[], wPx: number, hPx: number, onPins = false) {
  const lonFrac = Math.max(1e-6, (b[2] - b[0]) / 360);
  const latFrac = Math.max(1e-6, Math.abs(mercY(b[3]) - mercY(b[1])));
  const zx = Math.log2(wPx / (256 * lonFrac));
  const zy = Math.log2(hPx / (256 * latFrac));
  /* ★ 상한이 **둘**이다. 행정구역 상자로 갈 때는 12.5 에서 멈춘다 —
     그 큰 상자를 다 담으려다 보면 어차피 멀다. 그런데 **핀 상자**로 갈 때는
     내용이 있는 곳이니 더 들어가도 된다. 상호가 z14 부터 켜지므로(§13.60)
     그 위로 가야 *"주변에 뭐가 있나"* 가 같이 보인다. */
  const hi = onPins ? 16.5 : 12.5;
  /* ★ **하한도 둘이다**(§13.94 에서 고쳤다). 예전에는 둘 다 `Z_REGION + 0.3`(9.3)
     이었다. 그 값은 *"지역을 눌렀으면 집계 줌에 머물지 말고 들어간다"* 는 뜻이라
     행정구역 상자에서는 맞다. 그런데 **핀 상자에도 그대로 걸렸다.**

     실측: 스페이스 하나가 강릉·해운대·통영에 걸쳐 있을 때 맞는 줌은 **7.61** 인데
     하한이 **9.30** 으로 밀어 올려, `지도 ›` 로 데려간 화면에 핀이 하나도 안 보이고
     *"이 화면에는 공유 스페이스 기록이 없습니다"* 가 떴다. §13.67 이
     *"전국 화면에 떨어뜨리면 함께 채운 지도가 아니라 그냥 지도다"* 라며 만든 길인데,
     **반대로 너무 조여서 아무것도 없는 자리에 떨어뜨리고 있었다.**

     → 핀 상자에는 하한을 두지 않는다(3 은 안전장치일 뿐이다). 한 곳뿐일 때
       줌이 튀는 것은 `padPinBox` 의 최소 크기가 이미 막는다. */
  const lo = onPins ? 3 : Z_REGION + 0.3;
  return Math.min(hi, Math.max(lo, Math.min(zx, zy)));
}

/* 핀 상자에 여백을 준다. ★ 한 곳뿐이면 상자가 **점**이라 그대로 쓰면 줌이
   무한대로 튄다 — 최소 크기를 준다(약 400m). 여러 곳이면 가장자리 핀이
   화면 끝에 붙지 않게 한 뼘 넓힌다. */
export function padPinBox(b: number[]) {
  const MIN = 0.004;                              // 도 단위 ≈ 400m
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const w = Math.max(MIN, (b[2] - b[0]) * 1.6);
  const h = Math.max(MIN, (b[3] - b[1]) * 1.6);
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

/** 여러 지역의 핀 상자를 **합친다**(§13.67). 못 쓸 값은 버린다 */
export function unionBox(rows: { bw: number; bs: number; be: number; bn: number }[]) {
  const ok = rows.filter((r) => Number.isFinite(r.bw));
  if (!ok.length) return null;
  return [
    Math.min(...ok.map((r) => r.bw)), Math.min(...ok.map((r) => r.bs)),
    Math.max(...ok.map((r) => r.be)), Math.max(...ok.map((r) => r.bn)),
  ];
}

/** `mercY` 의 역함수 — 메르카토르 세로 좌표를 위도로 되돌린다 */
export const invMercY = (m: number) =>
  ((Math.atan(Math.exp((m - 0.5) * 2 * Math.PI)) - Math.PI / 4) * 360) / Math.PI;

export type Insets = { top: number; bottom: number };

/**
 * 상자를 **가려지지 않은 띠 안에** 맞춘다 (§13.95)
 *
 * ★ 지금까지 화면 **전체 높이**로 맞춰 왔다. 그런데 지도 위에는 늘 두 가지가 떠 있다 —
 *   상단 칩 두 줄과 하단 바텀시트. 전체로 맞추면 상자의 위아래 끝이 **그 밑으로 들어가**
 *   사용자는 "다 보인다"는 약속을 못 받는다. 실제로 스페이스로 날아갔을 때 맨 아래
 *   지역이 시트에 반쯤 가렸다.
 *
 * ★ **줌만 고치면 더 틀린다.** 보이는 띠는 화면 한가운데가 아니라 **위로 치우쳐**
 *   있는데(시트가 칩보다 두껍다) 카메라는 늘 화면 한가운데에 중심을 놓기 때문이다.
 *   그래서 **중심도 같이 옮긴다** — 그 둘은 한 쌍이다.
 *
 *   보이는 띠의 한가운데 = `(h + top - bottom) / 2`
 *   화면 한가운데      = `h / 2`
 *   → 상자 중심이 띠 한가운데에 오려면 카메라 중심은 **남쪽으로** `(bottom - top)/2` px.
 */
export function fitView(
  box: number[], w: number, h: number, insets: Insets, onPins = false,
) {
  const vis = Math.max(80, h - insets.top - insets.bottom);
  const zoom = zoomForBBox(box, w, vis, onPins);
  const cx = (box[0] + box[2]) / 2;
  /* 픽셀을 메르카토르 단위로 — 세계 전체가 `256 * 2^zoom` px 이다 */
  const shiftSouthPx = (insets.bottom - insets.top) / 2;
  const my = (mercY(box[1]) + mercY(box[3])) / 2 - shiftSouthPx / (256 * Math.pow(2, zoom));
  return { center: [cx, invMercY(my)] as [number, number], zoom };
}
