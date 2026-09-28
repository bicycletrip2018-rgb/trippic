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

## 갱신 — **사라진 곳까지 봐야 갱신이다** (§13.65)

upsert는 **새로 생긴 곳과 바뀐 곳**만 본다. 문을 닫아 데이터에서 빠진 곳은
아무도 안 봤고, 그래서 한 번 들어온 상호는 **지도에 영원히 남았다.**

`load_merge.sql` 4단계가 `api_mark_closed`를 부른다(051):

- 이번 스냅샷에 없던 `source_ref` → `closed_at` 을 찍는다
- 다시 나타나면 `closed_at` 을 지운다 (되살아남 — 자료 정리·업종 변경으로 흔하다)
- ★ **지우지 않는다.** `pins.place_id` 가 `on delete set null` 이라 하드 삭제하면
  **사용자의 기록이 장소를 잃는다.** 그 카페가 없어졌다고 *"거기 갔었다"* 가
  거짓이 되지는 않는다.
- ★ **출처마다 따로** 판정한다. 상가업소만 받은 날 TourAPI가 통째로 닫히면 안 된다 —
  **안 본 것과 없어진 것은 다르다.**

### ★ 반쪽짜리 스냅샷을 막는 빗장
내려받기가 끊기거나 공공데이터가 부분 공개된 날 그대로 돌리면 **수십만 곳이
한꺼번에 문을 닫는다.** 그래서 새 스냅샷이 **지금의 80% 미만**이면 아무것도 하지
않고 이유를 돌려준다:

```json
{"ok": false, "why": "새 스냅샷이 2곳뿐입니다 — 지금 58334곳의 80% 미만이라 폐업 판정을 건너뜁니다"}
```

**`ok:false` 를 그냥 넘기지 말 것.** 내려받기를 먼저 보고, 정말 그만큼 줄어든 것이
맞으면 `p_min_ratio` 를 낮춰 다시 부른다.

### 얼마나 묵었나
```sql
select source,
       count(*) filter (where closed_at is null)     as 살아있음,
       count(*) filter (where closed_at is not null) as 문닫음,
       max(updated_at)::date                         as 마지막_갱신,
       current_date - max(updated_at)::date          as 며칠_됐나
from public.places group by source;
```

### 언제 다시 돌리나
`fetch_sangga.sh` 는 **파일 ID를 매번 조회**하므로 원본이 재배포돼도 그대로 돈다
(옛 ID로 요청하면 에러도 없이 1,127바이트 빈 응답이 온다 — 그래서 하드코딩하지 않는다).

받아 보고 **크기가 지난번과 같으면 아직 새 판이 아니다.** 그때는 적재를 건너뛴다 —
같은 것을 다시 넣어도 결과는 같지만(멱등) 시간과 용량만 쓴다.

## 아직 안 한 것

- `regions` 적재 — 없으면 `places.region_code`가 전부 null이다.
  `load.sql` 3단계가 regions가 채워진 뒤 백필한다.
- `place_stats` 콜드스타트 시딩 (인기도 신호가 0에서 시작한다)
- **자동 실행** — 지금은 사람이 부른다. 원본이 분기 단위로 바뀌는 데이터라
  자동화보다 *"언제 묵었는지 보이는 것"* 이 먼저다.
