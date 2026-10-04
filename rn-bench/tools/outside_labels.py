#!/usr/bin/env python3
"""
바깥 지명을 **타일에서 뽑는다** (§13.129 북쪽 · §13.130 중국·일본·러시아)

★ 왜 스크립트인가 — 손으로 적으면 빠뜨리고, 빠뜨린 줄은 **조용히 샌다**.
  §13.128 에서 이름 목록을 피한 이유가 그것이다. 피할 수 없다면
  **적지 말고 뽑는다** — 그러면 다시 돌려서 갱신할 수 있다.

★ **가장 위험한 것은 같은 이름이다.** 남북이 같은 지명을 쓰는 곳이 있다.
  이름으로 지우면 **남한 라벨까지 사라진다.** 실제로 처음 돌렸을 때 36개가
  겹쳤고 거기 **`순천시`** 가 있었다 — 손으로 적었으면 **전남 순천시가
  지도에서 사라졌을 것이다.** 그래서 한반도 전체를 훑어 점이 어느 쪽에 있는지
  보고, **남한에도 있는 이름은 뺀다.** 뺀 것은 화면에 적는다.

★ **`city`·`town` 만 지운다.** 처음엔 전부(1,025개) 지우려 했는데, 그러면
  리·동까지 들어간다. 남쪽 이름은 z≤9 까지만 모아서 **z10 이상에서만 보이는
  남한 마을**과 이름이 겹치면 그 라벨까지 조용히 사라진다 — 확인할 수 없는
  방식으로 틀리는 것이 제일 나쁘다. 북한이 **평평한 윤곽**인 이상 깊이
  들어가 리 이름을 볼 일도 없다. 보이는 것만 지운다.

사용:
    python3 -m venv .venv && .venv/bin/pip install mapbox-vector-tile shapely
    .venv/bin/python rn-bench/tools/outside_labels.py
"""
import json, math, os, sys, time, urllib.request, gzip

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "rn-bench", "assets")
# 한반도 전체 — 남쪽도 같이 훑어야 **같은 이름**을 찾을 수 있다
# ① 한반도 — 남쪽 이름을 **지킬 목록**으로 모으는 범위. 깊게(z9) 본다.
BBOX  = (124.0, 33.0, 132.0, 43.2)
ZOOMS = (5, 6, 7, 8, 9)
# ② 이웃 — 중국·일본·러시아·대만. **첫 화면에 끼어드는 것**만 보면 되므로 z8 까지.
#    축소가 전국에서 멈추므로(§13.130) 그보다 넓은 화면은 아예 없다. 이 상자
#    바깥(베이징·도쿄)은 **일부러 찾아간 자리**라 안 건드린다 — 그렇다고 적는다.
BBOX2  = (120.0, 30.0, 136.0, 44.0)
ZOOMS2 = (5, 6, 7, 8)
STYLE = "https://tiles.openfreemap.org/styles/dark"

def tilexy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

CACHE = os.path.join(ROOT, ".tilecache")      # 남의 서버를 두 번 안 때린다 (.gitignore)

def get(url, binary=True, cache=False):
    if cache:
        f = os.path.join(CACHE, url.split("/planet/")[-1].replace("/", "_"))
        if os.path.exists(f): return open(f, "rb").read()
    req = urllib.request.Request(url, headers={"User-Agent": "trippic-build/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
    if cache:
        os.makedirs(CACHE, exist_ok=True); open(f, "wb").write(b)
    return b if binary else b.decode()

def main():
    import mapbox_vector_tile
    from shapely.geometry import shape, Point
    from shapely.ops import unary_union
    from shapely.prepared import prep

    north = prep(shape(json.load(open(os.path.join(ASSETS, "north-cover.json")))["geometry"]))
    sgg = json.load(open(os.path.join(ASSETS, "korea-regions.json")))
    south = prep(unary_union([shape(f["geometry"]).buffer(0) for f in sgg["features"]]))

    tmpl = json.loads(get(json.loads(get(STYLE, False))["sources"]["openmaptiles"]["url"], False))["tiles"][0]
    print("타일:", tmpl)

    n_names, f_names, s_names, seen = set(), set(), set(), 0
    for z, bb in [(z, BBOX) for z in ZOOMS] + [(z, BBOX2) for z in ZOOMS2]:
        x0, y1 = tilexy(bb[1], bb[0], z)
        x1, y0 = tilexy(bb[3], bb[2], z)
        tiles = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
        print(f"  z={z}  타일 {len(tiles)}장  {bb}")
        for x, y in tiles:
            try:
                raw = get(tmpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)), cache=True)
            except Exception as e:
                print(f"    건너뜀 {z}/{x}/{y}: {e}"); continue
            if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
            if not raw: continue
            for f in mapbox_vector_tile.decode(raw).get("place", {}).get("features", []):
                g = f["geometry"]
                if g["type"] != "Point": continue
                # mapbox_vector_tile 는 기본 4096 격자 좌표를 준다 → 경위도로 되돌린다
                px, py = g["coordinates"]
                n = 2 ** z
                lon = (x + px / 4096) / n * 360 - 180
                lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1 - py / 4096) / n))))
                p = Point(lon, lat)
                names = {str(f["properties"].get(k)) for k in ("name", "name:ko") if f["properties"].get(k)}
                if not names: continue
                seen += 1
                cls = f["properties"].get("class")
                if south.contains(p):
                    s_names |= names          # 남쪽은 **종류를 안 가린다** — 넓게 보호한다
                elif north.contains(p):
                    if cls in ("city", "town"): n_names |= names
                elif cls in ("city", "town"):
                    f_names |= names          # 중국·일본·러시아·대만
            time.sleep(0.03)      # 남의 서버다. 천천히 받고, 받은 것은 캐시한다.

    outside = n_names | f_names
    both = sorted(outside & s_names)
    drop = sorted(outside - s_names)
    print(f"\n점 {seen}개 · 북쪽 {len(n_names)} · 이웃 {len(f_names)} · 남쪽 이름(전부) {len(s_names)}")
    if both:
        print(f"★ 남한과 **같이 쓰는 이름** {len(both)}개 — 지우면 남한도 사라지므로 **뺀다**:")
        for b in both: print("   ", b)
    out = {
        "_": "타일에서 뽑은 바깥 지명. 손으로 고치지 말고 outside_labels.py 를 다시 돌릴 것(§13.129·§13.130).",
        "zooms": list(ZOOMS), "zooms_neighbour": list(ZOOMS2),
        "bbox": list(BBOX), "bbox_neighbour": list(BBOX2),
        "classes": ["city", "town"],
        "kept_shared": both, "names": drop,
    }
    json.dump(out, open(os.path.join(ASSETS, "outside-labels.json"), "w"), ensure_ascii=False, indent=0)
    print(f"\n저장: outside-labels.json · {len(drop)}개 (북 {len(n_names - s_names)} · 이웃 {len(f_names - s_names)})")

if __name__ == "__main__":
    main()
