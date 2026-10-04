/**
 * 약관 동의를 **기억한다** (§13.136)
 *
 * ★ App Store 가이드라인 1.2 는 사용자 콘텐츠 앱에 *"이용약관(EULA)에 동의받을
 *   것, 그 약관에 **불쾌한 콘텐츠·괴롭힘 무관용**이 명시될 것"* 을 요구한다.
 *   `website/terms.html` 이 그 문서이고, 여기는 **동의를 받은 사실**을 다룬다.
 *
 * ★ **판을 같이 적는다.** `true/false` 만 저장하면 약관을 고쳤을 때 다시 물을
 *   방법이 없다 — 고친 약관에 아무도 동의한 적이 없는 상태가 조용히 생긴다.
 *   판을 올리면 그 다음 실행에 한 번 더 묻는다.
 *
 * ★ **기기에 적는다.** 서버에 적으면 "누가 언제 동의했는지"를 갖게 되는데,
 *   그건 개인정보를 하나 더 모으는 일이다. 요구되는 것은 *"동의를 받을 것"*
 *   이지 *"동의 기록을 보관할 것"* 이 아니다. 안 모을 수 있으면 안 모은다.
 *
 * ★ 읽기가 실패하면 **안 본 것으로 친다.** 못 읽었는데 넘어가면 동의 없이 쓴다.
 */
import * as FileSystem from "expo-file-system/legacy";

/** 약관을 **내용까지 고쳤으면** 올린다. 올리면 모두에게 한 번 더 묻는다. */
export const TERMS_VERSION = 1;

const FILE = FileSystem.documentDirectory + "trippic-terms.json";

export async function agreedVersion(): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return 0;
    const j = JSON.parse(await FileSystem.readAsStringAsync(FILE));
    return typeof j?.v === "number" ? j.v : 0;
  } catch { return 0; }          // 못 읽으면 **안 본 것으로** — 넘어가면 동의 없이 쓴다
}

export const needsAgreement = async () => (await agreedVersion()) < TERMS_VERSION;

export async function setAgreed(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      FILE, JSON.stringify({ v: TERMS_VERSION, at: new Date().toISOString() }));
  } catch {}
}
