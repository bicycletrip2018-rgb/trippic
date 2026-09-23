# Supabase 배포

## 0. 프로젝트 만들기 (최초 1회)

1. <https://supabase.com> → **Start your project** → GitHub 계정으로 로그인
2. **New project**
   - **Name**: `trippic`
   - **Database Password**: 대시보드가 만들어주는 걸 쓰고 **바로 복사해 둔다.**
     나중에 다시 볼 수 없다 (재설정은 가능하지만 번거롭다).
   - **Region**: **Northeast Asia (Seoul)** — 사용자가 한국이다. 지연이 곧 체감 속도다.
   - **Plan**: Free로 시작. 500MB 제한이 걸리면 그때 올린다.
3. 프로비저닝 2~3분

### PostGIS는 따로 켤 필요가 없다

`db/migrations/001`이 `create extension if not exists postgis`를 실행한다.
대시보드(**Database → Extensions**)에서 미리 켜도 된다 — 어느 쪽이든 동작한다.

> 둘의 차이가 하나 있다. 대시보드로 켜면 `extensions` 스키마에,
> 우리 마이그레이션이 켜면 `public`에 설치된다. 그래서 모든 함수의
> `search_path`를 `public, extensions`로 두었다. 양쪽 다 찾는다.

### 용량 확인

무료 플랜 DB 용량은 **500MB**다.
`places` 20만 행을 실제로 넣어 재보니 **108MB**(테이블 39 + 인덱스 69)였다.
→ 1,625,826행이면 **약 875MB**. **무료 플랜에 안 들어간다.**

> 이 875MB는 로컬 PostGIS 스텁(core `point`, 16바이트) 기준이다.
> 진짜 PostGIS `geometry(Point,4326)`는 32바이트고 GiST 인덱스도 더 크다.
> **Supabase에서는 1GB를 넘길 가능성이 높다.** 올려 보고 다시 재야 한다.

선택지:
- **Pro ($25/월, 8GB)** 로 올린다 — 전량 적재하려면 이게 필요하다
- 또는 **지역을 좁혀 시작**한다. `data/sang/`에서 해당 시도 CSV만 골라
  `01_sangga.py`에 넘기면 된다. 예) 서울+부산+제주 ≈ 60만 행 ≈ 320MB — 무료 플랜에 들어간다.
  TourAPI 19,752곳은 전국을 다 넣어도 13MB밖에 안 되니 항상 전량 넣는다.

스키마 검증만 할 거라면 장소 없이 올려도 된다 — `verify.sh`는 자체 표본을 쓴다.

## 1. 연결 문자열

**Project Settings → Database → Connection string**에서 **Session pooler**를 고른다.
`[YOUR-PASSWORD]` 자리에 0단계에서 복사해 둔 비밀번호를 넣는다.

비밀번호가 들어가므로 **터미널 히스토리나 채팅에 남기지 말고** `.env`에 바로 적는다
(`.gitignore`에 이미 들어 있다):

```
DB_URL=postgresql://postgres.<ref>:<PW>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
```

> **Direct connection(`db.<ref>.supabase.co`)은 쓰지 않는다.**
> 새 프로젝트는 IPv6 전용이라 대부분의 가정 회선에서 안 붙는다.
> IPv4는 유료 부가기능이다. **Session pooler(5432)** 가 정답이다.
> Transaction pooler(6543)도 안 된다 — 임시 테이블·`set role`을 못 다뤄 중간에 깨진다.

> 마이그레이션은 **5432(session) 포트**로 돌린다. 6543(transaction pooler)은
> 준비된 구문·임시 테이블·`set role`을 제대로 못 다뤄 중간에 깨진다.

`.env`에 넣어도 된다 (`.gitignore`에 이미 들어 있다).

## 2. 점검 → 적용 → 검증

```bash
./db/supabase/push.sh --check   # 아무것도 안 바꾸고 환경만 본다
./db/supabase/push.sh           # 적용 (파일 하나 = 트랜잭션 하나)
./db/supabase/verify.sh         # 동작 검증 33건 (전부 롤백된다)
```

`--check`가 보는 것:
- 접속과 서버 버전
- **DB 로케일** — `LC_CTYPE`이 C면 여기서 멈춘다. pg_trgm이 한글을 문자로
  보지 않아 `similarity()`가 항상 0이 되고, 한글 검색과 장소 중복판정이
  **에러 없이** 죽는다. 배포 후에야 드러나는 종류의 사고다.
- `postgis` 확장 가용 여부
- `auth.users` 존재 (Supabase 프로젝트가 맞는지)

## 3. 올리지 않는 것

`db/local/*`는 **절대 올리지 않는다.**
- `000_supabase_shim.sql` — `auth.uid()`를 덮어쓴다. 올리는 순간 RLS가 전부 무너진다.
- `001_postgis_stub.sql` — 진짜 PostGIS와 충돌한다.

`push.sh`는 `db/migrations/*.sql`만 본다.

## 4. 적재

```bash
DB_URL=... ./db/import/03_load.sh
```

168만 행을 pooler로 밀어넣으면 오래 걸린다. `load.sql`은 멱등하므로
끊기면 다시 돌리면 된다.

## 남은 위험

- **RLS 성능**. 정책 안의 `pin_shared_with_me()`가 핀마다 호출된다.
  지도 한 화면 200핀 × 서브쿼리다. 실데이터에서 `explain analyze`로 봐야 한다.
- **`api_map_clusters`의 클러스터링 비용** — 실측 안 했다.
- 익명 웹 뷰어의 실제 지연 (pooler 경유).
