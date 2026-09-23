#!/usr/bin/env bash
# =====================================================================
# 소상공인시장진흥공단 상가(상권)정보 (~353MB) 다운로드 + 압축 해제
#
# ★ 파일 ID를 하드코딩하면 안 된다. data.go.kr은 재배포할 때마다 atchFileId를
#   바꾸고, **옛 ID로 요청하면 에러도 안 내고 1,127바이트짜리 빈 응답을 준다**
#   (Content-Disposition의 filename도 빈 문자열이다). 차단처럼 보이지만 아니다.
#   그래서 사이트가 쓰는 2단계를 그대로 따라간다:
#     1) /tcs/dss/selectFileDataDownload.do → 현재 atchFileId를 JSON으로 받는다
#     2) /cmm/cmm/fileDownload.do?atchFileId=… → 실제 파일
#
# ★ 이어받기(-C -)는 쓰지 말 것. 이 서버는 Range를 무시하고 200 + 빈 본문을 주며
#   curl이 거기서 그대로 멈춘다.
#
# 한국 공공데이터 zip은 파일명이 CP949라 unzip이 "Illegal byte sequence"로 죽는다.
# python zipfile로 cp437→cp949 디코딩해서 푼다.
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ZIP="$ROOT/data/sangga.zip"; DIR="$ROOT/data/sang"; CJ="$ROOT/data/.cookies"
PK=15083033
DETAIL="uddi:b3094bc9-8756-4ecc-9141-9144b98a531e"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
mkdir -p "$DIR"
trap 'rm -f "$CJ"' EXIT

if ! python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1])" "$ZIP" 2>/dev/null; then
  echo "▶ 1단계: 현재 파일 ID 조회"
  curl -sSL --max-time 60 -c "$CJ" -A "$UA" \
       "https://www.data.go.kr/data/$PK/fileData.do" -o /dev/null
  curl -sS --max-time 60 -b "$CJ" -c "$CJ" -A "$UA" \
       -H "X-Requested-With: XMLHttpRequest" \
       -H "Referer: https://www.data.go.kr/data/$PK/fileData.do" \
       --data-urlencode "publicDataPk=$PK" \
       --data-urlencode "publicDataDetailPk=$DETAIL" \
       --data-urlencode "atchFileId=" \
       --data-urlencode "fileDetailSn=1" \
       --data-urlencode "publicDataTyCode=PR0051" \
       "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do" -o "$ROOT/data/.dl.json"
  read -r FID SN NM < <(python3 - "$ROOT/data/.dl.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
if not d.get("status"):
    sys.exit("파일 ID 조회 실패: " + str(d.get("error")))
print(d["atchFileId"], d["fileDetailSn"], d["dataSetFileDetailInfo"].get("dataNm", ""))
PY
)
  rm -f "$ROOT/data/.dl.json"
  echo "   $NM  ($FID)"

  echo "▶ 2단계: 다운로드 (~353MB)"
  for i in 1 2 3; do
    curl -L --fail -b "$CJ" -A "$UA" \
         -H "Referer: https://www.data.go.kr/data/$PK/fileData.do" \
         --max-time 3600 --speed-time 120 --speed-limit 50000 \
         -o "$ZIP" "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FID&fileDetailSn=$SN" \
      && break
    echo "   재시도 $i…"; sleep 10
  done
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1])" "$ZIP" \
    || { echo "zip이 깨졌다. data/sangga.zip 지우고 다시 실행할 것."; exit 1; }
fi

echo "▶ 압축 해제 (CP949 파일명)"
python3 - "$ZIP" "$DIR" <<'PY'
import sys, zipfile, os
z, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(z) as f:
    for i in f.infolist():
        try:    name = i.filename.encode('cp437').decode('cp949')
        except (UnicodeEncodeError, UnicodeDecodeError): name = i.filename
        dst = os.path.join(out, os.path.basename(name))
        with f.open(i) as src, open(dst, 'wb') as d:
            d.write(src.read())
        print("  ", os.path.basename(name))
PY
echo "▶ 완료. zip은 지워도 된다: rm $ZIP"
