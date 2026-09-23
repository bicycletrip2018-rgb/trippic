#!/usr/bin/env python3
"""
중복 제거를 **DB가 아니라 여기서** 한다.

왜 옮겼나 — 실측:
  · Supabase(nano)에서 교차출처 중복제거 ~15분, 같은출처 ~10분
  · 규칙을 한 줄 고칠 때마다 전량 재적재 30~40분
  · 그 과정에서 statement_timeout, \\copy 버퍼 깨짐, truncate cascade 사고가 났다
    전부 "DB에서 무거운 작업을 스크립트로 돌린다"가 원인이다.

여기서 하면:
  · 규칙 1회 시험 ~30초, 실제 적재는 COPY ~4분
  · 무엇을 왜 지웠는지 **파일로 남겨** 검토할 수 있다 (지우고 나서 감사하지 않아도 된다)

규칙 (load_merge.sql과 같다):
  ① TourAPI 우선 — 상가업소가 100m 안에 같은 가게면 상가업소를 버린다
  ② 같은 출처 안 중복 — 30m 안에 같은 가게면 하나만 남긴다
  '같은 가게' = 몸통 유사도 > 0.7 AND 분점표기가 정확히 일치

사용:
  python3 db/import/04_dedup.py data/out/tourapi.tsv data/out/sangga_3.tsv \\
      -o data/out/places.tsv --report data/out/dedup_report.tsv
"""
import sys, os, re, math, argparse, unicodedata
from collections import defaultdict

BRANCH = re.compile(r'([0-9]+호점|[0-9]+호|본점|직영점)$')
WS = re.compile(r'\s+')

# ★ 이름이 아닌 값들. 이름으로 묶으면 서로 다른 가게가 한 덩어리가 된다.
#   실측: 상가업소에 '업소명없음'이 472건 있다. 30m 안에 여럿 있으면
#   전부 같은 가게로 보고 하나만 남기게 되는데, 실제로는 서로 다른 업소다.
PLACEHOLDER = {'업소명없음', '상호명없음', '무명', '미상', ''}
MIN_NAME = 2          # 한 글자 이름은 신뢰할 수 없다

def dedupable(name):
    n = WS.sub('', name or '')
    return n not in PLACEHOLDER and len(n) >= MIN_NAME

def base_branch(name):
    """이름을 몸통과 분점표기로 가른다.
    ★ '…점'을 일반적으로 자르면 안 된다 — 한글은 공백이 없어 경계를 못 찾는다.
      "스타벅스 해운대점" → 몸통 "스" / 분점 "타벅스해운대점" 으로 망가진다.
      모호하지 않은 토큰(N호점·N호·본점·직영점)만 분리하고 나머지는 몸통에 남긴다."""
    s = WS.sub('', name or '')
    m = BRANCH.search(s)
    return (s[:m.start()], m.group(1)) if m else (s, '')

def trigrams(s):
    """pg_trgm과 같은 방식: 앞뒤를 공백으로 패딩하고 3글자씩."""
    s = '  ' + s + ' '
    return {s[i:i+3] for i in range(len(s) - 2)}

def similarity(a, b):
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb: return 0.0
    inter = len(ta & tb)
    return inter / (len(ta) + len(tb) - inter)

_BB = {}
def bb(name):
    """몸통·분점·트라이그램을 이름당 한 번만 계산해 캐시한다."""
    v = _BB.get(name)
    if v is None:
        b, br = base_branch(name)
        v = _BB[name] = (b, br, trigrams(b))
    return v

def same_shop(n1, n2):
    if not dedupable(n1) or not dedupable(n2): return False
    b1, br1, t1 = bb(n1)
    b2, br2, t2 = bb(n2)
    if br1 != br2 or not t1 or not t2: return False
    inter = len(t1 & t2)
    return inter / (len(t1) + len(t2) - inter) > 0.7

# ── 격자 색인 ─────────────────────────────────────────────────────────
# ★ 칸 크기를 **질의 반경에 맞춘다.** 처음엔 200m 고정으로 두었는데,
#   30m를 찾는데도 9칸 수백 행을 매번 훑어 466K 처리에 275초가 걸렸다.
#   반경에 맞추면 칸마다 몇 행만 들어 있어 비교 횟수가 수십 배 줄어든다.
#
# 거리도 haversine 대신 **평면 근사**를 쓴다. 30~100m 범위에서 오차는 무시할 수준이고
# 삼각함수 호출이 사라진다. 위도별 경도 축척은 한 번만 계산한다.
LAT_M = 111320.0

def build_index(rows, cell_m):
    """cell_m 미터 크기의 격자. (색인, 칸크기°, 경도축척) 을 돌려준다."""
    lat0 = sum(r['lat'] for r in rows) / max(len(rows), 1)
    lng_scale = LAT_M * math.cos(lat0 * math.pi / 180)   # 경도 1° 당 미터
    cy = cell_m / LAT_M
    cx = cell_m / lng_scale
    g = defaultdict(list)
    for i, r in enumerate(rows):
        g[(int(r['lng'] / cx), int(r['lat'] / cy))].append(i)
    return {'g': g, 'cx': cx, 'cy': cy, 'lng_scale': lng_scale}

def neighbors(ix, rows, r, radius):
    """반경 안 이웃. 칸이 반경 크기이므로 인접 3×3만 본다."""
    cx, cy, ls = ix['cx'], ix['cy'], ix['lng_scale']
    gx, gy = int(r['lng'] / cx), int(r['lat'] / cy)
    rl, rt = r['lng'], r['lat']
    r2 = radius * radius
    g = ix['g']
    for x in (gx - 1, gx, gx + 1):
        for y in (gy - 1, gy, gy + 1):
            for i in g.get((x, y), ()):
                o = rows[i]
                dx = (o['lng'] - rl) * ls
                dy = (o['lat'] - rt) * LAT_M
                if dx * dx + dy * dy <= r2:
                    yield i, o

def load(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            c = line.rstrip('\n').split('\t')
            if len(c) < 9: continue
            rows.append({'name': c[0], 'cat': c[1], 'addr': c[2],
                         'lng': float(c[3]), 'lat': float(c[4]),
                         'src': c[5], 'ref': c[6], 'ground': c[7], 'floor': c[8],
                         'raw': line.rstrip('\n')})
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tsv', nargs='+', help='tourapi.tsv sangga.tsv (TourAPI를 먼저)')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--report', help='무엇을 왜 지웠는지 남길 파일')
    a = ap.parse_args()

    rows = []
    for p in a.tsv:
        n0 = len(rows); rows += load(p)
        print(f"  {os.path.basename(p)}: {len(rows)-n0:,}행", file=sys.stderr)

    drop = {}                                    # idx → (사유, 남은쪽 이름)
    tour = [r for r in rows if r['src'] == 'tour_api']
    gi_tour = build_index(tour, 100)

    # ① 상가업소 vs TourAPI — 100m + 같은 가게면 상가업소를 버린다
    for i, r in enumerate(rows):
        if r['src'] != 'public_data': continue
        for _, o in neighbors(gi_tour, tour, r, 100):
            if same_shop(o['name'], r['name']):
                drop[i] = ('tourapi와중복', o['name']); break

    # ② 같은 출처 안 — 30m + 같은 가게면 하나만 남긴다 (ref가 작은 쪽을 남겨 결과를 안정시킨다)
    alive = [i for i in range(len(rows)) if i not in drop]
    sub = [rows[i] for i in alive]
    gi = build_index(sub, 30)
    for pos, i in enumerate(alive):
        if i in drop: continue
        r = rows[i]
        for pos2, o in neighbors(gi, sub, r, 30):
            j = alive[pos2]
            if j == i or j in drop: continue
            if rows[j]['src'] != r['src']: continue
            if not same_shop(r['name'], o['name']): continue
            # ★ 동점은 **source_ref**로만 가른다. DB는 uuid로 갈랐는데
            #   uuid는 적재할 때마다 달라져 결과가 재현되지 않았다.
            keep, dropi = (i, j) if r['ref'] <= rows[j]['ref'] else (j, i)
            drop[dropi] = ('같은출처중복', rows[keep]['name'])
            if dropi == i: break

    with open(a.out, 'w', encoding='utf-8') as f:
        for i, r in enumerate(rows):
            if i not in drop: f.write(r['raw'] + '\n')
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as f:
            f.write('사유\t지워진이름\t출처\t남은이름\n')
            for i, (why, keep) in drop.items():
                f.write(f"{why}\t{rows[i]['name']}\t{rows[i]['src']}\t{keep}\n")

    kinds = defaultdict(int)
    for why, _ in drop.values(): kinds[why] += 1
    print(f"[04_dedup] 입력 {len(rows):,} → 출력 {len(rows)-len(drop):,} "
          f"(제거 {len(drop):,})", file=sys.stderr)
    for k, v in kinds.items(): print(f"           {k}: {v:,}", file=sys.stderr)
    if a.report: print(f"           검토용: {a.report}", file=sys.stderr)

if __name__ == '__main__':
    main()
