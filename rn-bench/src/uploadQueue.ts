/**
 * 나머지 사진 올리기 (§13.30) — 등록이 끝난 **뒤에** 천천히 올린다
 *
 * ★ 왜 나누는가: 첫 등록에 수십 장을 다 올리면 사용자는 진행 막대를 보며 기다리다
 *   앱을 닫는다. 대표 1장만 먼저 올려 **'완료'를 빨리 보여 주고**, 나머지는 뒤에서 민다.
 *
 * ★ 큐를 파일에 적는다. 메모리에만 두면 앱이 꺼지는 순간 사라지고, 사용자는
 *   "올렸다"고 들었는데 사진이 없는 상태가 된다 — **말한 것과 남은 것이 달라진다.**
 *   한 장 끝날 때마다 적는다. 느리지만, 이 큐에서 빠른 것은 가치가 없다.
 *
 * ★ **uri 를 저장하지 않는다.** MediaLibrary 의 localUri 는 Photos 컨테이너 안의
 *   임시 경로라 나중에 무효가 될 수 있다. 자산 id 만 적어 두고 올릴 때 다시 푼다.
 *
 * ★ 한 장씩 올린다. 폰의 업링크는 하나라 동시에 밀어도 각자가 느려질 뿐이고,
 *   실패했을 때 무엇이 실패했는지가 흐려진다.
 *
 * ★ **앱이 열려 있는 동안만** 돈다. 진짜 백그라운드 업로드(앱을 닫아도)는
 *   BGTaskScheduler + URLSession background 가 필요하고 expo-file-system 이
 *   그걸 안 열어 준다 — 네이티브를 더 붙여야 한다. 지금은 그 값을 치르지 않고,
 *   대신 **다음에 앱을 열면 이어서 올린다.** 무엇이 남았는지는 화면이 말한다.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as ML from "expo-media-library/legacy";
import * as API from "./api";

export type Job = {
  pinId: string;
  photoId: string;        // MediaLibrary 자산 id — uri 가 아니다
  takenAt: number;
  sortOrder: number;
  w?: number; h?: number;
  tries: number;
  lastError?: string;
};

const FILE = FileSystem.documentDirectory + "trippic-upload-queue.json";
const MAX_TRIES = 5;      // 넘으면 멈추고 남겨 둔다 — 조용히 버리지 않는다

type State = { jobs: Job[]; running: boolean; done: number; failed: number };
const S: State = { jobs: [], running: false, done: 0, failed: 0 };

const subs = new Set<(s: Readonly<State>) => void>();
export function subscribe(fn: (s: Readonly<State>) => void) {
  subs.add(fn); fn(snapshot());
  return () => { subs.delete(fn); };
}
const snapshot = () => ({ ...S, jobs: S.jobs.slice() });
const emit = () => subs.forEach((f) => f(snapshot()));

/** 남은 장수 / 이번 세션에 올린 장수 / 포기한 장수 */
export const status = () => ({
  left: S.jobs.filter((j) => j.tries < MAX_TRIES).length,
  stuck: S.jobs.filter((j) => j.tries >= MAX_TRIES).length,
  done: S.done, running: S.running,
});

async function save() {
  try { await FileSystem.writeAsStringAsync(FILE, JSON.stringify(S.jobs)); } catch {}
}
export async function load() {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return;
    S.jobs = JSON.parse(await FileSystem.readAsStringAsync(FILE));
  } catch { S.jobs = []; }
  emit();
}

export async function enqueue(jobs: Omit<Job, "tries">[]) {
  if (!jobs.length) return;
  // 같은 사진이 같은 핀에 두 번 들어가지 않게 (등록을 두 번 눌렀을 때)
  const key = (j: { pinId: string; photoId: string }) => j.pinId + "|" + j.photoId;
  const have = new Set(S.jobs.map(key));
  for (const j of jobs) if (!have.has(key(j))) S.jobs.push({ ...j, tries: 0 });
  await save(); emit();
}

/** 한 장 올린다. 성공하면 큐에서 지운다 — 지우기 전에 붙이기까지 끝낸다. */
async function runOne(job: Job): Promise<boolean> {
  let uri: string | undefined;
  try {
    const info = await ML.getAssetInfoAsync(job.photoId, { shouldDownloadFromNetwork: false });
    uri = info?.localUri || info?.uri;
  } catch {}
  if (!uri) {
    /* 사진이 지워졌거나 iCloud 에만 있다. 다시 시도해도 같을 가능성이 높지만
       iCloud 는 나중에 내려올 수 있으므로 시도 횟수만 올린다. */
    job.tries++; job.lastError = "기기에서 사진을 찾지 못했습니다";
    return false;
  }
  const up = await API.uploadPhoto(uri, { w: job.w, h: job.h });
  if (!up.ok) { job.tries++; job.lastError = up.why; return false; }
  const m = await API.attachMedia(job.pinId, up, {
    is_main: false, sort_order: job.sortOrder,
    taken_at: new Date(job.takenAt).toISOString(),
  });
  if (!m.ok) { job.tries++; job.lastError = m.error; return false; }
  return true;
}

/** 큐를 민다. 두 번 불러도 하나만 돈다. */
export async function start() {
  if (S.running) return;
  if (!API.isOn() || !API.SESSION.access_token) return;
  S.running = true; emit();
  try {
    for (;;) {
      const job = S.jobs.find((j) => j.tries < MAX_TRIES);
      if (!job) break;
      const ok = await runOne(job);
      if (ok) {
        S.jobs = S.jobs.filter((j) => j !== job);
        S.done++;
      } else if (job.tries < MAX_TRIES) {
        /* 물러섰다 다시 — 끊긴 망에 계속 두드리면 배터리만 쓴다.
           2·4·8·16초. 그 사이 화면은 계속 돈다(이 함수만 쉰다). */
        await new Promise((r) => setTimeout(r, 2000 * 2 ** (job.tries - 1)));
      } else {
        S.failed++;
      }
      await save(); emit();
    }
  } finally { S.running = false; emit(); }
}

/** 포기한 것을 다시 시도한다 (사용자가 눌렀을 때) */
export async function retryStuck() {
  S.jobs.forEach((j) => { if (j.tries >= MAX_TRIES) { j.tries = 0; j.lastError = undefined; } });
  await save(); emit();
  void start();
}

/** 사용자가 "그만 올리기"를 골랐을 때 — 지우는 것도 말한 대로 한다 */
export async function clear() {
  S.jobs = []; await save(); emit();
}
