#!/usr/bin/env python3
"""
축제·행사에 **컨셉 태그**를 붙인다 (자동 48% — 나머지는 운영자가 고친다).

★ 규칙 순서가 중요하다: **TourAPI 코드가 의미 있는 것 먼저**, 그다음 제목 키워드.
  제목만 쓰면 `가든 나이트 마켓`이 '꽃·자연'이 된다(실측 오분류 145건).
★ `concept_source='manual'`인 행은 **건드리지 않는다.** 사람이 고친 것을 덮으면 안 된다.
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
RAW = os.path.join(ROOT, "data", "out", "festivals_raw.jsonl")

# TourAPI 코드가 분명한 것 (표본 8건씩 눈으로 확인했다)
CODE = {"EV010300": "음식·특산물", "EV010500": "꽃·자연", "EV010400": "전통·야행"}
# 제목 키워드 — ★ '산·들·항·섬' 같은 느슨한 글자는 넣지 않는다 (부산·울산·광산에 걸린다)
KW = [
    ("꽃·자연", r"벚꽃|유채|장미|수국|억새|단풍|튤립|연꽃|코스모스|철쭉|매화|국화|해바라기|라벤더|꽃|백일홍|메밀|갈대|허브|수목원"),
    ("음식·특산물", r"먹거리|한우|김치|커피|막걸리|맥주|와인|딸기|사과|포도|대게|굴축제|젓갈|국수|누들|치킨|라면|삼계탕|유자|대추|마늘|인삼|한돈|미식|푸드|beer|빵|디저트|전어|주꾸미|한과|김밥|카페축제|비어|맛"),
    ("불꽃·빛·야경", r"불꽃|빛축제|빛 축제|야행|야경|루미나리에|등불|미디어아트|불빛|달빛|별빛"),
    ("바다·해변", r"해변|바다|비치|해수욕|갯벌|해양|워터"),
    ("전통·야행", r"국가유산|문화재|전통|단오|산성|병영성|향교|서원|종가|읍성|한복|선사|가야|백제|신라|대첩|고택"),
    ("공연·영화", r"음악|재즈|버스킹|콘서트|국악|오페라|합창|힙합|영화제|연극|무용|뮤지컬"),
    ("전시·마켓", r"비엔날레|아트|전시|미술|조각|공예|도자|마켓|팝업|페어|엑스포"),
    ("체험·가족", r"어린이|가족|체험|키즈|반려|캠핑"),
    ("겨울·눈", r"눈축제|얼음|산천어|빙어|스키|썰매|성탄|크리스마스|해맞이"),
]

def tag(title, code3):
    t = CODE.get(code3 or "")
    if t:
        return t
    for k, p in KW:
        if re.search(p, title, re.I):
            return k
    return None

def main():
    rows = []
    for line in open(RAW, encoding="utf-8"):
        d = json.loads(line)
        ref = str(d.get("contentid") or "").strip()
        t = tag(d.get("title") or "", d.get("lclsSystm3"))
        if ref and t:
            rows.append((ref, t))
    print(f"자동 태그 {len(rows)}건")

    sql = ["set statement_timeout='20min';", "begin;",
           "drop table if exists stg_cpt;",
           "create table stg_cpt(ref text, concept text);",
           "copy stg_cpt (ref, concept) from stdin;"]
    sql += ["\t".join(r) for r in rows]
    sql += ["\\.", "create index on stg_cpt(ref);", "analyze stg_cpt;",
            """update public.places p
                  set concept = s.concept, concept_source = 'auto'
                 from stg_cpt s
                where p.source='tour_api' and p.source_ref = s.ref
                  and coalesce(p.concept_source,'auto') <> 'manual';""",
            "drop table stg_cpt;", "commit;",
            """select concept, count(*) from public.places
                where concept is not null group by 1 order by 2 desc;""",
            """select count(*) filter (where concept is null) as 태그없는_행사
                 from public.places where category='event';"""]

    env = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""))
    if "DB_URL" not in env:
        for l in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
            if l.startswith("DB_URL="):
                env["DB_URL"] = l.split("=", 1)[1].strip().strip('"').strip("'")
    p = subprocess.run(["psql", "-X", "-q", "-d", env["DB_URL"], "-v", "ON_ERROR_STOP=1", "-f", "-"],
                       input="\n".join(sql), text=True, env=env, capture_output=True)
    print(re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", (p.stdout or "") + (p.stderr or "")).strip())
    sys.exit(p.returncode)

if __name__ == "__main__":
    main()
