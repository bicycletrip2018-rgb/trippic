/**
 * 네이티브 애플 로그인 (§13.45)
 *
 * ★ **왜 옮겼나**: 웹 OAuth 는 애플 client secret 이 **6개월이면 만료**된다.
 *   갱신을 잊으면 어느 날 모든 애플 로그인이 조용히 죽는다(§13.44) — 코드로 막을 수
 *   없는 종류의 고장이다. 네이티브 `id_token` 흐름에는 **그 갱신이 자체가 없다.**
 *   화면이 매끄러운 것(Face ID · 브라우저로 안 나감)은 덤이다.
 *
 * ★ **대신 계정을 얹지 못한다.** `id_token` 은 그 애플 계정으로 **들어가는** 문이라
 *   지금 임시 계정과는 다른 계정이 된다. 그래서 여기 §13.39 의 경고와 §13.40 의
 *   합치기가 그대로 붙는다 — 이 기기의 기록을 말없이 두고 가면 안 된다.
 *
 * ★ **표는 들어가기 전에 끊는다.** 로그인하는 순간 임시 계정의 토큰이 사라진다.
 */
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as API from "./api";

export const isAvailable = () => AppleAuthentication.isAvailableAsync();

export type AskSwitch = (what: {
  pins: number; photos: number; spaces: number;
}) => Promise<"merge" | "leave" | "cancel">;

/**
 * 애플로 들어간다.
 * @param ask 이 기기 임시 계정에 기록이 있을 때 무엇을 할지 묻는다. 비어 있으면 안 부른다.
 */
export type AppleResult = {
  ok: boolean; why?: string; cancelled?: boolean;
  user?: string | null; moved?: { pins: number; trips: number } | { failed: string } | null;
};

export async function signInWithApple(ask: AskSwitch): Promise<AppleResult> {
  if (!(await isAvailable())) return { ok: false, why: "이 기기에서는 애플 로그인을 쓸 수 없습니다" };

  /* ★ 먼저 **두고 갈 것**을 확인한다. 비어 있으면 묻지 않는다 —
     다른 기기에서 처음 여는 흔한 경우가 그것이고, 거기서 겁을 주면
     아무 이유 없이 멈춰 세우는 것이 된다(§13.39). */
  let ticket: string | null = null;
  const a = await API.accountSummary();
  if (a && !a.empty) {
    const pick = await ask({ pins: a.pins, photos: a.photos, spaces: a.spaces });
    if (pick === "cancel") return { ok: false, cancelled: true };
    if (pick === "merge") {
      const t = await API.mergePrepare();     // ★ 지금 끊어야 한다
      if (!t.ok) return { ok: false, why: t.why ?? "옮길 준비를 하지 못했습니다" };
      ticket = t.token;
    }
  }

  /* ★ nonce 를 붙인다. 애플이 서명한 토큰이 **이 요청의 것인지** 서버가 확인할 수
     있어야 한다 — 없으면 가로챈 토큰을 그대로 되쓸 수 있다.
     애플에는 **해시**를 주고 서버에는 원문을 준다. */
  const raw = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);

  let cred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    cred = await AppleAuthentication.signInAsync({
      // ★ 이름·메일을 달라고 하지만 **애플이 가릴 수 있다**(Hide My Email).
      //   그래도 우리는 그 값에 기대지 않는다 — 계정은 애플의 sub 로 식별된다.
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (e: any) {
    // 사용자가 그냥 닫은 것은 **오류가 아니다**
    if (e?.code === "ERR_REQUEST_CANCELED") return { ok: false, cancelled: true };
    return { ok: false, why: String(e?.message ?? e) };
  }

  if (!cred.identityToken) return { ok: false, why: "애플이 토큰을 주지 않았습니다" };

  const r = await API.signInWithAppleIdToken(cred.identityToken, raw);
  if (!r.ok) return r;

  /* 합치기는 **로그인한 뒤**다. 여기서 실패해도 로그인은 이미 됐으므로
     되돌릴 수 없다 — 그러니 실패를 조용히 넘기지 않고 그대로 돌려준다(§13.40). */
  let moved: any = null;
  if (ticket) {
    const m = await API.mergeClaim(ticket);
    moved = m.ok ? m.moved : { failed: m.why };
  }
  return { ok: true, user: r.user, moved };
}
