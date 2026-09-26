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
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import * as API from "../api";
import { dur, ymd } from "../course";
import { C, CAT } from "../theme";

/* ★ 배경 경계는 **DB 에서 뽑았다**(251개, 0.001° 단순화 → 691K).
   §13.47 에서 번들한 프로토타입의 `korea-sgg.json` 은 **코드 체계가 달랐다** —
   250개 중 DB 와 맞는 것이 9개뿐이라 지역 숫자를 폴리곤에 붙일 수 없었다.
   배경만 그릴 때는 코드가 필요 없어서 드러나지 않던 결함이다. */
const SGG = require("../../assets/korea-regions.json") as GeoJSON.FeatureCollection;

/* ★ 줌에 따라 **단위 자체가 바뀐다**(§13.11). 전국 줌에서 답해야 하는 질문은
   *"어느 지역에 볼 곳이 많나"* 이지 *"이 카페가 어디냐"* 가 아니다.
   핀 개수만 깎는 것은 같은 질문에 더 작게 답하는 것일 뿐 질문을 바꾸지 못한다. */
const Z_REGION = 9;    // 이 아래는 시·군·구 집계
const Z_ALL = 13;      // 이 위는 전부
/* ★ **세 단계다.** 웹은 처음부터 셋이었는데(§13.11) 앱은 둘뿐이라, z9 를 넘는 순간
   300개가 한꺼번에 쏟아졌다. 가운데가 빠지면 *"이 근처에 뭐가 있나"* 에 답하는
   줌이 없어진다 — 지역에서 바로 골목으로 떨어진다(§13.54). */
type Unit = "region" | "top" | "all";
const unitOf = (z: number): Unit => (z < Z_REGION ? "region" : z < Z_ALL ? "top" : "all");
const isRegionZoom = (z: number) => z < Z_REGION;

/* 가운데 단계에서 몇 개를 세울까. 웹이 실측으로 고른 값을 그대로 쓴다. */
const topN = (z: number) => (z < 12 ? 10 : z < 14 ? 16 : 24);

/* ★ 카테고리 쿼터 — 한 갈래가 썸네일의 40%를 넘지 못하게 막는다.
   반응 수만으로 뽑으면 맛집이 화면을 덮는다(웹 실측: 전체의 43%).
   **"여행 추억 지도"가 "맛집 앱"으로 미끄러지는 것을 막는 가장 싼 장치**다. */
const QUOTA_RATIO = 0.4;

/* 카테고리 칩. ★ 서버는 `p_cat` 을 **처음부터 받고 있었다**(031·042) —
   앱이 `null` 만 넘기고 있었을 뿐이다(§13.54). */
const CATS: { v: string | null; k: string }[] = [
  { v: null, k: "전체" },
  ...API.PIN_CATEGORY.filter((c) => c !== "etc")
    .map((c) => ({ v: c as string | null, k: CAT[c]?.k ?? c })),
];

/* bbox 를 화면에 담는 줌. ★ `fitBounds` 를 그냥 쓰면 **넓은 지역은 집계 줌에 그대로
   머문다** — 웹에서 강릉시를 눌렀더니 z8.7 이라 여전히 '지역' 단위였고, 탭했는데
   아무 일도 안 일어난 것처럼 보였다. 그래서 직접 계산해서 **반드시 집계 줌을 벗어나게**
   클램프한다. 무엇을 눌렀든 장소 단위까지는 들어간다. */
const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) / Math.PI / 2 + 0.5;

function zoomForBBox(b: number[], wPx: number, hPx: number) {
  const lonFrac = Math.max(1e-6, (b[2] - b[0]) / 360);
  const latFrac = Math.max(1e-6, Math.abs(mercY(b[3]) - mercY(b[1])));
  const zx = Math.log2(wPx / (256 * lonFrac));
  const zy = Math.log2(hPx / (256 * latFrac));
  return Math.min(12.5, Math.max(Z_REGION + 0.3, Math.min(zx, zy)));
}

/* 로그로 편다. ★ 선형으로 칠하면 거의 다 0에 붙는다 — 한 지역만 빨갛고 나머지는 검다.
   웹(§13.37)이 실측으로 고른 구간을 그대로 쓴다. */
const STOPS: [number, number][] = [[0, 0], [0.25, 0.05], [0.55, 0.26], [0.8, 0.52], [1, 0.82]];
const opacityOf = (lg: number) => {
  for (let i = 1; i < STOPS.length; i++) {
    const [x0, y0] = STOPS[i - 1], [x1, y1] = STOPS[i];
    if (lg <= x1) return y0 + ((lg - x0) / (x1 - x0)) * (y1 - y0);
  }
  return STOPS[STOPS.length - 1][1];
};

const LAND = "#282B36";
const BG = "#08090C";
/* PLAN 팔레트의 경계 토큰. ★ 폴리곤을 **채우지 않는다** — accent 도 visited 도
   "폴리곤엔 쓰지 않음"으로 못 박혀 있고, 채우는 색은 팔레트에 아예 없다.
   방문 지역은 **경계를 진하게** 해서 드러낸다(--region-stroke-vis). */
const STROKE = "rgba(255,255,255,0.15)";
const STROKE_VIS = "rgba(255,255,255,0.32)";

/* ★ '친구'라고 쓰지 않는다 — 우리에겐 1:1 친구가 없고 공유의 단위는 스페이스다.
   그렇게 쓰면 있지도 않은 친구 목록을 찾게 된다(§13.37).

   ★ **`모두의`는 필터가 아니라 모드 전환이다.** 앞의 셋은 *"내 기록 중 무엇을
     볼까"* 인데 `모두의`는 **내 기록을 벗어난다.** 같은 줄에 나란히 두면 넷이
     대등한 필터로 보이므로 **구분선으로 가른다**(§13.55).

   ★ `전부` → `나의 모든 여행`. 이름만 바뀐 게 아니라 **담는 것이 달라졌다** —
     옛 `all` 은 남의 공개 핀까지 담았다(실측: 5곳 중 3곳이 남의 것). */
type ScopeChip = { v: API.Scope; k: string; sep?: boolean };
const SCOPES: ScopeChip[] = [
  { v: "mine_all", k: "나의 모든 여행" },
  { v: "mine", k: "나의 여행" },
  { v: "shared", k: "공유 스페이스" },
  { v: "public", k: "모두의 지도", sep: true },
];

/* ★ 출처 배지 — **한 핀에 하나.** 남의 것에는 안 붙인다(§13.37): 기본값이라
   붙이면 소음이 된다. §13.47 에서는 붙일 자리가 없어 미뤄 뒀던 약속이다. */
const SRC_LABEL: Record<string, string> = { mine: "내 것", shared: "함께" };

/* 위치를 무엇으로 정했는지. ★ 'manual' 을 '사진 정보'라고 쓰지 않는다 —
   웹 프로토타입은 live 가 아니면 전부 '사진 정보'로 뭉갰는데 그건 사실이 아니다. */
const VER_LABEL: Record<string, string> = {
  live: "현장 인증", exif: "사진 정보", manual: "직접 지정",
};

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

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
  /** 지도 카드·작은 자리용(047). 서버가 없으면 원본으로 떨어뜨려 준다. */
  media_thumb: string | null;
  media_w: number | null;
  media_h: number | null;
  visited_at: string | null;
  stay_sec: number | null;
  verification: string | null;
  is_public: boolean;
  comment_count: number;
  /* 가운데 단계의 순위 재료. 서버는 계속 주고 있었는데 앱이 버리고 있었다. */
  like_count: number;
  save_count: number;
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
      /* ★ 레이어를 **끼웠다 뺐다 하지 않는다**(§13.47 에서 앱이 죽었다).
         고른 것과 아닌 것을 `top` 한 칸으로 구분하고 **paint 로만** 달리 그린다. */
      top: r.__top ? 1 : 0,
    },
  };
};

const inside = (inner: API.BBox, outer: API.BBox | null) =>
  !!outer &&
  inner.w >= outer.w && inner.e <= outer.e &&
  inner.s >= outer.s && inner.n <= outer.n;

/** ★ 시트가 열린 것을 App 에 알린다. `(+)` 는 App 이 지도 **위에** 띄우므로
    MapTab 안에서는 가릴 수 없다 — 그대로 두면 닫기(✕)를 덮는다. */
export function MapTab(
  { ready, onSheet, onAdd }: {
    ready?: boolean;
    onSheet?: (open: boolean) => void;
    /** 빈 화면의 CTA — (+) 와 **같은 문**으로 보낸다(두 벌로 만들지 않는다) */
    onAdd?: () => void;
  } = {},
) {
  const mapRef = useRef<MapRef>(null);
  const [scope, setScope] = useState<API.Scope>("mine_all");
  const [cat, setCat] = useState<string | null>(null);
  /* 고른 스페이스 하나. null 이면 스코프 전체다. */
  const [space, setSpace] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<API.SpaceRow[]>([]);
  const [pickSpace, setPickSpace] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [open, setOpen] = useState<Pin | null>(null);
  const [zoom, setZoom] = useState(5.6);
  const [agg, setAgg] = useState<API.RegionAgg[]>([]);
  const [into, setInto] = useState<string | null>(null);   // 들어온 지역 이름
  const camRef = useRef<CameraRef>(null);
  const size = useRef({ w: 402, h: 700 });
  useEffect(() => { onSheet?.(!!open); }, [open]);

  /* 이미 읽은 상자와 그때의 스코프. 스코프가 바뀌면 이 상자는 소용없다 —
     서버가 **다른 집합**을 준다(§13.37). */
  const loaded = useRef<{ box: API.BBox | null; scope: API.Scope;
                          cat: string | null; space: string | null }>(
    { box: null, scope: "mine_all", cat: null, space: null });
  const inflight = useRef(false);
  /* ★ `load` 는 의존성이 비어 있어 **처음 값에 얼어붙는다.** 스코프는 인자로 받아
     피했는데 카테고리까지 인자로 늘리면 호출부마다 둘을 다 실어야 한다 —
     `onRegionDidChange` 는 그때의 최신 값을 알아야 하므로 ref 로 들고 본다. */
  const catRef = useRef<string | null>(null);
  const spaceRef = useRef<string | null>(null);

  const load = useCallback(async (force: boolean, sc: API.Scope, z?: number) => {
    const ct = catRef.current, sp = spaceRef.current;
    if (inflight.current) return;
    /* ★ 집계 줌에서는 핀을 **안 읽는다.** 전국 한 화면이 상자가 되면
       "뷰포트로 자른다"가 아무것도 자르지 않는 말이 된다(031). */
    if (isRegionZoom(z ?? zoom)) {
      setPins([]); loaded.current = { box: null, scope: sc, cat: ct, space: sp }; return;
    }
    const b = await mapRef.current?.getBounds().catch(() => null);
    if (!b) return;
    const view: API.BBox = { w: b[0], s: b[1], e: b[2], n: b[3] };
    /* 카테고리가 바뀌면 이 상자는 소용없다 — 서버가 **다른 집합**을 준다.
       스코프와 같은 이유다(§13.37). */
    if (!force && loaded.current.scope === sc && loaded.current.cat === ct
        && loaded.current.space === sp && inside(view, loaded.current.box)) return;

    inflight.current = true;
    setBusy(true);
    const box = API.padBox(view);
    const r = await API.pinsInBBox(box, { limit: 300, scope: sc, cat: ct, space: sp });
    inflight.current = false;
    setBusy(false);

    if (!r.ok) { setWhy("지도를 불러오지 못했습니다 — 잠시 뒤 다시 시도합니다"); return; }
    setWhy(null);
    loaded.current = { box, scope: sc, cat: ct, space: sp };
    setMore(r.more);
    setPins((r.data as any[]).map((row) => ({
      id: row.id, lng: Number(row.lng), lat: Number(row.lat),
      category: row.category, source: row.source, memo: row.memo,
      media_url: row.media_url, media_thumb: row.media_thumb ?? row.media_url,
      media_w: row.media_w ?? null, media_h: row.media_h ?? null,
      visited_at: row.visited_at ?? null, stay_sec: row.stay_sec ?? null,
      verification: row.verification ?? null, is_public: !!row.is_public,
      comment_count: row.comment_count ?? 0,
      like_count: row.like_count ?? 0, save_count: row.save_count ?? 0,
    })).filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)));
  }, []);

  /* ★ 집계는 **스코프가 바뀔 때만** 읽는다. 화면을 밀어도 다시 읽지 않는다 —
     숫자가 뷰포트와 무관하니 다시 읽을 이유가 없다(042). */
  /* ★ **늦게 온 답이 새 답을 덮는다.** 열자마자 `mine_all` 집계가 나가는데, 그
     사이에 칩을 누르면 `shared`(0곳)가 먼저 돌아오고 **느린 `mine_all` 이 나중에
     도착해 덮어쓴다.** 화면은 `스페이스` 인데 숫자는 내 기록이 되는, 조용하고
     재현이 어려운 거짓말이다(§13.55 에서 실제로 잡았다).
     → 요청마다 번호를 붙이고 **마지막 것만** 받는다. 핀 쪽은 `loaded.current` 가
       우연히 막아 주지만 집계에는 그런 것이 없었다. */
  const aggSeq = useRef(0);

  const loadAgg = useCallback(async (sc: API.Scope, ct: string | null,
                                    sp: string | null = null) => {
    const seq = ++aggSeq.current;
    /* ★ 집계도 **같은 필터로** 센다. 필터를 무시하고 전체를 세면 '맛집'을 켜고
       전국으로 나가도 지도가 안 변한다 — 그러면 *"맛집이 많은 지역"* 을 볼 수가
       없다. §13.11 이 신뢰 필터에서 정한 것과 같은 규칙이다. */
    const r = await API.pinsByRegion(sc, ct, sp);
    if (seq !== aggSeq.current) return;      // 그 사이 더 새 요청이 나갔다
    setAgg(r.ok ? (r.data ?? []) : []);
  }, []);

  /* ★ **세션이 선 뒤에 읽는다.** 앱이 뜨자마자 읽으면 토큰이 아직 없어 RLS 가
     아무것도 주지 않는다 — 핀은 `onRegionDidChange` 가 다시 불러 살아나지만
     집계는 재시도가 없어 **영영 빈 채로 남는다.** 시뮬레이터에서 실제로 그랬다. */
  useEffect(() => {
    if (!ready) return;
    void load(true, scope);
    void loadAgg(scope, cat, space);
    /* ★ 목록은 **한 번만** 읽는다. 스페이스는 지도를 보는 중에 늘어나지 않는다 —
       늘어나는 순간(초대 수락)은 §13.38 이 이미 스코프를 바꿔 준다. */
    void API.mySpaces().then((r) => setSpaces(r.ok ? (r.data ?? []) : []));
  }, [ready]);

  /* 스코프를 바꾼다. ★ 이전 스코프의 핀을 **걷어낸다.** 안 걷으면 '내 지도'를 골랐는데
     남의 핀이 남아 있고, 그건 필터가 아니라 그냥 더하기다(§13.37). */
  /* 핀을 누르면 시트가 열린다. ★ 빈 곳을 누르면 **닫는다** — 닫는 길이 X 하나뿐이면
     지도를 보려고 매번 작은 버튼을 겨눠야 한다. */
  const onMapPress = async (e: any) => {
    const pt = e?.nativeEvent?.point;
    if (!pt) { setOpen(null); return; }

    /* ★ 집계 줌에서만 지역 탭을 받는다. 확대된 상태에서도 받으면
       **핀을 노린 손가락을 지역이 가로챈다**(웹에서 정한 규칙). */
    if (isRegionZoom(zoom)) {
      const hit = await mapRef.current
        ?.queryRenderedFeatures(pt, { layers: ["region-base"] })
        .catch(() => [] as any[]);
      const code = hit?.[0]?.properties?.code;
      const r = code ? NAME[code] : null;
      if (!r?.bbox) return;                       // 바다를 눌렀다 — 아무 일도 안 한다
      setInto(r.name);
      camRef.current?.flyTo({
        center: [(r.bbox[0] + r.bbox[2]) / 2, (r.bbox[1] + r.bbox[3]) / 2],
        zoom: zoomForBBox(r.bbox, size.current.w, size.current.h),
        duration: 700,
      });
      return;
    }
    const hits = await mapRef.current
      ?.queryRenderedFeatures(pt, { layers: ["pin-dot"] })
      .catch(() => [] as any[]);
    const id = hits?.[0]?.properties?.pinId;
    setOpen(id ? (pins.find((p) => p.id === id) ?? null) : null);
  };

  const changeScope = (v: API.Scope) => {
    /* ★ `공유 스페이스` 를 **다시 누르면** 고르는 창을 연다. 한 번 고른 뒤에 다른
       방으로 옮길 길이 없으면, 바꾸려고 딴 칩을 거쳐 돌아와야 한다. */
    if (v === scope) { if (v === "shared") setPickSpace(true); return; }
    setOpen(null);          // 스코프가 바뀌면 그 핀은 더 이상 이 화면의 것이 아니다
    setScope(v);
    /* ★ 스페이스 좁히기는 `스페이스` 스코프에서만 뜻이 있다 — 다른 칩으로 가면
       **푼다.** 안 풀면 '모두의 지도'를 보면서 내 스페이스로 걸러진다. */
    /* ★ `공유 스페이스` 는 **반드시 방 하나를 고른다**(`전체` 를 없앴다).
       방이 하나뿐이면 **묻지 않고 그걸 쓴다** — 선택지가 하나인 물음은 일이다. */
    let sp = v === "shared" ? spaceRef.current : null;
    if (v === "shared" && !sp && spaces.length === 1) sp = spaces[0].id;
    if (sp !== spaceRef.current) { spaceRef.current = sp; setSpace(sp); }
    setPins([]);
    setMore(false);
    loaded.current = { box: null, scope: v, cat, space: sp };
    setAgg([]);
    void load(true, v);
    void loadAgg(v, cat, sp);
    /* 아직 고른 방이 없으면 고르는 창을 띄운다 — 방이 없으면 빈 화면이 안내한다 */
    if (v === "shared" && !sp) setPickSpace(true);
  };

  /* 스페이스 하나로 좁힌다(또는 푼다). 스코프 바꾸기와 **같은 절차다.** */
  const changeSpace = (id: string) => {
    setPickSpace(false);
    if (id === space) return;
    setOpen(null);
    setSpace(id);
    spaceRef.current = id;
    setPins([]);
    setMore(false);
    loaded.current = { box: null, scope: "shared", cat, space: id };
    setAgg([]);
    void load(true, "shared");
    void loadAgg("shared", cat, id);
  };

  /* 카테고리를 바꾼다. 스코프와 **같은 절차다** — 이전 것을 걷어내지 않으면
     필터가 아니라 그냥 더하기가 된다(§13.37). */
  const changeCat = (v: string | null) => {
    if (v === cat) return;
    setOpen(null);
    setCat(v);
    catRef.current = v;
    setPins([]);
    setMore(false);
    loaded.current = { box: null, scope, cat: v, space };
    setAgg([]);
    void load(true, scope);
    void loadAgg(scope, v, space);
  };

  const unit = unitOf(zoom);
  const region = unit === "region";

  /* ── 가운데 단계: **무엇을 세울지 고른다** (§13.54 · 웹 §13.11 이식) ──────
     ★ 순위는 **보이는 것 안에서만** 매긴다. 전역 순위로는 지역별 밀도 차이를
       못 잡는다 — 웹 실측으로 강남 1,748곳 / 강릉 116곳이라, 같은 기준을 쓰면
       **강릉엔 아무것도 안 뜬다.** 서버가 이미 뷰포트로 잘라 줬으므로(031)
       여기 있는 것이 곧 '보이는 것'이다.
     ★ 그리고 **카테고리 쿼터**를 건다. 반응 수만으로 뽑으면 맛집이 화면을 덮는다. */
  const picked = (() => {
    if (unit !== "top") return null;                 // 'all' 은 전부, 'region' 은 핀 자체가 없다
    const N = topN(zoom);
    if (pins.length <= N) return null;               // 어차피 다 보인다 — 고를 이유가 없다
    const sorted = [...pins].sort(
      (a, b) => (b.like_count - a.like_count)
             || (b.save_count - a.save_count)
             || (b.comment_count - a.comment_count));
    const quota = Math.max(2, Math.ceil(N * QUOTA_RATIO));
    const used: Record<string, number> = {};
    const out = new Set<string>();
    const spill: Pin[] = [];
    for (const p of sorted) {
      if (out.size >= N) break;
      const c = p.category ?? "etc";
      if ((used[c] ?? 0) < quota) { used[c] = (used[c] ?? 0) + 1; out.add(p.id); }
      else spill.push(p);
    }
    /* 쿼터 때문에 자리가 남으면 밀렸던 것으로 채운다 — 빈자리를 남기지 않는다 */
    for (const p of spill) { if (out.size >= N) break; out.add(p.id); }
    return out;
  })();

  /* ★ 나가기는 **되돌릴 수 없다.** 확인은 시트가 받는다 — `Alert` 는 `Modal`
     안에서 모달 뒤에 가려 **안 보인다**(실제로 안 떴다). */
  const doLeave = async (sp: API.SpaceRow) => {
    const r: any = await API.leaveSpace(sp.id);
    if (!r?.ok) { setWhy(r?.why ?? "나가지 못했습니다"); return; }
    setPickSpace(false);
    const rest = spaces.filter((x) => x.id !== sp.id);
    setSpaces(rest);
    /* 보고 있던 방에서 나갔으면 **그 화면에 머물 수 없다** — 남은 방이 하나면
       그리로, 없으면 `나의 모든 여행` 으로 돌린다. 빈 지도에 두지 않는다. */
    if (space === sp.id) {
      if (rest.length === 1) changeSpace(rest[0].id);
      else if (rest.length === 0) changeScope("mine_all");
      else { spaceRef.current = null; setSpace(null); setPins([]); setAgg([]); setPickSpace(true); }
    }
    setWhy(r.closed ? `${sp.title} 스페이스를 접었습니다`
                    : `${sp.title}에서 나왔습니다`);
  };

  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: pins
      .map((p) => toFeature({ ...p, __top: !picked || picked.has(p.id) }))
      .filter(Boolean) as GeoJSON.Feature[],
  };

  /* ★ 지오메트리를 다시 보내지 않는다. 857K 를 스코프 바꿀 때마다 브리지로 넘기면
     화면이 걸린다 — 칠할 값만 `match` 식으로 보낸다(지역 수만큼의 짧은 배열).
     ★ 많고 적음은 **경계의 진하기**로 말한다. 로그로 펴는 것은 그대로다 —
     선형으로 하면 한 곳만 도드라지고 나머지는 전부 바닥에 붙는다. */
  const strokeExpr = (() => {
    if (!region || !agg.length) return STROKE as any;
    const max = Math.max(...agg.map((a) => a.n));
    const pairs: any[] = [];
    for (const a of agg) {
      const lg = Math.log(1 + a.n) / Math.log(1 + max);
      pairs.push(a.region_code, `rgba(255,255,255,${(0.15 + opacityOf(lg) * 0.55).toFixed(3)})`);
    }
    return ["match", ["get", "code"], ...pairs, STROKE] as any;
  })();

  const widthExpr = (() => {
    if (!region || !agg.length) return 0.5 as any;
    const pairs: any[] = [];
    for (const a of agg) pairs.push(a.region_code, 1.4);
    return ["match", ["get", "code"], ...pairs, 0.5] as any;
  })();

  /* 라벨. ★ 0곳까지 숫자를 찍으면 화면이 0으로 덮인다 — 서버가 아예 안 준다(042).
     많은 곳부터 40개만 — 전국 화면에 251개를 겹쳐 찍으면 읽을 수 없는 죽이 된다. */
  const NAME: Record<string, { name: string; cx: number; cy: number; bbox: number[] }> = (() => {
    const m: any = {};
    for (const f of SGG.features as any[]) {
      m[f.properties.code] = {
        name: f.properties.name, cx: f.properties.cx, cy: f.properties.cy,
        bbox: f.properties.bbox as number[],
      };
    }
    return m;
  })();
  const labels = region
    ? [...agg].sort((a, b) => b.n - a.n).slice(0, 40)
        .map((a) => ({ ...a, ...NAME[a.region_code] }))
        .filter((a) => Number.isFinite(a.cx) && Number.isFinite(a.cy))
    : [];

  const catLabel = cat ? `${CAT[cat]?.k ?? cat} · ` : "";

  /* 시트가 나눠 센다(§13.37) — 셋은 겹치므로 합이 전체와 같지 않을 수 있다. */
  const n = { mine: 0, shared: 0, other: 0 } as Record<string, number>;
  for (const p of pins) n[p.source ?? "other"] = (n[p.source ?? "other"] ?? 0) + 1;

  return (
    <View style={st.root}>
      <View style={st.head}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={st.chipRow}>
          {SCOPES.map((c) => {
            const on = scope === c.v;
            /* 스페이스를 하나 골랐으면 **그 이름을 칩에 쓴다** — 칩이 '스페이스'라고만
               적혀 있으면 무엇으로 좁혀진 상태인지 화면 어디에도 안 적힌다. */
            const label = c.v === "shared" && on && space
              ? (spaces.find((x) => x.id === space)?.title ?? c.k)
              : c.k;
            return (
              <React.Fragment key={c.v}>
                {c.sep && <View style={st.sep} />}
                <Pressable onPress={() => changeScope(c.v)}
                           style={[st.chip, on && st.chipOn]}>
                  <Text style={[st.chipT, on && st.chipTOn]} numberOfLines={1}>
                    {label}{c.v === "shared" && spaces.length > 1 ? " ▾" : ""}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </ScrollView>
        {/* ★ 두 줄을 **한 줄로 합치지 않는다.** '내 지도'와 '맛집'은 서로 다른 질문이라
            (누구의 것인가 / 무엇인가) 한 줄에 섞으면 둘이 배타적인 것처럼 보인다. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={st.chipRow}>
          {CATS.map((c) => {
            const on = cat === c.v;
            return (
              <Pressable key={c.v ?? "all"} onPress={() => changeCat(c.v)}
                         style={[st.chip2, on && st.chip2On,
                                 on && c.v ? { borderColor: CAT[c.v]?.c } : null]}>
                {!!c.v && <View style={[st.chipDot, { backgroundColor: CAT[c.v]?.c }]} />}
                <Text style={[st.chip2T, on && st.chip2TOn]}>{c.k}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Map ref={mapRef} style={st.fill} mapStyle={EMPTY_STYLE}
           onPress={(e) => { void onMapPress(e); }}
           onLayout={(e) => {
             const { width, height } = e.nativeEvent.layout;
             if (width > 0 && height > 0) size.current = { w: width, h: height };
           }}
           onRegionDidChange={(e) => {
             const z = (e as any)?.nativeEvent?.zoom;
             if (typeof z === "number") setZoom(z);
             /* ★ 전국 줌으로 **나가면** 지역 표시를 푼다. 안 풀면 전국을 보는데
                한 지역 이름이 남아 있다. ★ 이 검사는 **움직임이 끝난 뒤**에만 한다 —
                매 프레임 보면 들어가는 애니메이션 도중 아직 전국 줌이라 즉시 풀린다
                (웹에서 겪은 것). `onRegionDidChange` 가 바로 그 시점이다. */
             if (typeof z === "number" && isRegionZoom(z)) setInto(null);
             void load(false, scope, z);
           }}>
        {/* ★ 줌 숫자가 아니라 **담을 범위**로 말한다. `zoom: 5.6` 은 벤치마크 화면에서
            물려받은 값인데, 그 숫자가 "전국이 보인다"를 뜻하는지는 기기 크기와
            배경 데이터에 따라 달라진다 — 실제로 경계 파일을 바꾸자 전국이 잘렸다.
            bounds 는 의도 그 자체라 흔들리지 않는다. */}
        <Camera ref={camRef} initialViewState={{ bounds: [124.4, 32.9, 132.2, 38.7] }} />

        <GeoJSONSource id="sgg" data={SGG as any}>
          <Layer id="region-base" type="fill" paint={{ "fill-color": LAND }} />
          {/* ★ **끼웠다 뺐다 하지 않는다.** 조건부로 렌더하면 줌 단위가 바뀔 때
              형제 위치가 밀려 다음 레이어의 `id` 가 바뀐 것으로 잡히고,
              라이브러리가 `id cannot be changed` 로 **앱을 죽인다**(실제로 죽었다).
              같은 레이어를 두고 **paint 만** 바꾼다 — paint 는 바꿔도 된다. */}
          <Layer id="region-line" type="line"
                 paint={{ "line-color": strokeExpr, "line-width": widthExpr }} />
        </GeoJSONSource>

        {/* 집계 줌에서는 핀을 내린다 — 둘 다 "이 카페가 어디냐"에 답하는 것들이다 */}
        {labels.map((l) => (
          <Marker key={l.region_code} lngLat={[l.cx, l.cy]}>
            <View style={st.lab}>
              <Text style={st.labN}>{l.name}</Text>
              <Text style={st.labC}>{l.n}곳</Text>
            </View>
          </Marker>
        ))}

        <GeoJSONSource id="pins" data={(region ? EMPTY_FC : fc) as any}>
          {/* ★ 밀린 핀을 **지우지 않는다.** 지우면 "이 동네엔 이것뿐"으로 읽히는데
              사실이 아니다 — 작고 흐리게 두면 *"더 있다, 확대하면 보인다"* 가 된다.
              레이어는 그대로 두고 **paint 만** 바꾼다(끼웠다 빼면 앱이 죽는다). */}
          <Layer id="pin-halo" type="circle"
                 paint={{
                   "circle-radius": ["case", ["==", ["get", "top"], 1], 8, 4] as any,
                   "circle-color": "#000",
                   "circle-opacity": ["case", ["==", ["get", "top"], 1], 0.35, 0.18] as any,
                 }} />
          <Layer id="pin-dot" type="circle"
                 paint={{
                   "circle-radius": ["case", ["==", ["get", "top"], 1], 5, 2.5] as any,
                   "circle-color": ["get", "color"] as any,
                   "circle-opacity": ["case", ["==", ["get", "top"], 1], 1, 0.5] as any,
                   "circle-stroke-width": ["case", ["==", ["get", "top"], 1], 1.5, 0] as any,
                   "circle-stroke-color": "rgba(255,255,255,0.85)",
                 }} />
        </GeoJSONSource>
      </Map>

      {pickSpace && (
        <SpacePicker
          spaces={spaces} current={space}
          onPick={changeSpace}
          onClose={() => setPickSpace(false)}
          onLeave={(sp) => { void doLeave(sp); }}
          onAdd={() => { setPickSpace(false); onAdd?.(); }} />
      )}

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
        ) : region ? (
          <Text style={st.count}>
            {agg.length
              ? `${catLabel}${agg.length}개 지역 · ${agg.reduce((n, a) => n + a.n, 0)}곳 — 확대하면 기록이 보입니다`
              : cat ? `${CAT[cat]?.k ?? cat} 기록이 아직 없습니다` : "아직 기록이 없습니다"}
          </Text>
        ) : pins.length === 0 ? (
          <Text style={st.count}>
            {into ? `${into} — ` : ""}
            {/* ★ 카테고리를 켜 둔 채 비면 **그 사실을 말한다.** 안 그러면
                "이 동네엔 아무것도 없다"로 읽히는데, 사실은 필터가 걸러낸 것이다. */}
            {cat ? `이 화면에는 ${CAT[cat]?.k ?? cat} 기록이 없습니다`
              : scope === "mine" ? "이 화면에는 내가 올린 기록이 없습니다"
              : scope === "shared" ? "이 화면에는 공유 스페이스 기록이 없습니다"
              : "이 화면에는 아직 기록이 없습니다"}
          </Text>
        ) : (
          <Text style={st.count}>
            {into ? <Text style={st.into}>{into}  </Text> : null}
            {[
              n.mine ? `내 것 ${n.mine}곳` : null,
              n.shared ? `함께 ${n.shared}곳` : null,
              n.other ? `남 ${n.other}곳` : null,
            ].filter(Boolean).join(" · ")}
            {/* ★ 가운데 단계에서는 **골랐다는 것을 말한다.** 안 말하면 흐린 점이
                버그로 보이고, 사용자는 왜 어떤 것만 진한지 알 수 없다. */}
            {picked ? `  · 눈에 띄는 ${picked.size}곳` : ""}
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

/* ── 공유 스페이스 고르기 (§13.55 · §13.57) ─────────────────────
   ★ **`전체`를 없앴다.** `나의 모든 여행`이 이미 *내 것 + 공유 전부* 를 담으므로
     `공유 스페이스 > 전체` 는 *"공유는 전부인데 내 개인 기록만 빼고"* 라는 아주
     드문 상태다. 있으나 마나 한 칸은 고르는 일만 한 번 더 시킨다.
     → **방을 하나 고르는 화면**이 된다. 방이 하나뿐이면 묻지 않고 그걸 쓴다.

   ★ 드롭다운이 아니라 **바닥에서 올라오는 시트**인 이유: 칩이 화면 맨 위에 있어
     거기 붙은 드롭다운은 한 손으로 닿지 않는다. 그리고 방은 **이름만으로는
     못 고른다** — 멤버 수·기록 수·나가기가 한 줄에 같이 있어야 한다.
     드롭다운에는 그 자리가 없다. */
function SpacePicker(
  { spaces, current, onPick, onClose, onLeave, onAdd }: {
    spaces: API.SpaceRow[];
    current: string | null;
    onPick: (id: string) => void;
    onClose: () => void;
    onLeave: (sp: API.SpaceRow) => void;
    onAdd: () => void;
  },
) {
  /* 어느 방의 나가기를 묻는 중인가. 한 번에 하나만 열린다. */
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.spDim} onPress={onClose}>
        <Pressable style={st.spSheet} onPress={() => {}}>
          <View style={st.spGrip} />

          {!spaces.length ? (
            /* ★ 빈 화면에서 **할 일을 준다.** "없습니다"만 적으면 사용자는
               여기서 막힌다 — 무엇을 해야 생기는지는 우리가 안다. */
            <>
              <Text style={st.spTitle}>공유한 추억이 없습니다</Text>
              <Text style={st.spEmpty}>
                여행 사진·동영상을 올리고 지인을 초대해 보십시오.{"\n"}
                같이 다녀온 사람과 한 장의 지도를 채우게 됩니다.
              </Text>
              <Pressable style={st.spCta} onPress={onAdd}>
                <Text style={st.spCtaT}>사진·동영상 올리기</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={st.spTitle}>어느 공유 스페이스를 볼까요</Text>
              <ScrollView style={{ maxHeight: 360 }}>
                {spaces.map((sp) => {
                  const on = current === sp.id;
                  const asking = confirm === sp.id;
                  const last = sp.members <= 1;
                  return (
                    <View key={sp.id} style={[st.spRow, on && st.spRowOn,
                                              asking && st.spRowAsk]}>
                      <View style={st.spRowTop}>
                        <Pressable style={{ flex: 1 }}
                                   onPress={() => (asking ? setConfirm(null) : onPick(sp.id))}>
                          <Text style={[st.spRowT, on && st.spRowTOn]}>{sp.title}</Text>
                          {/* 빈 방과 쌓인 방은 다른 것이다 — **고르기 전에** 말한다 */}
                          <Text style={st.spRowS}>
                            멤버 {sp.members}명 · {sp.pins ? `기록 ${sp.pins}곳` : "아직 기록 없음"}
                          </Text>
                        </Pressable>
                        {!asking && (
                          /* ★ 글자에 `hitSlop` 만 주면 **48pt 최소 터치 영역**에 못 미치고,
                             ScrollView 안에서는 작은 목표가 스크롤로 먹힌다. 실제로
                             안 눌렸다 — 여백을 넣어 버튼을 **진짜 크기로** 만든다. */
                          <Pressable style={st.spLeaveBtn}
                                     onPress={() => setConfirm(sp.id)}>
                            <Text style={st.spLeave}>나가기</Text>
                          </Pressable>
                        )}
                      </View>

                      {/* ★ 확인을 **시트 안에서** 받는다. `Alert` 는 `Modal` 안에서
                          모달 뒤에 가려 안 보인다(실제로 안 떴다). 그리고 여기서
                          물으면 **어느 방인지 보면서** 읽게 된다. */}
                      {asking && (
                        <View style={st.spAsk}>
                          <Text style={st.spAskT}>
                            {last
                              ? "마지막 멤버라 이 스페이스는 사라집니다."
                              : `남은 ${sp.members - 1}명은 그대로 보게 됩니다.`}
                            {"\n"}올리신 기록은 남습니다 — 같이 다녀온 여행이라
                            지우면 그분들 지도에 구멍이 납니다.
                          </Text>
                          <View style={st.spAskRow}>
                            <Pressable style={st.spAskBtn} onPress={() => setConfirm(null)}>
                              <Text style={st.spAskBtnT}>그만두기</Text>
                            </Pressable>
                            <Pressable style={[st.spAskBtn, st.spAskGo]}
                                       onPress={() => { setConfirm(null); onLeave(sp); }}>
                              <Text style={[st.spAskBtnT, st.spAskGoT]}>나가기</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </>
          )}

          <Pressable style={st.spCancel} onPress={onClose}>
            <Text style={st.spCancelT}>닫기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  head: { paddingTop: 52, paddingBottom: 8, gap: 6, backgroundColor: BG },
  chipRow: { paddingHorizontal: 12, gap: 6 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 99,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
  },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipT: { color: C.muted, fontSize: 12 },
  chipTOn: { color: C.onAccent, fontWeight: "700" },
  /* ★ 카테고리 칩은 **accent 로 채우지 않는다.** 스코프 줄이 이미 accent 를 쓰고
     있어서 둘 다 파랗게 차면 어느 줄이 무엇인지 구분이 안 된다. 여기서는 그
     카테고리 **자기 색**으로 테두리만 준다 — 지도 위의 점과 같은 색이라
     "이 색을 고른 것"이 바로 읽힌다. */
  chip2: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99,
    borderWidth: 1, borderColor: "transparent", backgroundColor: "rgba(255,255,255,0.05)",
  },
  chip2On: { backgroundColor: C.surface, borderColor: C.line },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chip2T: { color: C.muted, fontSize: 12 },
  chip2TOn: { color: C.text, fontWeight: "700" },
  /* ★ `모두의 지도` 앞의 금. 필터가 아니라 **모드 전환**이라는 표시다. */
  sep: { width: 1, alignSelf: "stretch", marginHorizontal: 3, backgroundColor: C.line },
  spDim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  spSheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 34, gap: 8,
  },
  spGrip: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: C.line,
    alignSelf: "center", marginBottom: 6,
  },
  spTitle: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  spRow: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: "transparent",
  },
  spRowOn: { borderColor: C.accent },
  spRowT: { color: C.text, fontSize: 15 },
  spRowTOn: { fontWeight: "700" },
  spRowS: { color: C.muted, fontSize: 12, marginTop: 3 },
  spCancel: { alignItems: "center", paddingVertical: 12 },
  spCancelT: { color: C.muted, fontSize: 14 },
  spEmpty: { color: C.muted, fontSize: 13, lineHeight: 21, paddingVertical: 6 },
  spCta: { backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15,
           alignItems: "center", marginTop: 10 },
  spCtaT: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  spLeaveBtn: { paddingVertical: 14, paddingLeft: 16, paddingRight: 2,
                justifyContent: "center" },
  spLeave: { color: C.muted, fontSize: 13 },
  spRowTop: { flexDirection: "row", alignItems: "center" },
  spRowAsk: { borderColor: C.warn },
  spAsk: { marginTop: 12, gap: 10 },
  spAskT: { color: C.muted, fontSize: 12, lineHeight: 19 },
  spAskRow: { flexDirection: "row", gap: 8 },
  spAskBtn: { flex: 1, alignItems: "center", paddingVertical: 11,
              borderRadius: 10, backgroundColor: "rgba(255,255,255,0.07)" },
  spAskBtnT: { color: C.text, fontSize: 14 },
  spAskGo: { backgroundColor: "rgba(224,169,74,0.18)" },
  spAskGoT: { color: C.warn, fontWeight: "700" },
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
  into: { color: C.text, fontWeight: "700" },
  hidden: { opacity: 0 },
  lab: { alignItems: "center" },
  labN: { color: "rgba(255,255,255,0.92)", fontSize: 10, fontWeight: "600" },
  /* 방문 수는 `visited` 다 — accent 는 버튼·선택 상태에만 쓴다(팔레트 규칙) */
  labC: { color: C.visited, fontSize: 11, fontWeight: "700" },
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
