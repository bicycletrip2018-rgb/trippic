#!/usr/bin/env python3
"""
Geofabrik 추출본(ogr2ogr가 이미 폴리곤으로 조립해 준 것)을 우리 시군구 코드에 맞춘다.

★ 왜 이어붙이기 코드가 필요 없나 — GDAL의 OSM 드라이버가 관계의 way들을
  multipolygon으로 **알아서 조립**한다. Overpass에서는 내가 직접 고리를 이어야 했다.
★ 이름이 겹친다(중구·동구·서구·남구·북구·강서구·고성군). **우리 중심점을 품는 것**을 고른다.
★ 일반구(수원시 장안구)는 OSM에서 admin_level=7이고 이름이 '장안구'다.
  우리 이름은 '수원시 장안구'라 마지막 토큰으로 맞춘다.
"""
import json, os, sys

SP = os.path.dirname(os.path.abspath(__file__))

def npts(g):
    c = g["coordinates"]
    return sum(len(r) for r in c) if g["type"] == "Polygon" else sum(len(r) for p in c for r in p)

def polys(g):
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]

def pip(pt, ring):
    x, y = pt; inside = False
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i][0], ring[i][1]; x2, y2 = ring[i + 1][0], ring[i + 1][1]
        if (y1 > y) != (y2 > y):
            xx = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xx: inside = not inside
    return inside

def wkt(g):
    def ring(r): return "(" + ",".join(f"{p[0]:.6f} {p[1]:.6f}" for p in r) + ")"
    return "MULTIPOLYGON(" + ",".join("(" + ",".join(ring(r) for r in p) + ")" for p in polys(g)) + ")"

rows = [l.rstrip("\n").split("\t") for l in open(os.path.join(SP, "regions_list.tsv"), encoding="utf-8") if l.strip()]
feats = json.load(open(os.path.join(SP, "sgg67.json"), encoding="utf-8"))["features"]

by_name = {}
for f in feats:
    by_name.setdefault(f["properties"].get("name"), []).append(f)

out, miss, ambiguous = [], [], 0
for code, sido, name, x0, y0, x1, y1, cx, cy in rows:
    key = name.split(" ")[-1]          # '수원시 장안구' → '장안구'
    cands = by_name.get(key, [])
    if not cands:
        miss.append((code, sido, name, "OSM에 없음")); continue
    c = (float(cx), float(cy))
    hit = [f for f in cands if any(pip(c, p[0]) for p in polys(f["geometry"]))]
    if not hit:
        # 중심점을 품는 게 없으면 bbox 안에 드는 것으로 (해안·섬에서 중심이 바다일 수 있다)
        hit = [f for f in cands
               if float(x0) - 0.3 <= f["geometry"]["coordinates"][0][0][0][0] <= float(x1) + 0.3]
        if hit: ambiguous += 1
    if not hit:
        miss.append((code, sido, name, f"위치 불일치({len(cands)}개 후보)")); continue
    g = hit[0]["geometry"]
    out.append((code, sido, name, npts(g), wkt(g)))

dst = os.path.join(SP, "nat_wkt.tsv")
with open(dst, "w", encoding="utf-8") as f:
    for r in out: f.write("\t".join(str(x) for x in r) + "\n")

tot = sum(r[3] for r in out)
print(f"맞춘 것 {len(out)}/{len(rows)}곳 · 꼭짓점 {tot:,} (평균 {tot//max(len(out),1)})")
print(f"중심점 대신 bbox로 고른 것 {ambiguous}곳")
print(f"WKT 파일 {os.path.getsize(dst)/1024/1024:.1f} MB")
if miss:
    print(f"못 맞춘 것 {len(miss)}곳:")
    for m in miss: print("   ", " ".join(m))
