#!/usr/bin/env python3
"""
읍·면·동 경계를 subregions 에 올린다 (087).

  DB_URL=... db/import/load_subregions.py <geojson> [--dry-run]

자료
  통계청(KOSTAT) 2013 센서스 경계 — **"Free to share or remix"**
  southkorea/southkorea-maps `kostat/2013/json/skorea_submunicipalities_geo_simple.json`

★ OSM 을 **안 쓴다.** 한국 읍면동 경계가 고르지 않다 — 양평군은 하나도 없다(§13.162).
★ 이미 단순화된 파일이다(1.73 MB / 3,482개). 여기서 더 깎지 않는다 —
  깎을수록 싸지만 **줌 9~13 에서 보일 만큼은 남겨야** 한다.
★ `region_code` 는 **중심점이 어느 시군구 안인가**로 정한다(PostGIS 가 판단).
  섬·해안 18개는 중심점이 우리 폴리곤 밖이라 null 로 남는다 — **버리지 않는다.**
"""
import json, os, sys, subprocess

def wkt_multipolygon(geom):
    """GeoJSON Polygon/MultiPolygon → WKT MULTIPOLYGON"""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    out = []
    for poly in polys:
        rings = []
        for ring in poly:
            if ring[0] != ring[-1]:
                ring = ring + [ring[0]]            # 안 닫힌 고리가 실제로 있다
            if len(ring) < 4:
                continue                            # 삼각형도 안 되는 것은 버린다
            rings.append("(" + ",".join(f"{x} {y}" for x, y in ring) + ")")
        if rings:
            out.append("(" + ",".join(rings) + ")")
    return "MULTIPOLYGON(" + ",".join(out) + ")" if out else None

def main():
    src = sys.argv[1]
    dry = "--dry-run" in sys.argv
    db  = os.environ.get("DB_URL")
    if not db:
        sys.exit("DB_URL 이 필요하다")

    feats = json.load(open(src))["features"]
    rows, skipped = [], 0
    for f in feats:
        p = f["properties"]
        w = wkt_multipolygon(f["geometry"])
        if not w:
            skipped += 1
            continue
        rows.append((p["code"], p["name"], p.get("base_year"), w))
    print(f"  읽음 {len(rows):,}개 (버림 {skipped})")
    if dry:
        return

    # ★ COPY 로 넣는다. 3,482건 INSERT 를 한 줄씩 보내면 왕복이 3,482번이다.
    tsv = "\n".join("\t".join([c, n, (b or "\\N"), w]) for c, n, b, w in rows)
    sql = """
begin;
create temp table _sr (code text, name text, base_year text, wkt text) on commit drop;
\\copy _sr from stdin
%s
\\.
insert into public.subregions (code, region_code, name, base_year, geom, center)
select s.code,
       (select r.code from public.regions r
         where ST_Contains(r.geom, ST_Centroid(ST_GeomFromText(s.wkt, 4326))) limit 1),
       s.name, nullif(s.base_year, ''),
       ST_Multi(ST_MakeValid(ST_GeomFromText(s.wkt, 4326))),
       ST_Centroid(ST_GeomFromText(s.wkt, 4326))
from _sr s
on conflict (code) do update
  set region_code = excluded.region_code, name = excluded.name,
      geom = excluded.geom, center = excluded.center;
commit;
""" % tsv
    r = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", db],
                       input=sql, text=True, capture_output=True)
    print(r.stdout.strip()[-800:])
    if r.returncode != 0:
        print(r.stderr.strip()[-1200:]); sys.exit(1)
    print("  올림 완료")

if __name__ == "__main__":
    main()
