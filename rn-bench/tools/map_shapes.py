#!/usr/bin/env python3
"""
지도에 쓰는 **도형 두 개**를 만든다 (§13.131)

    assets/north-cover.json   북한을 평평하게 덮는 면      (§13.128)
    assets/south-outline.json 지명을 **좌표로** 가르는 울타리 (§13.131)

★ 왜 도구인가 — 처음엔 둘 다 **그 자리에서 쓴 스크립트**로 만들었다. 그러면
  *"3.3km 를 부풀렸다"* 같은 숫자가 어디에도 안 남아서, 저쪽 데이터가 바뀌어
  다시 만들 때 **같은 것을 못 만든다.** 검증도 같이 여기 둔다.

★ 앞서 이 파일은 **지명을 이름으로 거르는 목록**을 뽑는 도구였다(§13.129·§13.130).
  MapLibre 의 `within` 이 네이티브에서 돈다는 것을 확인하고 **좌표로 가르게**
  바꿨으므로(§13.131), 4,119개짜리 이름 목록은 통째로 필요 없어졌다.
  그때 배운 것은 **검증으로 남겼다** — 아래 `SAME_NAME` 이 그것이다.

사용:
    python3 -m venv .venv && .venv/bin/pip install shapely
    .venv/bin/python rn-bench/tools/map_shapes.py
"""
import json, os, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "rn-bench", "assets")
NE = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
      "geojson/ne_10m_admin_0_countries.geojson")

# ★ 북쪽 모양을 남한에서 뗄 때의 여유. 0.002°≈220m.
#   Natural Earth 의 북한 모양을 그대로 쓰면 남한을 0.1%(≈130km²) 덮는데,
#   하필 **파주·철원 같은 DMZ 접경** — 사람이 실제로 가는 곳이다(§13.128).
NK_MARGIN = 0.002
# ★ 울타리를 부풀리는 폭. 0.03°≈3.3km.
#   해안·섬의 점이 단순화 때문에 울타리 밖으로 떨어지면 **그 지명이 사라진다.**
OUTLINE_SIMPLIFY, OUTLINE_BUFFER = 0.03, 0.03

# ★ **남북·국외가 같이 쓰는 이름** — 이름으로 거르던 시절(§13.130)에 타일에서
#   찾아낸 것들이다. 한자는 달라도 `name:ko` 가 같다. 이제는 좌표로 가르므로
#   문제가 안 되지만, **울타리가 제대로 갈라 주는지 재는 자**로 남겨 둔다.
#   (바깥 좌표는 울타리 **밖**이어야 한다. 하나라도 안에 들면 울타리가 샌 것이다.)
# ★★ **원본 경계 파일에 독도가 없다.** `korea-regions.json` 의 동쪽 끝이
#   130.941 인데 독도는 131.87 이다 — 울릉군 면이 독도를 안 담고 있다.
#   울타리를 그대로 만들면 **독도 지명이 가려진다.** 모르고 넘어갈 뻔했고
#   `test/shapes.test.cjs` 가 잡았다. 빠진 땅은 **여기에 적어서** 더한다.
#   (마라도는 원본에서 250m 밖인데 3.3km 부풀림이 덮는다 — 그건 그냥 둔다.)
EXTRA_LAND = {
    "독도": (131.8664, 37.2422, 0.02),      # lon, lat, 반지름(도) ≈ 2.2km
}

SAME_NAME = {
    "鞍山市 (경기 안산시와 같은 이름)":   (122.99, 41.12),
    "安阳市 (경기 안양시와 같은 이름)":   (114.39, 36.10),
    "麗水市 (전남 여수시와 같은 이름)":   (119.92, 28.45),
    "순천시(평남) (전남 순천시와 같은)":  (125.95, 39.42),
    "김화(북) (철원 김화읍과 같은 이름)": (127.42, 38.52),
    "평양": (125.75, 39.02), "단둥": (124.39, 40.12), "후쿠오카": (130.40, 33.59),
}


def main():
    from shapely.geometry import shape, mapping, Point
    from shapely.ops import unary_union

    sgg = json.load(open(os.path.join(ASSETS, "korea-regions.json")))
    south = unary_union([shape(f["geometry"]).buffer(0) for f in sgg["features"]])

    print("Natural Earth 받는 중…")
    ne = json.loads(urllib.request.urlopen(NE, timeout=120).read())
    prk = shape([f for f in ne["features"]
                 if f["properties"].get("ADM0_A3") == "PRK"][0]["geometry"])

    # ── ① 북한 덮개 ──────────────────────────────────────────────────
    cover = prk.simplify(0.004, preserve_topology=True).difference(south.buffer(NK_MARGIN))
    bad = cover.intersection(south).area
    print(f"① north-cover  남한 침범 넓이 {bad:.8f} {'OK' if bad == 0 else '★ 샌다'}")
    write("north-cover.json", cover)

    # ── ② 남한 울타리 ────────────────────────────────────────────────
    out = (south.simplify(OUTLINE_SIMPLIFY, preserve_topology=True)
                .buffer(OUTLINE_BUFFER)
                .simplify(OUTLINE_BUFFER / 2, preserve_topology=True)
                .difference(cover))          # 북쪽으로는 한 뼘도 안 넘어간다
    out = unary_union([out] + [Point(x, y).buffer(r) for x, y, r in EXTRA_LAND.values()])
    miss = [f["properties"]["name"] for f in sgg["features"]
            if not out.contains(Point(f["properties"]["cx"], f["properties"]["cy"]))]
    leak = [k for k, (x, y) in SAME_NAME.items() if out.contains(Point(x, y))]
    print(f"② south-outline 조각 {len(out.geoms) if hasattr(out, 'geoms') else 1}")
    print(f"   시군구 중심 {251 - len(miss)}/251 안에 있다 {'OK' if not miss else miss}")
    print(f"   같은 이름 바깥 좌표 {len(SAME_NAME)}개 전부 밖 {'OK' if not leak else '★ ' + str(leak)}")
    print(f"   북쪽과 겹치는 넓이 {out.intersection(cover).area:.8f}")
    for k, (x, y, _) in EXTRA_LAND.items():
        print(f"   더해 넣은 땅 {k} 안에 있다: {out.contains(Point(x, y))}")
    write("south-outline.json", out)
    if miss or leak or bad:
        raise SystemExit("★ 검증 실패 — 숫자를 고치고 다시 돌릴 것")


def write(name, geom):
    from shapely.geometry import mapping
    p = os.path.join(ASSETS, name)
    js = json.dumps({"type": "Feature", "properties": {}, "geometry": mapping(geom)},
                    separators=(",", ":"))
    open(p, "w").write(js)
    print(f"   저장 {name} · {len(js) // 1024}KB")


if __name__ == "__main__":
    main()
