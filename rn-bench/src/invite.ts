/**
 * 초대 보내기 (§13.43 · §13.113 · §13.114)
 *
 * ★ **카카오 SDK 도 카카오 로그인도 쓰지 않는다.** 링크는 그냥 URL 이고, OS 공유
 *   시트에 카카오톡이 이미 들어 있다. 로그인을 붙이면 App Store 지침 4.8 이 걸려
 *   "동등한 다른 로그인"을 같이 내놔야 한다 — 공유 하나 하자고 치를 값이 아니다.
 *
 * ★ §13.114 에서 **스페이스 탭이 없어지면서** 여기로 옮겼다. 초대는 그 탭의 것이
 *   아니라 **스페이스의 것**이고, 이제 지도의 방 고르는 창이 부른다.
 */
import { Share } from "react-native";
import * as API from "./api";
import { INVITE_BASE } from "./config";
import { inviteWhy } from "./inviteBase";

export async function shareInvite(spaceId: string) {
  /* ★ **보내기 전에 막는다**(§13.113). 죽은 링크를 보내면 받는 사람이 우리 앱을
     한 번 믿었다가 실망하고, 보낸 사람은 그 사실조차 모른다. */
  const why = inviteWhy(INVITE_BASE);
  if (why) return { ok: false, why };

  const r = await API.inviteLink(spaceId, INVITE_BASE);
  if (!r.ok) return { ok: false, why: r.why };
  try {
    await Share.share({ message: `${r.title} — 같이 채운 지도를 보내 드립니다.\n${r.url}`,
                        url: r.url });
    return { ok: true };            // 어디로 보냈는지는 우리가 알 필요 없다
  } catch (e: any) {
    return { ok: false, why: String(e?.message ?? e) };
  }
}
