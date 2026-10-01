/**
 * 이미 등록한 여행을 기억한다 (§13.79)
 *
 * ★ `cluster.ts` 가 여행 id 를 **시작 시각**으로 지은 이유가 여기 있다:
 *     *"순번이 아니라 시작 시각. 판정을 고쳐 다시 묶으면 순번은 밀리고,
 *       **이미 등록한 여행이 목록에 되살아난다.**"*
 *   그 안정된 id 를 **아무도 쓰지 않고 있었다.** 바탕만 깔려 있던 셈이다.
 *
 * ★ 왜 서버가 아니라 기기인가. 등록 여부는 *"이 기기의 앨범에 있는 이 여행"* 에
 *   대한 사실이다. 서버는 핀을 알지 뿐 **어느 앨범 묶음에서 왔는지 모른다** —
 *   물어볼 방법이 없다. 그리고 앨범은 기기마다 다르다.
 *
 * ★ 지우는 길도 둔다. 판정이 바뀌어 여행이 다시 묶이면 옛 id 가 남는데,
 *   그건 **틀린 기억**이 아니라 **없는 여행에 대한 기억**이라 해롭지 않다.
 *   그래도 무한히 쌓이지는 않게 상한을 둔다.
 */
import * as FileSystem from "expo-file-system/legacy";

const FILE = FileSystem.documentDirectory + "trippic-registered.json";
const MAX = 500;                       // 앨범 하나에서 나올 수 있는 여행 수를 한참 넘는다

let ids: string[] | null = null;       // 메모리 캐시. 화면이 자주 묻는다

async function read(): Promise<string[]> {
  if (ids) return ids;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    ids = info.exists ? JSON.parse(await FileSystem.readAsStringAsync(FILE)) : [];
  } catch { ids = []; }
  return ids!;
}

async function write(next: string[]) {
  ids = next.slice(-MAX);
  try { await FileSystem.writeAsStringAsync(FILE, JSON.stringify(ids)); } catch {}
}

/** 등록한 여행으로 표시한다. 같은 것을 두 번 넣지 않는다. */
export async function markRegistered(tripId: string) {
  const cur = await read();
  if (cur.includes(tripId)) return;
  await write([...cur, tripId]);
}

export async function registeredIds(): Promise<Set<string>> {
  return new Set(await read());
}

/** 검사·초기화용 — 앨범을 비우거나 계정을 바꿀 때. */
export async function clearRegistered() { await write([]); }
