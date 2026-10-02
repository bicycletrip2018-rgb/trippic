/**
 * 남은 일 — **배지와 알림이 같은 것을 센다** (§12.27 · §13.93)
 *
 * ★ §12.27 이 `정리함` 탭을 접으면서 *"그래도 하나 건졌다"* 며 적어 둔 것이 배지다.
 *   웹에서는 배지가 **발견된 여행 수**를 달고 있어서, 전부 등록해도 숫자가 안 줄었다.
 *   배지를 누르면 나오는 화면 제목은 `아직 지도에 없는 여행 N개` 인데 **두 숫자가 달랐다.**
 *   → 그 교훈이 이 파일의 존재 이유다: **세는 곳을 하나로 만든다.**
 *     `pendingOf()` 가 유일한 셈이고, 배지도 알림도 여기서 나온 값을 쓴다.
 *     두 곳에서 세기 시작하면 언젠가 둘이 갈라지고, 갈라지면 **둘 다 못 믿게 된다**(§13.80).
 *
 * ★ RN 에는 배지가 **아예 없었다.** §12.27 은 웹 배지를 고쳤고 §13.83 이 또 고쳤는데,
 *   RN 쪽은 한 번도 붙은 적이 없다 — 그래서 앱이 찾아 놓은 일을 알 길이
 *   *"`+` 를 눌러 `앨범 정리`로 들어가 본다"* 와 주 1회 알림뿐이었다.
 *
 * ★ **기기에 둔다**(`registered.ts` 와 같은 이유). 앨범은 기기마다 다르고,
 *   서버는 어느 앨범 묶음에서 왔는지 모른다.
 *
 * ★ **이 값은 마지막으로 잰 것이다.** 그 뒤에 찍은 사진은 안 들어 있다 —
 *   세려면 앨범을 다시 읽어야 하고(EXIF 1,200장), 그건 앱을 켤 때 할 일이 아니다.
 *   대신 *"그 뒤에 새 사진이 있는가"* 만 싸게 묻고(`newPhotosSince`), 있으면 화면이
 *   **모른다고 표시한다**(`3+`). 모르는 것을 아는 척하지 않는다.
 */
import * as FileSystem from "expo-file-system/legacy";

const FILE = FileSystem.documentDirectory + "trippic-pending.json";

/* 셈은 `pendingCount.ts` 로 갈라 냈다 — 순수 함수라야 노드에서 잴 수 있다.
   쓰는 쪽이 두 파일을 알 필요는 없으므로 여기서 **그대로 다시 내보낸다.** */
export { pendingOf, EMPTY, type Pending } from "./pendingCount";
import { EMPTY, type Pending } from "./pendingCount";

let cache: Pending | null = null;

export async function readPending(): Promise<Pending> {
  if (cache) return cache;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    cache = info.exists
      ? { ...EMPTY, ...JSON.parse(await FileSystem.readAsStringAsync(FILE)) }
      : EMPTY;
  } catch { cache = EMPTY; }
  return cache!;
}

export async function writePending(p: Pending) {
  cache = p;
  try { await FileSystem.writeAsStringAsync(FILE, JSON.stringify(p)); } catch {}
}

/** 검사·초기화용 */
export async function clearPending() { await writePending(EMPTY); }
