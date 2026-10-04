/**
 * 서버 연결 — **환경변수에서 읽는다** (§13.134)
 *
 * ★ 왜 바꿨나 — 이 파일은 `.gitignore` 에 있었고 `App.tsx` 가 이걸 import 한다.
 *   그 말은 **깨끗한 체크아웃에서는 컴파일이 안 된다**는 뜻이다. 내 기계에서만
 *   되는 상태였고, EAS 빌드는 깨끗한 체크아웃에서 돈다 — **첫 빌드가 거기서
 *   멈춘다.** 빌드를 돌려 보기 전에는 아무도 모를 자리였다.
 *
 * ★ `EXPO_PUBLIC_*` 는 Expo 가 **번들에 그대로 박아 넣는다.** 새 의존성이
 *   필요 없다(`expo-constants` 는 직접 의존이 아니라 안 쓴다).
 *   값은 로컬에서는 `.env.local`, 빌드에서는 **EAS 환경변수**로 온다.
 *
 * ★ 셋 다 **공개 값**이다. 앱을 뜯으면 어차피 보인다 — 숨기는 것이 아니라
 *   **기계마다 다른 값을 한 자리에 모으는** 것이 목적이다.
 *   (진짜 비밀은 `service_role` 키인데 그건 앱에 아예 안 들어온다.)
 */
const need = (name: string, v: string | undefined) => {
  /* ★ 조용히 빈 문자열로 넘어가면 *"서버가 안 되네"* 로 몇 시간을 쓴다.
     없으면 **그 자리에서** 어느 이름이 비었는지 말한다. */
  if (!v) throw new Error(
    `${name} 가 비어 있습니다. 로컬이면 rn-bench/.env.local 을, ` +
    `빌드면 EAS 환경변수를 확인하십시오 (.env.example 참고).`);
  return v;
};

export const SUPABASE_URL =
  need("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY =
  need("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

/**
 * 초대받은 사람이 **열 주소**. 앱 딥링크가 아니라 **웹**이어야 한다 —
 * 앱을 안 깐 사람도 열어야 초대가 초대다(§13.43).
 * ★ **https 여야 한다.** 초대 코드가 주소에 실려 간다(`?invite=…`).
 */
export const INVITE_BASE =
  need("EXPO_PUBLIC_INVITE_BASE", process.env.EXPO_PUBLIC_INVITE_BASE);
