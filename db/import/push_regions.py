#!/usr/bin/env python3
"""
regions를 Supabase에 넣는다 (진짜 PostGIS 지오메트리로).

★ 로컬은 PostGIS 스텁이라 geom/bbox/center가 전부 point다. Supabase는 다르다 —
  geom geometry(MultiPolygon,4326) · bbox geometry(Polygon,4326) · center geometry(Point,4326).
  그래서 로컬용 load_regions.py를 그대로 못 쓴다. **이름을 잇는 규칙은 거기서 가져온다.**

★ 무료 한도(500MB)를 넘기지 않으려고 백필은 나눠서 돌리고 사이사이 vacuum 한다.
  places가 94MB(인덱스 포함 224MB)라, 한 번에 전부 UPDATE하면 죽은 행이 그만큼 더 쌓인다.
  region_code에 인덱스가 있어 HOT 업데이트가 안 되므로 인덱스도 같이 부푼다.

사용: db/import/push_regions.py [--regions] [--backfill] [--verify]
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
sys.path.insert(0, HERE)
import importlib.util
spec = importlib.util.spec_from_file_location("lr", os.path.join(HERE, "load_regions.py"))

# load_regions.py는 임포트하면 psql을 실행한다. 규칙만 여기 다시 적는다.
SIDO_FIX = {"강원도": "강원특별자치도", "전라북도": "전북특별자치도",
            "전라남도": "전남광주통합특별시", "광주광역시": "전남광주통합특별시"}
NAME_FIX = {"세종특별자치시 세종시": "세종특별자치시",
            "경상북도 군위군": "대구광역시 군위군",
            "인천광역시 남구": "인천광역시 미추홀구"}
SIDO_ALIAS = {
    "서울특별시": ["서울", "서울시"],          "부산광역시": ["부산", "부산시"],
    "대구광역시": ["대구", "대구시"],          "인천광역시": ["인천", "인천시"],
    "대전광역시": ["대전", "대전시"],          "울산광역시": ["울산", "울산시"],
    "세종특별자치시": ["세종", "세종시"],      "경기도": ["경기"],
    "충청북도": ["충북"],                      "충청남도": ["충남"],
    "경상북도": ["경북"],                      "경상남도": ["경남"],
    "제주특별자치도": ["제주", "제주도"],
    "강원특별자치도": ["강원도", "강원"],
    "전북특별자치도": ["전라북도", "전북"],
    "전남광주통합특별시": ["전라남도", "광주광역시", "전남", "광주"],
}

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
    out = (p.stdout or "") + (p.stderr or "")
    # 연결 문자열이 로그에 남지 않게 한다
    import re
    out = re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", out)
    print(f"--- {label} ---\n{out.strip()}")
    if p.returncode != 0:
        sys.exit(p.returncode)
    return out

def build_regions():
    import re
    off = {}
    for line in open(os.path.join(ROOT, "db/import/sgg_codes.tsv"), encoding="utf-8"):
        c, full = line.rstrip("\n").split("\t")
        off[full] = c
    feats = json.load(open(os.path.join(ROOT, "prototype/korea-sgg.json"), encoding="utf-8"))["features"]
    vals, miss = [], []
    for f in feats:
        p = f["properties"]
        sido = SIDO_FIX.get(p["sido"], p["sido"])
        name = p["name"]
        m = re.match(r"^(.+?시)([가-힣]+구)$", name)
        cand = [f"{sido} {name}"] + ([f"{sido} {m.group(1)} {m.group(2)}"] if m else [])
        cand = [NAME_FIX.get(c, c) for c in cand]
        full = next((c for c in cand if c in off), None)
        if not full:
            miss.append(f"{sido} {name}")
            continue
        # ★ 시도는 맞춰진 공식 전체명에서 다시 뽑는다 (NAME_FIX가 시도를 바꾸는 경우가 있다)
        sido = full.split(" ")[0]
        off_name = full[len(sido):].strip() or full
        gj = json.dumps(f["geometry"], ensure_ascii=False, separators=(",", ":"))
        # ★ ST_Multi로 감싼다 — 컬럼이 MultiPolygon이라 Polygon 하나가 오면 거부된다
        vals.append("({}, {}, {}, {}, ST_Multi(ST_GeomFromGeoJSON({})), "
                    "ST_Envelope(ST_GeomFromGeoJSON({})), "
                    "ST_Centroid(ST_GeomFromGeoJSON({})))".format(
                        q(off[full]), q(off_name), q(p.get("name_eng")), q(sido), q(gj), q(gj), q(gj)))
    return vals, miss

if __name__ == "__main__":
    args = sys.argv[1:] or ["--regions", "--backfill", "--verify"]

    if "--regions" in args:
        vals, miss = build_regions()
        print(f"경계 → 코드 매칭 {len(vals)}개, 못 맞춘 것 {len(miss)}개: {', '.join(miss)}")
        sql = ["set statement_timeout = '30min';", "begin;",
               "insert into public.regions(code,name,name_eng,sido,geom,bbox,center) values\n"
               + ",\n".join(vals)
               + """ on conflict (code) do update set
                 name=excluded.name, name_eng=excluded.name_eng, sido=excluded.sido,
                 geom=excluded.geom, bbox=excluded.bbox, center=excluded.center,
                 updated_at=now();""",
               "commit;",
               "select count(*) as regions적재 from public.regions;"]
        run("\n".join(sql), "regions 적재")

    if "--backfill" in args:
        # ★ 로컬(load_regions.py)과 **같은 순서**로 간다: A 토큰 → B 부분문자열 → C 좌표.
        #   순서가 다르면 두 DB가 조용히 달라진다.
        off = {}
        for line in open(os.path.join(ROOT, "db/import/sgg_codes.tsv"), encoding="utf-8"):
            c, full = line.rstrip("\n").split("\t")
            off[full] = c
        pairs = list(off.items())
        for f, c in list(pairs):
            head = f.split(" ")[0]
            for old in SIDO_ALIAS.get(head, []):
                pairs.append((old + f[len(head):], c))
        alias = [(a, cur) for cur, olds in SIDO_ALIAS.items() for a in [cur] + olds]

        # 임시 테이블은 psql 세션마다 사라진다 — 매번 다시 만든다
        PRE = ("set statement_timeout = '30min';\n"
               "create temp table stg_sgg(code text, fullname text);\n"
               "insert into stg_sgg values "
               + ",".join("(%s,%s)" % (q(c), q(f)) for f, c in pairs) + ";\n"
               "create temp table stg_ok as select s.code, s.fullname from stg_sgg s "
               "join public.regions r on r.code = s.code;\n"
               "create index on stg_ok(fullname); analyze stg_ok;\n"
               "create temp table stg_sido(alias text, sido text);\n"
               "insert into stg_sido values "
               + ",".join("(%s,%s)" % (q(a), q(c)) for a, c in alias) + ";\n"
               "analyze stg_sido;\n")
        REMAIN = "select count(*) as 남음 from public.places where region_code is null;"

        def remaining(out):
            import re
            m = re.findall(r"^\s*(\d+)\s*$", out, re.M)
            return int(m[-1]) if m else -1

        STEP_A = """
        with a as (
          select id, (string_to_array(address,' '))[1] t1,
                 array_to_string((string_to_array(address,' '))[1:2],' ') t2,
                 array_to_string((string_to_array(address,' '))[1:3],' ') t3
          from public.places
          where region_code is null and coalesce(address,'') <> '' limit 80000
        ),
        m as (select a.id, coalesce(c3.code, c2.code, c1.code) code from a
              left join stg_ok c3 on c3.fullname = a.t3
              left join stg_ok c2 on c2.fullname = a.t2
              left join stg_ok c1 on c1.fullname = a.t1)
        update public.places p set region_code = m.code
        from m where p.id = m.id and m.code is not null;
        """
        prev = -1
        for i in range(1, 12):
            out = run(PRE + STEP_A + REMAIN, f"A 배치 {i}")
            n = remaining(out)
            print(f"    남은 행 {n}")
            if n == prev or n <= 0:
                break
            prev = n
            run("vacuum public.places;", f"vacuum {i}")

        # 경계가 없는 시군구(인천 재편 등)를 **장소 좌표의 외접 사각형**으로 만든다.
        # 추측한 모양이 아니라 '아는 장소들이 실제로 퍼져 있는 범위'다.
        run(PRE + """
        insert into public.regions(code, name, sido, geom, bbox, center)
        select s.code,
               substr(s.fullname, position(' ' in s.fullname) + 1),
               (string_to_array(s.fullname,' '))[1],
               ST_Multi(ST_Envelope(ST_Collect(p.geom))),
               ST_Envelope(ST_Collect(p.geom)),
               ST_Centroid(ST_Collect(p.geom))
        from stg_sgg s join public.places p
          on array_to_string((string_to_array(p.address,' '))[1:2],' ') = s.fullname
        where not exists (select 1 from public.regions r where r.code = s.code)
          and p.region_code is null
        group by s.code, s.fullname
        having count(*) >= 20 and ST_Area(ST_Envelope(ST_Collect(p.geom))) > 0
        on conflict (code) do nothing;
        select count(*) as regions from public.regions;
        """, "경계 없는 지역 생성")

        run(PRE + STEP_A + REMAIN, "A 다시")

        run(PRE + """
        with tgt as (select id, address from public.places
                     where region_code is null and coalesce(address,'') <> ''),
        withsido as (
          select t.id, t.address,
                 (select a.sido from stg_sido a where t.address like a.alias || ' %'
                  order by length(a.alias) desc limit 1) as sido
          from tgt t),
        cand as (
          select w.id, r.code, length(r.name) ln
          from withsido w join public.regions r
            on length(r.name) > 0 and position(r.name in w.address) > 0
           and (w.sido is null or r.sido = w.sido)),
        best as (select id, max(ln) ln from cand group by id),
        pick as (select c.id, min(c.code) code, count(*) n
                 from cand c join best b on b.id=c.id and b.ln=c.ln group by c.id)
        update public.places p set region_code = pick.code
        from pick where p.id = pick.id and pick.n = 1;
        """ + REMAIN, "B 부분 문자열")

        run("""set statement_timeout = '30min';
        update public.places p set region_code = (
          select q.region_code from public.places q
          where q.region_code is not null
          order by q.geom <-> p.geom limit 1)
        where p.region_code is null;
        """ + REMAIN, "C 좌표")
        run("vacuum analyze public.places;", "마무리 vacuum")

        # ★ 적재의 마지막은 **좌표 검사**다. region_code가 채워진 직후가 잴 수 있는 시점이다.
        #   거르거나 고치지 않고 geom_offset_m에 숫자만 적는다 (마이그레이션 018).
        import subprocess as _sp
        _sp.run([sys.executable, os.path.join(ROOT, "db/import/check_geom.py")], env=env())

    if "--verify" in args:
        run("""
        select count(*) filter (where region_code is not null) as 코드있음,
               count(*) as 전체,
               pg_size_pretty(pg_database_size(current_database())) as db크기
        from public.places;
        """, "확인")
