#!/usr/bin/env python3
"""
`outside-cover.json` 을 만든다 — **대한민국만 구멍인 덮개** (§13.174)

★ 왜 이렇게 만드나.
  §13.128 은 북한을 **북한 모양** 폴리곤으로 덮었다. 그 방법은 덮을 나라마다
  그 나라 땅 모양이 있어야 하는데, 중국·일본·러시아 모양은 우리에게 **없다.**
  (국경 데이터를 새로 받아 오는 것은 라이선스·용량이 또 다른 일이 된다.)

  → 뒤집는다. **큰 사각형에서 대한민국을 빼면** 바깥 전부가 한 번에 덮인다.
    새로 받아 올 데이터가 **0바이트**다 — 이미 있는 `south-outline.json`
    (시군구 251개를 합친 모양, §13.131)을 구멍으로 쓴다.

★ 바다는 이 덮개가 **같이 덮는다.** 그래서 지도 쪽에서 물 겹을 덮개 **위에
  한 번 더** 그린다 — 그러면 바깥 땅은 평평해지고 바다는 그대로 파랗다.
  (§13.128 은 *"바다는 안 건드린다"* 고 적었는데, 그건 **덮개가 땅 모양일 때**
   할 수 있는 말이었다. 방법이 바뀌면 그 약속을 지키는 방법도 바뀐다.)

★ 사각형은 넉넉히 잡는다. `maxBounds` 로 중심이 한반도에 묶여 있어도, 최소 줌에서
  가장자리에 서면 꽤 멀리까지 보인다. 어차피 꼭짓점 네 개라 용량이 안 는다.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, "..", "..", "rn-bench", "assets", "south-outline.json")
OUT  = os.path.join(HERE, "..", "..", "rn-bench", "assets", "outside-cover.json")

# 지구를 다 덮을 필요는 없다 — 보이는 범위보다 넉넉하면 된다
W, S, E, N = 100.0, 10.0, 160.0, 55.0

def main():
    src = json.load(open(SRC, encoding="utf-8"))
    geom = src["geometry"] if src.get("type") == "Feature" else src
    assert geom["type"] == "MultiPolygon", geom["type"]

    # 각 섬·본토의 **바깥 고리만** 구멍으로 쓴다(안쪽 고리는 호수 같은 것이라 뺀다)
    holes = [poly[0] for poly in geom["coordinates"]]

    # GeoJSON 권고: 바깥 고리는 반시계, 구멍은 시계. 맞춰 둔다 —
    # 렌더러 대부분은 고리 **순서**로 판정하지만, 규격을 지켜 두면 다른
    # 도구(검증기·ogr)에서도 같은 뜻으로 읽힌다.
    def area2(ring):                     # 부호 있는 넓이 ×2
        return sum((ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1])
                   for i in range(len(ring) - 1))
    outer = [[W, S], [E, S], [E, N], [W, N], [W, S]]        # 반시계
    if area2(outer) < 0: outer.reverse()
    holes = [list(reversed(h)) if area2(h) > 0 else h for h in holes]   # 시계

    out = {"type": "Feature", "properties": {},
           "geometry": {"type": "Polygon", "coordinates": [outer] + holes}}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

    n = len(holes)
    print(f"구멍 {n}개 · {os.path.getsize(OUT)/1024:.0f} KB → {os.path.relpath(OUT, HERE)}")
    # 되읽어 확인 — 만들었다고 말하기 전에 꺼내 본다
    back = json.load(open(OUT, encoding="utf-8"))
    assert back["geometry"]["type"] == "Polygon"
    assert len(back["geometry"]["coordinates"]) == n + 1
    print("되읽기 OK")

if __name__ == "__main__":
    main()
