/**
 * TRIPPIC — 지도 탭 (§13.47)
 *
 * ★ 여기 있던 것은 **Skia 벤치마크 화면**이었다. 아틀라스 합성 시간을 재고
 *   `localhost:5173` 에서 사진을 받던 측정 도구다. 그 측정은 끝났고(§13 실기기 측정),
 *   같은 자리에 **제품 지도**가 온다. 측정 코드는 지웠다 — 두 벌을 남기면
 *   어느 쪽이 진짜 화면인지 매번 헷갈린다.
 *
 * ★ **지도는 하나고, 무엇을 볼지만 고른다**(§13.37). 지도를 셋으로 나누지 않는다.
 *   나누면 §12.27 에서 접었던 '정리함'과 같은 실수가 된다(같은 일을 하는 화면이 둘).
 *   그래서 칩은 **필터지 분류가 아니다** — 셋은 겹칠 수 있고, 그건 결함이 아니다.
 *
 * ★ **뷰포트로 잘라 읽는다**(§13.31). 전국을 한 번에 읽지 않는다. 화면보다 1.8배
 *   넓게(PAD 0.4) 읽어 두면 조금씩 미는 동안은 왕복이 공짜다.
 *
 * ★ 배경 지도는 **앱에 넣었다**(593K). 웹은 `localhost:5173` 에서 받았지만 앱이
 *   개발 서버에 매달리면 그건 제품이 아니다. 사진은 여전히 URL 로 받는다 —
 *   번들을 42MB 로 불리지 않는다는 원칙(§13)은 그대로다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import * as API from "../api";
import { dur, ymd } from "../course";
import { C, CAT } from "../theme";

const SGG = require("../../assets/korea-sgg.json");

const LAND = "#282B36";
const BG = "#08090C";

/* 웹과 같은 네 칩·같은 라벨(§13.37). '친구'라고 쓰지 않는다 — 우리에겐 1:1 친구가
   없고 공유의 단위는 스페이스다. 그렇게 쓰면 있지도 않은 친구 목록을 찾게 된다. */
const SCOPES: { v: API.Scope; k: string }[] = [
  { v: "all", k: "전부" },
  { v: "mine", k: "내 지도" },
  { v: "shared", k: "함께" },
  { v: "public", k: "모두의" },
];

/* ★ 출처 배지 — **한 핀에 하나.** 남의 것에는 안 붙인다(§13.37): 기본값이라
   붙이면 소음이 된다. §13.47 에서는 붙일 자리가 없어 미뤄 뒀던 약속이다. */
const SRC_LABEL: Record<string, string> = { mine: "내 것", shared: "함께" };

/* 위치를 무엇으로 정했는지. ★ 'manual' 을 '사진 정보'라고 쓰지 않는다 —
   웹 프로토타입은 live 가 아니면 전부 '사진 정보'로 뭉갰는데 그건 사실이 아니다. */
const VER_LABEL: Record<string, string> = {
  live: "현장 인증", exif: "사진 정보", manual: "직접 지정",
};

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": BG } }],
};

type Pin = {
  id: string;
  lng: number;
  lat: number;
  category: string | null;
  source: string | null;
  memo: string | null;
  media_url: string | null;
  media_w: number | null;
  media_h: number | null;
  visited_at: string | null;
  stay_sec: number | null;
  verification: string | null;
  is_public: boolean;
  comment_count: number;
};

const toFeature = (r: any): GeoJSON.Feature | null => {
  const lng = Number(r?.lng), lat = Number(r?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      pinId: r.id,
      cat: r.category ?? "etc",
      color: CAT[r.category ?? "etc"]?.c ?? CAT.etc.c,
      source: r.source ?? "other",
    },
  };
};

const inside = (inner: API.BBox, outer: API.BBox | null) =>
  !!outer &&
  inner.w >= outer.w && inner.e <= outer.e &&
  inner.s >= outer.s && inner.n <= outer.n;

/** ★ 시트가 열린 것을 App 에 알린다. `(+)` 는 App 이 지도 **위에** 띄우므로
    MapTab 안에서는 가릴 수 없다 — 그대로 두면 닫기(✕)를 덮는다. */
export function MapTab({ onSheet }: { onSheet?: (open: boolean) => void } = {}) {
  const mapRef = useRef<MapRef>(null);
  const [scope, setScope] = useState<API.Scope>("all");
  const [pins, setPins] = useState<Pin[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [open, setOpen] = useState<Pin | null>(null);
  useEffect(() => { onSheet?.(!!open); }, [open]);

  /* 이미 읽은 상자와 그때의 스코프. 스코프가 바뀌면 이 상자는 소용없다 —
     서버가 **다른 집합**을 준다(§13.37). */
  const loaded = useRef<{ box: API.BBox | null; scope: API.Scope }>({ box: null, scope: "all" });
  const inflight = useRef(false);

  const load = useCallback(async (force: boolean, sc: API.Scope) => {
    if (inflight.current) return;
    const b = await mapRef.current?.getBounds().catch(() => null);
    if (!b) return;
    const view: API.BBox = { w: b[0], s: b[1], e: b[2], n: b[3] };
    if (!force && loaded.current.scope === sc && inside(view, loaded.current.box)) return;

    inflight.current = true;
    setBusy(true);
    const box = API.padBox(view);
    const r = await API.pinsInBBox(box, { limit: 300, scope: sc });
    inflight.current = false;
    setBusy(false);

    if (!r.ok) { setWhy("지도를 불러오지 못했습니다 — 잠시 뒤 다시 시도합니다"); return; }
    setWhy(null);
    loaded.current = { box, scope: sc };
    setMore(r.more);
    setPins((r.data as any[]).map((row) => ({
      id: row.id, lng: Number(row.lng), lat: Number(row.lat),
      category: row.category, source: row.source, memo: row.memo,
      media_url: row.media_url, media_w: row.media_w ?? null, media_h: row.media_h ?? null,
      visited_at: row.visited_at ?? null, stay_sec: row.stay_sec ?? null,
      verification: row.verification ?? null, is_public: !!row.is_public,
      comment_count: row.comment_count ?? 0,
    })).filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)));
  }, []);

  useEffect(() => { void load(true, scope); }, []);

  /* 스코프를 바꾼다. ★ 이전 스코프의 핀을 **걷어낸다.** 안 걷으면 '내 지도'를 골랐는데
     남의 핀이 남아 있고, 그건 필터가 아니라 그냥 더하기다(§13.37). */
  /* 핀을 누르면 시트가 열린다. ★ 빈 곳을 누르면 **닫는다** — 닫는 길이 X 하나뿐이면
     지도를 보려고 매번 작은 버튼을 겨눠야 한다. */
  const onMapPress = async (e: any) => {
    const pt = e?.nativeEvent?.point;
    if (!pt) { setOpen(null); return; }
    const hits = await mapRef.current
      ?.queryRenderedFeatures(pt, { layers: ["pin-dot"] })
      .catch(() => [] as any[]);
    const id = hits?.[0]?.properties?.pinId;
    setOpen(id ? (pins.find((p) => p.id === id) ?? null) : null);
  };

  const changeScope = (v: API.Scope) => {
    if (v === scope) return;
    setOpen(null);          // 스코프가 바뀌면 그 핀은 더 이상 이 화면의 것이 아니다
    setScope(v);
    setPins([]);
    setMore(false);
    loaded.current = { box: null, scope: v };
    void load(true, v);
  };

  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: pins.map(toFeature).filter(Boolean) as GeoJSON.Feature[],
  };

  /* 시트가 나눠 센다(§13.37) — 셋은 겹치므로 합이 전체와 같지 않을 수 있다. */
  const n = { mine: 0, shared: 0, other: 0 } as Record<string, number>;
  for (const p of pins) n[p.source ?? "other"] = (n[p.source ?? "other"] ?? 0) + 1;

  return (
    <View style={st.root}>
      <View style={st.head}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={st.chipRow}>
          {SCOPES.map((s) => (
            <Pressable key={s.v} onPress={() => changeScope(s.v)}
                       style={[st.chip, scope === s.v && st.chipOn]}>
              <Text style={[st.chipT, scope === s.v && st.chipTOn]}>{s.k}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <Map ref={mapRef} style={st.fill} mapStyle={EMPTY_STYLE}
           onPress={(e) => { void onMapPress(e); }}
           onRegionDidChange={() => { void load(false, scope); }}>
        <Camera initialViewState={{ center: [127.75, 36.3], zoom: 5.6 }} />

        <GeoJSONSource id="sgg" data={SGG as any}>
          <Layer id="region-base" type="fill" paint={{ "fill-color": LAND }} />
          <Layer id="region-line" type="line"
                 paint={{ "line-color": "rgba(255,255,255,0.22)", "line-width": 0.5 }} />
        </GeoJSONSource>

        <GeoJSONSource id="pins" data={fc as any}>
          <Layer id="pin-halo" type="circle"
                 paint={{ "circle-radius": 8, "circle-color": "#000", "circle-opacity": 0.35 }} />
          <Layer id="pin-dot" type="circle"
                 paint={{
                   "circle-radius": 5,
                   "circle-color": ["get", "color"] as any,
                   "circle-stroke-width": 1.5,
                   "circle-stroke-color": "rgba(255,255,255,0.85)",
                 }} />
        </GeoJSONSource>
      </Map>

      {open && <PinSheet pin={open} onClose={() => setOpen(null)} />}

      {/* 시트가 떠 있으면 집계 알약은 감춘다 — 같은 자리를 두 개가 다툰다 */}
      <View style={[st.foot, open && st.hidden]} pointerEvents={open ? "none" : "auto"}>
        {why ? (
          <Text style={st.warn}>{why}</Text>
        ) : busy ? (
          <View style={st.busyRow}>
            <ActivityIndicator size="small" color={C.muted} />
            <Text style={st.count}>불러오는 중</Text>
          </View>
        ) : pins.length === 0 ? (
          <Text style={st.count}>
            {scope === "mine" ? "이 화면에는 내가 올린 기록이 없습니다"
              : scope === "shared" ? "이 화면에는 함께 보는 기록이 없습니다"
              : "이 화면에는 아직 기록이 없습니다"}
          </Text>
        ) : (
          <Text style={st.count}>
            {[
              n.mine ? `내 것 ${n.mine}곳` : null,
              n.shared ? `함께 ${n.shared}곳` : null,
              n.other ? `남 ${n.other}곳` : null,
            ].filter(Boolean).join(" · ")}
            {more ? "  더 있습니다 — 확대하면 더 보입니다" : ""}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * 핀 상세 시트 — **서버가 준 것만 적는다.**
 *
 * ★ 상호명이 없다. `api_pins_in_bbox` 는 장소 이름을 주지 않고, 웹도 메모를 20자
 *   잘라 이름 자리에 넣고 있었다. 지어내지 않는다 — 메모가 없으면 제목을 비운다.
 *   ("내 기록"이라고 적으면 **남의 핀에서 거짓말**이 된다)
 * ★ 저장·좋아요·지도앱 열기는 아직 없다. **죽은 버튼을 만들지 않는다** —
 *   누르면 아무 일도 안 나는 버튼은 없느니만 못하다.
 * ★ 머문 시간이 없으면 **없다고 적는다**(§13.32). 0분이라고 쓰지 않는다.
 */
function PinSheet({ pin, onClose }: { pin: Pin; onClose: () => void }) {
  const cat = CAT[pin.category ?? "etc"] ?? CAT.etc;
  const src = pin.source ? SRC_LABEL[pin.source] : null;
  const ver = pin.verification ? VER_LABEL[pin.verification] : null;
  const stay = dur(pin.stay_sec);
  const day = pin.visited_at ? ymd(new Date(pin.visited_at)) : null;
  const ratio = pin.media_w && pin.media_h ? pin.media_w / pin.media_h : 3 / 2;

  return (
    <View style={st.sheet}>
      <View style={st.sheetHead}>
        <View style={[st.dot, { backgroundColor: cat.c }]} />
        <Text style={st.catT}>{cat.k}</Text>
        {src ? <Text style={[st.badge, st.badgeSrc]}>{src}</Text> : null}
        {ver ? <Text style={st.badge}>{ver}</Text> : null}
        {!pin.is_public ? <Text style={st.badge}>나만 보기</Text> : null}
        <Pressable onPress={onClose} hitSlop={10} style={st.close}>
          <Text style={st.closeT}>✕</Text>
        </Pressable>
      </View>

      {pin.media_url ? (
        <Image source={{ uri: pin.media_url }}
               style={[st.photo, { aspectRatio: Math.max(0.6, Math.min(2.2, ratio)) }]} />
      ) : (
        <Text style={st.none}>사진이 없는 기록입니다</Text>
      )}

      {pin.memo ? <Text style={st.memo}>{pin.memo}</Text> : null}

      <Text style={st.meta}>
        {[
          day,
          stay ? `${stay} 머물렀습니다` : "머문 시간은 알 수 없습니다",
          pin.comment_count ? `댓글 ${pin.comment_count}` : null,
        ].filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  head: { paddingTop: 52, paddingBottom: 8, backgroundColor: BG },
  chipRow: { paddingHorizontal: 12, gap: 6 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipT: { color: C.muted, fontSize: 12 },
  chipTOn: { color: C.onAccent, fontWeight: "700" },
  fill: { flex: 1 },
  /* ★ 탭바가 `bottom:26` 에 **떠 있다**(높이 ~62). 문서 흐름의 맨 아래에 두면
     그 뒤로 깔려 글자가 잘린다 — 시뮬레이터에서 실제로 잘렸다.
     그래서 탭바 위(88+여백)에 같은 모양의 알약으로 띄운다. */
  foot: {
    /* (+) 는 right:18 에 54 폭으로 떠 있다 — 그 왼쪽에서 끝낸다(18+54+12) */
    position: "absolute", left: 14, right: 84, bottom: 96,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    backgroundColor: "rgba(22,24,31,0.92)", borderWidth: 1, borderColor: C.line,
  },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  count: { color: C.muted, fontSize: 12 },
  hidden: { opacity: 0 },
  sheet: {
    position: "absolute", left: 14, right: 14, bottom: 96,
    padding: 12, borderRadius: 16,
    backgroundColor: "rgba(22,24,31,0.97)", borderWidth: 1, borderColor: C.line,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 9 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  catT: { color: C.text, fontSize: 13, fontWeight: "700" },
  badge: {
    color: C.muted, fontSize: 10.5, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6, backgroundColor: "rgba(255,255,255,0.07)", overflow: "hidden",
  },
  badgeSrc: { color: C.text, backgroundColor: "rgba(56,182,255,0.22)" },
  close: { marginLeft: "auto", paddingHorizontal: 4 },
  closeT: { color: C.muted, fontSize: 15 },
  photo: { width: "100%", borderRadius: 11, backgroundColor: "#0B0C10" },
  none: { color: C.muted, fontSize: 12, paddingVertical: 10 },
  memo: { color: C.text, fontSize: 13.5, lineHeight: 19, marginTop: 9 },
  meta: { color: C.muted, fontSize: 11.5, marginTop: 8 },
  warn: { color: C.warn, fontSize: 12 },
});
