/**
 * 소셜 로그인 콜백 (§13.42) — 앱은 **딥링크**로 받는다
 *
 * ★ 웹은 주소의 `#access_token` 을 읽으면 됐다(§13.41). 앱에는 주소창이 없다 —
 *   카카오가 `app.trippic.bench://auth#access_token=…` 으로 앱을 깨운다.
 *
 * ★ **네이티브 의존성을 안 늘렸다.** `expo-web-browser` 의 `openAuthSessionAsync`
 *   가 화면은 더 매끄럽지만 새 네이티브 모듈이고, 그러면 재빌드가 붙는다(§13.28).
 *   그리고 스킴(`app.trippic.bench`)은 **이미 Info.plist 에 등록돼 있다** —
 *   Expo 가 번들 id 를 기본 스킴으로 넣어 둔다. 코어 `Linking` 으로 끝난다.
 *   (대가: 시스템 브라우저로 나갔다 돌아온다. 앱 안 시트보다 거칠다.)
 *
 * ★ **두 경로를 다 받아야 한다.** 앱이 떠 있으면 `url` 이벤트로 오고,
 *   꺼져 있었으면 그 링크가 앱을 **깨우면서** 들어온다(`getInitialURL`).
 *   하나만 받으면 "카카오 눌렀는데 아무 일도 안 일어난다"가 절반의 경우에 생긴다.
 */
import { Linking } from "react-native";
import * as API from "./api";

/** 이미 Info.plist 에 있는 스킴. 새로 만들지 않는다 — 만들면 재빌드다. */
export const SCHEME = "app.trippic.bench";
export const REDIRECT = `${SCHEME}://auth`;

type Done = (r: { ok: boolean; user?: string | null; why?: string }) => void;

let started = false;

/** 앱이 사는 동안 한 번만 건다. 두 번 걸면 콜백이 두 번 돈다. */
export function listenForAuth(onDone: Done) {
  if (started) return () => {};
  started = true;

  const handle = async (url: string | null) => {
    if (!url || !url.startsWith(SCHEME)) return;
    // ★ 토큰이 링크에 실려 있다. 받은 뒤 이 문자열을 들고 다니지 않는다.
    const r = await API.consumeAuthRedirect(url);
    if (r) onDone(r);
  };

  const sub = Linking.addEventListener("url", (e) => void handle(e.url));
  // 앱이 꺼져 있었다면 이 링크가 앱을 깨웠다
  void Linking.getInitialURL().then(handle);

  return () => { sub.remove(); started = false; };
}

/** 카카오로 나간다. 돌아오는 것은 위 리스너가 받는다. */
export async function openKakao(mode: "link" | "signin") {
  const r = mode === "link"
    ? await API.linkKakao(REDIRECT)
    : await API.kakaoSignInUrl(REDIRECT);
  if (!r.ok || !r.url) return { ok: false, why: r.why };
  const can = await Linking.canOpenURL(r.url);
  if (!can) return { ok: false, why: "브라우저를 열 수 없습니다" };
  await Linking.openURL(r.url);
  return { ok: true };
}
