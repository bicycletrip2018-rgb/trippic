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

/**
 * 정리하는 데 걸리는 시간.
 *
 * ★ **측정값이 아니다.** 사람이 정거장 하나를 정리하는 시간은 사람을 봐야 알 수 있고,
 *   아직 사용자가 없다. 그래서 숫자를 **지어내지 않고 근거를 적는다** —
 *   자동 매칭(§13.70)이 장소를 미리 채우므로 대부분은 확인하고 넘기는 동작이고,
 *   그걸 정거장당 15초로 잡았다. 실제 사용 로그가 쌓이면 **등록 화면에 머문 시간**으로
 *   바꿔야 한다(그때까지 이 상수가 유일한 근거다).
 * ★ 1분 미만도 **1분이라고 적는다.** *"20초면 끝납니다"* 는 과장으로 읽혀
 *   오히려 못 미덥다.
 */
export const SEC_PER_STOP = 15;
export const minutesFor = (stops: number) =>
  Math.max(1, Math.round((stops * SEC_PER_STOP) / 60));
