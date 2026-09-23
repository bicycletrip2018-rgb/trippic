/**
 * 핀 아이콘 생성 — 웹의 circleIcon()을 Skia로 이식.
 *
 * 웹:  캔버스 → map.addImage(id, ImageData)
 * RN:  Skia 오프스크린 → base64 PNG → <Images images={{ id: "data:image/png;base64,..." }} />
 *
 * ★ Images(아이콘)와 ImageSource(아틀라스)는 로딩 경로가 완전히 다르다.
 *   - Images      : iOS RCTImageLoader / Android Fresco  → data: URI 지원  ✅
 *   - ImageSource : iOS NSURL / Android java.net.URL     → data: URI 미지원 ❌
 *   (검증: MLRNImages.kt 주석 "http/https/file/asset/data", MLRNImageSource.kt URL())
 *
 * ★ 786개를 미리 만들지 않는다. <Images onImageMissing> 으로 필요할 때만 만든다.
 */
import { Skia, ClipOp, ImageFormat, PaintStyle, type SkImage } from "@shopify/react-native-skia";

export const CAT_COLOR: Record<string, string> = {
  sight: "#7FA8C4",
  beach: "#6FB5B3",
  food: "#C98A6E", // 전체의 43%라 가장 눌러야 한다
  cafe: "#BCA07C",
  bar: "#9D89B5",
  stay: "#8FA8A0",
  etc: "#8A8F9A",
};

/** 원형 썸네일 + 카테고리 색 테두리. 테두리를 별도 레이어로 두면 안 된다 —
 *  아이콘이 충돌 제거로 숨겨져도 테두리만 남아 화면에 색 덩어리가 생긴다. */
export function circleIcon(img: SkImage, color: string, px = 80): string | null {
  const surface = Skia.Surface.MakeOffscreen(px, px);
  if (!surface) return null;

  const canvas = surface.getCanvas();
  const r = px / 2;
  const ring = 5;

  // 1) 사진을 원으로 클리핑
  const clip = Skia.Path.Make();
  clip.addCircle(r, r, r - ring);
  canvas.save();
  canvas.clipPath(clip, ClipOp.Intersect, true);

  const iw = img.width();
  const ih = img.height();
  const s = Math.max((px - ring * 2) / iw, (px - ring * 2) / ih);
  const dw = iw * s;
  const dh = ih * s;
  canvas.drawImageRect(
    img,
    Skia.XYWHRect(0, 0, iw, ih),
    Skia.XYWHRect(r - dw / 2, r - dh / 2, dw, dh),
    Skia.Paint(),
  );
  canvas.restore();

  // 2) 안쪽 흰 선
  const white = Skia.Paint();
  white.setStyle(PaintStyle.Stroke);
  white.setStrokeWidth(2.4);
  white.setColor(Skia.Color("rgba(255,255,255,0.95)"));
  canvas.drawCircle(r, r, r - ring + 1.2, white);

  // 3) 바깥 카테고리 색 테두리
  const cat = Skia.Paint();
  cat.setStyle(PaintStyle.Stroke);
  cat.setStrokeWidth(ring);
  cat.setColor(Skia.Color(color));
  canvas.drawCircle(r, r, r - ring / 2, cat);

  const b64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100);
  return b64 ? `data:image/png;base64,${b64}` : null;
}

/** 아이콘 이름 규약은 웹과 동일하게 유지한다: ph{사진index}_{카테고리} */
export const iconName = (photoIndex: number, category: string) => `ph${photoIndex}_${category}`;
/** 클러스터용(카테고리가 섞여 있으므로 중립 흰 테두리) */
export const clusterIconName = (photoIndex: number) => `phc${photoIndex}`;

export function parseIconName(name: string): { photoIndex: number; category: string } | null {
  const m = /^ph(c?)(\d+)(?:_(\w+))?$/.exec(name);
  if (!m) return null;
  return {
    photoIndex: Number(m[2]),
    category: m[1] === "c" ? "__cluster" : (m[3] ?? "etc"),
  };
}
