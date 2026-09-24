/**
 * 지도 화면 — 웹 프로토타입의 레이어 구성을 MapLibre RN 11.x로 이식.
 *
 * ★ v11은 MapLibre **스타일 스펙을 그대로** 쓴다 (type / layout / paint).
 *   웹 프로토타입의 레이어 정의가 거의 문자 그대로 옮겨진다. camelCase 변환이 없다.
 *
 * 웹 → RN 11 대응표
 *   new maplibregl.Map(...)                  →  <Map mapStyle={...}>
 *   map.addSource('x', {type:'geojson'})     →  <GeoJSONSource id="x" shape={...}>
 *   map.addSource('a', {type:'canvas'})      →  <ImageSource url="file://..." coordinates=...>  ★ canvas 소스 없음
 *   map.addImage(id, imageData)              →  <Images images={{id: "data:image/png;base64,..."}}>
 *   map.addLayer({type:'fill', ...})         →  <Layer type="fill" layout={} paint={}>
 *   map.on('moveend')                        →  <Map onRegionDidChange>
 */
import { useCallback, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  Images,
  ImageSource,
  Layer,
  Map,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import type {
  ExpressionSpecification,
  FilterSpecification,
  StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { FeatureCollection } from "geojson";

import type { AtlasResult } from "./atlas";

/* 웹과 동일한 토큰. PLAN §9 */
export const TOKENS = {
  mapBg: "#08090C",
  land: "#282B36",
  stroke: "rgba(255,255,255,0.22)",
  water: "#0E182E",
  accent: "#38B6FF",
};

/* 폴리곤은 z8.6에서 물러나고 핀이 인계받는다. PLAN §9 LOD */
/* ★ 스타일 스펙 타입은 튜플이라 배열 리터럴이 그대로는 안 들어간다.
   ExpressionSpecification 으로 명시해야 한다. 웹(JS)에는 없던 단계다. */
const POLY_OPACITY: ExpressionSpecification =
  ["interpolate", ["linear"], ["zoom"], 8.6, 1, 9.4, 0];
const PIN_OPACITY: ExpressionSpecification =
  ["interpolate", ["linear"], ["zoom"], 9.2, 0, 9.8, 1];

const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": TOKENS.mapBg } }],
};

export interface TrippicMapProps {
  regions: FeatureCollection;
  water: FeatureCollection;
  pois: FeatureCollection;
  atlas: AtlasResult | null;
  /** 폴리곤 사진을 쓰는 렌즈인지 (내 지도 / 스페이스). 모두의 지도는 핀만 쓴다 */
  showPolygonPhotos: boolean;
  visitedCodes: string[];
  icons: Record<string, string>;
  onImageMissing: (name: string) => void;
  onViewportChange: (bbox: [number, number, number, number], zoom: number) => void;
}

export function TrippicMap(props: TrippicMapProps) {
  const mapRef = useRef<MapRef>(null);

  const handleRegionDidChange = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const [bounds, zoom] = await Promise.all([map.getBounds(), map.getZoom()]);
    const [w, s, e, n] = bounds;
    props.onViewportChange([w, s, e, n], zoom);
  }, [props]);

  const unvisitedFilter = useMemo<FilterSpecification>(
    () => ["!", ["in", ["get", "code"], ["literal", props.visitedCodes]]],
    [props.visitedCodes],
  );

  return (
    <View style={styles.fill}>
      <Map
        ref={mapRef}
        style={styles.fill}
        mapStyle={EMPTY_STYLE}
        onRegionDidChange={handleRegionDidChange}
      >
        <Camera initialViewState={{ center: [127.75, 36.3], zoom: 6.4 }} minZoom={5} maxZoom={16} />

        <Images
          images={props.icons}
          onImageMissing={(e) => props.onImageMissing(e.nativeEvent.image)}
        />

        {/* 1) 육지 베이스 + hairline 경계 */}
        <GeoJSONSource id="sgg" data={props.regions}>
          <Layer id="region-base" type="fill" paint={{ "fill-color": TOKENS.land }} />
        </GeoJSONSource>

        {/* 1.5) 수계 — 없으면 "그냥 땅 덩어리"라 방향 감각이 안 생긴다 */}
        <GeoJSONSource id="water" data={props.water}>
          <Layer
            id="water-body"
            type="fill"
            filter={["==", ["get", "k"], "body"]}
            paint={{ "fill-color": TOKENS.water }}
          />
          <Layer
            id="water-river"
            type="line"
            filter={["==", ["get", "k"], "river"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": TOKENS.water,
              "line-width": [
                "interpolate", ["exponential", 1.6], ["zoom"],
                6,  ["match", ["get", "r"], 3, 1.1, 2, 0.5, 0.25],
                10, ["match", ["get", "r"], 3, 4.0, 2, 2.0, 1.0],
                14, ["match", ["get", "r"], 3, 16,  2, 7,   3],
                16, ["match", ["get", "r"], 3, 34,  2, 15,  6],
              ] as ExpressionSpecification,
            }}
          />
        </GeoJSONSource>

        {/* 2) 국토 아틀라스 — 웹의 canvas 소스를 대체한다.
               ★ Android ImageSource는 java.net.URL을 쓰므로 data: URI가 조용히 실패한다.
                 반드시 file:// 로 넘긴다. */}
        {props.atlas && props.showPolygonPhotos ? (
          <ImageSource id="atlas" url={props.atlas.uri} coordinates={props.atlas.coordinates}>
            <Layer
              id="atlas-l"
              type="raster"
              paint={{ "raster-opacity": POLY_OPACITY, "raster-fade-duration": 0 }}
            />
          </ImageSource>
        ) : null}

        {/* 3) 미방문 지역 — 사진 bbox가 삐져나온 것을 덮는다 */}
        <GeoJSONSource id="sgg-overlay" data={props.regions}>
          <Layer
            id="region-unvisited"
            type="fill"
            filter={unvisitedFilter}
            paint={{ "fill-color": TOKENS.land, "fill-opacity": props.showPolygonPhotos ? 1 : 0 }}
          />
          <Layer
            id="region-line"
            type="line"
            paint={{
              "line-color": TOKENS.stroke,
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 9, 0.7, 13, 1.1] as ExpressionSpecification,
            }}
          />
        </GeoJSONSource>

        {/* 4) 장소 핀. 클러스터는 숫자가 아니라 대표 사진 + 개수 배지 */}
        <GeoJSONSource
          id="poi"
          data={props.pois}
          cluster
          clusterMaxZoom={11}
          clusterRadius={68}
          clusterProperties={{
            // clusterProperties는 [누적연산, 맵표현식] 2요소 형태다.
            // 누적연산은 ["accumulated"] 를 참조해야 한다.
            // likes와 이미지 인덱스를 한 숫자에 인코딩해 max를 취하면
            // 자동으로 "가장 반응 좋은 멤버의 사진"이 뽑힌다.
            top: [
              ["max", ["accumulated"], ["get", "top"]],
              ["+", ["*", ["get", "likes"], 100], ["get", "imgi"]],
            ],
          }}
        >
          <Layer
            id="poi-cluster"
            type="symbol"
            filter={["has", "point_count"]}
            layout={{
              "icon-image": ["concat", "phc", ["to-string", ["%", ["get", "top"], 100]]] as ExpressionSpecification,
              "icon-allow-overlap": true,
              "icon-size": ["interpolate", ["linear"], ["get", "point_count"], 2, 0.42, 1000, 0.9] as ExpressionSpecification,
            }}
            paint={{ "icon-opacity": PIN_OPACITY }}
          />
          <Layer
            id="poi-cluster-badge"
            type="circle"
            filter={["all", ["has", "point_count"], [">=", ["get", "point_count"], 3]]}
            paint={{
              "circle-color": TOKENS.accent,
              "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 3, 6.6, 1000, 13.6] as ExpressionSpecification,
              // ★ circle-translate는 데이터 기반 표현식을 지원하지 않는다(줌 표현식만).
              //   그래서 배지 오프셋을 클러스터 크기에 비례시킬 수 없다.
              "circle-translate": [13, -13],
              "circle-stroke-width": 1.6,
              "circle-stroke-color": "rgba(10,11,15,0.9)",
              "circle-opacity": PIN_OPACITY,
              "circle-stroke-opacity": PIN_OPACITY,
            }}
          />
          <Layer
            id="poi-cluster-n"
            type="symbol"
            filter={["all", ["has", "point_count"], [">=", ["get", "point_count"], 3]]}
            layout={{
              "text-field": ["get", "point_count_abbreviated"] as ExpressionSpecification,
              "text-font": ["Noto Sans Regular"],
              "text-size": ["interpolate", ["linear"], ["get", "point_count"], 3, 9.5, 1000, 13] as ExpressionSpecification,
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            }}
            paint={{ "text-color": "#fff", "text-translate": [13, -13], "text-opacity": PIN_OPACITY }}
          />
          {/* 상위권 밖은 작은 무채색 점 — "여기도 뭐 있음"만 알린다 */}
          <Layer
            id="poi-dot"
            type="circle"
            filter={["all", ["!", ["has", "point_count"]], [">=", ["get", "rk"], 9999]]}
            paint={{
              "circle-color": "#9AA0AA",
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.2, 16, 4.4] as ExpressionSpecification,
              "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.2, 0, 10, 0.62] as ExpressionSpecification,
            }}
          />
          {/* 아이콘과 라벨은 반드시 한 레이어. 분리하면 라벨이 아이콘을 밀어낸다.
              text-field의 줌 임계값은 정수여야 한다 — 심볼 레이아웃은 타일 줌에서 평가된다. */}
          <Layer
            id="poi-pin"
            type="symbol"
            filter={["all", ["!", ["has", "point_count"]], ["<", ["get", "rk"], 9999]]}
            layout={{
              "icon-image": ["concat", ["get", "img"], "_", ["get", "c"]] as ExpressionSpecification,
              "icon-allow-overlap": false,
              "icon-padding": 2,
              "symbol-sort-key": ["-", 0, ["get", "likes"]] as ExpressionSpecification,
              "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.11, 16, 0.56] as ExpressionSpecification,
              "text-field": ["step", ["zoom"], "", 12, ["get", "n"]] as ExpressionSpecification,
              "text-font": ["Noto Sans Regular"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 12.4, 10.5, 16, 13] as ExpressionSpecification,
              "text-offset": [0, 1.6],
              "text-anchor": "top",
              "text-optional": true,
              "text-padding": 3,
            }}
            paint={{
              "icon-opacity": PIN_OPACITY,
              "text-color": "#E9EBEF",
              "text-halo-color": "rgba(0,0,0,0.88)",
              "text-halo-width": 1.5,
              "text-opacity": ["interpolate", ["linear"], ["zoom"], 12.4, 0, 13.0, 1] as ExpressionSpecification,
            }}
          />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: TOKENS.mapBg },
});
