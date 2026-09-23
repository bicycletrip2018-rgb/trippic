/**
 * 하루 코스 (§12.25-B) — **만드는 게 아니라 복원한다**
 *
 * ★ 다른 앱의 코스는 편집자가 만든다. 우리는 만들 재료가 없다:
 *   장소 465,914곳과 사진 49,285장이 있지만 그건 **점이지 순서가 아니다.**
 *   `places` 에 코스·동선 컬럼은 없다. 인기 장소를 거리순으로 묶어 코스라 부르면
 *   그건 에디터 코스의 **사람 손조차 안 탄 버전**이다.
 *
 * ★ 우리가 가진 유일한 근거는 **사진의 시각과 좌표**다. 그래서 코스는 기록에서
 *   복원되고, 복원의 단위는 **한 사람의 실제 하루**다.
 *
 * ★ 그래서 이 파일에는 '추천'이 없다. 순서를 바꾸지도, 안 간 곳을 끼워 넣지도,
 *   최적 경로로 다시 짜지도 않는다. **있었던 일을 읽기 좋게 놓을 뿐이다.**
 *   집계 코스("여기 간 사람들이 다음에 간 곳")는 여러 사람의 실제 하루가 쌓여야
 *   가능하다 — 지금 서버에 여행 1개다. 쌓이기 전에는 만들지 않는다.
 */

export type CoursePin = {
  id: string;
  placeId?: string | null;   // 집계 코스는 **장소 단위**다 — 좌표만으로는 이름을 못 붙인다
  regionCode?: string | null;// 섬 판정에 쓴다 (035). 좌표가 아니라 행정구역으로 가른다
  visited_at: string;
  stay_sec?: number | null;
  category?: string;
  memo?: string | null;
  placeName?: string | null;
  lng: number;
  lat: number;
  photo?: string | null;
};

export type Leg = {
  distM: number;
  /** 이동 시간(초). 섬을 건너면 null — 아래 `crossSea` 를 본다. */
  moveSec: number | null;
  crossSea: boolean;
};

export type Course = {
  id: string;            // "d20240510"
  day: number;           // dayOf()
  date: Date;
  stops: CoursePin[];
  legs: Leg[];           // stops.length - 1 개
  startAt: Date;
  endAt: Date;
  /** 첫 사진~마지막 사진. 하루의 길이가 아니라 **기록이 덮은 구간**이다. */
  spanSec: number;
  /** 체류 합계(초). 모르는 정거장은 빼고 더한다 — 아래 `stayUnknown` 를 본다. */
  staySec: number;
  stayUnknown: number;   // 체류를 모르는 정거장 수 (사진 1장짜리)
  moveSec: number;       // 이동 합계(초). 섬 구간은 빼고 더한다
  crossSea: number;      // 섬을 건넌 구간 수
  /** 사진이 없어 무엇을 했는지 모르는 시간(초) = 덮은 시간 − 체류 − 이동.
      ★ 이걸 안 내놓으면 화면에 세 숫자가 나란히 서고 **합이 안 맞는다.**
        사용자는 계산기를 두드리다 우리를 의심하거나, 더 나쁘게는 안 세어 본다. */
  gapSec: number;
};

const DAY_MS = 864e5, KST = 9 * 36e5;
export const dayOf = (ts: number) => Math.floor((ts + KST) / DAY_MS);

const EARTH = 6371000;
export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/* ★ 직선 × 1.4 는 **육지에서만** 맞다 (§12.25-E). 제주와 뭍 사이에 도로는 없는데
   공식은 태연히 "42분"을 내놓는다. 거짓 숫자보다 "배·비행기 필요"가 낫다.
   ★ 한때 위도 한 줄(33.6/34.2)로 제주만 막았다. 울릉도·백령도는 그대로 "차로 3시간"이
     찍혔다. 이제 **행정구역 → 육로 덩어리** 표(035)로 판정한다 — 서버와 같은 표다.
   ★ 덩어리를 **모르면**(옹진처럼 섬과 연륙교가 섞인 군) 시간을 말하지 않는다. */
export type LandmassOf = (regionCode?: string | null) => string;
export const MAINLAND = "mainland", UNKNOWN_LAND = "unknown";
/** 표를 못 받았을 때의 기본값 — 전부 본토로 본다(옛 동작과 같다). */
export const noLandmass: LandmassOf = () => MAINLAND;

/* ★ 이동 모델은 **앱 전체에 한 벌**이다. 한때 여기는 40km/h, 갈 곳 탭은 60km/h 였다 —
   같은 거리를 두 화면이 다르게 말했고, 시간 예산 필터가 그 둘 위에 서면
   "차로 25분"이라 해 놓고 40분으로 자르게 된다.
   ★ 40 을 골랐다. 둘 다 추측이지만, 시간 예산에서 틀리는 방향이 다르다 —
   빠르게 잡으면 **못 끝낼 일정**을 권하고, 느리게 잡으면 후보가 조금 줄 뿐이다.
   체류 시간도 이미 하한(032)이라 여기서까지 낙관하면 오차가 겹친다.
   ★ 서버(034)도 같은 값을 쓴다. 바꿀 때는 두 곳을 같이 바꾼다. */
export const ROAD_FACTOR = 1.4;   // 직선 대비 도로 거리
export const KMH = 40;

export function legOf(a: CoursePin, b: CoursePin, lm: LandmassOf = noLandmass): Leg {
  const d = distM(a, b);
  const la = lm(a.regionCode), lb = lm(b.regionCode);
  // 덩어리가 다르거나, 한쪽이라도 모르면 차 시간을 못 낸다
  if (la !== lb || la === UNKNOWN_LAND) return { distM: d, moveSec: null, crossSea: true };
  return { distM: d, moveSec: (d * ROAD_FACTOR) / (KMH * 1000 / 3600), crossSea: false };
}

/** 핀들을 **날짜로 잘라** 하루씩 만든다. 정렬은 방문 시각 — 등록 순서가 아니다. */
export function buildCourses(
  pins: CoursePin[], minStops = 2, lm: LandmassOf = noLandmass,
): Course[] {
  const byDay = new Map<number, CoursePin[]>();
  for (const p of pins) {
    const ts = Date.parse(p.visited_at);
    if (!Number.isFinite(ts)) continue;
    const d = dayOf(ts);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(p);
  }
  const out: Course[] = [];
  for (const [day, raw] of byDay) {
    /* ★ 정거장 하나짜리는 코스가 아니다. "어디에 갔다"는 이미 지도가 말하고 있고,
       코스는 **순서**가 있어야 코스다. 기본 2곳. */
    if (raw.length < minStops) continue;
    const stops = raw.slice().sort((a, b) => Date.parse(a.visited_at) - Date.parse(b.visited_at));
    const legs = stops.slice(1).map((s, i) => legOf(stops[i], s, lm));
    const startAt = new Date(Date.parse(stops[0].visited_at));
    const last = stops[stops.length - 1];
    const endAt = new Date(Date.parse(last.visited_at) + (last.stay_sec ?? 0) * 1000);
    out.push({
      id: "d" + day, day, date: startAt, stops, legs, startAt, endAt,
      spanSec: Math.max(0, (endAt.getTime() - startAt.getTime()) / 1000),
      staySec: stops.reduce((n, p) => n + (p.stay_sec ?? 0), 0),
      stayUnknown: stops.filter((p) => p.stay_sec == null).length,
      moveSec: 0, crossSea: 0, gapSec: 0,
    });
    const c = out[out.length - 1];
    c.moveSec = legs.reduce((n, l) => n + (l.moveSec ?? 0), 0);
    c.crossSea = legs.filter((l) => l.crossSea).length;
    c.gapSec = Math.max(0, c.spanSec - c.staySec - c.moveSec);
  }
  return out.sort((a, b) => b.day - a.day);
}

/* ── 보여 주기 ────────────────────────────────────────────────
   ★ "0분"을 쓰지 않는다. 사진이 한 장이면 체류를 **모르는** 것이지 0 이 아니다. */
export const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function dur(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}시간 ${r}분` : `${h}시간`;
}

export const ymd = (d: Date) =>
  `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;

/** 직선거리(m) → 차로 몇 분. 화면에 쓰는 문구까지 여기서 만든다 — 두 벌이 되지 않게. */
export const driveMin = (distM: number) => Math.ceil((distM * ROAD_FACTOR) / (KMH * 1000 / 60));
export const driveText = (distM: number) => {
  const m = driveMin(distM);
  return m < 60 ? `차로 ${m}분` : `차로 ${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + "분" : ""}`.trim();
};
