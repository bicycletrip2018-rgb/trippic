# 장소 데이터 적재

`places` 테이블을 두 출처로 채운다. 하나만으로는 앱이 성립하지 않는다.

| 출처 | 채우는 것 | 규모 | 왜 필요한가 |
|---|---|---|---|
| 상가업소정보 (공공데이터포털) | 식당·카페·술집·숙박·상점 | 전국 168만 → 필터 후 일부 | 업소 커버리지가 압도적 |
| TourAPI (KorService2) | 관광지·자연·해수욕장·문화재·축제 | 약 5만 | **상가업소정보에는 이게 하나도 없다** |

## 순서

```bash
./db/import/fetch_sangga.sh          # 353MB zip 받아서 CP949 파일명으로 해제
set -a; . .env; set +a               # TOURAPI_KEY
./db/import/03_load.sh               # 변환 → 적재 (로컬 검증 DB)
DB_URL=postgres://... ./db/import/03_load.sh   # Supabase
```

## 규칙

**1. 버리는 게 본체다.**
`db/mapping/*.csv`에서 `trippic_category`가 빈 분류는 통째로 버린다.
병원·학원·부동산·미용실·정비소는 여행 기록이 아니다. PLAN §8.5 1차 방어선.

**2. TourAPI가 먼저, 상가업소가 나중.**
`load.sql`은 TourAPI를 먼저 넣고, 상가업소 중 **100m 안에 이름이 비슷한
TourAPI 장소가 이미 있으면 버린다**. 같은 곳이 두 번 뜨는 게 가장 나쁘다.
이름 비교 전에 공백과 지점 접미사(`…점`)를 지운다.

**3. 멱등하다.**
`(source, source_ref)` 유니크 인덱스로 upsert 한다. 몇 번 돌려도 결과가 같다.
TourAPI 수집은 `data/out/.tourapi.ckpt`에 체크포인트를 남겨 이어받는다.

## 함정 (겪은 것만 적는다)

- **DB 로케일**: `LC_CTYPE`이 C면 pg_trgm이 한글을 문자로 보지 않아
  `similarity()`가 **항상 0**이 된다. 중복 판정과 한글 검색이 조용히 전부 죽는다.
  DB는 반드시 UTF-8 로케일로 만든다. `db/local/smoke.sql`이 이걸 검사한다.
- **`\copy`는 `:'변수'`를 치환하지 않는다.** 그리고 `-f`로 돌릴 때
  `from stdin`은 **스크립트 파일**을 읽는다. `from pstdin`을 써야 파이프를 읽는다.
- **CP949 파일명**: 한국 공공데이터 zip은 `unzip`이 "Illegal byte sequence"로 죽는다.
  `fetch_sangga.sh`가 python `zipfile`로 `cp437 → cp949` 디코딩해서 푼다.
- **중분류명 뒤 공백**: `"비알코올 "` 처럼 공백이 붙어 있다. 코드로 매칭하고
  이름은 참고로만 쓴다.
- **TourAPI 개발계정은 하루 1,000호출**이다 (`numOfRows=100` → 10만 행/일).
  전국 5만 건은 하루면 끝나지만, 운영계정(심의승인)을 받아두는 편이 낫다.

## 아직 안 한 것

- `regions` 적재 — 없으면 `places.region_code`가 전부 null이다.
  `load.sql` 3단계가 regions가 채워진 뒤 백필한다.
- `place_stats` 콜드스타트 시딩 (인기도 신호가 0에서 시작한다)
