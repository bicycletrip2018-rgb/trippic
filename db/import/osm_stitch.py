#!/usr/bin/env python3
"""
OSM 경계 관계(relation)를 폴리곤 WKT로 잇는다.

OSM은 경계를 **길 조각(way) 여러 개**로 나눠 갖고 있다. 폴리곤이 되려면
끝점을 맞춰 고리(ring)로 이어야 한다. role이 outer면 바깥, inner면 구멍이다
(role이 비어 있으면 outer로 본다 — 실제 데이터에 그런 경우가 있다).
"""
import json, sys

def rings(ways):
    """way 목록(각각 [(lon,lat), ...])을 닫힌 고리들로 잇는다."""
    segs = [list(w) for w in ways if len(w) >= 2]
    out = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == cur[-1]:
                    cur += s[-2::-1]; segs.pop(i); changed = True; break
                if s[-1] == cur[0]:
                    cur = s[:-1] + cur; segs.pop(i); changed = True; break
                if s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur; segs.pop(i); changed = True; break
        if cur[0] != cur[-1]:
            cur.append(cur[0])          # 못 닫히면 강제로 닫는다 (해안선 조각 등)
        if len(cur) >= 4:
            out.append(cur)
    return out

def area(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]; x2, y2 = ring[i + 1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2

def wkt(polys):
    def r(ring):
        return "(" + ",".join(f"{x:.7f} {y:.7f}" for x, y in ring) + ")"
    return "MULTIPOLYGON(" + ",".join("(" + ",".join(r(x) for x in p) + ")" for p in polys) + ")"

d = json.load(open(sys.argv[1], encoding="utf-8"))
rows = []
for e in d["elements"]:
    name = e["tags"]["name"]
    outer, inner = [], []
    for m in e.get("members", []):
        if m["type"] != "way" or "geometry" not in m:
            continue
        pts = [(round(p["lon"], 7), round(p["lat"], 7)) for p in m["geometry"]]
        (inner if m.get("role") == "inner" else outer).append(pts)
    orings = sorted(rings(outer), key=area, reverse=True)
    irings = rings(inner)
    if not orings:
        print(f"  ! {name}: 고리를 못 만들었다", file=sys.stderr); continue
    # 구멍은 그것을 품는 가장 작은 바깥 고리에 붙인다 (여기서는 가장 큰 것 하나로 충분하다)
    polys = [[orings[0]] + irings] + [[o] for o in orings[1:]]
    rows.append((name, len(orings), sum(len(r) for p in polys for r in p), wkt(polys)))

for name, n, pts, w in rows:
    print(f"{name}\t{n}\t{pts}\t{w}")
