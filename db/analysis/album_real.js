/* =====================================================================
   실제 앨범으로 파라미터를 검증한다.

   ★ 실제 앨범에는 **정답표가 없다.** "이 여행이 맞다"를 아는 건 사용자뿐이다.
     그래서 자동으로 잴 수 있는 두 가지만 잰다:

     ① 안정성 — 파라미터를 흔들었을 때 결과가 얼마나 변하는가.
        평지 위에 있으면 그 값은 안전하고, 벼랑 끝이면 위험하다.
        합성 앨범에서 고른 값이 실제 앨범에서도 평지인지가 핵심이다.
     ② 병리 징후 — 정답을 몰라도 **틀린 건 알 수 있다.**
          · 14일 넘는 '여행'        → 일상이 여행으로 새어 들어왔다
          · 앨범의 30%가 한 여행    → 같은 증상
          · 여행 사진 비율 70% 초과 → 일상 필터가 사실상 꺼져 있다
          · 같은 주에 2장짜리 여행 여러 개 → 과분할

   나머지(이게 진짜 내 여행인가)는 목록을 뽑아 사람이 본다.

   입력: ts(초)\tlat\tlng  — album_export.applescript의 출력
   실행: node db/analysis/album_real.js data/out/album_real.tsv
   ===================================================================== */
const fs = require("fs"), path = require("path"), vm = require("vm"), cp = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const TSV = process.argv[2] || path.join(ROOT, "data/out/album_real.tsv");

const poi = JSON.parse(fs.readFileSync(path.join(ROOT, "prototype/korea-poi.json"), "utf8"));
const noop = () => {};
const fake = new Proxy({}, { get: (t, k) => (k === "firstElementChild" ? fake : noop), set: () => true });
const sb = { window: {}, poi, console,
  document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => fake,
              body: fake, addEventListener: noop } };
sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, "prototype/upload.js"), "utf8"), sb, { filename: "upload.js" });
const A = sb.window.__albumInternals, TUNE = A.TUNE;
sb.window.UP.dayRule = {};                       // 사용자 수정 없이 순수 추정만 본다

/* ── 입력 ─────────────────────────────────────────────────── */
if (!fs.existsSync(TSV)) { console.error("앨범 파일이 없다:", TSV); process.exit(1); }
const album = [];
for (const line of fs.readFileSync(TSV, "utf8").split("\n")) {
  const [t, la, lo] = line.trim().split(/\s+/);
  const ts = +t * 1000, lat = +la, lng = +lo;
  if (!ts || !isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) continue;
  album.push({ id: album.length, ts, gps: { lat, lng }, acc: 15, poi: null,
               w: 1280, h: 960, focus: 1500, contrast: 45, faceRatio: 0.05 });
}
if (album.length < 50) { console.error("사진이 너무 적다:", album.length); process.exit(1); }
const span = (Math.max(...album.map((x) => x.ts)) - Math.min(...album.map((x) => x.ts))) / 864e5;
const days = new Set(album.map((x) => Math.floor(x.ts / 864e5))).size;
console.log(`실제 앨범 ${album.length}장 · ${(span / 365).toFixed(1)}년 · 촬영한 날 ${days}일`);
console.log(`  ${new Date(Math.min(...album.map((x) => x.ts))).toISOString().slice(0, 10)}`
  + ` ~ ${new Date(Math.max(...album.map((x) => x.ts))).toISOString().slice(0, 10)}`);

/* ── 측정 ─────────────────────────────────────────────────── */
const DAY = 864e5;
function measure() {
  const trips = A.clusterTrips(album);
  const inTrip = trips.reduce((n, t) => n + t.items.length, 0);
  const lens = trips.map((t) => (t.end - t.start) / DAY + 1).sort((a, b) => b - a);
  const sizes = trips.map((t) => t.items.length).sort((a, b) => b - a);
  // 과분할: 같은 주에 2~3장짜리 여행이 여러 개
  const wk = {};
  trips.filter((t) => t.items.length <= 3).forEach((t) => {
    const w = Math.floor(t.start / (7 * DAY)); wk[w] = (wk[w] || 0) + 1;
  });
  return {
    trips: trips.length,
    pct: (100 * inTrip) / album.length,
    maxLen: lens[0] || 0,
    maxPct: (100 * (sizes[0] || 0)) / album.length,
    over14: lens.filter((l) => l > 14).length,
    fragWeeks: Object.values(wk).filter((v) => v >= 3).length,
    list: trips,
  };
}

const base = measure();
console.log(`\n── 현재 설정 ${JSON.stringify(TUNE)}`);
console.log(`  여행 ${base.trips}건 · 앨범의 ${base.pct.toFixed(1)}%가 여행 사진`);
console.log(`  가장 긴 여행 ${base.maxLen.toFixed(0)}일 · 가장 큰 여행이 앨범의 ${base.maxPct.toFixed(1)}%`);

console.log(`\n── 병리 징후 (정답을 몰라도 틀린 건 알 수 있다)`);
const flags = [
  ["14일 넘는 여행", base.over14, base.over14 === 0, "일상이 여행으로 새어 들어왔다"],
  ["한 여행이 앨범의 30% 초과", base.maxPct > 30 ? 1 : 0, base.maxPct <= 30, "같은 증상"],
  ["여행 사진 비율 70% 초과", base.pct > 70 ? 1 : 0, base.pct <= 70, "일상 필터가 사실상 꺼져 있다"],
  ["작은 여행이 몰린 주", base.fragWeeks, base.fragWeeks <= 2, "과분할 — 한 여행이 쪼개졌을 수 있다"],
];
flags.forEach(([k, v, ok, why]) => console.log(`  ${ok ? "OK  " : "경고"} ${k}: ${v}${ok ? "" : "  ← " + why}`));

/* ── 파라미터 스윕 ────────────────────────────────────────── */
console.log(`\n── 파라미터를 흔들어 본다 (현재값 ★)`);
function sweep(key, vals, fmt = (v) => v) {
  const orig = TUNE[key];
  const rows = vals.map((v) => {
    TUNE[key] = v;
    const m = measure();
    return { v, m };
  });
  TUNE[key] = orig;
  console.log(`\n  ${key}`);
  console.log(`  ${"값".padEnd(10)}${"여행수".padStart(7)}${"여행사진%".padStart(11)}${"최장(일)".padStart(10)}${"최대여행%".padStart(11)}`);
  rows.forEach(({ v, m }) => {
    const mark = v === orig ? " ★" : "  ";
    console.log(`  ${(fmt(v) + mark).padEnd(10)}${String(m.trips).padStart(7)}`
      + `${m.pct.toFixed(1).padStart(11)}${m.maxLen.toFixed(0).padStart(10)}${m.maxPct.toFixed(1).padStart(11)}`);
  });
}
sweep("CELL_DEG", [0.005, 0.01, 0.02, 0.04, 0.08], (v) => `${v}(≈${Math.round(v * 111)}km)`);
sweep("ROUTINE_WIN", [30, 60, 90, 180, 365]);
sweep("ROUTINE_RUNS", [2, 3, 4, 6, 8]);
sweep("TRIP_GAP", [1 * DAY, 2 * DAY, 3 * DAY, 5 * DAY], (v) => `${v / DAY}일`);

/* ── 사람이 볼 목록 ───────────────────────────────────────── */
const PSQL = ["psql", "-X", "-q", "-h", "/tmp", "-p", "55432", "-d", "trippic_data", "-At", "-F", "\t"];
function regionsFor(trips) {
  const vals = trips.map((t, i) => {
    const c = t.items.filter((x) => x.gps)
      .reduce((a, x) => ({ lat: a.lat + x.gps.lat / t.items.length, lng: a.lng + x.gps.lng / t.items.length }),
              { lat: 0, lng: 0 });
    return `(${i},${c.lng},${c.lat})`;
  }).join(",");
  const q = `with c(i,lng,lat) as (values ${vals})
    select c.i, coalesce((select array_to_string((string_to_array(p.address,' '))[1:2],' ')
      from public.places p order by p.geom <-> point(c.lng,c.lat) limit 1), '?') from c order by c.i;`;
  try {
    const out = cp.execFileSync(PSQL[0], [...PSQL.slice(1), "-c", q],
      { env: { ...process.env, PATH: "/opt/homebrew/opt/postgresql@16/bin:" + process.env.PATH },
        encoding: "utf8", timeout: 60000 });
    const m = {};
    out.trim().split("\n").forEach((l) => { const [i, r] = l.split("\t"); m[+i] = r; });
    return m;
  } catch (e) { return {}; }
}
const fmtD = (t) => new Date(t).toISOString().slice(0, 10);
const reg = regionsFor(base.list);
console.log(`\n── 검출된 여행 ${base.list.length}건 — 이게 실제 여행이 맞는지는 사람만 안다`);
base.list.slice(0, 40).forEach((t, i) => {
  console.log(`  ${String(i + 1).padStart(3)}. ${fmtD(t.start)}~${fmtD(t.end).slice(5)}`
    + ` · ${(reg[i] || "?").padEnd(16)} · ${String(t.items.length).padStart(4)}장`
    + ` · ${((t.end - t.start) / DAY + 1).toFixed(0)}일 · 정거장 ${t.stops.length}`);
});
if (base.list.length > 40) console.log(`  … 외 ${base.list.length - 40}건`);
