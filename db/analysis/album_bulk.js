/* =====================================================================
   "몇 년 치 사진을 한 번에 넣으면 알아서 정리되는가" — 실측
   광고 컨셉 그대로를 재현한다: 방치된 앨범 전체를 통째로 투입.

   prototype/makeAlbum()과 다른 점 (일부러 다르게 만든다)
     · 규모      130장 → 수천 장
     · 구성비    실제 앨범은 대부분이 일상 사진이다. 여행은 소수다.
     · 좌표없음  카톡·스크린샷은 EXIF도 **장소도** 없다.
                 makeAlbum은 좌표 없는 사진에도 poi를 달아 뒀다 — 답을 아는 데이터다.
     · 정렬      OS 앨범 스캔 결과가 시간순이라는 보장이 없다.
     · 이사      7년이면 거주지가 바뀐다.

   실행: node db/analysis/album_bulk.js [사진수]
   ===================================================================== */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..", "..");
const N = parseInt(process.argv[2] || "6000", 10);

/* ── upload.js를 브라우저 없이 올린다 (복사본이 아니라 원본을 잰다) ── */
const poi = JSON.parse(fs.readFileSync(path.join(ROOT, "prototype/korea-poi.json"), "utf8"));
const noop = () => {};
const fakeEl = new Proxy({}, { get: (t, k) => (k === "style" || k === "dataset" || k === "classList"
  ? new Proxy({}, { get: () => noop }) : k === "firstElementChild" ? fakeEl : noop) , set: () => true });
const sandbox = {
  window: {}, poi, console,
  document: { querySelector: () => null, querySelectorAll: () => [],
              createElement: () => fakeEl, body: fakeEl, addEventListener: noop },
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "prototype/upload.js"), "utf8"), sandbox, { filename: "upload.js" });
const A = sandbox.window.__albumInternals;
if (!A) { console.error("테스트 시임(__albumInternals)이 없다"); process.exit(1); }

/* ── 결정적 난수 (재현 가능해야 비교가 된다) ───────────────────── */
let seed = 20260921;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = (s) => s * Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
const jit = (p, s) => ({ lat: p.lat + gauss(s) / 111320,
                         lng: p.lng + gauss(s) / (111320 * Math.cos(p.lat * Math.PI / 180)) });
const ll = (f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];

const byRegion = {};
for (const f of poi.features) { const r = f.properties.rn; if (r) (byRegion[r] ||= []).push(f); }

/* ── 앨범 합성 ─────────────────────────────────────────────────
   비율 근거: 일반 사용자 앨범에서 여행 사진은 소수다.
     일상 70% / 여행 20% / 좌표없음(카톡·스크린샷·편집본) 10%          */
const HOME_OLD = { lat: 37.5, lng: 127.03 };   // upload.js의 HOME 상수와 같은 자리
const DAILY_POOL = [...(byRegion["강남구"] || []), ...(byRegion["서초구"] || [])];
// ★ 집(강남)에서 30km 밖만 고른다. 종로·성동은 규칙상 애초에 여행이 아니다 —
//   그걸 섞으면 알고리즘 탓이 아닌 실패를 알고리즘 탓으로 읽게 된다.
const TRIP_REGIONS = ["해운대구", "강릉시", "제주시", "경주시", "여수시", "유성구"]
  .filter((r) => (byRegion[r] || []).length >= 6);

const T0 = new Date("2019-01-01T00:00:00+09:00").getTime();
const T1 = new Date("2026-09-01T00:00:00+09:00").getTime();
const album = [];
let pid = 0, truthTrip = 0;
const truth = new Map();   // photoId -> 진짜 여행 id ("" = 여행 아님)

const nDaily = Math.round(N * 0.70), nNoGps = Math.round(N * 0.10);

/* ① 일상 사진 — 집 근처. 여행으로 잡히면 오검출이다. */
for (let i = 0; i < nDaily; i++) {
  const f = pick(DAILY_POOL);
  album.push({ id: pid, poi: f, truth: f.properties.n, gps: jit(ll(f), 15), acc: 15,
               w: 1280, h: 960, focus: 1500, contrast: 45, faceRatio: 0.05,
               ts: T0 + rnd() * (T1 - T0) });
  truth.set(pid++, "");
}

/* ② 여행 — 7년에 걸쳐 흩뿌린다. 하루에 정거장 3~6곳, 정거장마다 2~6장. */
const nTripPhotos = N - nDaily - nNoGps;
const tripWindows = [];
while (album.length - nDaily < nTripPhotos) {
  const region = pick(TRIP_REGIONS), pool = byRegion[region];
  const days = 1 + Math.floor(rnd() * 4);
  const start = T0 + rnd() * (T1 - T0 - days * 864e5);
  if (tripWindows.some((w) => Math.abs(w.s - start) < 20 * 864e5)) continue;  // 여행끼리 안 겹치게
  const tid = "T" + truthTrip++;
  tripWindows.push({ s: start, e: start + days * 864e5, tid, region });
  for (let d = 0; d < days; d++) {
    const stops = 3 + Math.floor(rnd() * 4);
    for (let st = 0; st < stops; st++) {
      const f = pick(pool), base = ll(f);
      const sigma = rnd() < 0.25 ? 30 : 15;               // 가끔 도심 협곡
      const t = start + d * 864e5 + (9 + st * 2.2) * 36e5;
      const shots = 2 + Math.floor(rnd() * 5);
      for (let k = 0; k < shots; k++) {
        album.push({ id: pid, poi: f, truth: f.properties.n, gps: jit(base, sigma), acc: sigma,
                     w: 1280, h: 960, focus: 1500, contrast: 45, faceRatio: 0.05,
                     ts: t + k * 6 * 6e4 });
        truth.set(pid++, tid);
      }
    }
  }
}
/* ②-b 사진 2장짜리 당일치기 3건 — `items.length >= 3` 필터에 걸리는지 본다 */
const shortTrips = [];
for (let i = 0; i < 3; i++) {
  const region = pick(TRIP_REGIONS), f = pick(byRegion[region]);
  const t = T0 + rnd() * (T1 - T0), tid = "S" + i;
  shortTrips.push(tid);
  for (let k = 0; k < 2; k++) {
    album.push({ id: pid, poi: f, truth: f.properties.n, gps: jit(ll(f), 15), acc: 15,
                 w: 1280, h: 960, focus: 1500, contrast: 45, faceRatio: 0.05, ts: t + k * 12 * 6e4 });
    truth.set(pid++, tid);
  }
}

/* ⑤ 근거리 나들이 — 집(강남)에서 30km 안인 종로·성동으로 하루 놀러 간 날.
      "친구가 여행 와서 같이 종로 놀러 간 날"이 이것이다. 일상이 아니다.
      현재 규칙(거주지 30km)은 이걸 통째로 놓친다 — 그게 맞는지가 이 실험의 핵심. */
const NEAR_REGIONS = ["종로구", "성동구", "용산구"].filter((r) => (byRegion[r] || []).length >= 4);
const nearTrips = [];
for (let i = 0; i < 5; i++) {
  const region = pick(NEAR_REGIONS), tid = "N" + i;
  const day = T0 + rnd() * (T1 - T0);
  const dayStart = Math.floor(day / 864e5) * 864e5 + 3 * 36e5;   // 그 날 낮
  nearTrips.push(tid);
  const stops = 2 + Math.floor(rnd() * 3);
  for (let st = 0; st < stops; st++) {
    const f = pick(byRegion[region]), base = ll(f);
    for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) {
      album.push({ id: pid, poi: f, truth: f.properties.n, gps: jit(base, 15), acc: 15,
                   w: 1280, h: 960, focus: 1500, contrast: 45, faceRatio: 0.05,
                   ts: dayStart + (9 + st * 2.5) * 36e5 + k * 7 * 6e4 });
      truth.set(pid++, tid);
    }
  }
}

/* ③ 좌표도 장소도 없는 사진 — 카톡·스크린샷·편집본.
      ★ poi를 달지 않는다. 실제 앱은 이 사진이 어디서 찍혔는지 모른다. */
for (let i = 0; i < nNoGps; i++) {
  album.push({ id: pid, poi: null, truth: null, gps: null, noGps: true,
               ts: T0 + rnd() * (T1 - T0) });
  truth.set(pid++, "");
}

/* ④ 정렬하지 않는다 — OS 앨범 스캔이 시간순이라는 보장은 없다 */
for (let i = album.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [album[i], album[j]] = [album[j], album[i]]; }

console.log(`앨범 ${album.length}장 · ${new Date(T0).getFullYear()}~${new Date(T1).getFullYear()} · `
  + `일상 ${nDaily} / 여행 ${nTripPhotos}(${truthTrip}건) / 좌표없음 ${nNoGps} / 2장짜리 ${shortTrips.length}건 / 근거리나들이 ${nearTrips.length}건`);

/* ── 채점 ──────────────────────────────────────────────────── */
function score(label, input) {
  const t = process.hrtime.bigint();
  let trips, orphans, err = null;
  try {
    trips = A.clusterTrips(input);
    orphans = A.findOrphans(input, trips);
  } catch (e) { err = e; }
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  if (err) { console.log(`\n── ${label}\n  ✗ 터진다: ${err.message}`); return null; }

  // 검출된 여행 하나가 진짜 여행 하나와 대응하는가
  const found = new Set(); let mixed = 0, polluted = 0;
  trips.forEach((tr) => {
    // 좌표 없는 사진을 시간으로 붙이는 것은 §6.5 4단계의 설계된 동작이다.
    // 오염으로 세면 안 된다 — 채점 대상은 좌표를 가진 사진뿐이다.
    const tids = new Set(tr.items.filter((x) => x.gps).map((x) => truth.get(x.id)));
    if (tids.size > 1) mixed++;                       // 여러 여행이 한 덩어리로
    if (tids.has("")) polluted++;                     // 일상 사진이 섞임
    tids.forEach((v) => v && found.add(v));
  });
  const allTrue = truthTrip + shortTrips.length + nearTrips.length;
  const lostShort = shortTrips.filter((s) => !found.has(s)).length;
  const lostNear  = nearTrips.filter((s) => !found.has(s)).length;
  // 일상이 거대 덩어리로 엮였는가 — 규칙을 아예 없앴을 때 무엇이 망가지는지 본다
  const biggest = trips.reduce((m, t) => Math.max(m, t.items.length), 0);
  const longest = trips.reduce((m, t) => Math.max(m, (t.end - t.start) / 864e5), 0);
  const orphTrip = orphans.items.filter((x) => truth.get(x.id)).length;
  console.log(`\n── ${label}   (${ms.toFixed(0)}ms)`);
  console.log(`  검출 여행      ${trips.length}건 / 진짜 ${allTrue}건  →  찾아낸 것 ${found.size}건`);
  console.log(`  여러 여행 병합 ${mixed}건`);
  console.log(`  일상 사진 혼입 ${polluted}건`);
  console.log(`  2장짜리 유실   ${lostShort}/${shortTrips.length}건`);
  console.log(`  근거리 나들이 유실 ${lostNear}/${nearTrips.length}건  ← "친구랑 종로"`);
  console.log(`  가장 큰 여행   ${biggest}장 · ${longest.toFixed(0)}일`);
  console.log(`  낱개로 밀린 여행사진 ${orphTrip}장 (전체 낱개 ${orphans.items.length}장)`);
  return { trips, orphans, ms };
}

/* 여행 기간과 시간이 겹치는 일상 사진. 여행 중에 집 근처 사진이 찍힐 일은 드물다 —
   이게 섞이면 실패 원인이 "알고리즘"인지 "데이터"인지 구분되지 않는다. */
const inTrip = (x) => tripWindows.some((w) => x.ts >= w.s - 36e5 && x.ts <= w.e + 36e5);
const clean = album.filter((x) => !(truth.get(x.id) === "" && x.gps && inTrip(x)));
console.log(`  (여행 기간과 겹친 일상 사진 ${album.length - clean.length}장을 ④에서 뺀다)`);

score("① 현재 코드 · 앨범 그대로(비정렬·좌표없음 포함)", album);
score("② 좌표 없는 사진을 빼고", album.filter((x) => x.gps));
score("③ 좌표 없는 사진을 빼고 + 시간순 정렬", album.filter((x) => x.gps).slice().sort((a, b) => a.ts - b.ts));
score("④ ③ + 여행 기간에 겹친 일상 사진까지 제거 (알고리즘에 가장 유리한 조건)",
      clean.filter((x) => x.gps).slice().sort((a, b) => a.ts - b.ts));


/* =====================================================================
   여행/일상을 가르는 규칙 세 가지 비교
   ※ B·C는 **탐색용 구현**이다. 이긴 규칙만 upload.js에 옮기고
      거기서 진짜 clusterTrips로 다시 잰다 (복사본을 정답으로 삼지 않는다).
   ===================================================================== */
const DAY = 864e5, KST = 9 * 36e5;
const dayOf = (ts) => Math.floor((ts + KST) / DAY);

// 공통 체인 — "여행 사진"으로 판정된 것들을 2일 간격으로 잇는다
function chain(items) {
  const out = []; let cur = null;
  for (const it of items.slice().sort((a, b) => a.ts - b.ts)) {
    if (cur && it.ts - cur.end <= 2 * DAY) { cur.items.push(it); cur.end = it.ts; }
    else { cur = { items: [it], start: it.ts, end: it.ts }; out.push(cur); }
  }
  return out.filter((t) => t.items.length >= 2);
}

/* B — 규칙을 아예 없앤다 (시간 간격만) */
function ruleB(album) { return chain(album.filter((x) => x.gps)); }

/* C — "늘 가던 곳이냐"로 가른다. 집 좌표가 필요 없다.
     · 2km 격자로 뭉개고, 격자마다 '방문한 날'을 센다
     · 그 날 기준 ±90일 창에서 4일 이상 방문한 격자 = 일상 격자
     · 하루의 주된 격자가 일상 격자가 아니면 그 날은 '나간 날'
     · 나간 날 안에서도 일상 격자에 있는 사진은 뺀다 (출발 전 집앞 사진 등)
   이사하면 새 동네가 저절로 일상 격자가 된다 — 상수가 없다. */
const CELL = 0.02, WIN = 90, ROUTINE_DAYS = 4;
const cellOf = (p) => Math.round(p.lat / CELL) + ":" + Math.round(p.lng / CELL);
function ruleC(album) {
  const gps = album.filter((x) => x.gps);
  const cellDays = new Map();          // 격자 -> 방문한 날짜 배열
  const byDay = new Map();             // 날짜 -> 사진들
  for (const x of gps) {
    const c = cellOf(x.gps), d = dayOf(x.ts);
    if (!cellDays.has(c)) cellDays.set(c, new Set());
    cellDays.get(c).add(d);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(x);
  }
  for (const [c, set] of cellDays) cellDays.set(c, [...set].sort((a, b) => a - b));
  const routine = (c, d) => {
    const days = cellDays.get(c) || [];
    let n = 0;
    for (const dd of days) if (Math.abs(dd - d) <= WIN && ++n >= ROUTINE_DAYS) return true;
    return false;
  };
  const out = [];
  for (const [d, photos] of byDay) {
    const cnt = {};
    photos.forEach((x) => { const c = cellOf(x.gps); cnt[c] = (cnt[c] || 0) + 1; });
    const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    if (routine(main, d)) continue;                       // 늘 가던 곳 → 일상
    out.push(...photos.filter((x) => !routine(cellOf(x.gps), d)));
  }
  return chain(out);
}

function scoreRule(label, trips) {
  const found = new Set(); let mixed = 0, polluted = 0;
  trips.forEach((tr) => {
    const tids = new Set(tr.items.filter((x) => x.gps).map((x) => truth.get(x.id)));
    if (tids.size > 1) mixed++;
    if (tids.has("")) polluted++;
    tids.forEach((v) => v && found.add(v));
  });
  const big = trips.reduce((m, t) => Math.max(m, t.items.length), 0);
  const lng = trips.reduce((m, t) => Math.max(m, (t.end - t.start) / DAY), 0);
  const allTrue = truthTrip + shortTrips.length + nearTrips.length;
  console.log(`  ${label}`);
  console.log(`     검출 ${String(trips.length).padStart(4)}건 / 진짜 ${allTrue}건 · 찾아낸 것 ${found.size}건`
    + ` · 병합 ${mixed} · 일상혼입 ${polluted}`);
  console.log(`     먼여행 ${truthTrip - [...found].filter(x=>x[0]==="T").length}건 유실`
    + ` · 2장짜리 ${shortTrips.filter((x) => !found.has(x)).length}/${shortTrips.length} 유실`
    + ` · 근거리나들이 ${nearTrips.filter((x) => !found.has(x)).length}/${nearTrips.length} 유실`);
  console.log(`     가장 큰 덩어리 ${big}장 · ${lng.toFixed(0)}일`);
}

/* C2 — C의 실패를 고친다.
     C는 "창 안에서 4일 이상 방문"을 일상으로 봤다. 그러면 같은 여행지를 90일 안에
     두 번 가면(4일+4일) 일상이 되어 여행이 통째로 사라진다 — 실측에서 2건이 그렇게 날아갔다.
     일상은 '여러 번 나눠서' 가는 것이지 '한 번에 오래' 있는 게 아니다.
     → 날 수가 아니라 **끊어진 방문 횟수**를 센다. 4일 연속 체류는 1회다. */
const ROUTINE_RUNS = 3;
function ruleC2(album) {
  const gps = album.filter((x) => x.gps);
  const cellDays = new Map(), byDay = new Map();
  for (const x of gps) {
    const c = cellOf(x.gps), d = dayOf(x.ts);
    if (!cellDays.has(c)) cellDays.set(c, new Set());
    cellDays.get(c).add(d);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(x);
  }
  // 격자마다 '끊어진 방문' 구간의 시작일 목록
  const runs = new Map();
  for (const [c, set] of cellDays) {
    const ds = [...set].sort((a, b) => a - b), r = [];
    for (let i = 0; i < ds.length; i++) if (i === 0 || ds[i] - ds[i - 1] > 2) r.push(ds[i]);
    runs.set(c, r);
  }
  const routine = (c, d) => {
    let n = 0;
    for (const s0 of runs.get(c) || []) if (Math.abs(s0 - d) <= WIN && ++n >= ROUTINE_RUNS) return true;
    return false;
  };
  const out = [];
  for (const [d, photos] of byDay) {
    const cnt = {};
    photos.forEach((x) => { const c = cellOf(x.gps); cnt[c] = (cnt[c] || 0) + 1; });
    const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    if (routine(main, d)) continue;
    out.push(...photos.filter((x) => !routine(cellOf(x.gps), d)));
  }
  return chain(out);
}

console.log("\n════ 여행/일상 판정 규칙 비교 (같은 앨범 6천 장) ════");
scoreRule("A 현재 — 거주지 30km 밖만 여행", A.clusterTrips(album));
scoreRule("B 규칙 없음 — 시간 간격만",       ruleB(album));
scoreRule("C 늘 가던 곳이냐 (방문 '날' 수)", ruleC(album));
scoreRule("C2 늘 가던 곳이냐 (끊어진 '방문' 횟수)", ruleC2(album));
