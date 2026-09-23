#!/usr/bin/env python3
"""
regions 테이블을 채우고 places.region_code를 메운다.

★ 왜 법정동코드인가
  사전 키를 '해운대구' 같은 짧은 이름으로 두면 '중구'처럼 여러 시도에 있는 이름을 가를 수 없다.
  게다가 주소의 시도 표기가 들쭉날쭉하다("제주특별자치도 제주시" / "제주 제주시").
  법정동코드 시군구 5자리(예: 26350 부산광역시 해운대구)는 이 둘을 한 번에 없앤다.

자료 둘을 잇는다
  · db/import/sgg_codes.tsv   행정표준코드관리시스템(code.go.kr) 법정동코드 전체자료에서
                              시군구 레벨(뒤 5자리가 00000, 시도 아님, 존재)만 추린 269행
  · prototype/korea-sgg.json  시군구 경계 250개. ★ 여기 들어 있는 code는 법정동코드가 아니다
                              (종로구가 11010 — 법정동코드는 11110). 그래서 **이름으로** 잇는다.

이름으로 잇다 보니 생기는 것들 — 숨기지 않고 남긴다
  · 시도명이 바뀌었다: 강원도→강원특별자치도, 전라북도→전북특별자치도,
    전라남도·광주광역시→전남광주통합특별시
  · 경계 파일이 '수원시장안구'처럼 띄어쓰기를 뺐다
  · 군위군이 경북에서 대구로 갔다
  · 인천이 제물포구·영종구·서해구·검단구로 재편됐다 — 옛 중구/동구/남구/서구는
    **이름으로 이을 수 없다.** 경계가 쪼개지고 합쳐졌기 때문이다. 못 맞춘 채로 둔다.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SGG = os.path.join(ROOT, "db/import/sgg_codes.tsv")
POLY = os.path.join(ROOT, "prototype/korea-sgg.json")

SIDO_FIX = {"강원도": "강원특별자치도", "전라북도": "전북특별자치도",
            "전라남도": "전남광주통합특별시", "광주광역시": "전남광주통합특별시"}
NAME_FIX = {"세종특별자치시 세종시": "세종특별자치시",
            "경상북도 군위군": "대구광역시 군위군",
            # 개명이라 경계가 그대로다 — 이어도 안전하다.
            # (인천 중구·동구·서구는 제물포구·영종구·서해구·검단구로 **쪼개졌다** — 잇지 않는다)
            "인천광역시 남구": "인천광역시 미추홀구"}

official = {}
for line in open(SGG, encoding="utf-8"):
    code, full = line.rstrip("\n").split("\t")
    official[full] = code

feats = json.load(open(POLY, encoding="utf-8"))["features"]
rows, unmatched = [], []
for f in feats:
    p = f["properties"]
    sido = SIDO_FIX.get(p["sido"], p["sido"])
    name = p["name"]
    # 경계 파일은 '수원시장안구'처럼 붙여 쓴다 — 공식 표기는 '수원시 장안구'
    m = re.match(r"^(.+?시)([가-힣]+구)$", name)
    cand = [f"{sido} {name}"]
    if m:
        cand.append(f"{sido} {m.group(1)} {m.group(2)}")
    cand = [NAME_FIX.get(c, c) for c in cand]
    full = next((c for c in cand if c in official), None)
    if not full:
        unmatched.append(f"{sido} {name}")
        continue
    code = official[full]
    # ★ 이름은 경계 파일이 아니라 **공식 표기**를 쓴다.
    #   경계 파일은 '수원시장안구'처럼 붙여 쓰는데, 주소는 '수원시 장안구'로 띄어 쓴다.
    #   이름으로 주소를 맞출 거라 여기서 어긋나면 한 곳도 못 맞춘다.
    # ★ 시도는 **맞춰진 공식 전체명**에서 다시 뽑는다.
    #   NAME_FIX가 시도까지 바꾸는 경우가 있다(경상북도 군위군 → 대구광역시 군위군).
    #   경계 파일의 옛 시도 길이로 자르면 '시 군위군'이 남는다 — 실제로 그렇게 들어갔다.
    # ★ 세종은 공식 전체명이 '세종특별자치시' 하나뿐이라 시도를 떼면 빈 문자열이 된다.
    #   position('' in 주소)는 1이라 **모든 주소에 매칭된다**. 비면 전체명을 쓴다.
    sido = full.split(" ")[0]
    off_name = full[len(sido):].strip() or full
    bb = p["bbox"]
    rows.append((code, off_name, p.get("name_eng"), sido,
                 (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2))

print(f"경계 {len(feats)}개 → 법정동코드 매칭 {len(rows)}개 ({100*len(rows)/len(feats):.1f}%)")
if unmatched:
    print("  못 맞춘 것(행정구역 재편):", ", ".join(unmatched))

def q(v):
    """SQL 문자열 리터럴. repr()로 때우면 따옴표가 든 값에서 깨진다."""
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"

# ★ full은 예약어다(FULL JOIN) — 컬럼명으로 쓰면 구문 오류가 난다
sql = ["begin;", "set local synchronous_commit = off;",
       "create temp table stg_sgg(code text, fullname text);"]
# ★ 주소에는 옛 시도명이 남아 있다("전라남도 여수시"). 같은 코드를 옛 이름으로도 찾게 한다.
#   옛 이름과 축약형을 함께 받는다("경남 사천시", "제주 제주시" 같은 주소가 실제로 있다)
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
pairs = [(f, c) for f, c in official.items()]
for f, c in list(pairs):
    head = f.split(" ")[0]
    for old in SIDO_ALIAS.get(head, []):
        pairs.append((old + f[len(head):], c))
sql.append("insert into stg_sgg values "
           + ",".join("(%s,%s)" % (q(c), q(f)) for f, c in pairs) + ";")
# ★ 임시 테이블에는 통계가 없다. ANALYZE를 빼먹으면 플래너가 중첩 루프를 골라
#   1,635,152행 × 269행을 돈다 — 실제로 5분이 넘도록 **한 행도 못 썼다.**
sql.append("create index on stg_sgg(fullname);")
sql.append("analyze stg_sgg;")
# regions 적재 — 로컬 스텁은 geom이 point라 중심점을 넣는다(실서버는 폴리곤)
vals = ",".join(
    "(%s,%s,%s,%s,point(%r,%r),point(%r,%r),point(%r,%r),'korea-sgg',null)" % (
        q(c), q(n), q(e), q(s), lng, lat, lng, lat, lng, lat)
    for (c, n, e, s, lng, lat) in rows)
# ★ delete 하면 안 된다 — places.region_code가 FK로 참조하고 있다.
#   (실제로 여기서 트랜잭션이 통째로 막혔고, 출력을 grep으로 걸러 보느라 못 봤다)
#   upsert로 갈아 끼운다.
# ★ 출처를 같이 적는다 (마이그레이션 017). 나중에 무엇을 더 정밀하게 올릴지 이 칸이 답한다.
sql.append("insert into public.regions(code,name,name_eng,sido,geom,bbox,center,geom_source,geom_simplify_m) values "
           + vals + """ on conflict (code) do update set
             name = excluded.name, name_eng = excluded.name_eng, sido = excluded.sido,
             geom = excluded.geom, bbox = excluded.bbox, center = excluded.center,
             geom_source = excluded.geom_source, geom_simplify_m = excluded.geom_simplify_m,
             updated_at = now();""")
# ★ 여기서 커밋한다. regions 적재는 즉시 끝나고, 아래 백필은 1,635,152행을 다시 쓰느라
#   디스크 바운드로 10분 가까이 걸린다. 한 트랜잭션에 묶으면 **빠른 쪽까지 볼 수 없다**
#   (실제로 그래서 regions가 비어 보였고, 사전 내보내기가 통째로 막혔다).
sql.append("commit;")
sql.append("begin;")
# ★ 경계 파일에 없는 시군구를 장소 좌표로 채운다.
#   인천이 제물포구·영종구·서해구·검단구로 재편됐는데 경계 파일은 옛 구획이라
#   이 코드들이 regions에 없었다 — 주소에는 22,242곳이 새 이름으로 들어 있는데도.
#   중심 좌표를 추측하지 않고 **그 주소를 가진 장소들의 평균**으로 잡는다.
sql.append("""
insert into public.regions(code, name, sido, geom, bbox, center, geom_source)
select s.code,
       substr(s.fullname, position(' ' in s.fullname) + 1),
       (string_to_array(s.fullname, ' '))[1],
       point(avg(ST_X(p.geom)), avg(ST_Y(p.geom))),
       point(avg(ST_X(p.geom)), avg(ST_Y(p.geom))),
       point(avg(ST_X(p.geom)), avg(ST_Y(p.geom)))
from stg_sgg s
join public.places p
  on array_to_string((string_to_array(p.address, ' '))[1:2], ' ') = s.fullname
where not exists (select 1 from public.regions r where r.code = s.code)
group by s.code, s.fullname
having count(*) >= 50      -- 오타 주소 몇 건으로 지역이 생기지 않게
on conflict (code) do nothing;
""")

sql.append("""
-- ★ regions에 실제로 있는 코드만 후보로 둔다.
--   앞선 판은 3토큰이 먼저 맞으면 그 코드가 regions에 없어도 2토큰을 보지 않았다.
--   그래서 '경기도 부천시 원미구'가 41192(경계 없음)로 잡히고 41190(부천시)로
--   물러서지 못해 통째로 비었다 — 부천·화성만 44,000행이다.
create temp table stg_ok as
  select s.code, s.fullname from stg_sgg s join public.regions r on r.code = s.code;
create index on stg_ok(fullname);
analyze stg_ok;
""")
if "--redo-unparseable" in sys.argv:
    # ★ 토큰으로 안 풀리는 행을 비워서 B(부분 문자열)·C(좌표)를 다시 태운다.
    #   앞선 판은 C만 있었다 — B가 잡았어야 할 것까지 좌표가 가져갔다
    #   ('부산광역시 해운대구광역시 석대동'이 금정구로 갔다).
    sql.append("""
    with a as (
      select id,
             (string_to_array(address,' '))[1] as t1,
             array_to_string((string_to_array(address,' '))[1:2],' ') as t2,
             array_to_string((string_to_array(address,' '))[1:3],' ') as t3
      from public.places where coalesce(address,'') <> ''
    )
    update public.places p set region_code = null
    from a where p.id = a.id
      and not exists (select 1 from stg_ok o where o.fullname in (a.t1, a.t2, a.t3));
    """)

sql.append("""
-- 3토큰(일반구) → 2토큰(시군구) → 1토큰(세종처럼 시도가 곧 시군구인 경우) 순으로 물러선다
with a as (
  select id,
         (string_to_array(address,' '))[1] as t1,
         array_to_string((string_to_array(address,' '))[1:2],' ') as t2,
         array_to_string((string_to_array(address,' '))[1:3],' ') as t3
  from public.places
  where address is not null and address <> '' and region_code is null   -- ★ 빈 것만 손본다
),
m as (
  select a.id, coalesce(c3.code, c2.code, c1.code) as code
  from a
  left join stg_ok c3 on c3.fullname = a.t3
  left join stg_ok c2 on c2.fullname = a.t2
  left join stg_ok c1 on c1.fullname = a.t1
)
update public.places p set region_code = m.code
from m where p.id = m.id and m.code is not null;
""")
# ── B. 부분 문자열로 한 번 더 ────────────────────────────────────────
# 토큰이 안 맞는 주소에도 시군구 이름이 **글자로는** 들어 있는 경우가 있다.
#   "부산광역시 해운대구광역시 석대동"  ← '해운대구'가 그대로 있다
#   "서울특별 광진구"                   ← 시도가 잘렸지만 '광진구'는 온전하다
# ★ 다만 부분 문자열은 새 오류를 만든다 — '중구'는 다섯 곳이다. 그래서 둘을 건다:
#   ① 주소 첫 토큰이 시도로 읽히면 **그 시도 안에서만** 찾는다
#   ② 그래도 후보가 둘 이상이면 **건너뛴다** (좌표가 판정하게 둔다)
alias_rows = [(a, cur) for cur, olds in SIDO_ALIAS.items() for a in [cur] + olds]
sql.append("create temp table stg_sido(alias text, sido text);")
sql.append("insert into stg_sido values "
           + ",".join("(%s,%s)" % (q(a), q(c)) for a, c in alias_rows) + ";")
sql.append("analyze stg_sido;")
sql.append("""
with tgt as (
  select id, address from public.places
  where region_code is null and coalesce(address,'') <> ''
),
-- 주소가 어느 시도로 시작하는가 (모르면 null)
withsido as (
  select t.id, t.address,
         (select a.sido from stg_sido a
          where t.address like a.alias || ' %' order by length(a.alias) desc limit 1) as sido
  from tgt t
),
cand as (
  select w.id, r.code, length(r.name) as ln
  from withsido w
  join public.regions r
    on length(r.name) > 0                    -- ★ 빈 이름은 무엇에나 매칭된다
   and position(r.name in w.address) > 0
   and (w.sido is null or r.sido = w.sido)
),
best as (   -- 가장 긴 이름이 가장 구체적이다 ('수원시 장안구' > '수원시')
  select id, max(ln) as ln from cand group by id
),
pick as (
  select c.id, min(c.code) as code, count(*) as n
  from cand c join best b on b.id = c.id and b.ln = c.ln
  group by c.id
)
update public.places p set region_code = pick.code
from pick where p.id = pick.id and pick.n = 1;   -- ★ 모호하면 건드리지 않는다
""")

# ── C. 마지막은 좌표 ─────────────────────────────────────────────────
# 주소 글자를 못 믿을 때도 좌표는 멀쩡하다.
# ★ 지역 중심점이 아니라 **이미 코드가 붙은 가장 가까운 장소**를 본다.
#   중심점은 큰 시군구에서 엉뚱하게 잡힌다 (경주 끝자락이 포항 중심에 더 가깝다).
sql.append("""
update public.places p set region_code = (
  select q.region_code from public.places q
  where q.region_code is not null
  order by q.geom <-> p.geom limit 1)
where p.region_code is null;
""")

sql.append("commit;")
sql.append("select count(*) filter (where region_code is not null) as 코드있음, count(*) as 전체 from public.places;")

if "--regions-only" in sys.argv:
    # 사전 내보내기에 필요한 것은 regions뿐이다. 백필은 따로 돌린다.
    sql = sql[:sql.index("commit;") + 1] + [
        "select count(*) as regions적재 from public.regions;"]

env = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""),
           LC_ALL="C")
p = subprocess.run(["psql", "-X", "-q", "-h", "/tmp", "-p", "55432", "-d", "trippic_data",
                    "-v", "ON_ERROR_STOP=1", "-f", "-"],
                   input="\n".join(sql), text=True, env=env)
sys.exit(p.returncode)
