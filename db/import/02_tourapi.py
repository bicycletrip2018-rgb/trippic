#!/usr/bin/env python3
"""
TourAPI(KorService2) 지역기반 관광정보 → places 적재용 TSV

왜 필요한가: 상가업소정보에는 **관광지·자연·해수욕장·문화재가 단 하나도 없다**(§10).
상권 데이터이기 때문이다. 우리 앱의 절반은 거기 없다. TourAPI가 그 절반을 채운다.

개발계정은 하루 1,000건이다. numOfRows=100이면 하루 10만 행 —
전국 약 5만 건은 하루면 끝난다. 다만 **중간에 끊겨도 이어서 받게** 체크포인트를 쓴다.

사용:
  set -a; . .env; set +a
  python3 db/import/02_tourapi.py > data/out/tourapi.tsv
  python3 db/import/02_tourapi.py --resume      # 끊긴 지점부터
  python3 db/import/02_tourapi.py --from-cache  # API 안 부르고 원본 캐시에서 다시 만든다

★ 받은 원본은 data/out/tourapi_raw.jsonl에 그대로 쌓는다.
  카테고리 매핑은 언제든 바뀐다. 매핑이 바뀔 때마다 하루 1,000건짜리 쿼터를
  다시 태울 수는 없다. TSV는 캐시에서 다시 굽는다.
"""
import os, sys, csv, json, time, urllib.parse, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAP  = os.path.join(ROOT, "db", "mapping", "tourapi_lcls_to_trippic.csv")
CKPT = os.path.join(ROOT, "data", "out", ".tourapi.ckpt")
RAW  = os.path.join(ROOT, "data", "out", "tourapi_raw.jsonl")

KEY = os.environ.get("TOURAPI_KEY")
END = os.environ.get("TOURAPI_ENDPOINT", "https://apis.data.go.kr/B551011/KorService2")
if not KEY:
    sys.exit("TOURAPI_KEY가 없다. `set -a; . .env; set +a` 먼저.")

# ★ areaCode로 순회하면 안 된다. 실측: 전국 19,836건밖에 안 나온다.
#   TourAPI가 법정동 코드(lDongRegnCd)로 옮겨가면서 **구 areacode가 빈 문자열인
#   콘텐츠가 많고**, areaCode를 지정하면 그것들이 통째로 빠진다.
#   협재해수욕장(contentid 127490)이 그 예다 — areacode='' 라서 안 잡혔다.
#
#   전국 총건수 실측:
#     areaBasedList2   (areaCode 1..39 순회)  19,836   ← 처음에 쓴 방식
#     areaBasedList2   (areaCode 없이)        49,679
#     areaBasedSyncList2 (전국)               69,026   ← 이것을 쓴다
#
#   areaBasedSyncList2는 대량 동기화용 엔드포인트다. 지역 필터 없이 전국을 훑는다.
OP = "areaBasedSyncList2"

def load_map():
    """소분류코드(lclsSystm3) → trippic 카테고리. 빈 값은 버린다."""
    m = {}
    with open(MAP, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cat = (row.get("trippic_category") or "").strip()
            if cat:
                m[row["소분류코드"].strip()] = cat
    return m

def fetch(page, rows=100, tries=4):
    q = urllib.parse.urlencode({
        "serviceKey": KEY, "MobileOS": "ETC", "MobileApp": "trippic",
        "_type": "json", "arrange": "C",          # C = 수정일순. 페이징이 안정적이다
        "numOfRows": rows, "pageNo": page,
    }, safe="%")
    url = f"{END}/{OP}?{q}"
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)          # 공공데이터포털은 순간 부하에 약하다

def esc(s):
    s = (s or "").strip()
    return s.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")

def to_tsv(items, cmap, emit, seen, stat):
    """원본 item 목록 → TSV 행. API 호출과 분리해 둔다."""
    for it in items:
        ref = str(it.get("contentid") or "").strip()
        if not ref or ref in seen:
            continue
        cat = cmap.get(str(it.get("lclsSystm3") or "").strip())
        if not cat:
            stat["dropped"] += 1; continue
        try:
            lng = float(it.get("mapx")); lat = float(it.get("mapy"))
        except (TypeError, ValueError):
            stat["bad"] += 1; continue
        if not (124.0 <= lng <= 132.0 and 33.0 <= lat <= 39.0):
            stat["bad"] += 1; continue
        seen.add(ref)
        addr = (str(it.get("addr1") or "") + " " + str(it.get("addr2") or "")).strip()
        emit([esc(it.get("title")), cat, esc(addr), f"{lng:.6f}", f"{lat:.6f}",
              "tour_api", ref, "t", r"\N"])
        stat["kept"] += 1


def from_cache(cmap):
    """API를 부르지 않고 캐시에서 TSV를 다시 굽는다."""
    def emit(cols):
        sys.stdout.write("\t".join(str(c) for c in cols) + "\n")
    seen, stat = set(), {"kept": 0, "dropped": 0, "bad": 0}
    n = 0
    with open(RAW, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            to_tsv([json.loads(line)], cmap, emit, seen, stat); n += 1
    print(f"[02_tourapi] 캐시 {n:,}행 → 적재 {stat['kept']:,} / "
          f"매핑없어 버림 {stat['dropped']:,} / 좌표오류 {stat['bad']:,}", file=sys.stderr)


def main():
    cmap = load_map()
    os.makedirs(os.path.dirname(CKPT), exist_ok=True)
    if "--from-cache" in sys.argv:
        return from_cache(cmap)
    done = set()
    if "--resume" in sys.argv and os.path.exists(CKPT):
        done = set(json.load(open(CKPT)))
        print(f"[02_tourapi] 이어받기: 완료된 페이지 {len(done)}개 건너뜀", file=sys.stderr)

    calls = 0
    seen = set()
    stat0 = {"kept": 0, "dropped": 0, "bad": 0}
    def emit(cols):
        sys.stdout.write("\t".join(str(c) for c in cols) + "\n")
    raw = open(RAW, "a", encoding="utf-8")
    try:
        page = 1
        while True:
            if page in done:
                page += 1; continue
            d = fetch(page); calls += 1
            body = (d.get("response", {}).get("body") or {})
            items = (body.get("items") or {})
            items = items.get("item") if isinstance(items, dict) else None
            if not items:
                break
            for it in items:                      # 원본을 먼저 그대로 쌓는다
                raw.write(json.dumps(it, ensure_ascii=False) + "\n")
            to_tsv(items, cmap, emit, seen, stat0)
            done.add(page)
            total = int(body.get("totalCount") or 0)
            if page % 50 == 0:
                print(f"[02_tourapi] {page*100:,}/{total:,}건", file=sys.stderr)
            if page * 100 >= total:
                break
            page += 1
            time.sleep(0.12)      # 초당 호출 제한 회피
    finally:
        raw.close()
        json.dump(sorted(done), open(CKPT, "w"))
        print(f"[02_tourapi] 적재 {stat0['kept']:,} / 매핑없어 버림 {stat0['dropped']:,} / "
              f"좌표오류 {stat0['bad']:,} / API호출 {calls}", file=sys.stderr)
        print(f"[02_tourapi] 체크포인트: {CKPT}", file=sys.stderr)
        print(f"[02_tourapi] 원본 캐시: {RAW} (매핑만 바꿀 땐 --from-cache)", file=sys.stderr)

if __name__ == "__main__":
    main()
