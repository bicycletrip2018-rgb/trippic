/**
 * 국토 아틀라스 합성 — 웹 프로토타입의 buildAtlas()를 React Native로 이식한 것.
 *
 * 웹:  오프스크린 <canvas> → MapLibre `canvas` 소스
 * RN:  Skia 오프스크린 서피스 → PNG 파일 → MapLibre `ImageSource`
 *
 * ★ GL Native에는 `canvas` 소스 타입이 없다. ImageSource(4모서리 좌표)만 있다.
 * ★ Android의 ImageSource는 java.net.URL을 쓰므로 data: URI가 조용히 실패한다.
 *   반드시 file:// 경로로 넘겨야 한다. (검증: MLRNImageSource.kt setURL)
 */
import { Skia, ClipOp, FillType, ImageFormat, type SkImage, type SkSurface } from "@shopify/react-native-skia";

export type LngLat = [number, number];
export type Ring = LngLat[];
export type Poly = Ring[]; // [outer, ...holes]

export interface RegionFeature {
  code: string;
  bbox: [number, number, number, number]; // w, s, e, n
  polys: Poly[];
}

export interface AtlasResult {
  /** file:// URL — ImageSource.url 에 그대로 넣는다 */
  uri: string;
  /** ImageSource.coordinates — [topLeft, topRight, bottomRight, bottomLeft] */
  coordinates: [LngLat, LngLat, LngLat, LngLat];
  width: number;
  height: number;
  buildMs: number;
}

/* ── 웹 버전과 동일한 메르카토르 정렬 ─────────────────────────────
   x와 y를 같은 단위(라디안)로 맞춰야 한다.
   경도를 도(degree)로 두고 y만 메르카토르로 쓰면 종횡비가 60배 틀어진다. */
const mercX = (lon: number) => (lon * Math.PI) / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

export function mercAspect(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  return (mercX(e) - mercX(w)) / (mercY(n) - mercY(s));
}

function makeProjector(bbox: [number, number, number, number], W: number, H: number) {
  const [w, s, e, n] = bbox;
  const mx0 = mercX(w);
  const my0 = mercY(n);
  const dx = mercX(e) - mx0;
  const dy = mercY(s) - my0;
  return {
    x: (lon: number) => ((mercX(lon) - mx0) / dx) * W,
    y: (lat: number) => ((mercY(lat) - my0) / dy) * H,
  };
}

/** 지역 폴리곤들을 하나의 Path로. 구멍은 EvenOdd로 처리한다 (웹의 clip('evenodd')와 동일) */
function pathFor(polys: Poly[], P: { x: (n: number) => number; y: (n: number) => number }) {
  const path = Skia.Path.Make();
  path.setFillType(FillType.EvenOdd);
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const x = P.x(lon);
        const y = P.y(lat);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.close();
    }
  }
  return path;
}

/** cover-fit: 영역을 사진으로 꽉 채우되 비율 유지 (웹 drawCover와 동일) */
function coverRect(img: SkImage, x: number, y: number, w: number, h: number) {
  const iw = img.width();
  const ih = img.height();
  const r = Math.max(w / iw, h / ih);
  const dw = iw * r;
  const dh = ih * r;
  return Skia.XYWHRect(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export interface BuildAtlasArgs {
  /** 화면에 그릴 지역들 (방문 지역) */
  visited: RegionFeature[];
  /** 국토 전체 bbox */
  bbox: [number, number, number, number];
  /** 지역 코드 → 그 지역에 넣을 사진 */
  photoFor: (code: string) => SkImage | null;
  /** 한 변 최대 픽셀. 웹은 4096을 썼으나 모바일은 2048부터 시작하길 권한다 */
  maxPx?: number;
  /** 저장 경로 (file:// 없이 절대경로). 캐시 회피를 위해 매번 다른 이름을 준다 */
  outPath: string;
}

export function buildAtlas(args: BuildAtlasArgs): AtlasResult | null {
  const { visited, bbox, photoFor, outPath } = args;
  const maxPx = args.maxPx ?? 2048;
  const t0 = Date.now();

  const aspect = mercAspect(bbox);
  let W = maxPx;
  let H = Math.round(maxPx / aspect);
  if (H > maxPx) {
    H = maxPx;
    W = Math.round(maxPx * aspect);
  }

  const surface: SkSurface | null = Skia.Surface.MakeOffscreen(W, H);
  if (!surface) return null; // GPU 컨텍스트 확보 실패 — 호출부에서 폴백 처리

  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  const P = makeProjector(bbox, W, H);

  for (const f of visited) {
    const img = photoFor(f.code);
    if (!img) continue;
    const [bw, bs, be, bn] = f.bbox;
    const x0 = P.x(bw);
    const x1 = P.x(be);
    const y0 = P.y(bn); // 위도 최대 = 위쪽
    const y1 = P.y(bs);

    canvas.save();
    canvas.clipPath(pathFor(f.polys, P), ClipOp.Intersect, true);
    const dest = coverRect(img, x0, y0, x1 - x0, y1 - y0);
    canvas.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()), dest, paint);
    canvas.restore();
  }

  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(ImageFormat.PNG, 100);
  if (!bytes) return null;

  // 호출부에서 파일로 쓴다 (expo-file-system). 여기서는 바이트만 돌려줘도 되지만
  // ImageSource가 file:// 만 받으므로 경로를 확정해 반환한다.
  writeFileSync(outPath, bytes);

  const [w, s, e, n] = bbox;
  return {
    uri: `file://${outPath}`,
    coordinates: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
    width: W,
    height: H,
    buildMs: Date.now() - t0,
  };
}

/** expo-file-system 래퍼. 동기 API가 없으므로 호출부에서 주입하도록 분리한다. */
let writeFileSync: (path: string, bytes: Uint8Array) => void = () => {
  throw new Error("setAtlasWriter()로 파일 기록 함수를 먼저 주입하세요");
};

export function setAtlasWriter(fn: (path: string, bytes: Uint8Array) => void) {
  writeFileSync = fn;
}
