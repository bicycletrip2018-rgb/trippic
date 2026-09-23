#!/usr/bin/env python3
"""
주소로 좌표를 다시 찾는다 (2판).

1판의 문제: '20곳 이상 맞을 때까지' 넓히다 보니 읍·면 중심점이 나왔다(흩어짐 4~24km).
핀으로 쓸 수 없다.

2판 규칙
  · 좁은 단계부터 본다. **3곳 이상 맞고 흩어짐이 500m 이내면 거기서 멈춘다.**
  · 도로명이 없는 지번 주소('중구 충무로4가')는 시군구로 범위를 잡고
    **동 이름을 포함 검색**한다.
  · 어느 단계도 500m 안에 안 들어오면 **고치지 않는다.** 흐릿한 좌표로 바꾸는 것은
    틀린 좌표를 남기는 것보다 나을 게 없다 — 무엇이 문제인지 알 수 없게 만든다.
"""
import math, os, subprocess

SP = os.path.dirname(os.path.abspath(__file__))
PSQL = ["psql", "-X", "-q", "-h", "/tmp", "-p", "55432", "-d", "trippic_data", "-At", "-F", "\t"]
ENV = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""), LC_ALL="C")
MAX_SPREAD = 500

def q(sql):
    p = subprocess.run(PSQL + ["-c", sql], capture_output=True, text=True, env=ENV)
    return [l.split("\t") for l in p.stdout.strip().split("\n") if l.strip()]

def esc(s): return s.replace("'", "''")

def stat(where):
    r = q(f"""select count(*), avg(ST_X(geom)), avg(ST_Y(geom)),
                     coalesce(stddev_pop(ST_X(geom)),0), coalesce(stddev_pop(ST_Y(geom)),0)
              from public.places where {where}""")
    if not r or not r[0][0] or r[0][0] == '0': return None
    n = int(r[0][0]); x = float(r[0][1]); y = float(r[0][2])
    sp = max(float(r[0][3]) * 88, float(r[0][4]) * 111) * 1000
    return n, x, y, sp

def hav(a, b, c, d):
    return 2 * 6371000 * math.asin(math.sqrt(
        math.sin(math.radians(d - b) / 2) ** 2 +
        math.cos(math.radians(b)) * math.cos(math.radians(d)) * math.sin(math.radians(c - a) / 2) ** 2))

rows = [l.rstrip("\n").split("|") for l in open(os.path.join(SP, "bad25.tsv"), encoding="utf-8") if l.strip()]
res = []
for pid, name, src, addr, lng, lat, cur, poly, dist in rows:
    toks = addr.split()
    best = None
    # ① 주소 앞쪽 토큰을 그대로 쓰는 접두 검색 (도로명 주소에 잘 듣는다)
    for k in range(len(toks), 2, -1):
        s = stat(f"address like '{esc(' '.join(toks[:k]))}%'")
        if s and s[0] >= 3 and s[3] <= MAX_SPREAD:
            best = ("접두" + str(k), *s); break
    # ② 지번 동명 포함 검색 (시군구로 범위를 좁히고 동 이름을 찾는다)
    if not best and len(toks) >= 3:
        sgg = " ".join(toks[:2])
        for t in toks[2:]:
            if not t.endswith(("동", "가", "리", "읍", "면")): continue
            s = stat(f"address like '{esc(sgg)}%' and address like '%{esc(t)}%'")
            if s and s[0] >= 3 and s[3] <= MAX_SPREAD:
                best = ("포함:" + t, *s); break
    if best:
        tag, n, nx, ny, sp = best
        d = hav(float(lng), float(lat), nx, ny)
        res.append((pid, name, addr, tag, n, nx, ny, sp, d))
    else:
        res.append((pid, name, addr, "-", 0, None, None, None, None))

print(f"{'장소':<24}{'방법':<10}{'표본':>5} {'흩어짐':>7} {'기존과':>9}")
for pid, name, addr, tag, n, nx, ny, sp, d in res:
    if nx is None: print(f"{name[:24]:<24}{'고치지 않음':<10}")
    else: print(f"{name[:24]:<24}{tag:<10}{n:>5} {sp:>6.0f}m {d:>8.0f}m")
with open(os.path.join(SP, "regeo2.tsv"), "w", encoding="utf-8") as f:
    for r in res:
        f.write("\t".join("" if x is None else str(x) for x in r) + "\n")
