/**
 * 앱에서 난 오류를 서버로 (§13.120 · 066)
 *
 * ★ MVP 테스트에서 **가장 잃기 쉬운 것**은 네이티브 크래시가 아니다. 크래시는 앱이
 *   꺼지니 테스터가 말해 준다. 못 건지는 것은 **조용한 실패**다 — 빈 화면, 안 끝나는
 *   동그라미. 테스터는 *"좀 이상해요"* 라고만 말하고 우리는 **재현도 못 한다.**
 *
 * ★ **네이티브 크래시는 못 받는다.** 이건 자바스크립트 쪽만 본다. 솔직히 적어 둔다 —
 *   빌드 파이프라인이 생기면 Sentry 로 올린다.
 *
 * ★ **같은 오류를 한 번만 보낸다.** 오류는 고리에 빠지기 쉽다(터진 화면이 다시
 *   그려지며 또 터진다). 서버도 1분 20줄로 막지만, **앱에서 안 보내는 것이 먼저**다 —
 *   보내 놓고 서버가 버리면 망만 쓴다.
 *
 * ★ **오류를 보내다 난 오류는 안 보낸다.** 그게 진짜 고리다.
 */
import { Platform } from "react-native";
import * as API from "./api";

const VERSION = require("../app.json").expo.version as string;

/** 이번 실행에서 이미 보낸 요약 — 같은 것을 또 안 보낸다 */
const sent = new Set<string>();
let busy = false;

export async function logError(
  kind: "js" | "api" | "boot", message: string, detail?: string,
) {
  const msg = String(message ?? "").slice(0, 300) || "(빈 메시지)";
  if (sent.has(msg) || busy) return;
  sent.add(msg);
  busy = true;
  try {
    await API.rpc("api_log_client_error", {
      p_kind: kind, p_message: msg,
      p_detail: detail ? String(detail).slice(0, 4000) : null,
      p_version: VERSION, p_platform: Platform.OS,
    });
  } catch {
    /* ★ 여기서는 **아무것도 안 한다.** 오류를 보내다 난 오류를 또 보내면 고리다. */
  } finally { busy = false; }
}

/**
 * 안 잡힌 예외를 받는다.
 * ★ **원래 처리기를 지우지 않는다.** 지우면 개발 중 빨간 화면이 안 뜨고,
 *   배포판에서는 앱이 꺼지는 것 자체가 안 일어나 **더 이상해진다.**
 *   우리 것은 **덧붙이는 것**이다.
 */
export function installErrorLog() {
  /* 서버 호출이 끝내 실패한 것도 받는다. ★ 401 뒤 갱신해서 성공한 것은 안 온다 —
     `req()` 가 끝내 실패했을 때만 부른다(§13.106). */
  API.setFailHook((msg) => { void logError("api", msg); });

  const EU = (globalThis as any).ErrorUtils;
  if (!EU?.getGlobalHandler) return;
  const prev = EU.getGlobalHandler();
  EU.setGlobalHandler((e: any, isFatal?: boolean) => {
    void logError("js", `${isFatal ? "[치명] " : ""}${e?.message ?? e}`, e?.stack);
    prev?.(e, isFatal);
  });
}
