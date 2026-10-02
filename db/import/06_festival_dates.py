#!/usr/bin/env python3
"""
축제·행사(contenttypeid=15)의 **기간**을 받아 places.event_start/end에 채운다.

★ 왜 따로 받나 — areaBasedSyncList2(우리가 쓴 엔드포인트)는 기간을 주지 않는다.
  원본 캐시 69,026건 어디에도 eventstartdate가 없다. searchFestival2를 써야 한다.
★ 호출은 목록 단위다. numOfRows=1000이면 몇 번이면 끝난다 —
  개발키가 하루 1,000회라 건별 상세조회(detailIntro)는 쓰면 안 된다.
★ 지난 행사도 받는다. "작년 이맘때 했던 축제"가 §12.12의 3단계(시기 추천) 재료다.

사용: db/import/06_festival_dates.py [--from 20240101]
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
# ★ `.env` 는 **있으면 읽는다**(§13.88). 저장소에 커밋하지 않으므로 CI 에는 없고,
#   거기서는 비밀을 환경변수로 받는다. 필수로 읽으면 자동 갱신이 첫 줄에서 죽는다
#   (`verify.sh` 등 셸 스크립트는 처음부터 `[ -f .env ] &&` 로 선택이었다 — 여기만 달랐다).
try:
    for l in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
except FileNotFoundError:
    pass
KEY = os.environ["TOURAPI_KEY"]
END = os.environ.get("TOURAPI_ENDPOINT", "https://apis.data.go.kr/B551011/KorService2")
OUT = os.path.join(ROOT, "data", "out", "festivals_raw.jsonl")

def call(page, start):
    q = urllib.parse.urlencode({
        "serviceKey": KEY, "MobileOS": "ETC", "MobileApp": "trippic", "_type": "json",
        "arrange": "A", "numOfRows": 1000, "pageNo": page, "eventStartDate": start,
    }, safe="%")
    for t in (1, 2, 3):
        try:
            with urllib.request.urlopen(f"{END}/searchFestival2?{q}", timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if t == 3:
                # ★ **이유를 적는다**(§13.88). 예전에는 `URLError` 라고만 찍어서
                #   막힌 건지, 끊긴 건지, 키가 틀린 건지 알 수가 없었다.
                #   CI 에서 실패했을 때 로그가 유일한 단서다 — 거기에 이름만 있으면
                #   한 번 돌리는 데 2분 반이 드는 시험을 몇 번씩 해야 한다.
                why = getattr(e, "reason", None) or getattr(e, "code", None) or e
                print(f"  ! 실패: {type(e).__name__}: {str(why)[:160]}", file=sys.stderr)
                return None
            time.sleep(3 * t)

def main():
    start = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else "20240101"
    items, page = [], 1
    while True:
        d = call(page, start)
        if not d: break
        body = (d.get("response") or {}).get("body") or {}
        got = ((body.get("items") or {}) or {}).get("item") or []
        if isinstance(got, dict): got = [got]
        items += got
        total = int(body.get("totalCount") or 0)
        print(f"  {page}쪽 · 누적 {len(items):,} / {total:,}", flush=True)
        if len(items) >= total or not got: break
        page += 1; time.sleep(1)

    # ★ 원본 캐시 자리를 **만들고** 쓴다(§13.88). `data/` 는 커밋하지 않으므로
    #   새 클론(CI)에는 그 폴더가 없다 — 예전 판은 여기서 죽었다.
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for it in items: f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"원본 캐시 → {OUT}")

    rows = []
    for it in items:
        ref = str(it.get("contentid") or "").strip()
        s = str(it.get("eventstartdate") or "").strip()
        e = str(it.get("eventenddate") or "").strip()
        if ref and len(s) == 8:
            rows.append((ref, s, e if len(e) == 8 else r"\N"))
    print(f"기간이 있는 행사 {len(rows):,}건")
    # ★ **반쪽짜리 스냅샷을 막는 빗장**(§13.65 와 같은 이유). API 가 빈손으로 답하거나
    #   키가 만료되면 예전에는 조용히 0건을 쓰고 **성공으로 끝났다** — 자동으로 돌기
    #   시작하면 그 침묵이 몇 주를 간다. 평소 700~800건이 오므로 바닥을 둔다.
    floor = int(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 300
    if len(rows) < floor:
        print(f"! 너무 적다({len(rows)} < {floor}) — 쓰지 않고 멈춘다. "
              f"API 나 키를 확인하라.", file=sys.stderr)
        sys.exit(2)
    if not rows: return

    sql = ["set statement_timeout='20min';", "begin;",
           "drop table if exists stg_fest;",
           "create table stg_fest(ref text, s text, e text);",
           "copy stg_fest (ref, s, e) from stdin;"]
    sql += ["\t".join(r) for r in rows]
    sql += ["\\.", "create index on stg_fest(ref);", "analyze stg_fest;",
            """update public.places p
                  set event_start = to_date(f.s, 'YYYYMMDD'),
                      event_end   = case when f.e is null then null else to_date(f.e,'YYYYMMDD') end
                 from stg_fest f
                where p.source = 'tour_api' and p.source_ref = f.ref;""",
            "drop table stg_fest;", "commit;",
            """select count(*) filter (where event_start is not null) as 기간있음,
                      count(*) filter (where category='event') as event_전체,
                      min(event_start) as 가장이른, max(event_end) as 가장늦은
                 from public.places;"""]

    env = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""))
    p = subprocess.run(["psql", "-X", "-q", "-d", env["DB_URL"], "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input="\n".join(sql), text=True, env=env, capture_output=True)
    print(re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", (p.stdout or "") + (p.stderr or "")).strip())
    sys.exit(p.returncode)

if __name__ == "__main__":
    main()
