#!/usr/bin/env python3
"""
OSM에서 받아 이어붙인 시군구 경계를 Supabase regions에 올린다.

  db/import/push_osm_regions.py <wkt.tsv> [--tolerance 5] [--dry-run]

★ 단순화는 **미터**로 한다. SRID 4326에서 ST_SimplifyPreserveTopology의 단위는 '도'라
  위도·경도에서 오차가 달라진다. 한국 좌표계(EPSG:5179)로 옮겨 자르고 되돌린다.

★ 나중에 되돌릴 수 있게 세 가지를 남긴다
  ① 원본 WKT를 data/out/osm_sgg_wkt.tsv 에 보관한다 (단순화 전 그대로)
  ② regions.geom_source / geom_simplify_m 에 출처와 오차를 적는다 (마이그레이션 017)
  ③ 용량이 허락하면 `--tolerance 0` 으로 같은 파일을 다시 올리면 끝이다

★ OSM은 ODbL이다. geom_source='osm'이 들어가는 순간
  그 경계를 보여주는 화면에 "© OpenStreetMap contributors" 표기 의무가 생긴다.
"""
import os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")

def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"

def env():
    e = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""))
    if "DB_URL" not in e:
        for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            if line.startswith("DB_URL="):
                e["DB_URL"] = line.split("=", 1)[1].strip().strip('"').strip("'")
    return e

def run(sql, label):
    e = env()
    p = subprocess.run(["psql", "-X", "-q", "-d", e["DB_URL"], "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input=sql, text=True, env=e, capture_output=True)
    out = re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", (p.stdout or "") + (p.stderr or ""))
    print(f"--- {label} ---\n{out.strip()}")
    if p.returncode != 0:
        sys.exit(p.returncode)
    return out

if __name__ == "__main__":
    src = sys.argv[1]
    tol = 5.0
    if "--tolerance" in sys.argv:
        tol = float(sys.argv[sys.argv.index("--tolerance") + 1])
    dry = "--dry-run" in sys.argv

    rows = [l.rstrip("\n").split("\t") for l in open(src, encoding="utf-8") if l.strip()]
    print(f"경계 {len(rows)}곳 · 단순화 {tol}m" + (" · 시험만" if dry else ""))

    # ① 원본을 프로젝트에 보관한다 (세션 임시폴더는 사라진다)
    keep = os.path.join(ROOT, "data/out/osm_sgg_wkt.tsv")
    os.makedirs(os.path.dirname(keep), exist_ok=True)
    if os.path.abspath(src) != os.path.abspath(keep):
        with open(keep, "w", encoding="utf-8") as f:
            for r in rows:
                f.write("\t".join(r) + "\n")
        print(f"원본 보관 → {keep} ({os.path.getsize(keep)/1024/1024:.1f} MB)")

    run("select pg_size_pretty(pg_database_size(current_database())) as 올리기_전;", "용량")

    # 미터 단순화: 5179로 옮겨 자르고 되돌린다. tol=0이면 자르지 않는다
    def geom_expr(w):
        # ★ ST_MakeValid는 자기교차 도형에서 GeometryCollection(폴리곤+선)을 돌려준다.
        #   CollectionExtract(...,3)으로 폴리곤만 남겨야 MultiPolygon 칼럼에 들어간다.
        g = f"ST_CollectionExtract(ST_MakeValid(ST_GeomFromText({q(w)},4326)),3)"
        if tol > 0:
            g = f"ST_Transform(ST_SimplifyPreserveTopology(ST_Transform({g},5179),{tol}),4326)"
        return f"ST_Multi(ST_CollectionExtract(ST_MakeValid({g}),3))"

    B = 25
    for i in range(0, len(rows), B):
        chunk = rows[i:i + B]
        sql = ["set statement_timeout='30min';", "begin;"]
        for code, sido, name, npts, w in chunk:
            g = geom_expr(w)
            sql.append(f"""update public.regions set
  geom = ({g})::geometry(MultiPolygon,4326),
  bbox = ST_Envelope({g})::geometry(Polygon,4326),
  center = ST_PointOnSurface({g})::geometry(Point,4326),
  geom_source = 'osm', geom_simplify_m = {tol}, updated_at = now()
where code = {q(code)};""")
        sql.append("rollback;" if dry else "commit;")
        run("\n".join(sql), f"적재 {i+1}~{min(i+B,len(rows))}")

    run("""
    select geom_source, coalesce(geom_simplify_m,-1) as 단순화m, count(*),
           round(avg(ST_NPoints(geom))) as 평균꼭짓점
    from public.regions group by 1,2 order by 3 desc;
    select pg_size_pretty(pg_database_size(current_database())) as 올린_후;
    select count(*) as 좌표검사_낡음 from public.places where geom_checked_at is not null;
    """, "결과")

    # ★ 경계가 바뀌면 places.geom_offset_m이 낡는다. 자동으로 돌리지는 않는다 —
    #   465,914행 재검사가 7분이라, 부를지 말지는 사람이 정한다.
    if not dry:
        print("\n경계가 바뀌었으니 좌표 검사를 다시 돌려야 한다:")
        print("  python3 db/import/check_geom.py --all")
