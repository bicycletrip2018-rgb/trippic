/**
 * TRIPPIC — RN 네이티브 성능 벤치마크
 *
 * 측정 대상 (PLAN.md §13 "실기기 성능 측정"의 항목들)
 *   1. Skia.Surface.MakeOffscreen(N) 이 성공하는가        ← 1순위 위험
 *   2. 아틀라스 합성 시간 (2048 / 4096)
 *   3. PNG 인코딩 + 파일 기록 시간
 *   4. ImageSource 가 그 파일을 실제로 렌더하는가          ← 스크린샷으로 확인
 *   5. 아이콘 1개 생성 시간 (× 786개 환산)
 *
 * 데이터는 로컬 HTTP 서버(localhost:5173)에서 받는다 — 앱 번들을 42MB로 불리지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import {
  Skia,
  ClipOp,
  FillType,
  ImageFormat,
  PaintStyle,
  type SkImage,
} from "@shopify/react-native-skia";
import {
  Camera,
  GeoJSONSource,
  ImageSource,
  Layer,
  Map,
} from "@maplibre/maplibre-react-native";
import type { StyleSpecification, ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

const HOST = "http://localhost:5173";
const LAND = "#282B36";
const BG = "#08090C";

type Line = { t: string; v: string; ok?: boolean };

const mercX = (lon: number) => (lon * Math.PI) / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": BG } }],
};

export function MapTab() {
  const [log, setLog] = useState<Line[]>([]);
  const [atlas, setAtlas] = useState<{ uri: string; coords: any } | null>(null);
  const [regions, setRegions] = useState<any>(null);
  const started = useRef(false);

  const add = useCallback((t: string, v: string, ok?: boolean) => {
    setLog((L) => [...L, { t, v, ok }]);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, []);

  async function run() {
    try {
      // ── 데이터 ─────────────────────────────────────────────
      let t0 = Date.now();
      const sgg = await fetch(`${HOST}/korea-sgg.json`).then((r) => r.json());
      add("행정경계 로드", `${Date.now() - t0}ms · ${sgg.features.length}개`);
      setRegions(sgg);

      const meta = await fetch(`${HOST}/photos/_meta.json`).then((r) => r.json());
      add("사진 메타", `${meta.length}장`);

      // ── 사진 디코드 (Skia) ─────────────────────────────────
      t0 = Date.now();
      const N_PHOTOS = 40;
      const imgs: SkImage[] = [];
      for (let i = 0; i < N_PHOTOS; i++) {
        const data = await Skia.Data.fromURI(`${HOST}/photos/p${meta[i].i + 1}.jpg`);
        const img = Skia.Image.MakeImageFromEncoded(data);
        if (img) imgs.push(img);
      }
      add("사진 디코드", `${Date.now() - t0}ms · ${imgs.length}장 (${((Date.now() - t0) / imgs.length).toFixed(0)}ms/장)`,
          imgs.length === N_PHOTOS);
      if (!imgs.length) { add("중단", "사진을 하나도 못 읽었다", false); return; }

      // ── ① 워밍업 가설 검증: 같은 크기를 두 번 ────────────────
      for (const px of [2048, 2048, 4096]) {
        const t = Date.now();
        const s = Skia.Surface.MakeOffscreen(px, px);
        add(`MakeOffscreen(${px})`, s ? `성공 · ${Date.now() - t}ms` : "실패(null)", !!s);
        s?.dispose?.();
      }

      // ── ② 아틀라스: 인코딩 포맷 비교 ★진짜 병목 찾기 ────────
      const visited = sgg.features.slice(0, 90);
      let w = 180, s0 = 90, e = -180, n = -90;
      for (const f of sgg.features) {
        const b = f.properties.bbox;
        w = Math.min(w, b[0]); s0 = Math.min(s0, b[1]);
        e = Math.max(e, b[2]); n = Math.max(n, b[3]);
      }
      const aspect = (mercX(e) - mercX(w)) / (mercY(n) - mercY(s0));

      // 워밍업 (셰이더 컴파일 비용을 측정에서 분리)
      buildAtlas(visited, [w, s0, e, n], aspect, imgs, 2048, () => {}, ImageFormat.PNG, 100);

      const FORMATS: [string, number, number][] = [
        ["PNG q100", ImageFormat.PNG, 100],
        ["PNG q0",   ImageFormat.PNG, 0],
        ["WEBP q80", ImageFormat.WEBP, 80],
        ["WEBP q100",ImageFormat.WEBP, 100],
        ["JPEG q85", ImageFormat.JPEG, 85],
      ];
      let best: any = null;
      for (const [label, fmt, q] of FORMATS) {
        const r = buildAtlas(visited, [w, s0, e, n], aspect, imgs, 2048, add, fmt, q, label);
        if (label === "WEBP q80" && r) best = r;
      }
      if (best) setAtlas(best);   // WEBP가 ImageSource에서 렌더되는지 확인

      // ── ③ 아이콘 생성 ──────────────────────────────────────
      for (const [lb, fm, q] of [["아이콘 PNG", ImageFormat.PNG, 100],
                                 ["아이콘 WEBP80", ImageFormat.WEBP, 80]] as [string, number, number][]) {
        const tIcon = Date.now();
        const ICONS = 30;
        let made = 0;
        for (let i = 0; i < ICONS; i++) if (circleIcon(imgs[i % imgs.length], "#C98A6E", 80, fm, q)) made++;
        const per = (Date.now() - tIcon) / ICONS;
        add(lb, `${per.toFixed(1)}ms/개 → 786개 ${(per * 786 / 1000).toFixed(1)}초`, made === ICONS);
      }

      add("완료", "지도에 아틀라스가 보이면 WEBP도 ImageSource에서 렌더된다는 뜻", true);
    } catch (err: any) {
      add("예외", String(err?.message ?? err), false);
    }
  }

  function buildAtlas(
    visited: any[], bbox: number[], aspect: number,
    imgs: SkImage[], maxPx: number,
    log: (t: string, v: string, ok?: boolean) => void,
    fmt: number = ImageFormat.PNG, quality: number = 100, label?: string,
  ) {
    let W = maxPx, H = Math.round(maxPx / aspect);
    if (H > maxPx) { H = maxPx; W = Math.round(maxPx * aspect); }

    const t0 = Date.now();
    const surface = Skia.Surface.MakeOffscreen(W, H);
    if (!surface) { log(`아틀라스 ${maxPx}`, "MakeOffscreen 실패", false); return null; }

    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    const [bw, bs, be, bn] = bbox;
    const mx0 = mercX(bw), my0 = mercY(bn);
    const dx = mercX(be) - mx0, dy = mercY(bs) - my0;
    const PX = (lon: number) => ((mercX(lon) - mx0) / dx) * W;
    const PY = (lat: number) => ((mercY(lat) - my0) / dy) * H;

    visited.forEach((f: any, idx: number) => {
      const img = imgs[idx % imgs.length];
      const path = Skia.Path.Make();
      path.setFillType(FillType.EvenOdd);
      for (const poly of f.geometry.coordinates) {
        for (const ring of poly) {
          ring.forEach(([lon, lat]: number[], i: number) => {
            const x = PX(lon), y = PY(lat);
            if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
          });
          path.close();
        }
      }
      const b = f.properties.bbox;
      const x0 = PX(b[0]), x1 = PX(b[2]), y0 = PY(b[3]), y1 = PY(b[1]);
      const rw = x1 - x0, rh = y1 - y0;
      const sc = Math.max(rw / img.width(), rh / img.height());
      const dw = img.width() * sc, dh = img.height() * sc;

      canvas.save();
      canvas.clipPath(path, ClipOp.Intersect, true);
      canvas.drawImageRect(
        img,
        Skia.XYWHRect(0, 0, img.width(), img.height()),
        Skia.XYWHRect(x0 + (rw - dw) / 2, y0 + (rh - dh) / 2, dw, dh),
        paint,
      );
      canvas.restore();
    });
    const tDraw = Date.now() - t0;

    const t1 = Date.now();
    const snap = surface.makeImageSnapshot();
    const bytes = snap.encodeToBytes(fmt as any, quality);
    const tEnc = Date.now() - t1;

    const t2 = Date.now();
    const ext = fmt === ImageFormat.PNG ? "png" : fmt === ImageFormat.WEBP ? "webp" : "jpg";
    const path = `${FileSystem.cacheDirectory}atlas_${maxPx}_${Date.now()}.${ext}`;
    let b64 = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    FileSystem.writeAsStringAsync(path, globalThis.btoa(b64), {
      encoding: FileSystem.EncodingType.Base64,
    });
    const tWrite = Date.now() - t2;

    log(label ?? `아틀라스 ${W}×${H}`,
        `그리기 ${tDraw}ms · 인코딩 ${tEnc}ms · 기록 ${tWrite}ms · ${(bytes.length / 1048576).toFixed(2)}MB`,
        true);

    return {
      uri: path,
      coords: [[bw, bn], [be, bn], [be, bs], [bw, bs]] as any,
    };
  }

  function circleIcon(img: SkImage, color: string, px = 80,
                      fmt: number = ImageFormat.PNG, q = 100): string | null {
    const s = Skia.Surface.MakeOffscreen(px, px);
    if (!s) return null;
    const c = s.getCanvas();
    const r = px / 2, ring = 5;
    const clip = Skia.Path.Make();
    clip.addCircle(r, r, r - ring);
    c.save();
    c.clipPath(clip, ClipOp.Intersect, true);
    const sc = Math.max((px - ring * 2) / img.width(), (px - ring * 2) / img.height());
    const dw = img.width() * sc, dh = img.height() * sc;
    c.drawImageRect(img, Skia.XYWHRect(0, 0, img.width(), img.height()),
      Skia.XYWHRect(r - dw / 2, r - dh / 2, dw, dh), Skia.Paint());
    c.restore();
    const p = Skia.Paint();
    p.setStyle(PaintStyle.Stroke); p.setStrokeWidth(ring); p.setColor(Skia.Color(color));
    c.drawCircle(r, r, r - ring / 2, p);
    return s.makeImageSnapshot().encodeToBase64(fmt as any, q);
  }

  return (
    <View style={st.root}>
      <View style={st.mapBox}>
        <Map style={st.fill} mapStyle={EMPTY_STYLE}>
          <Camera initialViewState={{ center: [127.75, 36.3], zoom: 5.6 }} />
          {regions ? (
            <GeoJSONSource id="sgg" data={regions}>
              <Layer id="region-base" type="fill" paint={{ "fill-color": LAND }} />
              <Layer id="region-line" type="line"
                paint={{ "line-color": "rgba(255,255,255,0.22)", "line-width": 0.5 }} />
            </GeoJSONSource>
          ) : null}
          {atlas ? (
            <ImageSource id="atlas" url={atlas.uri} coordinates={atlas.coords}>
              <Layer id="atlas-l" type="raster" paint={{ "raster-opacity": 1 }} />
            </ImageSource>
          ) : null}
        </Map>
      </View>
      <ScrollView style={st.logBox} contentContainerStyle={{ padding: 10 }}>
        <Text style={st.h}>RN 네이티브 벤치마크</Text>
        {log.map((l, i) => (
          <View key={i} style={st.row}>
            <Text style={[st.k, l.ok === false && st.bad, l.ok === true && st.good]}>{l.t}</Text>
            <Text style={st.v}>{l.v}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingTop: 50 },
  mapBox: { height: "45%" },
  fill: { flex: 1 },
  logBox: { flex: 1, backgroundColor: "#0E0F13" },
  h: { color: "#F2F3F5", fontSize: 15, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", marginBottom: 5 },
  k: { color: "#8A8F9A", width: 150, fontSize: 11 },
  v: { color: "#F2F3F5", flex: 1, fontSize: 11 },
  good: { color: "#4ADE80" },
  bad: { color: "#F87171" },
});
