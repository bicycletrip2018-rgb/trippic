/**
 * 앨범 → 여행 → 정거장 (§6.5) — 웹 `prototype/upload.js` 의 판정부 이식
 *
 * ★ 여기에는 화면이 한 줄도 없다. 웹판에서 이 함수들만 DOM 을 안 건드리게
 *   짜 둔 것이 이 이식을 **하루가 아니라 한 시간**으로 만들었다.
 *   숫자(TUNE·R·T)는 6,061장 실측으로 고른 값이라 **그대로** 옮긴다 —
 *   옮기면서 고치면 그 측정이 무효가 된다.
 *
 * ★ 웹과 다른 것 하나: `localStorage` 가 없다. 날짜 규칙(사용자 정정)은
 *   호출자가 넘긴다 — 저장은 화면의 일이고 판정은 여기의 일이다.
 */

export type Gps = { lat: number; lng: number };
export type Photo = {
  id: string;
  ts: number;                 // 촬영 시각 (EXIF). 없으면 파일 생성 시각
  gps: Gps | null;            // EXIF 좌표. 없을 수 있다 — 카톡·스크린샷
  acc?: number;               // GPS 정확도(m)
  uri?: string;               // 기기 안 경로. **밖으로 나가지 않는다**
  w?: number; h?: number;
};
export type Stop = {
  id: string;
  items: Photo[];
  c: Gps;
  start: number; end: number;
  worstAcc: number;
  noGpsCount: number;
};
export type Trip = {
  id: string;
  title: string;
  region: string;
  start: number; end: number;
  items: Photo[];
  stops: Stop[];
  placeCount: number;
  isOrphan?: boolean;
};

/* ★ 상수가 아니라 설정이다 — 실제 앨범으로 흔들어 보며 평지인지 벼랑인지 봐야 한다 */
export const TUNE = {
  CELL_DEG: 0.02,        // ≈2km 격자
  ROUTINE_WIN: 90,       // ±90일 안에서 본다
  ROUTINE_RUNS: 3,       // 끊어진 방문 3회 이상이면 일상
  RUN_GAP: 2,            // 이틀 넘게 비면 다른 '방문'
  TRIP_GAP: 2 * 864e5,   // 이틀 이상 비면 다른 여행
  TRIP_MIN: 2,           // 사진 2장이면 여행이다
};
const DAY_MS = 864e5, KST = 9 * 36e5;
const cellOf = (p: Gps) =>
  Math.round(p.lat / TUNE.CELL_DEG) + ":" + Math.round(p.lng / TUNE.CELL_DEG);
export const dayOf = (ts: number) => Math.floor((ts + KST) / DAY_MS);

const EARTH = 6371000;
export function distM(a: Gps, b: Gps) {
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(h));
}

/* ── 정거장 ────────────────────────────────────────────────────
   ★ R 은 상수가 아니다 — 사진이 들고 온 GPS 정확도에서 계산한다.
     2.5σ면 2D 정규오차의 약 96%를 덮는다. 아래 60m, 위 200m 에서 자른다.
   합성 채점(114장·28곳): R=50m 탭45 병합0 분할8 / R=150m 탭23 병합5 분할0.
   분할은 한 번 더 고르면 끝이고 병합은 **틀린 데이터가 남는다** → 넉넉히 잡고 쪼갠다. */
export const STOP_T = 3 * 36e5;
export const stopRadius = (accM?: number) => Math.min(200, Math.max(60, 2.5 * (accM || 15)));

export function clusterStops(items: Photo[], R: number | null = null, T = STOP_T): Stop[] {
  const out: any[] = [];
  let cur: any = null;
  // EXIF 가 없는 사진은 좌표로 묶을 수 없다. 먼저 빼고, 나중에 시간으로 붙인다.
  const withGps = items.filter((x) => x.gps);
  const noGps = items.filter((x) => !x.gps);
  for (const it of withGps.slice().sort((a, b) => a.ts - b.ts)) {
    const p = it.gps!;
    // 두 사진 중 **나쁜 쪽**에 맞춘다 — 정확한 사진이 부정확한 사진을 밀어내지 않게
    const r = R !== null ? R
            : Math.max(stopRadius(it.acc), stopRadius(cur ? cur.worstAcc : 15));
    if (cur) {
      const far = distM(cur.c, p) > r;
      const stale = it.ts - cur.end > T;
      if (!far && !stale) {
        cur.items.push(it); cur.end = it.ts;
        cur.worstAcc = Math.max(cur.worstAcc || 15, it.acc || 15);
        const n = cur.items.length;          // 중심을 누적 평균으로 (GPS 오차를 평균이 흡수)
        cur.c = { lat: cur.c.lat + (p.lat - cur.c.lat) / n,
                  lng: cur.c.lng + (p.lng - cur.c.lng) / n };
        continue;
      }
    }
    cur = { items: [it], c: { ...p }, start: it.ts, end: it.ts, worstAcc: it.acc || 15 };
    out.push(cur);
  }
  // 시간이 가장 가까운 정거장에 붙인다 (§6.5 4단계). 공개 자격은 없다.
  for (const it of noGps) {
    let best: any = null, bd = Infinity;
    for (const st of out) {
      const d = Math.min(Math.abs(it.ts - st.start), Math.abs(it.ts - st.end));
      if (d < bd) { bd = d; best = st; }
    }
    if (best) best.items.push(it);
  }
  return out.map((s, i) => ({
    ...s, id: "s" + i,
    items: s.items.slice().sort((a: Photo, b: Photo) => a.ts - b.ts),
    noGpsCount: s.items.filter((x: Photo) => !x.gps).length,
  }));
}

/* 정거장을 둘로 쪼갠다 (가장 큰 시간 간격에서 자른다).
   병합 오류를 **막는 대신 고치기 싸게** 만드는 쪽이 이 설계의 전제다. */
export function splitStop(stops: Stop[], id: string): Stop[] {
  const i = stops.findIndex((s) => s.id === id);
  const s = stops[i];
  if (!s || s.items.length < 2) return stops;
  let cut = 1, best = -1;
  for (let k = 1; k < s.items.length; k++) {
    const gap = s.items[k].ts - s.items[k - 1].ts;
    if (gap > best) { best = gap; cut = k; }
  }
  const a = clusterStops(s.items.slice(0, cut), 1e9, 1e15)[0];
  const b = clusterStops(s.items.slice(cut), 1e9, 1e15)[0];
  return [...stops.slice(0, i), { ...a, id: id + "a" }, { ...b, id: id + "b" }, ...stops.slice(i + 1)];
}

/* ── 늘 가던 곳 판정 ───────────────────────────────────────────
   실측(6,061장·진짜 39건): 거주지 30km 규칙은 근거리 나들이 5/5 를 잃었고,
   규칙 없음은 56일짜리 덩어리를 만들었다. '늘 가던 곳' 이 37건·오염 4건으로 이겼다.
   ★ 덤: 앱이 사용자의 집을 알 필요가 없어진다 (§2 최소 수집). */
export type DayRule = Record<number, "trip" | "daily" | undefined>;

export function buildRoutine(album: Photo[], dayRule: DayRule = {}) {
  const cellDays = new Map<string, Set<number>>(), byDay = new Map<number, Photo[]>();
  for (const x of album) {
    if (!x.gps) continue;
    const c = cellOf(x.gps), d = dayOf(x.ts);
    if (!cellDays.has(c)) cellDays.set(c, new Set());
    cellDays.get(c)!.add(d);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(x);
  }
  const runs = new Map<string, number[]>();   // 격자마다 '끊어진 방문'의 시작일
  for (const [c, set] of cellDays) {
    const ds = [...set].sort((a, b) => a - b), r: number[] = [];
    for (let i = 0; i < ds.length; i++) if (i === 0 || ds[i] - ds[i - 1] > TUNE.RUN_GAP) r.push(ds[i]);
    runs.set(c, r);
  }
  const isRoutine = (c: string, d: number) => {
    let n = 0;
    for (const s0 of runs.get(c) || [])
      if (Math.abs(s0 - d) <= TUNE.ROUTINE_WIN && ++n >= TUNE.ROUTINE_RUNS) return true;
    return false;
  };
  return {
    usual: (x: Photo) => (x.gps ? isRoutine(cellOf(x.gps), dayOf(x.ts)) : true),
    /* 하루의 **주된** 격자가 일상이면 그 날은 통째로 일상, 아니면 그 날 안에서도
       일상 격자의 사진은 뺀다 (출발 전 집앞 사진 등). */
    travelPhotos() {
      const ids = new Set<string>();
      for (const [d, photos] of byDay) {
        const fixed = dayRule[d];              // ★ 사람이 기준보다 우선이다
        if (fixed === "daily") continue;
        if (fixed === "trip") { photos.forEach((x) => ids.add(x.id)); continue; }
        const cnt: Record<string, number> = {};
        photos.forEach((x) => { const c = cellOf(x.gps!); cnt[c] = (cnt[c] || 0) + 1; });
        const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
        if (isRoutine(main, d)) continue;
        photos.forEach((x) => { if (!isRoutine(cellOf(x.gps!), d)) ids.add(x.id); });
      }
      return ids;
    },
  };
}

/* ── 여행 ──────────────────────────────────────────────────── */
export function clusterTrips(album: Photo[], dayRule: DayRule = {}): Trip[] {
  const out: any[] = [];
  let cur: any = null;
  /* ★ 정렬 — 앨범 스캔이 시간순이라는 보장은 없다. 정렬하지 않으면 서로 다른
     여행이 한 덩어리가 된다. 실측: 진짜 34건 → 검출 9건, 9건 전부 혼합이었다. */
  const sorted = album.slice().sort((a, b) => a.ts - b.ts);
  const routine = buildRoutine(sorted, dayRule);
  const travel = routine.travelPhotos();
  for (const it of sorted) {
    if (!it.gps) continue;
    /* ★ 일상 사진을 만나도 진행 중인 여행을 **끊지 않는다** — 건너뛰기만 한다.
       실측: 그런 사진 112장이 여행 31건을 73조각으로 쪼갰다. */
    if (!travel.has(it.id)) continue;
    if (cur && it.ts - cur.end <= TUNE.TRIP_GAP) { cur.items.push(it); cur.end = it.ts; }
    else { cur = { items: [it], start: it.ts, end: it.ts }; out.push(cur); }
  }
  for (const it of sorted) {                   // 좌표 없는 사진은 시간으로 붙인다
    if (it.gps) continue;
    const t = out.find((x) => it.ts >= x.start && it.ts <= x.end);
    if (t) t.items.push(it);
  }
  return out
    .filter((t) => t.items.filter((x: Photo) => x.gps).length >= TUNE.TRIP_MIN)
    .map((t) => {
      const stops = clusterStops(t.items);
      const d = new Date(t.start);
      /* ★ 지역 이름은 **아직 모른다.** 웹판은 데모 POI 가 답을 들고 있었지만
         실제 사진에는 장소가 안 달려 있다 — 장소는 다음 화면에서 서버가 붙인다.
         그래서 제목은 날짜로 짓고, 지역은 장소를 고른 뒤 채운다. */
      return {
        // ★ 순번이 아니라 시작 시각. 판정을 고쳐 다시 묶으면 순번은 밀리고,
        //   이미 등록한 여행이 목록에 되살아난다.
        id: "t" + t.start,
        title: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")} 여행`,
        region: "", start: t.start, end: t.end,
        items: t.items, stops, placeCount: stops.length,
      } as Trip;
    })
    .sort((a, b) => b.start - a.start);
}

/* 여행에 묶이지 않은 사진 — ㉠ 늘 가던 곳 ㉡ 사진이 적어 탈락한 낱개 기록.
   둘 다 등록할 수 있어야 한다 (PLAN §6.5 "낱개 기록도 허용한다"). */
export function findOrphans(album: Photo[], trips: Trip[], dayRule: DayRule = {}): Trip {
  const used = new Set(trips.flatMap((t) => t.items.map((x) => x.id)));
  const rest = album.filter((a) => !used.has(a.id));
  const routine = buildRoutine(album, dayRule);
  const loose = rest.filter((x) => x.gps && !routine.usual(x));   // ㉡ 만 보여 준다
  return {
    id: "orphans", isOrphan: true, title: "여행에 묶이지 않은 사진",
    region: "여러 곳", items: rest, stops: clusterStops(loose),
    placeCount: 0,
    start: rest.length ? rest[0].ts : Date.now(),
    end: rest.length ? rest[rest.length - 1].ts : Date.now(),
  };
}

export const fmtRange = (a: number, b: number) => {
  const f = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  };
  return new Date(a).toDateString() === new Date(b).toDateString() ? f(a) : `${f(a)}–${f(b).slice(-5)}`;
};
