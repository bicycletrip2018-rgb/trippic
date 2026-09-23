#!/usr/bin/env python3
"""
소상공인시장진흥공단 상가(상권)정보 CSV → places 적재용 TSV

핵심은 변환이 아니라 **버리는 것**이다.
전국 1,68x,xxx개 업소 중 우리가 넣는 건 일부다. PLAN §8.5:
  병원·학원·부동산·미용실·정비소는 여행 기록이 아니다.
  매핑표(db/mapping/sangga_mid_to_trippic.csv)에서 trippic_category가
  비어 있는 중분류는 통째로 버린다. 이게 상업화 방어의 1차 방어선이다.

사용:
  python3 db/import/01_sangga.py data/sang/*.csv > data/out/sangga.tsv
"""
import csv, sys, os, glob, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAP  = os.path.join(ROOT, "db", "mapping", "sangga_mid_to_trippic.csv")
SUB  = os.path.join(ROOT, "db", "mapping", "sangga_sub_exceptions.csv")

def load_map():
    """중분류코드 → trippic 카테고리. 빈 값은 '버린다'는 뜻이다."""
    m = {}
    with open(MAP, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cat = (row.get("trippic_category") or "").strip()
            if cat:
                m[row["중분류코드"].strip()] = cat
    return m


def load_sub():
    """(중분류명, 소분류명) → 카테고리. 중분류 판정을 **덮어쓴다**.

    중분류 이름만 보고 매핑했다가 두 번 틀렸다:
      · '도서관·사적지'  → 실제로는 100% 독서실/스터디카페 (사적지 0곳)
      · '구내식당·뷔페'  → 구내식당 65% / 뷔페 35%
    한 칸 안에 성격이 다른 게 섞여 있으면 여기서 소분류로 가른다.
    빈 카테고리는 '이 소분류만 버린다'는 뜻이다.
    """
    m = {}
    if not os.path.exists(SUB):
        return m
    with open(SUB, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m[((row.get("중분류명") or "").strip(),
               (row.get("소분류명") or "").strip())] = (row.get("trippic_category") or "").strip()
    return m

# 층정보 → (1층인가, 층번호)
#   비어 있으면 단독 건물일 가능성이 높다 → 1층으로 본다 (007 주석과 같은 규칙)
def floor_of(s):
    s = (s or "").strip()
    if not s:
        return True, None
    m = re.search(r"-?\d+", s)
    if not m:
        return True, None
    n = int(m.group())
    return n == 1, n

def esc(s):
    """COPY text 포맷. 탭·개행·역슬래시만 막으면 된다."""
    s = (s or "").strip()
    return s.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")

def main(paths):
    cmap = load_map()
    smap = load_sub()
    seen = set()                      # 상가업소번호 중복 (연도별 파일이 겹친다)
    kept = dropped = bad = 0
    drop_by_cat = {}
    # esc()가 탭·개행·역슬래시를 이미 없앴으므로 csv 모듈 없이 그냥 쓴다.
    def emit(cols):
        sys.stdout.write("\t".join(str(c) for c in cols) + "\n")
    for p in paths:
        with open(p, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                mid = (row.get("상권업종중분류코드") or "").strip()
                cat = cmap.get(mid)
                # 소분류 예외가 있으면 중분류 판정을 덮어쓴다 (살리는 쪽도, 버리는 쪽도)
                sub = smap.get(((row.get("상권업종중분류명") or "").strip(),
                                (row.get("상권업종소분류명") or "").strip()))
                if sub is not None:
                    cat = sub or None
                if not cat:
                    dropped += 1
                    k = (row.get("상권업종중분류명") or "?").strip()
                    drop_by_cat[k] = drop_by_cat.get(k, 0) + 1
                    continue
                ref = (row.get("상가업소번호") or "").strip()
                if not ref or ref in seen:
                    continue
                try:
                    lng = float(row["경도"]); lat = float(row["위도"])
                except (KeyError, ValueError, TypeError):
                    bad += 1; continue
                # 대한민국 경위도 밖은 좌표 오류다
                if not (124.0 <= lng <= 132.0 and 33.0 <= lat <= 39.0):
                    bad += 1; continue
                seen.add(ref)
                ground, fno = floor_of(row.get("층정보"))
                addr = (row.get("도로명주소") or row.get("지번주소") or "").strip()
                emit([
                    esc(row.get("상호명")), cat, esc(addr),
                    f"{lng:.6f}", f"{lat:.6f}",
                    "public_data", ref,
                    "t" if ground else "f",
                    r"\N" if fno is None else fno,
                ])
                kept += 1
    top = sorted(drop_by_cat.items(), key=lambda x: -x[1])[:8]
    print(f"[01_sangga] 적재 {kept:,} / 버림 {dropped:,} / 좌표오류 {bad:,}", file=sys.stderr)
    print(f"[01_sangga] 많이 버린 업종: " + ", ".join(f"{k} {v:,}" for k, v in top), file=sys.stderr)

if __name__ == "__main__":
    args = sys.argv[1:]
    files = [f for a in args for f in (glob.glob(a) if "*" in a else [a])]
    if not files:
        sys.exit("사용: 01_sangga.py <상가업소 CSV...>")
    main(files)
