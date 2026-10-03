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
import * as API from "../api";
import { whereAmI, watchHere, watchHeading, type Here } from "../live";
import { MapSheet, SHEET_PEEK, SHEET_BOTTOM, SHEET_HALF, type Snap } from "../MapSheet";
import { PlaceSheet } from "../PlaceSheet";
import { sawCover, openedCover, researchedCover, flushCovers } from "../coverLog";
import { MapSearch, type Hit } from "../MapSearch";
import { dur, ymd } from "../course";
import { C, CAT } from "../theme";
import { splitMapSaves } from "../mapSaves";
import { zoomForBBox, padPinBox, unionBox, fitView } from "../fitBox";
import { pickNearest, TAP_SLOP, type Cand } from "../tapPick";
import { metersPerPx, pickScale } from "../scaleBar";

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
/* ★ 상호는 **가까이서만** 켠다(§13.60). 멀리서 켜면 글자가 죽이 되고,
   그 줌에서 답해야 하는 질문(*어느 지역에 많나*)과도 어긋난다. */
const Z_PLACES = 14;
/* ★ 표지 카드(사진 + 이름)를 켜는 줌. 상호 이름보다 **한 칸 더 가까이** 간다 —
   카드는 무겁고(이미지) 자리를 많이 차지해서, 이름이 먼저 나오고 그다음이 사진이다. */
const Z_CARDS = 15;
/* ★ 몇 장이나. 네이버도 전부 안 띄운다. 8장이면 @3x 로 썸네일 8장이라
   `thumb_url`(480px, §13.58)이 있어야 감당된다. */
const MAX_CARDS = 8;
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

/* ★ 정확도 원을 **미터 그대로** 그린다. `circle-radius` 는 **픽셀**이라 줌을
   바꾸면 원이 따라 커지지 않는다 — 그러면 "이만큼 오차가 있다"가 아니라
   그냥 장식이 된다. 폴리곤으로 그리면 땅에 붙어서 줌과 같이 움직인다.
   ★ 위도에 따라 경도 1도의 길이가 달라지므로 `cos(lat)` 로 나눈다. */
function accuracyRing(h: Here, steps = 40): GeoJSON.FeatureCollection {
  const dLat = h.accM / 111_320;
  const dLng = h.accM / (111_320 * Math.cos((h.lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([h.lng + dLng * Math.cos(t), h.lat + dLat * Math.sin(t)]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {},
                 geometry: { type: "Polygon", coordinates: [ring] } }],
  };
}

/* ★ **탐침 2 — 벡터 타일**(§13.59).
   탐침 1(래스터)은 *"타일을 깔면 우리 레이어 밑에 들어간다"* 만 확인했다. 그런데
   래스터는 **이미 그려진 그림**이라 색도 글꼴도 밀도도 우리가 못 바꾼다 —
   그대로 깔면 "부동산 벽에 붙은 지도"가 된다.
   벡터는 우리가 **디자인을 정한다.** 그게 네이버처럼 보이게 하는 유일한 길이다.

   ★ OpenFreeMap: 키 없음 · 무료 · **상업 이용 가능** · MIT · OSM 기반.
     `dark` 스타일이 있다. 브이월드와 달리 *"영리 목적은 동의 필요"* 같은 조항이 없다. */
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/dark";

/* ★ **한글을 앞에 세운다.** 이 스타일은 `name:latin` 을 먼저 쓰고 비라틴을 뒤에
   붙인다(실측: `name:latin` 12곳, `name:ko` 0곳). 그래서 확대하면 도로가
   **BANSONG-RO** 로 보인다 — 한국 사용자에게 그건 읽는 것이 아니라 푸는 것이다.
   ★ 스타일을 **받아서 고쳐 쓴다.** URL 그대로 넘기면 손댈 수가 없다.
     받아 오지 못하면 URL 을 그대로 쓴다 — 지도가 아예 안 뜨는 것보다 낫다. */
function koreanFirst(style: any) {
  for (const l of style?.layers ?? []) {
    if (l.type !== "symbol") continue;
    const tf = l.layout?.["text-field"];
    if (!tf) continue;
    /* `name` 은 OSM 의 현지 표기라 한국에서는 대개 한글이다.
       셋 다 없으면 라틴으로 떨어뜨린다 — 빈 라벨보다 낫다. */
    l.layout["text-field"] = [
      "coalesce", ["get", "name:ko"], ["get", "name"], ["get", "name:latin"],
    ];
  }

  /* ── ★ **산이 보여야 한다** (§13.95) ──────────────────────────────
     이 스타일은 `mountain_peak` 을 **한 겹도 안 그린다** — 그런데 타일에는
     들어 있다(`vector_layers` 에 있다). 네이버에서 위치가 바로 읽히는 이유의
     절반이 산 이름이다(금정산·백양산·승학산). 없는 데이터를 지어내는 것이
     아니라 **안 그리고 있던 것을 그린다.** */
  const i = style.layers.findIndex((l: any) => l.id === "place_other");
  const peak = {
    id: "mountain-peak", type: "symbol", source: "openmaptiles",
    "source-layer": "mountain_peak",
    minzoom: 8,
    /* ── ★ 무엇을 버릴지는 **세어 보고** 정했다 (§13.96) ──────────────
       처음엔 `rank <= 3` 으로 걸렀다. *"rank 가 낮을수록 중요한 봉우리"* 라고
       적어 놓고 **확인은 안 했다.** 전국 타일에서 1,448개를 뽑아 세 보니:

         rank 1:307 · 2:297 · 3:282 · 4:291 · 5:271   ← **거의 균등**

       `rank` 는 전역 중요도가 아니라 **타일 안의 라벨 우선순위**다. 즉 그 필터는
       중요도와 **무관하게 40%를 버리고** 있었다 — 한라산이 남고 뒷산이 사라지는
       것이 아니라 그냥 아무거나 사라졌다.

       ★ 진짜 신호는 **고도**다. `ele` 가 **98.8%**(1,192/1,206)에 들어 있다:
         1000m+ 237 · 500~1000 466 · 300~500 231 · ~300 258
         (가장 높은 쪽: 한라산 1947 · 중봉 1875 · 제석봉 1814)
       → 줌에 따라 **고도로** 자른다. 멀리서는 큰 산만, 가까이서는 뒷산까지.

       ★ 이름으로 거르는 것은 **정확히 일치할 때만**이다. `삼각점`(218m)은 측량점이
       맞지만, 산 이름이 아닌 198개는 대부분 **제주 오름**(가시오름·거문오름·
       윗세오름)이라 이름 모양으로 거르면 진짜 지명이 날아간다.
       `삼각점봉`(175m)은 남긴다 — 봉우리 이름일 수 있고, 어차피 고도에서 걸린다. */
    filter: ["all",
      ["has", "name"],
      /* 측량점 — 전국에 한 개뿐이지만 화면에 뜨면 산 이름 자리를 차지한다 */
      ["match", ["coalesce", ["get", "name:ko"], ["get", "name"], ""],
                ["삼각점", "수준점", "기준점"], false, true],
      /* 고도를 모르는 1.2% 는 0 으로 떨어뜨린다 — 모르는 것을 높다고 치지 않는다 */
      [">=", ["coalesce", ["get", "ele"], 0],
             ["step", ["zoom"], 1000, 10, 500, 12, 200, 13, 0]],
    ],
    layout: {
      "text-field": ["coalesce", ["get", "name:ko"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 12, 12.5],
      "text-anchor": "top", "text-offset": [0, 0.5],
      "text-max-width": 6, "text-padding": 4,
      /* ★ 겹칠 때 **높은 산이 이긴다.** 정렬 키는 작을수록 먼저라 고도를 뒤집는다 —
         예전에는 `rank` 로 정렬해, 무엇이 살아남는지가 사실상 무작위였다. */
      "icon-image": "", "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]],
    },
    paint: {
      "text-color": "rgba(150,196,160,0.95)",      // 산은 **초록 글씨**로 — 상호와 안 헷갈린다
      "text-halo-color": "rgba(0,0,0,0.9)", "text-halo-width": 1.3,
    },
  };
  style.layers.splice(i < 0 ? style.layers.length : i, 0, peak);

  /* ── ★ **강과 숲에 색을 준다** (§13.95) ───────────────────────────
     레이어는 처음부터 있었는데 **색이 배경과 같아서 안 보였다**(실측):
       · `waterway`      line-color `rgb(27,27,29)`  ← 배경 `rgb(12,12,12)`·땅 `#282B36`
       · `water`         fill-color `rgb(27,27,29)`
       · `landcover_wood` 불투명도가 **z8 에서 0**, 색은 `rgb(32,32,32)`
     즉 순서를 고쳐 위로 올려도 **보일 색이 아니었다.** 강은 선 하나로 방향을
     잡게 해 주는 가장 센 단서다 — 낙동강이 보이면 "강 건너 김해"가 즉시 읽힌다. */
  for (const l of style.layers) {
    if (l.id === "water") {
      l.paint = { ...l.paint, "fill-color": "#0F1A26" };     // 바다·호수: 땅보다 어둡고 **푸르게**
    } else if (l.id === "waterway") {
      l.paint = {
        "line-color": "rgba(104,152,196,0.85)",
        /* 줌에 따라 굵기를 준다 — 원래는 굵기 지정이 없어 1px 고정이었다 */
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 10, 1.3, 14, 2.6],
      };
      l.minzoom = 5;
    } else if (l.id === "landcover_wood" || l.id === "landuse_park") {
      /* ★ `fill-pattern`(스프라이트)을 **뺀다.** 패턴이 없으면 면이 통째로
         안 그려진다 — 색 하나가 더 믿을 만하다. */
      l.paint = {
        "fill-color": "#1C2A22",                              // 산·공원: 초록 기운
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 10, 0.7, 14, 0.5],
      };
      l.minzoom = 5;
    }
  }
  return style;
}

type Pin = {
  id: string;
  lng: number;
  lat: number;
  category: string | null;
  source: string | null;
  memo: string | null;
  /** ★ 서버는 처음부터 줬는데 앱이 버리고 있었다(§13.69). 표지 로그의 키다. */
  place_id: string | null;
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
  { ready, onSheet, onAdd, onSheetHeight, jumpSpace, onJumped,
    onCenter, jumpTo, onJumpedTo }: {
    ready?: boolean;
    onSheet?: (open: boolean) => void;
    /** 빈 화면의 CTA — (+) 와 **같은 문**으로 보낸다(두 벌로 만들지 않는다) */
    onAdd?: () => void;
    /** 바텀시트가 지금 몇 pt 인가 — (+) 가 그 위에 앉는다(§13.66 A안) */
    onSheetHeight?: (h: number) => void;
    /** 스페이스 탭에서 *"지도 ›"* 를 눌렀다 — 그 방으로 맞춘다(§13.67) */
    jumpSpace?: string | null;
    onJumped?: () => void;
    /** ★ 지금 보고 있는 자리. `갈 곳` 의 *"여기서 가까운"* 이 이 값을 쓴다(§13.74) */
    onCenter?: (c: { lng: number; lat: number }) => void;
    /** `갈 곳` 에서 카드를 눌렀다 — 그 장소로 날아간다 */
    jumpTo?: { lng: number; lat: number; name: string } | null;
    onJumpedTo?: () => void;
  } = {},
) {
  const mapRef = useRef<MapRef>(null);
  /* 받아서 고친 배경 스타일. null 이면 아직 못 받았다 — 그동안 지도를 안 그린다
     (`mapStyle` 을 나중에 바꾸면 지도가 통째로 다시 만들어진다). */
  const [style, setStyle] = useState<any>(null);
  const [scope, setScope] = useState<API.Scope>("mine_all");
  const [cat, setCat] = useState<string | null>(null);
  /* 고른 스페이스 하나. null 이면 스코프 전체다. */
  const [space, setSpace] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<API.SpaceRow[]>([]);
  const [places, setPlaces] = useState<API.PlaceRow[]>([]);
  /* ★ 저장한 곳(§13.104). **뷰포트를 따라다니지 않는다** — 상호(`places`)는
     *"이 화면에 뭐가 있나"* 라 화면이 바뀌면 다시 묻지만, 저장은 *"내가 어디를
     찜해 뒀나"* 라 화면과 무관하다. 한 번 읽고, 저장이 바뀔 때만 다시 읽는다. */
  const [saves, setSaves] = useState<API.SaveRow[]>([]);
  const [here, setHere] = useState<Here | null>(null);
  const [locating, setLocating] = useState(false);
  const [snap, setSnap] = useState<Snap>("peek");
  const [sheetH, setSheetH] = useState(SHEET_PEEK);
  const [facing, setFacing] = useState<number | null>(null);
  /* ★ 지도는 두 손가락으로 **돌아간다**(touchRotate 기본값). 화살표는 화면 기준으로
     도는 RN 뷰라, 지도를 돌리면 북쪽이 옮겨간 만큼 **그대로 틀어진다**(§13.78).
     나침반 각도에서 지도 방위를 빼야 화면에서 맞는 쪽을 가리킨다. */
  const [bearing, setBearing] = useState(0);
  const stopWatch = useRef<null | (() => void)>(null);
  const stopHeading = useRef<null | (() => void)>(null);
  /* ★ 카드를 누르면 `Marker` 가 먼저 열고, **지도의 press 가 곧바로 닫는다** —
     카드 자리에는 핀 점이 없어서(카드로 뽑힌 핀은 점을 끈다) 빈 곳을 누른 것으로
     읽히기 때문이다. 방금 카드를 눌렀으면 지도 쪽은 **아무것도 하지 않는다.** */
  const cardTapAt = useRef(0);
  useEffect(() => () => { stopWatch.current?.(); stopHeading.current?.(); }, []);
  const [pickSpace, setPickSpace] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [open, setOpen] = useState<Pin | null>(null);
  /* ★ **장소** 상세 (§13.91). 핀 상세(`open`)와 **다른 것**이다 — 핀은 기록 하나,
     이건 자리 하나. 지금까지 지도의 상호 점과 이름은 **눌러도 아무 일이 없었다**:
     표지 카드는 전부 핀이라(§13.63) 핀이 없는 장소는 눌 곳 자체가 없었고,
     `갈 곳` 에서 날아와도(§13.74) 도착해서 열 것이 없었다. */
  const [openPlace, setOpenPlace] = useState<{ id: string; name: string } | null>(null);
  /* ★ 지도 위에 떠 있는 것들의 높이를 **잰다**(§13.95). 상수로 박으면 칩이 한 줄
     늘거나 글꼴이 바뀔 때 조용히 틀어진다 — 그러면 "다 보인다"는 약속이 깨진다. */
  const [headH, setHeadH] = useState(116);
  /* ★ 축척 막대가 쓸 **보고 있는 위도**(§13.99). 메르카토르라 같은 줌이라도
     위도에 따라 1픽셀이 덮는 거리가 다르다 — 제주와 강원이 다르다. */
  const [atLat, setAtLat] = useState(36.3);
  /* 검색이 펼쳐졌는가 — 결과 목록이 칩 줄을 덮으므로 그동안 칩을 감춘다 */
  const [searching, setSearching] = useState(false);
  /* 서버에 보낼 기준점. 반경 안을 먼저 보게 해 빠르고 가까운 것을 준다(§13.100) */
  const [atLng, setAtLng] = useState(127.8);
  const [zoom, setZoom] = useState(5.6);
  const [agg, setAgg] = useState<API.RegionAgg[]>([]);
  const [into, setInto] = useState<string | null>(null);   // 들어온 지역 이름
  const camRef = useRef<CameraRef>(null);
  const size = useRef({ w: 402, h: 700 });
  /* ★ 장소 상세도 (+) 를 감춰야 한다. 전면 화면이라 안 감추면 (+) 가 **상세
     위에** 떠서 닫기 버튼 옆에 엉뚱한 버튼이 하나 더 있는 모양이 된다. */
  useEffect(() => { onSheet?.(!!open || !!openPlace); }, [open, openPlace]);
  /* 열었다 = 관심이다. **누를 때마다** 센다(노출과 달리 한 번만이 아니다). */
  useEffect(() => { if (open) openedCover(open.place_id); }, [open?.id]);

  /* ★ 모아 둔 것을 **주기적으로** 보낸다. 누를 때마다 보내면 통신이 잦고,
     화면을 떠날 때만 보내면 앱이 그대로 죽는 경우를 놓친다.
     ★ 보내지 못하면 **버리지 않고 남긴다** — 그 노출은 다시 만들 수 없다. */
  useEffect(() => {
    const t = setInterval(() => { void flushCovers(); }, 60_000);
    return () => { clearInterval(t); void flushCovers(); };
  }, []);

  useEffect(() => {
    let live = true;
    fetch(BASEMAP_STYLE)
      .then((r) => r.json())
      .then((j) => { if (live) setStyle(koreanFirst(j)); })
      .catch(() => { if (live) setStyle(BASEMAP_STYLE); });   // 못 고쳐도 깔기는 한다
    return () => { live = false; };
  }, []);

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
  /* ★ 상호는 **자기 상자를 따로 기억한다.** 핀과 같이 묶어 두면, 핀 쪽이
     *"이미 덮인 상자다"* 로 일찍 빠져나갈 때 상호도 같이 못 읽는다 —
     확대만 하는 동안 상호가 **영영 안 뜬다**(실제로 그랬다, §13.60).
     핀은 줌이 바뀌어도 같은 집합이지만 상호는 **줌으로 켜고 끈다.** 기준이
     다르면 상자도 따로 가져야 한다. */
  const placesBox = useRef<{ box: API.BBox | null; cat: string | null }>(
    { box: null, cat: null });

  const load = useCallback(async (force: boolean, sc: API.Scope, z?: number) => {
    const ct = catRef.current, sp = spaceRef.current;
    if (inflight.current) return;
    /* ★ 집계 줌에서는 핀을 **안 읽는다.** 전국 한 화면이 상자가 되면
       "뷰포트로 자른다"가 아무것도 자르지 않는 말이 된다(031). */
    if (isRegionZoom(z ?? zoom)) {
      setPins([]);
      loaded.current = { box: null, scope: sc, cat: ct, space: sp }; return;
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
      place_id: row.place_id ?? null,
      media_url: row.media_url, media_thumb: row.media_thumb ?? row.media_url,
      media_w: row.media_w ?? null, media_h: row.media_h ?? null,
      visited_at: row.visited_at ?? null, stay_sec: row.stay_sec ?? null,
      verification: row.verification ?? null, is_public: !!row.is_public,
      comment_count: row.comment_count ?? 0,
      like_count: row.like_count ?? 0, save_count: row.save_count ?? 0,
    })).filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)));
  }, []);

  /* 화면 안의 상호. 줌이 낮으면 걷어낸다. */
  const loadPlaces = useCallback(async (z: number) => {
    if (z < Z_PLACES) {
      placesBox.current = { box: null, cat: null };
      setPlaces((prev) => (prev.length ? [] : prev));
      return;
    }
    const b = await mapRef.current?.getBounds().catch(() => null);
    if (!b) return;
    const view: API.BBox = { w: b[0], s: b[1], e: b[2], n: b[3] };
    const ct = catRef.current;
    if (placesBox.current.cat === ct && inside(view, placesBox.current.box)) return;
    const box = API.padBox(view);
    const r = await API.placesInBBox(box, { limit: 60, cat: ct });
    if (!r.ok) return;
    placesBox.current = { box, cat: ct };
    setPlaces(r.data ?? []);
  }, []);

  /* 저장한 곳. ★ **좌표를 안 준다** — 지도는 거리를 모르고, 여기서 새로 재면
     `갈 곳` 카드와 같은 곳을 다르게 말한다(§13.34). 서버는 거리를 비워서 준다.
     ★ 한도를 넉넉히 준다. 묶음(24개)은 *"최근에 찜한 것"* 을 보여 주는 자리지만
       지도는 **빠진 것이 보이면 안 된다** — 한 곳이라도 안 그려지면 사용자는
       *"저장이 안 됐나"* 로 읽는다. */
  const loadSaves = useCallback(async () => {
    const r = await API.mySaves(null, null, 500);
    if (r.ok) setSaves(r.data ?? []);
  }, []);
  useEffect(() => { void loadSaves(); }, [loadSaves]);

  /* ★ 집계는 **스코프가 바뀔 때만** 읽는다. 화면을 밀어도 다시 읽지 않는다 —
     숫자가 뷰포트와 무관하니 다시 읽을 이유가 없다(042). */
  /* ★ **늦게 온 답이 새 답을 덮는다.** 열자마자 `mine_all` 집계가 나가는데, 그
     사이에 칩을 누르면 `shared`(0곳)가 먼저 돌아오고 **느린 `mine_all` 이 나중에
     도착해 덮어쓴다.** 화면은 `스페이스` 인데 숫자는 내 기록이 되는, 조용하고
     재현이 어려운 거짓말이다(§13.55 에서 실제로 잡았다).
     → 요청마다 번호를 붙이고 **마지막 것만** 받는다. 핀 쪽은 `loaded.current` 가
       우연히 막아 주지만 집계에는 그런 것이 없었다. */
  const aggSeq = useRef(0);

  /**
   * 찾은 것을 **연다** (§13.101)
   *
   * ★ 지역과 장소는 가는 곳이 다르다. 지역은 *"거기 뭐가 있나"* 라 **상자로** 가고,
   *   장소는 *"저기"* 라 **그 점으로** 간 다음 상세를 연다.
   * ★ 장소를 열 때 **재검색 신호**를 보낸다(§13.9 규칙 3). 그 판정(보여 준 적
   *   있는가 · 30분 안인가)은 `coverLog` 가 한다 — 여기서 또 판단하지 않는다.
   */
  const pickHit = async (h: Hit) => {
    if (h.kind === "region") {
      const r = NAME[h.id];
      const box = r?.bbox;
      if (!box) return;
      const v = fitView(box, size.current.w, size.current.h,
                        { top: headH, bottom: SHEET_BOTTOM + SHEET_PEEK }, false);
      camRef.current?.flyTo({ center: v.center, zoom: v.zoom, duration: 700 });
      setInto(r.name);
      return;
    }
    /* ★ **먼저 날아가고** 상세를 연다. 닫았을 때 그 자리에 있어야 *"찾아간 것"* 이다 */
    camRef.current?.flyTo({ center: [h.lng, h.lat], zoom: Z_CARDS, duration: 700 });
    researchedCover(h.id);
    setOpen(null);
    setOpenPlace({ id: h.id, name: h.name });
  };

  /* ★ 집계가 가진 **상자들을 합쳐** 그 위로 날아간다(§13.67). 스페이스 탭에서
     *"지도 ›"* 를 눌렀을 때 전국 화면에 떨어지면 *"함께 채운 지도"* 가 아니라
     그냥 지도다 — 무엇을 채웠는지 보여 주려고 온 길이다. */
  const flyToAgg = (rows: API.RegionAgg[]) => {
    const box = unionBox(rows);
    if (!box) return;
    const pad = padPinBox(box);
    /* ★ **가려지는 만큼 빼고** 맞춘다(§13.95). 화면 전체로 맞추면 상자의 위아래 끝이
       상단 칩과 바텀시트 **밑으로 들어간다** — 실제로 맨 아래 지역이 시트에 반쯤
       가렸다. 줌과 중심은 **한 쌍**이라 같이 옮긴다(`fitView` 주석 참고). */
    const v = fitView(pad, size.current.w, size.current.h,
                      { top: headH, bottom: SHEET_BOTTOM + SHEET_PEEK }, true);
    camRef.current?.flyTo({ center: v.center, zoom: v.zoom, duration: 700 });
  };

  const loadAgg = useCallback(async (sc: API.Scope, ct: string | null,
                                    sp: string | null = null,
                                    onRows?: (rows: API.RegionAgg[]) => void) => {
    const seq = ++aggSeq.current;
    /* ★ 집계도 **같은 필터로** 센다. 필터를 무시하고 전체를 세면 '맛집'을 켜고
       전국으로 나가도 지도가 안 변한다 — 그러면 *"맛집이 많은 지역"* 을 볼 수가
       없다. §13.11 이 신뢰 필터에서 정한 것과 같은 규칙이다. */
    const r = await API.pinsByRegion(sc, ct, sp);
    if (seq !== aggSeq.current) return;      // 그 사이 더 새 요청이 나갔다
    const rows = r.ok ? (r.data ?? []) : [];
    setAgg(rows);
    onRows?.(rows);
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
    if (Date.now() - cardTapAt.current < 400) return;   // 카드가 방금 열었다
    /* ★ 이벤트에서 쓸 것은 **await 전에 전부 꺼낸다.** React 의 synthetic event 는
       **재사용**되므로, `await` 뒤에 `e.nativeEvent` 를 읽으면 그때는 다른 탭의
       값이거나 비어 있을 수 있다 — 실제로 콘솔이
       *"This synthetic event is reused for performance reasons"* 로 경고했다.
       한 번은 맞게 돌아서 더 나쁘다: 간헐적으로만 틀린다. */
    const pt = e?.nativeEvent?.point;
    const ll = e?.nativeEvent?.lngLat;
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

      /* ★ **기록이 있는 곳으로 간다**(§13.61). 행정구역 한가운데는 대개 산이다 —
         해운대구를 누르면 장산 산지에 떨어져 아무것도 없는 화면을 봤다.
         *"지역을 눌렀다"* 는 *"거기 뭐가 있는지 보자"* 는 뜻이다.
         ★ 집계를 읽을 때 상자를 **같이** 받아 뒀다(050). 탭할 때 또 물으면
           그만큼 지도가 늦게 움직인다. */
      const a = agg.find((x) => x.region_code === code);
      const box = (a && Number.isFinite(a.bw))
        ? padPinBox([a.bw, a.bs, a.be, a.bn])
        : r.bbox;                                 // 기록이 없는 지역은 예전처럼

      /* 지역을 눌러 들어갈 때도 같다 — 들어간 자리가 시트에 가리면 누른 보람이 없다 */
      const v = fitView(box, size.current.w, size.current.h,
                        { top: headH, bottom: SHEET_BOTTOM + SHEET_PEEK }, !!a);
      camRef.current?.flyTo({ center: v.center, zoom: v.zoom, duration: 700 });
      return;
    }
    /* ★ **손가락만큼 여유를 준다**(§13.98). 예전에는 점 **하나**를 찍어야 했다 —
       반지름 2.5px 짜리를 맞히라는 뜻이었고, 그래서 실제로는 글자를 눌러야만 열렸다.
       이제 누른 자리 둘레 44pt(= 애플 최소 타깃) 안을 보고 **가장 가까운 것**을 연다.
       ★ 핀과 상호를 **한 번에** 본다. 예전처럼 핀을 먼저 보고 끝내면, 여유를 준
         순간 20px 떨어진 내 핀이 2px 옆의 상호를 가로챈다. 고르는 규칙은
         `tapPick.ts` 한 곳에 있고 — 같은 좌표면 핀이 이긴다(**핀을 앞에 넣는다**). */
    /* ★ `point` 는 `{x,y}` 가 아니라 **`[x, y]` 튜플**이다(라이브러리 타입).
       처음에 `pt.x` 로 썼는데 `e` 가 `any` 라 **타입 검사가 못 잡았고**, 상자가
       통째로 `NaN` 이 되어 아무것도 안 잡혔을 것이다. 조용히 틀리는 모양이다. */
    const box: [[number, number], [number, number]] = [
      [pt[0] - TAP_SLOP, pt[1] - TAP_SLOP],
      [pt[0] + TAP_SLOP, pt[1] + TAP_SLOP],
    ];
    const hits = await mapRef.current
      ?.queryRenderedFeatures(box, {
        /* ★ 저장한 곳도 **눌리는 것**이어야 한다(§13.104). 안 넣으면 금테 점이
           화면에만 있고 손가락에는 없는, §13.98 이 고친 그 상태로 되돌아간다. */
        layers: ["pin-dot", "place-label", "place-dot",
                 "save-dot", "save-label"],
      })
      .catch(() => [] as any[]);

    const cands: Cand[] = [];
    const seen = new Set<string>();
    for (const f of hits ?? []) {
      const c = (f.geometry as any)?.coordinates;
      if (!Array.isArray(c)) continue;
      const pid = f.properties?.pinId;
      const plid = f.properties?.id;
      /* 점과 글자가 같은 장소를 두 번 낸다 — 한 번만 센다 */
      const key = pid ? `n:${pid}` : plid ? `p:${plid}` : null;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (pid) cands.push({ kind: "pin", id: pid, lng: c[0], lat: c[1] });
      else if (plid) cands.push({ kind: "place", id: plid, lng: c[0], lat: c[1] });
    }
    /* ★ 핀을 **앞에** 둔다 — 동점(그 장소에 꽂은 내 기록)에서 핀이 이기게 하는
       규칙이 여기 한 줄로만 표현된다. */
    cands.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "pin" ? -1 : 1));

    const hit = pickNearest(cands, ll?.[0] ?? 0, ll?.[1] ?? 0);
    if (!hit) { setOpen(null); return; }
    if (hit.kind === "pin") {
      setOpen(pins.find((p) => p.id === hit.id) ?? null);
      return;
    }
    setOpen(null);
    const nm = (hits ?? []).find((f) => f.properties?.id === hit.id)?.properties?.name;
    setOpenPlace({ id: hit.id, name: nm ?? "장소" });
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
    if (id === space && scope === "shared") return;
    setOpen(null);
    setScope("shared");          // 스페이스 탭에서 바로 올 수도 있다(§13.67)
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
    placesBox.current = { box: null, cat: v };   // 상호도 같은 필터를 탄다
    void loadPlaces(zoom);
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

  /* ── 표지 카드 (§13.63) ────────────────────────────────────────
     ★ **겹치면 안 고른다.** 상호 이름은 MapLibre 가 충돌을 처리해 주지만
       (§13.60) 카드는 RN 뷰라 그 기능이 없다 — 그대로 두면 8장이 한 덩어리로
       뭉친다. 화면에서 카드 폭만큼 떨어진 것만 남긴다.
     ★ 거리 기준을 **도(degree)가 아니라 화면 비율**로 잡는다. 같은 0.001도라도
       줌에 따라 화면에서는 전혀 다른 거리다. */
  const cards = (() => {
    if (zoom < Z_CARDS) return [];
    const withPhoto = pins.filter((p) => p.media_thumb);
    if (!withPhoto.length) return [];
    /* 화면 가로가 몇 도인지 — 카드 하나가 화면의 몇 분의 일인지로 최소 간격을 낸다 */
    const box = loaded.current.box;
    const degPerPx = box ? (box.e - box.w) / (size.current.w * (1 + API.PAD * 2)) : 0;
    const minSep = degPerPx * 110;                 // 카드 폭 ≈ 96pt + 여백
    const out: Pin[] = [];
    for (const p of [...withPhoto].sort((a, b) => b.like_count - a.like_count)) {
      if (out.length >= MAX_CARDS) break;
      if (out.some((q) => Math.abs(q.lng - p.lng) < minSep
                       && Math.abs(q.lat - p.lat) < minSep * 0.8)) continue;
      out.push(p);
    }
    return out;
  })();
  const cardIds = new Set(cards.map((c) => c.id));

  /* ★ **보인 것을 센다**(§13.69). 표지 카드가 곧 *"그 장소의 얼굴"* 이라
     여기가 노출의 자리다. 같은 묶음에서 두 번 세지 않는 것은 `coverLog` 가 막는다 —
     지도를 조금 밀 때마다 같은 카드가 다시 그려지기 때문이다. */
  useEffect(() => {
    for (const c of cards) sawCover(c.place_id);
  }, [cards.map((c) => c.id).join(",")]);

  /* ── 저장한 곳 (§13.104) ────────────────────────────────────────
     ★ **갈래 칩을 탄다.** `맛집` 만 보겠다고 눌렀는데 찜해 둔 산이 남아 있으면
       필터가 약속을 깬다 — 지도 전체에 **규칙 하나**다(§13.37).
       반면 `나의 여행`·`모두의 지도` 같은 **스코프 칩은 안 탄다**: 그건 *"누구의
       기록인가"* 를 고르는 것이고, 저장은 기록이 아니라 **가 보려는 표시**다.
     ★ 줌과 무관하게 **늘 그린다.** 상호는 14 줌 아래에서 걷어내는데(46만 곳이라
       안 걷으면 화면이 죽는다), 저장한 곳은 많아야 수십 개이고 무엇보다
       **멀리서 볼 때 가장 쓸모 있다** — 찜한 것들이 어디에 몰려 있는지가 곧
       다음 여행의 윤곽이다. */
  /* ★ 가르는 규칙은 `splitMapSaves` 한 곳에 있다 — 두 규칙(갈래 타기 · 상호에서
     빼기)이 **서로 맞물려** 있어서, JSX 에 흩어 두면 한쪽을 고칠 때 다른 쪽이
     따라 틀어지는 것을 아무도 못 본다. */
  const { saveShown, placeShown } = splitMapSaves(places, saves, cat);
  const saveFc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: saveShown.map((q) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [q.lng, q.lat] },
      properties: {
        id: q.place_id,
        name: q.name,
        color: CAT[q.category ?? "etc"]?.c ?? CAT.etc.c,
        /* 문 닫은 곳은 **흐리게** 둔다. 지우지는 않는다 — 내가 찜한 것이
           말없이 사라지면 *"저장이 풀렸나"* 가 된다(051 이 장소를 안 지우는 것과 같다). */
        closed: q.closed ? 1 : 0,
      },
    })),
  };

  /* 상호. ★ 핀보다 **뒤에** 그린다 — 내 기록이 배경에 묻히면 안 된다.
     ★ 저장한 곳은 **뺀다.** 같은 자리에 점이 둘이면 테두리가 겹쳐 지저분해지고,
       무엇보다 **위에 뭐가 그려졌는지**를 코드만 보고 알 수 없게 된다. */
  const placeFc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: placeShown.map((q) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [q.lng, q.lat] },
      properties: {
        /* ★ `id` 를 싣는다. 없으면 눌렀을 때 **어느 장소인지 알 길이 없다** —
           이름으로 되찾으면 같은 이름의 가게 둘 중 아무 쪽이나 열린다. */
        id: q.id,
        name: q.name,
        color: CAT[q.category ?? "etc"]?.c ?? CAT.etc.c,
      },
    })),
  };

  /* 내 위치로 간다. ★ 누른 그 순간에 권한을 묻는다(§13.62). */
  const goHere = async () => {
    setLocating(true);
    const r = await whereAmI();
    setLocating(false);
    if ((r as any).ok === false) { setWhy((r as any).why); return; }
    const h = r as Here;
    setHere(h);
    setWhy(null);
    camRef.current?.flyTo({
      center: [h.lng, h.lat],
      /* ★ 이미 가까이 있으면 **줌을 건드리지 않는다.** 내 위치를 보려고 눌렀는데
         보고 있던 축척이 바뀌면 방금까지 보던 맥락을 잃는다. */
      zoom: zoom < Z_PLACES ? 15 : zoom,
      duration: 600,
    });
    /* 한 번 허락을 받았으면 그 뒤로는 따라간다 — 걸으면서 보는 화면이다. */
    if (!stopWatch.current) {
      stopWatch.current = await watchHere(setHere).catch(() => null);
    }
    /* ★ 방향은 **자력계**가 있어야 한다. 시뮬레이터에는 없으므로 조용히 실패하고,
       화살표 없이 점만 남는다 — 그게 맞는 모습이다(§13.64). */
    if (!stopHeading.current) {
      stopHeading.current = await watchHeading(setFacing).catch(() => null);
    }
  };

  /* ★ 스페이스 탭에서 온 요청. 스코프를 `공유 스페이스` 로 바꾸고 그 방만 남긴 뒤,
     **기록이 있는 곳으로 날아간다**(§13.61 의 상자를 그대로 쓴다).
     ★ 한 번 처리하면 **지운다.** 안 지우면 지도 탭으로 돌아올 때마다 다시 날아가
       사용자가 보던 자리를 빼앗는다. */
  useEffect(() => {
    if (!jumpSpace || !ready) return;
    setPickSpace(false);
    setOpen(null);
    setScope("shared");
    setSpace(jumpSpace);
    spaceRef.current = jumpSpace;
    setPins([]); setMore(false); setAgg([]);
    loaded.current = { box: null, scope: "shared", cat, space: jumpSpace };
    void load(true, "shared");
    /* ★ 집계가 온 **뒤에** 날아간다 — 상자를 모르면 어디로 갈지 알 수 없다 */
    void loadAgg("shared", cat, jumpSpace, flyToAgg);
    onJumped?.();
  }, [jumpSpace, ready]);

  /* `갈 곳` 카드 → 그 장소로. ★ `jumpSpace` 와 **같은 모양**으로 둔다 —
     한 번 처리하면 지운다. 안 지우면 지도로 돌아올 때마다 다시 날아가
     사용자가 보던 자리를 빼앗는다(위에서 겪은 것과 같은 함정이다). */
  useEffect(() => {
    if (!jumpTo || !ready) return;
    camRef.current?.flyTo({
      center: [jumpTo.lng, jumpTo.lat],
      zoom: Z_CARDS,          // 표지 카드가 보이는 줌 — 가서 볼 것이 있어야 한다
      duration: 700,
    });
    onJumpedTo?.();
  }, [jumpTo, ready]);

  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: pins
      /* ★ 카드로 뽑힌 핀은 점을 **끈다.** 같은 기록을 카드와 점으로 두 번
         그리면 카드 밑에 점이 삐져나와 지저분하다. */
      .filter((p) => !cardIds.has(p.id))
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

  /* ★ 요약 한 줄을 **여기서 한 번** 만든다. 시트가 접혀 있을 때 보이는 것이고,
     예전 알약이 하던 말 그대로다 — 자리만 옮겼지 뜻이 바뀌면 안 된다. */
  const summary = why ? why
    : busy ? "불러오는 중"
    : region
      ? (agg.length
          ? `${catLabel}${agg.length}개 지역 · ${agg.reduce((k, a) => k + a.n, 0)}곳 — 확대하면 기록이 보입니다`
          : cat ? `${CAT[cat]?.k ?? cat} 기록이 아직 없습니다` : "아직 기록이 없습니다")
    : pins.length === 0
      ? `${into ? `${into} — ` : ""}` + (
          cat ? `이 화면에는 ${CAT[cat]?.k ?? cat} 기록이 없습니다`
          : scope === "mine" ? "이 화면에는 내가 올린 기록이 없습니다"
          : scope === "shared" ? "이 화면에는 공유 스페이스 기록이 없습니다"
          : "이 화면에는 아직 기록이 없습니다")
      : `${into ? `${into}  ` : ""}`
        + [n.mine ? `내 것 ${n.mine}곳` : null,
           n.shared ? `함께 ${n.shared}곳` : null,
           n.other ? `남 ${n.other}곳` : null].filter(Boolean).join(" · ")
        + (picked ? `  · 눈에 띄는 ${picked.size}곳` : "")
        + (more ? "  더 있습니다 — 확대하면 더 보입니다" : "");

  /* 시트 목록. ★ **지도에 보이는 것과 같은 집합**이다 — 목록과 지도가 다른 것을
     보여 주면 사용자는 둘 중 무엇을 믿어야 할지 모른다. */
  const sheetItems = pins.map((p) => ({
    id: p.id, thumb: p.media_thumb, memo: p.memo,
    category: p.category, visited_at: p.visited_at, source: p.source,
  }));

  return (
    <View style={st.root}>
      <View style={st.head}
            onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
        {/* ★ 찾기 — **칩 위**에 둔다(§13.97 ③). 네이버와 같은 자리이고, 칩은
            *"지금 보고 있는 것을 좁히는" 것*이라 *"다른 곳으로 가는" 것*보다 뒤다.
            ★ `headH` 는 재는 값이라(§13.95) 줄이 하나 늘어도 맞춤이 저절로 따라간다. */}
        <MapSearch
          at={{ lng: atLng, lat: atLat }}
          onOpen={setSearching}
          onPick={(h) => void pickHit(h)} />
        {/* 검색 결과가 펼쳐지면 칩을 감춘다 — 목록이 칩을 덮으면 둘 다 못 쓴다 */}
        {!searching && (
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
        )}
        {/* ★ 두 줄을 **한 줄로 합치지 않는다.** '내 지도'와 '맛집'은 서로 다른 질문이라
            (누구의 것인가 / 무엇인가) 한 줄에 섞으면 둘이 배타적인 것처럼 보인다. */}
        {!searching && (
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
        )}
      </View>

      {!style ? (
        <View style={[st.fill, st.center]}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
      <Map ref={mapRef} style={st.fill} mapStyle={style}
           /* ★ 돌린 지도를 **되돌릴 길을 준다**(§13.78). 두 손가락으로 쉽게 돌아가는데
              (실제로 90도 돌려 봤다) 나침반이 없으면 북쪽으로 돌아올 방법이 없다 —
              기울어진 지도에 갇힌다. 기본 나침반은 눌러서 북쪽으로 돌아온다.
              ★ 북쪽일 때는 **안 보인다**(compassHiddenFacingNorth). 늘 떠 있으면
                평소 화면에 쓸모없는 장식이 하나 는다. */
           compass compassHiddenFacingNorth
           /* ★ **왼쪽**에 둔다. 오른쪽에는 내 위치와 (+) 가 이미 있고,
              개발 빌드에서는 Expo 개발 메뉴 버튼까지 같은 자리에 뜬다. */
           compassPosition={{ top: 8, left: 8 }}
           onPress={(e) => { void onMapPress(e); }}
           onLayout={(e) => {
             const { width, height } = e.nativeEvent.layout;
             if (width > 0 && height > 0) size.current = { w: width, h: height };
           }}
           onRegionIsChanging={(e) => {
             /* 돌리는 **도중에도** 따라간다. DidChange 만 보면 손을 뗄 때까지
                화살표가 옛 방위에 붙어 있다가 툭 튄다. */
             const b = (e as any)?.nativeEvent?.bearing;
             if (typeof b === "number") setBearing(b);
             /* ★ 축척도 **도중에** 따라간다. 손을 뗄 때까지 옛 값이면 핀치하는
                내내 `5km` 라고 적힌 채 화면만 좁아진다 — 그 사이 내내 거짓말이다.
                (방위와 같은 자리다. 여기는 이미 매 프레임 리렌더한다.) */
             const z2 = (e as any)?.nativeEvent?.zoom;
             if (typeof z2 === "number") setZoom(z2);
             const c = (e as any)?.nativeEvent?.center;
             if (Array.isArray(c) && typeof c[1] === "number") setAtLat(c[1]);
           }}
           onRegionDidChange={(e) => {
             const b = (e as any)?.nativeEvent?.bearing;
             if (typeof b === "number") setBearing(b);
             const z = (e as any)?.nativeEvent?.zoom;
             if (typeof z === "number") setZoom(z);
             /* ★ 전국 줌으로 **나가면** 지역 표시를 푼다. 안 풀면 전국을 보는데
                한 지역 이름이 남아 있다. ★ 이 검사는 **움직임이 끝난 뒤**에만 한다 —
                매 프레임 보면 들어가는 애니메이션 도중 아직 전국 줌이라 즉시 풀린다
                (웹에서 겪은 것). `onRegionDidChange` 가 바로 그 시점이다. */
             if (typeof z === "number" && isRegionZoom(z)) setInto(null);
             void load(false, scope, z);
             if (typeof z === "number") void loadPlaces(z);
             /* ★ 보고 있는 자리를 알린다 — `갈 곳` 이 *"여기서 가까운"* 을
                이 값으로 잰다(§13.74). 예전에는 그 탭이 **전국 중심 상수**를
                쓰면서 화면에는 *"지도에서 보던 자리 기준"* 이라고 적고 있었다. */
             void mapRef.current?.getBounds().then((b) => {
               if (!b) return;
               onCenter?.({ lng: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 });
               setAtLat((b[1] + b[3]) / 2);
               setAtLng((b[0] + b[2]) / 2);
             }).catch(() => {});
           }}>
        {/* ★ 줌 숫자가 아니라 **담을 범위**로 말한다. `zoom: 5.6` 은 벤치마크 화면에서
            물려받은 값인데, 그 숫자가 "전국이 보인다"를 뜻하는지는 기기 크기와
            배경 데이터에 따라 달라진다 — 실제로 경계 파일을 바꾸자 전국이 잘렸다.
            bounds 는 의도 그 자체라 흔들리지 않는다. */}
        <Camera ref={camRef} initialViewState={{ bounds: [124.4, 32.9, 132.2, 38.7] }} />

        <GeoJSONSource id="sgg" data={SGG as any}>
          {/* ★ **줌이 바뀌면 지도의 성격도 바뀐다**(§13.11 의 확장, §13.59).
              전국 줌에서 우리가 파는 것은 *"어디를 채웠나"* 라 **지적도**가 맞다 —
              도로와 건물은 그 질문에 방해만 된다. 그런데 확대하면 질문이
              *"여기가 어디냐"* 로 바뀌고, 그때는 **실제 지도**여야 한다.
              → 면을 지웠다 그렸다 하지 않고 **불투명도만** 줌에 맡긴다
                (레이어를 끼웠다 빼면 앱이 죽는다 — §13.47). */}
          {/* ★ **배경 지도 위가 아니라 아래에 깐다**(§13.95). 예전에는 맨 위에
              있어서 전국 줌에서 불투명도 1 로 **강·도로·지명을 통째로 덮었다.**
              그래서 "어디를 채웠나"는 보였지만 **여기가 어디인지**를 알 수 없었다 —
              행정경계만 떠 있는 땅덩어리였다.
              ★ `beforeId="water"` 는 *"이 레이어 **아래**에 넣는다"* 는 뜻이다.
                배경(background) 바로 위에 들어가므로, 물·숲·강·도로·지명이
                전부 우리 면 **위로** 올라온다. 우리가 칠하는 것은 땅 색일 뿐이다. */}
          <Layer id="region-base" type="fill" beforeId="water"
                 paint={{
                   "fill-color": LAND,
                   /* ★ 이제 **덮지 않으므로** 전국 줌에서도 1 로 둔다 — 땅과 바다를
                      가르는 것이 이 면의 일이고, 지형은 위에서 그려진다. */
                   "fill-opacity": [
                     "interpolate", ["linear"], ["zoom"],
                     Z_REGION - 1, 1,
                     Z_REGION + 2, 0.5,
                     Z_ALL, 0.25,          // 골목에서도 옅게 남긴다 — 경계가 뜬금없지 않게
                   ],
                 } as any} />
          {/* ★ **끼웠다 뺐다 하지 않는다.** 조건부로 렌더하면 줌 단위가 바뀔 때
              형제 위치가 밀려 다음 레이어의 `id` 가 바뀐 것으로 잡히고,
              라이브러리가 `id cannot be changed` 로 **앱을 죽인다**(실제로 죽었다).
              같은 레이어를 두고 **paint 만** 바꾼다 — paint 는 바꿔도 된다. */}
          {/* ★ 경계선은 **지명 바로 아래**에 둔다. 면과 같이 맨 밑으로 내리면
              도로가 그 위를 지나가 커버리지(채운 곳)가 안 읽히고, 맨 위에 두면
              지명을 덮는다. 둘 사이가 이 선의 자리다. */}
          <Layer id="region-line" type="line" beforeId="place_other"
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

        {/* ★ 상호 — **글자 충돌을 라이브러리에 맡긴다.** `text-allow-overlap` 을
            끄면 겹치는 이름을 알아서 버린다. 네이버가 깔끔해 보이는 이유의
            절반이 이것이다. RN `Marker` 로 그리면 이 기능이 없어 60개가
            그대로 겹친다(지역 라벨이 40개에서 이미 빡빡했다).
            ★ 폰트는 배경 스타일이 쓰는 것과 **같은 이름**이어야 한다 —
              `Noto Sans Regular`. 한글 글리프 확인함(44032 범위 181KB). */}
        {/* ★ 표지 카드. **사진이 곧 그 자리의 얼굴**이다(§13.8) — 이름만으로는
            *"어떤 느낌의 장소인지"* 가 안 온다.
            ★ `media_thumb` 을 쓴다. 없으면 서버가 원본으로 떨어뜨려 주므로
              옛 사진도 그냥 보인다(§13.58). */}
        {cards.map((c) => (
          /* ★ `anchor="bottom"` — 카드는 좌표 **위에** 선다. 기본값(center)이면
             사진 한가운데가 좌표에 놓여, 아래 꼭지가 가리키는 곳과 실제 지점이
             **한 뼘 어긋난다.** 가리키는 시늉만 하는 꼭지는 없느니만 못하다.
             ★ 누르는 것은 `Marker` 자신의 `onPress` 로 받는다. 안쪽 `Pressable`
               로 받으면 **지도의 press 가 가로채** 시트가 열렸다 바로 닫힌다
               (실제로 그랬다 — §13.63). */
          <Marker key={`card-${c.id}`} lngLat={[c.lng, c.lat]}
                  anchor="bottom"
                  onPress={() => { cardTapAt.current = Date.now(); setOpen(c); }}>
            <View style={st.card}>
              <Image source={{ uri: c.media_thumb! }} style={st.cardImg} />
              {!!c.memo && (
                <Text style={st.cardT} numberOfLines={1}>{c.memo}</Text>
              )}
              {/* 카드가 가리키는 지점 — 없으면 사진이 공중에 뜬 것처럼 보인다 */}
              <View style={st.cardPin} />
            </View>
          </Marker>
        ))}

        <GeoJSONSource id="places" data={placeFc as any}>
          {/* ★ **누를 수 있는 크기**로 키운다(§13.98 · §13.97 의 ①).
              반지름이 **2.5px** 이었다 — 46만 곳을 그려 놓고 손가락으로는 한 곳도
              겨눌 수가 없었다. §13.91 에서 *"실제로 누르게 되는 것은 글자"* 라고
              적고 넘어갔는데, 그건 처방이 아니라 **증상을 적어 둔 것**이다.
              ★ 테두리를 준다. 색만으로는 숲 위·바다 위·도시 위에서 다 다르게 보인다 —
                §13.95 로 배경이 풍부해진 만큼 점도 그 위에서 버텨야 한다.
              ★ 색은 카테고리다(`CAT`) — 네이버가 작은 장소를 색점으로 그리는 것과
                같은 층이다. 그림 아이콘은 그보다 윗층이고, 그건 자산이 있어야 한다. */}
          <Layer id="place-dot" type="circle"
                 paint={{
                   "circle-radius": [
                     "interpolate", ["linear"], ["zoom"],
                     Z_PLACES, 4.5, 16, 6, 18, 7.5,
                   ],
                   "circle-color": ["get", "color"] as any,
                   "circle-opacity": 0.95,
                   "circle-stroke-width": 1.2,
                   "circle-stroke-color": "rgba(10,12,16,0.85)",
                 } as any} />
          <Layer id="place-label" type="symbol"
                 layout={{
                   "text-field": ["get", "name"] as any,
                   "text-font": ["Noto Sans Regular"],
                   "text-size": 10.5,
                   "text-offset": [0, 0.9],
                   "text-anchor": "top",
                   "text-max-width": 7,
                   "text-padding": 3,
                 } as any}
                 paint={{
                   "text-color": "rgba(255,255,255,0.72)",
                   /* 어두운 배경에서도 읽히게 **테두리**를 준다 — 지도가 어두워도
                      도로 위에 글자가 올라가면 대비가 무너진다. */
                   "text-halo-color": "rgba(0,0,0,0.85)",
                   "text-halo-width": 1.2,
                 }} />
        </GeoJSONSource>

        {/* ── 저장한 곳 (§13.104) ──
            ★ **상호 위, 핀 아래**다. 핀은 *"내가 다녀왔다"* 는 증거고 저장은
              *"가 보려 한다"* 는 표시다 — 증거가 위다(§13.69 가 핀을 맨 위에 둔 이유).
            ★ 금색은 상세의 `★ 저장함` 버튼과 **같은 색**(`C.warn`)이다. 같은 뜻에
              다른 색을 쓰면 두 화면이 같은 것을 말하는지 알 수 없다. */}
        <GeoJSONSource id="saves" data={saveFc as any}>
          {/* 둘레의 옅은 금빛. ★ 멀리서 **눈에 걸리라고** 둔다 — 전국을 보는 줌에서
              점 하나는 배경에 묻히는데, 저장한 곳은 그 줌에서 가장 쓸모 있다. */}
          <Layer id="save-halo" type="circle"
                 paint={{
                   "circle-radius": [
                     "interpolate", ["linear"], ["zoom"], 5, 7, 12, 9, 18, 13,
                   ],
                   "circle-color": C.warn,
                   "circle-opacity": 0.22,
                 } as any} />
          {/* 가운데는 **갈래 색** 그대로다 — 금테만 있고 속이 금색이면
              *"무엇을 저장했는지"* 가 사라진다. 저장은 덧붙은 표시지 갈래를 덮지 않는다. */}
          <Layer id="save-dot" type="circle"
                 paint={{
                   "circle-radius": [
                     "interpolate", ["linear"], ["zoom"], 5, 4, 12, 5.5, 18, 8,
                   ],
                   "circle-color": ["get", "color"] as any,
                   /* 문 닫은 곳은 흐리게. **지우지는 않는다** — 찜해 둔 것이 말없이
                      사라지면 "저장이 풀렸나"가 된다(051 이 장소를 안 지우는 것과 같다). */
                   "circle-opacity": ["case", ["==", ["get", "closed"], 1], 0.45, 1] as any,
                   "circle-stroke-width": 2,
                   "circle-stroke-color": C.warn,
                   "circle-stroke-opacity":
                     ["case", ["==", ["get", "closed"], 1], 0.45, 1] as any,
                 } as any} />
          {/* 이름은 **상호와 같은 줌부터**(14). 전국 줌에서 이름을 다 적으면
              찜한 것들이 어디 몰려 있는지를 보려는 그 화면이 글자로 덮인다. */}
          <Layer id="save-label" type="symbol" minzoom={Z_PLACES}
                 layout={{
                   "text-field": ["get", "name"] as any,
                   "text-font": ["Noto Sans Regular"],
                   "text-size": 11,
                   "text-offset": [0, 1],
                   "text-anchor": "top",
                   "text-max-width": 7,
                   "text-padding": 3,
                 } as any}
                 paint={{
                   /* 글자도 금빛이다 — 점만 금색이고 이름이 흰색이면 **다른 것**으로 읽힌다 */
                   "text-color": C.warn,
                   "text-halo-color": "rgba(0,0,0,0.85)",
                   "text-halo-width": 1.2,
                 }} />
        </GeoJSONSource>

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

        {/* ★ 내 위치는 **맨 위**에 그린다. 핀이나 상호에 가리면 "내가 어디냐"에
            답을 못 한다 — 그게 이 점의 유일한 일이다.
            ★ 레이어는 **끼웠다 빼지 않는다**(§13.47). 위치가 없으면 빈 것을 먹인다. */}
        <GeoJSONSource id="here-acc" data={(here ? accuracyRing(here) : EMPTY_FC) as any}>
          <Layer id="here-acc-fill" type="fill"
                 paint={{ "fill-color": C.accent, "fill-opacity": 0.12 }} />
          <Layer id="here-acc-line" type="line"
                 paint={{ "line-color": C.accent, "line-opacity": 0.35, "line-width": 1 }} />
        </GeoJSONSource>

        {/* ★ 바라보는 방향. **회전이 필요해서** circle 레이어로는 못 그린다 —
            RN 뷰를 돌린다. 하나뿐이라 겹침 걱정도 없다.
            ★ 방향을 **모르면 안 그린다.** 엉뚱한 쪽을 가리키는 화살표는 없느니만
              못하다 — 사용자가 그걸 믿고 몸을 돌린다. */}
        {here && facing != null && (
          <Marker lngLat={[here.lng, here.lat]}>
            <View style={{ transform: [{ rotate: `${facing - bearing}deg` }] }}>
              <View style={st.facing} />
            </View>
          </Marker>
        )}

        <GeoJSONSource id="here" data={(here ? {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {},
                       geometry: { type: "Point", coordinates: [here.lng, here.lat] } }],
        } : EMPTY_FC) as any}>
          <Layer id="here-halo" type="circle"
                 paint={{ "circle-radius": 11, "circle-color": "#000", "circle-opacity": 0.35 }} />
          <Layer id="here-dot" type="circle"
                 paint={{
                   "circle-radius": 6,
                   "circle-color": C.accent,
                   "circle-stroke-width": 2.5,
                   "circle-stroke-color": "#fff",
                 }} />
        </GeoJSONSource>
      </Map>
      )}

      {/* ★ 내 위치 버튼. `(+)` 위에 둔다 — `(+)` 는 App 이 지도 위에 띄우므로
          자리를 비켜 준다. 시트가 떠 있으면 같이 감춘다. */}
      {!open && !!style && sheetH < SHEET_HALF + 40 && (
        <Pressable style={[st.locate, { bottom: SHEET_BOTTOM + Math.min(sheetH, SHEET_HALF) + 64 }]}
                   onPress={() => { void goHere(); }}>
          {locating
            ? <ActivityIndicator size="small" color={C.text} />
            : <Text style={[st.locateT, here && { color: C.accent }]}>◎</Text>}
        </Pressable>
      )}

      {/* ★ 축척 막대(§13.97 ②). **왼쪽 아래** — 오른쪽에는 내 위치와 (+) 가 있다.
          시트를 따라 올라간다(위치 버튼과 같은 기준) — 안 그러면 시트에 가린다.
          ★ 막대 길이는 **고른 거리에 정확히 맞춘다**. "100px 에 3.7km" 라고 쓰면
            읽는 사람이 그 길이로 다른 거리를 가늠할 수 없다(§13.99). */}
      {!!style && !open && !openPlace && (() => {
        const sc = pickScale(metersPerPx(zoom, atLat));
        return (
          <View style={[st.scale, { bottom: SHEET_BOTTOM + Math.min(sheetH, SHEET_HALF) + 14 }]}>
            <Text style={st.scaleT}>{sc.label}</Text>
            <View style={[st.scaleBar, { width: sc.px }]} />
          </View>
        );
      })()}

      {pickSpace && (
        <SpacePicker
          spaces={spaces} current={space}
          onPick={changeSpace}
          onClose={() => setPickSpace(false)}
          onLeave={(sp) => { void doLeave(sp); }}
          onAdd={() => { setPickSpace(false); onAdd?.(); }} />
      )}

      {open && <PinSheet pin={open} onClose={() => setOpen(null)} />}

      {/* ★ 요약은 이제 **바텀시트의 접힌 상태**다(§13.66). 알약과 시트가 같은
          자리를 다투면 둘 다 반쯤 보인다 — 하나로 합쳤다.
          ★ 핀 상세가 떠 있으면 감춘다. 둘 다 바닥에서 올라오므로 겹친다. */}
      {!open && !!style && (
        <MapSheet
          snap={snap} onSnap={setSnap}
          onHeight={(h) => { setSheetH(h); onSheetHeight?.(h); }}
          summary={summary}
          items={sheetItems}
          onPick={(id) => {
            const p = pins.find((x) => x.id === id);
            if (p) setOpen(p);
          }} />
      )}

      {/* ★ 장소 상세 (§13.91). **지도 위에 전면으로 얹는다** — 바텀시트로 두면
          `MapSheet` 와 같은 바닥을 다투고(§13.66 에서 겪었다), 표지 사진과 사진
          격자가 시트 높이에 들어가지 않는다.
          ★ `지도에서 보기` 를 **주지 않는다**(`onOpenMap` 을 안 넘긴다) — 이미
            지도이고, 사용자가 **보고 있던 점**을 누른 것이다. 그 버튼을 달면 누르고
            나서 아무 일도 안 난 것처럼 보인다. 날아가지도 않는다 — 보고 있는 자리를
            빼앗을 이유가 없다.
          ★ 거리(`distM`)도 안 넘긴다. 지도는 그 값을 모르고, 여기서 새로 재면
            `갈 곳` 카드와 같은 곳을 다르게 말한다(§13.34). 모르면 그 줄을 비운다. */}
      {openPlace && (
        <PlaceSheet
          placeId={openPlace.id} fallbackName={openPlace.name}
          onClose={() => setOpenPlace(null)}
          /* ★ 저장을 켜면 **지도에 바로 금테가 생긴다**(§13.104). 닫을 때 읽게 하면
             시트를 연 채로 누른 사람에게는 아무 일도 안 난 것처럼 보인다. */
          onSaveChanged={() => { void loadSaves(); }} />
      )}
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
  center: { alignItems: "center", justifyContent: "center" },
  /* (+) 는 right:20/bottom:96 에 있다(App). 그 **위로** 올린다. */
  scale: {
    position: "absolute", left: 16,   /* bottom 은 시트 높이를 따라간다 */
    alignItems: "flex-start",
  },
  scaleT: {
    color: C.text, fontSize: 10.5, fontWeight: "600", marginBottom: 2,
    /* 지도 위 어디서든 읽혀야 한다 — 숲 위·바다 위·도시 위가 다 다르다 */
    textShadowColor: "rgba(0,0,0,0.9)", textShadowRadius: 3,
  },
  scaleBar: {
    height: 3, borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000", shadowOpacity: 0.8, shadowRadius: 2,
  },
  locate: {
    position: "absolute", right: 22,   /* bottom 은 시트 높이를 따라간다 */
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(22,24,31,0.92)",
    borderWidth: 1, borderColor: C.line,
  },
  locateT: { color: C.text, fontSize: 20, lineHeight: 24 },
  /* 표지 카드 — 사진이 주인공이라 테두리는 얇게, 배경은 거의 안 보이게 */
  card: { alignItems: "center", width: 96 },
  cardImg: {
    width: 84, height: 84, borderRadius: 12,
    borderWidth: 2, borderColor: "rgba(255,255,255,0.92)",
    backgroundColor: "#222",
  },
  cardT: {
    marginTop: 4, maxWidth: 96, color: "rgba(255,255,255,0.92)",
    fontSize: 10.5, fontWeight: "600", textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.9)", textShadowRadius: 3,
  },
  /* 부채꼴 대신 **삼각형 하나.** 점 위에 얹히므로 아래쪽을 비워 둔다
     (marginBottom 으로 점 중심에서 위로 밀어낸다). */
  facing: {
    width: 0, height: 0, marginBottom: 26,
    borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 11,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderBottomColor: C.accent,
  },
  cardPin: {
    width: 7, height: 7, borderRadius: 4, marginTop: 3,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
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
