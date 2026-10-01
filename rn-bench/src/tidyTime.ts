/**
 * 정리에 **실제로 걸린 시간** (§13.80)
 *
 * ★ §13.79 는 *"정거장당 15초"* 라는 **내가 지어낸 상수**로 `N분이면 끝납니다` 를
 *   적었다. 그 자리에 이렇게 써 뒀다:
 *     *"측정값이 아니다 … 실사용 로그가 쌓이면 등록 화면에 머문 시간으로 바꿔야 한다."*
 *   그 측정을 붙인다. 화면에 적는 숫자는 **잰 것이어야 한다** —
 *   사용자가 그 숫자를 보고 지금 할지 말지를 정한다.
 *
 * ★ **포그라운드 시간만 센다.** 정리하다 전화를 받고 10분 뒤 돌아오면 그 10분은
 *   정리한 시간이 아니다. 그걸 빼지 않으면 한 번의 외출이 추정을 통째로 망친다 —
 *   측정을 붙여 놓고 더 나쁜 숫자를 얻는 길이다.
 *
 * ★ **평균이 아니라 중앙값.** 표본이 적어서 한 번의 긴 기록이 평균을 끌고 간다.
 *
 * ★ **빠른 기록도 버리지 않는다.** 바로 등록을 누른 사람의 시간도 진짜 시간이다.
 *   *"너무 빠른 건 제대로 안 본 것"* 이라며 거르면 **내가 기대한 분포를 만드는** 것이지
 *   재는 것이 아니다. 자동 매칭(§13.70)이 장소를 미리 채우므로 실제로 빠를 수 있다.
 *
 * ★ 기기에만 쌓는다. 서버로 보낼 값이 아니다 — 이 숫자는 *"이 사람이 이 앨범을
 *   정리하는 속도"* 이고, 쓰는 곳도 이 기기뿐이다. 사람이 모이면 그때 합치면 된다.
 */
import { AppState, type AppStateStatus } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

const FILE = FileSystem.documentDirectory + "trippic-tidytime.json";
const KEEP = 20;                    // 최근 것만 본다 — 앱이 빨라지면 옛 기록은 틀린 말이 된다

/** 아직 한 번도 안 재 봤을 때만 쓰는 값. **첫 기록이 들어오면 즉시 버려진다.** */
export const SEC_PER_STOP_GUESS = 15;

let samples: number[] | null = null;        // 초/정거장
let loading: Promise<number[]> | null = null;

async function load(): Promise<number[]> {
  if (samples) return samples;
  if (!loading) loading = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(FILE);
      samples = info.exists ? JSON.parse(await FileSystem.readAsStringAsync(FILE)) : [];
    } catch { samples = []; }
    return samples!;
  })();
  return loading;
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const v = [...a].sort((x, y) => x - y), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** 지금까지 잰 **초/정거장**. 잰 적이 없으면 추정값. */
export async function secPerStop(): Promise<number> {
  const s = await load();
  return s.length ? median(s) : SEC_PER_STOP_GUESS;
}

/** 잰 횟수 — 화면이 *"추정"* 인지 *"내 속도"* 인지 가려 말할 수 있게 */
export async function sampleCount(): Promise<number> {
  return (await load()).length;
}

export const minutesFrom = (stops: number, perStop: number) =>
  Math.max(1, Math.round((stops * perStop) / 60));

/* ── 재기 ──────────────────────────────────────────────────────── */
let runAt: number | null = null;   // 지금 포그라운드 구간이 시작된 시각
let acc = 0;                       // 쌓인 포그라운드 시간(ms)
let sub: { remove: () => void } | null = null;

function onApp(st: AppStateStatus) {
  if (st === "active") { if (runAt == null) runAt = Date.now(); return; }
  if (runAt != null) { acc += Date.now() - runAt; runAt = null; }
}

/** 정거장 화면에 들어왔다. */
export function startTidy() {
  stopWatching();
  acc = 0; runAt = Date.now();
  sub = AppState.addEventListener("change", onApp);
}

function stopWatching() {
  sub?.remove(); sub = null;
  if (runAt != null) { acc += Date.now() - runAt; runAt = null; }
}

/** 등록을 눌렀다 — 여기까지가 정리 시간이다. */
export async function finishTidy(stops: number) {
  stopWatching();
  const ms = acc; acc = 0;
  if (stops <= 0 || ms <= 0) return;
  const per = ms / 1000 / stops;
  const s = await load();
  samples = [...s, per].slice(-KEEP);
  try { await FileSystem.writeAsStringAsync(FILE, JSON.stringify(samples)); } catch {}
}

/** 등록하지 않고 나갔다 — **버린다.** 중간에 그만둔 시간은 '정리에 걸린 시간'이 아니다. */
export function cancelTidy() { stopWatching(); acc = 0; }

/** 검사·초기화용 */
export async function clearTidyTime() {
  samples = []; loading = null;
  try { await FileSystem.writeAsStringAsync(FILE, "[]"); } catch {}
}
