"""DB 지역 경계를 육지로 잘라 앱 배경용으로 만든다.

★ DB `regions.geom` 은 OSM 행정경계라 **바다 관할 구역까지 들어 있다.**
  옹진군·신안군·제주시가 바다 멀리까지 뻗고, 울릉군·독도는 동그란 관할 원으로 그려진다.
  그대로 그리면 해안선이 사라지고 나라가 덩어리처럼 보인다(§13.49 화면에서 드러남).
  → 프로토타입 `korea-sgg.json` 을 합친 모양을 **육지 마스크**로 쓰고 교집합만 남긴다.
  해안선은 korea-sgg 것(단순화됨)이 되고, 시·군·구 사이 경계와 코드는 DB 것이 남는다.

사용:
  pip install shapely
  python3 db/export/clip_regions_to_land.py            # rn-bench/assets/korea-regions.json 을 제자리에서 고친다
  python3 db/export/clip_regions_to_land.py IN OUT

DB 에서 경계를 다시 내보내면 **이 스크립트를 다시 돌려야 한다.**
"""
import json
import sys
from pathlib import Path

from shapely.geometry import Point, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
LAND = ROOT / "prototype" / "korea-sgg.json"
DEFAULT = ROOT / "rn-bench" / "assets" / "korea-regions.json"
# 육지 마스크의 해안이 DB 보다 거칠어 해안 구역이 조금 깎인다. 약 100m 만 늘려 메운다.
LAND_PAD_DEG = 0.001
# 마스크 가장자리에 남는 부스러기(약 0.01㎢ 미만)는 버린다
MIN_PART_DEG2 = 1e-6
# DB 내보내기와 같은 단순화(약 111m). 자르면 마스크의 꼭짓점이 붙어 3배로 불어난다
SIMPLIFY_DEG = 0.001


def rnd(obj, nd=5):
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, (list, tuple)):
        return [rnd(x, nd) for x in obj]
    if isinstance(obj, dict):
        return {k: rnd(v, nd) for k, v in obj.items()}
    return obj


def _bounds_of(coords):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for k in c:
                walk(k)

    walk(coords)
    return [min(xs), min(ys), max(xs), max(ys)]


def main(src: Path, dst: Path) -> None:
    land = unary_union([shape(f["geometry"]).buffer(0) for f in json.load(open(LAND))["features"]])
    land = land.buffer(LAND_PAD_DEG, quad_segs=2)
    fc = json.load(open(src))
    out, lost = [], []
    for f in fc["features"]:
        g = shape(f["geometry"]).buffer(0)
        c = g.intersection(land)
        parts = [p for p in getattr(c, "geoms", [c]) if p.geom_type == "Polygon" and p.area >= MIN_PART_DEG2]
        if not parts:
            lost.append(f["properties"].get("name"))
            continue
        c = unary_union(parts).simplify(SIMPLIFY_DEG, preserve_topology=True)
        # ★ bbox 와 라벨 좌표는 **잘린 도형 기준으로 다시 잡는다.** DB 값은 바다까지
        #   포함한 범위라, 지역을 눌러 들어갈 때(§13.50 flyTo) 옹진군처럼 바다가 넓은
        #   곳이 필요 이상으로 넓게 잡힌다 — 눌렀는데 덜 들어간 것처럼 보인다.
        #   여기서 같이 고치지 않으면 다음 내보내기 때 또 어긋난다.
        props = dict(f["properties"])
        geom = rnd(mapping(c))
        # ★ bbox 는 **파일에 실제로 적힌 좌표**에서 뽑는다. `c.bounds` 를 따로 반올림하면
        #   자릿수가 달라 경계가 몇 m 어긋나고, 그걸 나중에 "왜 안 맞지"로 다시 쫓게 된다.
        props["bbox"] = _bounds_of(geom["coordinates"])
        cx, cy = props.get("cx"), props.get("cy")
        if cx is None or cy is None or not c.contains(Point(cx, cy)):
            # 잘린 뒤 중심이 도형 밖(바다)이 됐다 — 반드시 안에 있는 점으로 옮긴다
            rp = c.representative_point()
            props["cx"], props["cy"] = round(rp.x, 4), round(rp.y, 4)
        out.append({"type": "Feature", "properties": props, "geometry": geom})
        kept = c.area / g.area if g.area else 1
        if kept < 0.5:
            print(f"  바다를 많이 덜어냄  {f['properties'].get('name')}: {kept:.0%} 남음")
    if lost:
        sys.exit(f"육지와 겹치지 않는 지역이 있다 — 마스크를 확인할 것: {lost}")
    json.dump({"type": "FeatureCollection", "features": out}, open(dst, "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)}개 지역 → {dst} ({dst.stat().st_size // 1024}K)")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(Path(a[0]) if a else DEFAULT, Path(a[1]) if len(a) > 1 else DEFAULT)
