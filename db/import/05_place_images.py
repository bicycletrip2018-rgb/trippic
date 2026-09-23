#!/usr/bin/env python3
"""
TourAPI 원본 캐시에서 **이미지와 저작권 유형**을 뽑아 places에 채운다.

★ API를 다시 부르지 않는다. 받아 둔 data/out/tourapi_raw.jsonl에 이미 들어 있다
  (firstimage 56,296건 / 69,026건). 개발키가 하루 1,000회라 이게 크게 다르다.

★ 한 행씩 UPDATE 하지 않는다. 스테이징 테이블에 COPY로 밀어 넣고 조인으로 한 번에 갱신한다.
  (§10.x에서 인덱스를 켠 채 대량 삽입해 1시간을 날린 적이 있다)

사용: db/import/05_place_images.py            # Supabase
      db/import/05_place_images.py --local    # 로컬 trippic_data
"""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
RAW = os.path.join(ROOT, "data", "out", "tourapi_raw.jsonl")

def esc(v):
    s = str(v or "").strip()
    return s.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", " ")

def main():
    local = "--local" in sys.argv
    rows, seen = [], set()
    for line in open(RAW, encoding="utf-8"):
        d = json.loads(line)
        ref = esc(d.get("contentid"))
        img = esc(d.get("firstimage"))
        if not ref or ref in seen or not img:
            continue
        seen.add(ref)
        rows.append((ref, img, esc(d.get("firstimage2")) or r"\N", esc(d.get("cpyrhtDivCd")) or r"\N"))
    print(f"이미지 있는 장소 {len(rows):,}건")

    sql = ["set statement_timeout='30min';", "begin;",
           "drop table if exists stg_img;",
           "create table stg_img(ref text, img text, thumb text, lic text);",
           "copy stg_img (ref, img, thumb, lic) from stdin;"]
    sql += ["\t".join(r) for r in rows]
    sql += ["\\.",
            "create index on stg_img(ref);",
            "analyze stg_img;",
            """
            update public.places p
               set image_url = s.img,
                   image_thumb_url = nullif(s.thumb, ''),
                   image_license = nullif(s.lic, '')
              from stg_img s
             where p.source = 'tour_api' and p.source_ref = s.ref
               and p.image_url is distinct from s.img;""",
            "drop table stg_img;",
            "commit;",
            """
            select count(*) filter (where image_url is not null) as 이미지있음,
                   count(*) filter (where image_license = 'Type3') as 변경금지,
                   count(*) filter (where source='tour_api') as 관광공사_전체
            from public.places;"""]

    env = dict(os.environ, PATH="/opt/homebrew/opt/postgresql@16/bin:" + os.environ.get("PATH", ""))
    if local:
        env["LC_ALL"] = "C"
        cmd = ["psql", "-X", "-q", "-h", "/tmp", "-p", "55432", "-d", "trippic_data",
               "-v", "ON_ERROR_STOP=1", "-f", "-"]
    else:
        if "DB_URL" not in env:
            for l in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
                if l.startswith("DB_URL="):
                    env["DB_URL"] = l.split("=", 1)[1].strip().strip('"').strip("'")
        cmd = ["psql", "-X", "-q", "-d", env["DB_URL"], "-v", "ON_ERROR_STOP=1", "-f", "-"]

    p = subprocess.run(cmd, input="\n".join(sql), text=True, env=env, capture_output=True)
    out = re.sub(r"://([^:]+):[^@]+@", r"://\1:****@", (p.stdout or "") + (p.stderr or ""))
    print(out.strip())
    sys.exit(p.returncode)

if __name__ == "__main__":
    main()
