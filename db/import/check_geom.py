#!/usr/bin/env python3
"""
좌표가 주소의 시군구 안에 있는지 검사해 `places.geom_offset_m`에 적는다.

  db/import/check_geom.py [--all] [--report]

★ 거르지도 고치지도 않는다. **숫자만 적는다.** (마이그레이션 018 주석 참고)
  실측상 불일치의 81%가 경계 50m 이내 잡음이고, 자동 보정은 바다에 찍히는 사고가 났다.

★ 적재 파이프라인의 **마지막 단계**다. regions 경계가 바뀌어도 다시 돌려야 한다
  (그럴 땐 --all 로 geom_checked_at을 무시하고 전부 다시 잰다).

★ 나눠서 돌리고 사이사이 vacuum 한다 — 465,914행을 한 번에 갱신하면
  죽은 행이 그만큼 쌓여 무료 한도(500MB)를 밀어올린다.
"""
import os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")

def env():
    e = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""))
    if "DB_URL" not in e:
        for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            if line.startswith("DB_URL="):
                e["DB_URL"] = line.split("=", 1)[1].strip().strip('"').strip("'")
    return e

def run(sql, label, quiet=False):
    e = env()
    p = subprocess.run(["psql", "-X", "-q", "-d", e["DB_URL"], "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input=sql, text=True, env=e, capture_output=True)
    out = re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", (p.stdout or "") + (p.stderr or "")).strip()
    if not quiet: print(f"--- {label} ---\n{out}")
    if p.returncode != 0: sys.exit(p.returncode)
    return out

BATCH = 60000
STEP = """
set statement_timeout='30min';
with b as (
  select p.id, p.geom, p.region_code
  from public.places p
  where %s
  limit %d
)
update public.places t
   set geom_offset_m = case
         when r.code is null then null                    -- 지역을 모르면 잴 수 없다
         when ST_Contains(r.geom, b.geom) then 0
         else ST_Distance(b.geom::geography, r.geom::geography)
       end,
       geom_checked_at = now()
  from b left join public.regions r on r.code = b.region_code
 where t.id = b.id;
select count(*) as 남음 from public.places where %s;
"""

REPORT = """
select case when geom_offset_m is null then '⑤ 지역 없음'
            when geom_offset_m = 0    then '① 주소 지역 안'
            when geom_offset_m <= 50  then '② 50m 이내 — 경계 잡음'
            when geom_offset_m <= 200 then '③ 200m 이내'
            when geom_offset_m <= 1000 then '④ 1km 이내'
            else '⑥ 1km 초과 — 좌표 의심' end as 구간,
       count(*),
       round(100.0*count(*)/sum(count(*)) over (), 3) as pct
from public.places group by 1 order by 1;

select source, count(*) as 의심건수
from public.places where geom_offset_m > 1000 group by 1 order by 2 desc;

select name, substr(address,1,38) as 주소, round(geom_offset_m::numeric) as 벗어남m
from public.places where geom_offset_m > 1000 order by geom_offset_m desc limit 10;
"""

if __name__ == "__main__":
    if "--report" not in sys.argv:
        if "--all" in sys.argv:
            # ★ 다시 재려면 표시만 지운다. '이미 잰 것'을 조건으로 돌리면 끝나지 않는다.
            run("update public.places set geom_checked_at = null;", "전부 다시 재기", quiet=True)
        i = 0
        while True:
            i += 1
            out = run(STEP % ("geom_checked_at is null", BATCH, "geom_checked_at is null"),
                      f"검사 배치 {i}", quiet=True)
            m = re.findall(r"^\s*(\d+)\s*$", out, re.M)
            left = int(m[-1]) if m else 0
            print(f"  배치 {i} · 남음 {left:,}", flush=True)
            if left == 0: break
            if i > 40:
                print("  ! 배치가 40번을 넘었다 — 갱신이 안 되고 있다"); break
            run("vacuum public.places;", "vacuum", quiet=True)
        run("vacuum analyze public.places;", "마무리 vacuum", quiet=True)
    run(REPORT, "결과")
