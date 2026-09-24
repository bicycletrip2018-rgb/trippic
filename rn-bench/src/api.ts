/**
 * 서버 다리 — 웹 `prototype/api.js` 이식 (§13.28)
 *
 * ★ **네이티브 의존성을 하나도 안 늘린다.** 늘리면 pod install + 재빌드가 붙고,
 *   그때마다 몇 분이 사라진다. 지금 있는 것(expo-file-system)으로 끝낸다.
 *   그래서 세션 저장에 AsyncStorage 대신 파일을 쓴다.
 *
 * ★ 웹판의 규칙을 그대로 지킨다: 서버가 없어도 화면은 돈다. 모든 호출이
 *   `{ok, data, via}` 를 돌려주고 화면이 출처를 안다.
 */
import * as FileSystem from "expo-file-system/legacy";

export const CFG = {
  url: "",        // app.json extra 또는 아래 setConfig 로 주입
  anonKey: "",
};
export function setConfig(url: string, anonKey: string) {
  CFG.url = url; CFG.anonKey = anonKey;
}
export const isOn = () => !!(CFG.url && CFG.anonKey);

const SES_FILE = FileSystem.documentDirectory + "trippic-session.json";
export const SESSION = {
  access_token: null as string | null,
  refresh_token: null as string | null,
  user_id: null as string | null,
  anonymous: false,
};

export async function loadSession() {
  try {
    const info = await FileSystem.getInfoAsync(SES_FILE);
    if (!info.exists) return;
    Object.assign(SESSION, JSON.parse(await FileSystem.readAsStringAsync(SES_FILE)));
  } catch {}
}
async function saveSession() {
  try { await FileSystem.writeAsStringAsync(SES_FILE, JSON.stringify(SESSION)); } catch {}
}
export async function clearSession() {
  SESSION.access_token = SESSION.refresh_token = SESSION.user_id = null;
  SESSION.anonymous = false;
  try { await FileSystem.deleteAsync(SES_FILE, { idempotent: true }); } catch {}
}

/* ★ 새 키(`sb_publishable_…`)는 JWT 가 아니라 Bearer 로 보내면 파싱에 실패한다.
   로그인했으면 **사용자 토큰**이 Bearer 에 들어간다 — 그게 있어야 auth.uid() 가 찬다. */
function headers(): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json", apikey: CFG.anonKey,
  };
  if (SESSION.access_token) h.Authorization = `Bearer ${SESSION.access_token}`;
  else if (CFG.anonKey.startsWith("eyJ")) h.Authorization = `Bearer ${CFG.anonKey}`;
  return h;
}

export const STATE = { calls: 0, fails: 0, lastError: null as string | null };

type R<T> = { ok: boolean; via: "server" | "local" | "off"; data: T | null; error?: string };

async function req<T>(path: string, init?: RequestInit): Promise<R<T>> {
  if (!isOn()) return { ok: false, via: "off", data: null };
  STATE.calls++;
  try {
    const r = await fetch(`${CFG.url}${path}`,
      { ...init, headers: { ...headers(), ...(init?.headers as any) } });
    if (!r.ok) throw new Error(`${path} ${r.status} ${(await r.text()).slice(0, 120)}`);
    return { ok: true, via: "server", data: (await r.json()) as T };
  } catch (e: any) {
    STATE.fails++; STATE.lastError = String(e?.message ?? e);
    return { ok: false, via: "local", data: null, error: STATE.lastError };
  }
}

export const rpc = <T>(fn: string, args?: any) =>
  req<T>(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args ?? {}) });
export const select = <T>(table: string, query: string) =>
  req<T>(`/rest/v1/${table}?${query}`);
/* ★ `Prefer: return=representation` 이 없으면 PostgREST 는 **본문 없이 201** 을 준다.
   그러면 방금 만든 행의 id 를 못 받고, 사진을 어느 핀에 붙일지 알 수 없다.
   (웹판은 이 헤더를 갖고 있었는데 이식하면서 빠졌다 — 등록 플로우가 여기서 멈춘다) */
export const insert = <T>(table: string, row: any) =>
  req<T>(`/rest/v1/${table}`, {
    method: "POST", body: JSON.stringify(row),
    headers: { Prefer: "return=representation" },
  });

/* ── 익명 로그인 ───────────────────────────────────────────── */
export async function signInAnonymously() {
  if (!isOn()) return { ok: false, why: "키 없음" };
  if (SESSION.access_token) return { ok: true, why: "이미 로그인" };
  const r = await fetch(`${CFG.url}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CFG.anonKey },
    body: "{}",
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, why: j?.error_code === "anonymous_provider_disabled"
      ? "대시보드에서 Anonymous sign-ins 를 켜야 합니다" : (j?.msg ?? `HTTP ${r.status}`) };
  }
  SESSION.access_token = j.access_token;
  SESSION.refresh_token = j.refresh_token;
  SESSION.user_id = j.user?.id ?? null;
  SESSION.anonymous = true;
  await saveSession();
  return { ok: true, user: SESSION.user_id };
}

/* ★ 저장해 둔 세션이 **서버에 없는 계정**을 가리킬 수 있다. JWT 는 서명된 값이라
   만료 전까지는 형식상 멀쩡하지만, 그 계정이 지워졌으면 auth.uid() 가 가리키는
   profiles 행이 없어 쓰기가 전부 23503(FK 위반)으로 튕긴다.
   ★ 화면에는 이게 "올리지 못했습니다 — Key is not present in table profiles" 로 보인다.
     사용자가 할 수 있는 일이 하나도 없는 문구다. 켤 때 한 번 확인하고 조용히 다시 든다.
   (검증 중 reset_test_data.sh 로 계정을 지웠을 때 그대로 터졌다. 계정 삭제는
    실제로도 일어나는 일이라 이 회복 경로는 테스트 편의가 아니다.) */
export async function ensureSession() {
  if (!isOn()) return { ok: false, why: "키 없음" };
  if (SESSION.access_token) {
    try {
      const r = await fetch(`${CFG.url}/auth/v1/user`, { headers: headers() });
      if (r.ok) return { ok: true, why: "세션 유효" };
    } catch {
      // 망이 끊긴 것과 계정이 없는 것은 다르다 — 못 물어봤으면 버리지 않는다
      return { ok: true, why: "확인 못 함 — 그대로 쓴다" };
    }
    await clearSession();
  }
  return signInAnonymously();
}

/* ── 초대 링크 (§13.43) ───────────────────────────────────────────
   ★ **카카오 SDK 도 카카오 로그인도 쓰지 않는다.** 링크는 그냥 URL 이고, OS 공유
     시트에 카카오톡이 이미 들어 있다. 로그인을 붙이면 App Store 지침 4.8 이 걸려
     "동등한 다른 로그인"을 같이 내놔야 한다 — 공유 하나 하자고 치를 값이 아니다.
   ★ `base` 는 **받는 사람이 열 주소**다. 앱 딥링크가 아니라 웹이어야 한다 —
     앱을 안 깐 사람도 열어야 초대가 초대다(§13.38). */
export async function inviteLink(spaceId: string, base: string) {
  const r = await select<any[]>("spaces", `id=eq.${spaceId}&select=id,title,invite_code`);
  const row = r.ok ? r.data?.[0] : null;
  if (!row?.invite_code) return { ok: false, why: "초대 링크를 읽지 못했습니다" };
  return { ok: true, title: row.title as string,
           url: `${base}?invite=${encodeURIComponent(row.invite_code)}` };
}

/* ── 소셜 로그인 (§13.41 · §13.42) ────────────────────────────────
   ★ **켜져 있는 것만 보여 준다.** 꺼져 있는데 버튼을 두면 누른 사람이
     `Unsupported provider` 를 본다 — 우리 설정 문제를 사용자 화면에 떠넘기는 것이다. */
let PROVIDERS: Record<string, boolean> | null = null;
export async function providers() {
  if (PROVIDERS) return PROVIDERS;
  if (!isOn()) return (PROVIDERS = {});
  try {
    const r = await fetch(`${CFG.url}/auth/v1/settings`, { headers: { apikey: CFG.anonKey } });
    PROVIDERS = (await r.json())?.external ?? {};
  } catch { PROVIDERS = {}; }
  return PROVIDERS!;
}

/* ★ **provider 를 받는다.** 카카오용·애플용을 따로 만들면 공식이 두 벌이 되고,
   한쪽만 고치는 날 둘이 갈라진다(§13.20에서 이미 겪은 형태다). */
export const SOCIALS = ["kakao", "apple"] as const;
export type Social = (typeof SOCIALS)[number];
const PROV_NAME: Record<string, string> = { kakao: "카카오", apple: "애플" };
export const provName = (p: string) => PROV_NAME[p] ?? p;

/* 지금 임시 계정에 **얹는다**. 계정 id 가 그대로라 아무것도 안 옮긴다. */
export async function linkProvider(provider: Social, redirectTo: string) {
  if (!SESSION.access_token) return { ok: false, why: "먼저 시작해야 합니다" };
  const p = await providers();
  if (!p[provider])
    return { ok: false, why: `${provName(provider)} 로그인이 아직 켜져 있지 않습니다` };
  try {
    const u = `${CFG.url}/auth/v1/user/identities/authorize?provider=${provider}`
            + `&skip_http_redirect=true&redirect_to=${encodeURIComponent(redirectTo)}`;
    const r = await fetch(u, { headers: { apikey: CFG.anonKey,
      Authorization: `Bearer ${SESSION.access_token}` } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return { ok: false, why: j?.msg ?? `HTTP ${r.status}` };
    return { ok: true, url: j.url as string };
  } catch (e: any) { return { ok: false, why: String(e?.message ?? e) }; }
}

/* 다른 기기에서 그 계정으로 **들어온다**. 세션이 바뀌는 문이다. */
export async function providerSignInUrl(provider: Social, redirectTo: string) {
  const p = await providers();
  if (!p[provider])
    return { ok: false, why: `${provName(provider)} 로그인이 아직 켜져 있지 않습니다` };
  return { ok: true, url: `${CFG.url}/auth/v1/authorize?provider=${provider}`
    + `&redirect_to=${encodeURIComponent(redirectTo)}` };
}

/* ── 네이티브 애플 로그인 (§13.45) ───────────────────────────────
   ★ 웹 OAuth 는 애플 **client secret 이 6개월이면 만료**된다 — 잊으면 어느 날
     모든 애플 로그인이 조용히 죽는다(§13.44). 네이티브 흐름(`id_token`)에는
     **그 갱신이 없다.** 그게 옮기는 이유고, 화면이 매끄러운 것은 덤이다.
   ★ 대신 **계정을 얹지 못한다.** `id_token` 은 그 애플 계정으로 **들어가는** 문이라
     지금 임시 계정과는 다른 계정이 된다 — 그래서 §13.40 의 합치기가 여기 붙는다.
     (얹기는 웹 OAuth 만 할 수 있다. 두 문의 쓰임이 다르다.) */
export async function signInWithAppleIdToken(idToken: string, nonce?: string) {
  if (!isOn()) return { ok: false, why: "서버 연결 없음" };
  const prev = { ...SESSION };
  try {
    const r = await fetch(`${CFG.url}/auth/v1/token?grant_type=id_token`, {
      method: "POST",
      headers: { apikey: CFG.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "apple", token: idToken, ...(nonce ? { nonce } : {}) }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      return { ok: false, why: j?.error_description ?? j?.msg ?? `HTTP ${r.status}` };
    }
    SESSION.access_token = j.access_token;
    SESSION.refresh_token = j.refresh_token;
    SESSION.user_id = j.user?.id ?? null;
    SESSION.anonymous = !!j.user?.is_anonymous;
    if (!SESSION.user_id) { Object.assign(SESSION, prev); return { ok: false, why: "계정을 확인하지 못했습니다" }; }
    await saveSession();
    return { ok: true, user: SESSION.user_id };
  } catch (e: any) {
    Object.assign(SESSION, prev);
    return { ok: false, why: String(e?.message ?? e) };
  }
}

/* 계정 합치기 (§13.40) — 네이티브 로그인은 계정이 **바뀌므로** 이 두 개가 붙는다 */
export const mergePrepare = () => rpc<any>("api_merge_prepare").then((r) => r.data ?? { ok: false });
export const mergeClaim = (token: string) =>
  rpc<any>("api_merge_claim", { p_token: token }, ).then((r) => r.data ?? { ok: false });
export const accountSummary = () => rpc<any>("api_account_summary").then((r) => r.data ?? null);

/* 돌아왔다. 웹은 `location.hash`, 앱은 **딥링크 문자열**이라 URL 을 받아서 푼다.
   ★ **확인되기 전에는 세션으로 받아들이지 않는다.** 먼저 저장했다가 토큰이 가짜면
     `user_id` 가 null 인 채 "로그인됨" 이 남고, 그 상태에서는 쓰기가 전부 튕긴다
     — 사용자는 이유를 모른다 (§13.41 에서 웹에서 겪었다). */
export async function consumeAuthRedirect(url: string) {
  const i = url.indexOf("#");
  if (i < 0) return null;
  const q = new URLSearchParams(url.slice(i + 1));
  const at = q.get("access_token"), rt = q.get("refresh_token");
  if (!at) {
    const err = q.get("error_description") || q.get("error");
    return err ? { ok: false, why: decodeURIComponent(err) } : null;
  }
  const prev = { ...SESSION };
  SESSION.access_token = at; SESSION.refresh_token = rt;
  let me: any = null;
  try {
    const r = await fetch(`${CFG.url}/auth/v1/user`, { headers: headers() });
    if (r.ok) me = await r.json();
  } catch {}
  if (!me?.id) {
    Object.assign(SESSION, prev);
    return { ok: false, why: "로그인을 마치지 못했습니다 — 다시 시도해 주십시오" };
  }
  SESSION.user_id = me.id;
  SESSION.anonymous = !!me.is_anonymous;
  await saveSession();
  return { ok: true, user: SESSION.user_id };
}

/* ── 읽기 ──────────────────────────────────────────────────── */
const PIN_COLS =
  "id,trip_id,place_id,region_code,geom,category,visited_at,stay_sec,memo,verification,is_public,comment_count," +
  "media(url,width,height,is_main,sort_order)";

export const search = (q: string, limit = 14) =>
  rpc<any[]>("api_search", { p_q: q, p_limit: limit });

export const publicRecords = (limit = 200) =>
  select<any[]>("pins",
    `is_public=eq.true&deleted_at=is.null&order=visited_at.desc&limit=${limit}&select=${PIN_COLS}`);

export const myRecords = (limit = 200) =>
  SESSION.user_id
    ? select<any[]>("pins",
        `user_id=eq.${SESSION.user_id}&deleted_at=is.null&order=visited_at.desc&limit=${limit}&select=${PIN_COLS}`)
    : Promise.resolve({ ok: false, via: "off", data: [] } as R<any[]>);

/* ── 뷰포트로 잘라 읽기 (§13.31 · 031) ────────────────────────
   ★ `publicRecords` 는 **최근 200개**를 읽는다. 5만 개를 남한에 뿌리고 재보니
     받은 300개 중 화면 안은 **0개**였다 — 지도에 쓰면 거의 전부가 버려진다.
     그리고 기록이 limit 를 넘는 순간 오래된 곳이 지도에서 사라진다.
   ★ 내 것과 공개 것을 한 번에 받는다. 따로 부르면 두 응답의 시점이 어긋나 깜빡인다.
   ★ `more` 는 개수가 아니라 "더 있다"는 사실이다 — 정확한 개수를 세는 것이
     이 함수가 피하려는 일 그 자체다. */
export type BBox = { w: number; s: number; e: number; n: number };

/** 지도는 하나고 무엇을 볼지만 고른다(§13.37). 셋은 **겹친다** — 분류가 아니라 필터다. */
export type Scope = "all" | "mine" | "shared" | "public";

export async function pinsInBBox(
  b: BBox, opts?: { limit?: number; cat?: string | null; scope?: Scope },
) {
  const r = await rpc<any[]>("api_pins_in_bbox", {
    p_w: b.w, p_s: b.s, p_e: b.e, p_n: b.n,
    p_limit: opts?.limit ?? 300, p_cat: safeCat(opts?.cat),
    p_scope: opts?.scope ?? "all",
  });
  const rows = r.ok ? (r.data ?? []) : [];
  return { ok: r.ok, via: r.via, data: rows, more: !!rows[0]?.more };
}

/* 뷰포트보다 넉넉히 읽어 두면 조금씩 미는 동안은 공짜다.
   0.4(=화면의 1.8배 넓이)는 "한 화면 밀어도 안 부른다"를 만족하는 가장 작은 값이다. */
export const PAD = 0.4;
export const padBox = (b: BBox): BBox => {
  const dx = (b.e - b.w) * PAD, dy = (b.n - b.s) * PAD;
  return { w: b.w - dx, s: b.s - dy, e: b.e + dx, n: b.n + dy };
};
export const boxInside = (inner: BBox, outer: BBox | null) => !!outer &&
  inner.w >= outer.w && inner.e <= outer.e && inner.s >= outer.s && inner.n <= outer.n;

export const myTrips = () =>
  SESSION.user_id
    ? select<any[]>("trips",
        `user_id=eq.${SESSION.user_id}&order=start_date.desc&limit=100&select=id,title,start_date,end_date`)
    : Promise.resolve({ ok: false, via: "off", data: [] } as R<any[]>);

/* ── 집계 코스 (§13.33 · 033) ─────────────────────────────────────
   "여기 간 사람들이 다음에 간 곳". ★ 지금은 거의 항상 **못 보여준다** — 그게 정상이다.
   그래서 답(`rows`)과 **진행 상황**(`base` / `need`)을 같이 받는다:
   못 보여줄 때 화면이 "아직 2팀입니다"라고 말할 수 있어야 한다. */
export type NextPlaces = {
  base: number;      // A 에서 **다음 곳을 기록한** 일행 수 (관측 안 한 이동은 안 센다)
  need: number;      // 열리는 데 필요한 일행 수
  floor: number;     // Wilson 하한 문턱
  ready: boolean;
  rows: { place_id: string; name: string; category: string;
          parties: number; lower_bound: number; gap_min: number }[];
};

export async function nextPlaces(placeId: string, limit = 5) {
  const r = await rpc<NextPlaces>("api_next_places", { p_place_id: placeId, p_limit: limit });
  return r.ok && r.data
    ? r.data
    : { base: 0, need: 5, floor: 0.3, ready: false, rows: [] } as NextPlaces;
}

/* ── 육로 덩어리 (§13.35 · 035) ───────────────────────────────────
   ★ 네 줄짜리 표다. 한 번 받아 캐시한다 — 화면마다 다시 물으면 섬 판정이
     화면마다 다른 순간이 생긴다. 서버와 **같은 표**를 쓰는 것이 요점이다. */
let LAND: Record<string, string> | null = null;
export async function loadLandmass() {
  if (LAND) return LAND;
  const r = await rpc<{ region_code: string; landmass: string }[]>("api_landmass");
  LAND = {};
  for (const row of r.data ?? []) LAND[row.region_code] = row.landmass;
  return LAND;
}
export const landmassOf = (regionCode?: string | null) =>
  (regionCode && LAND?.[regionCode]) || "mainland";

/* ── 시간 예산 (§13.34 · 034) ─────────────────────────────────────
   "지금부터 3시간 비는데 어디 갈까". 거리 필터는 왕복 이동과 머무는 시간을 안 뺀다.
   ★ `stayMin` 이 null 이면 **체류를 모르는 것**이다 — 0 이 아니고, 평균도 아니다.
     모르는 곳에 "보통 1시간"을 끼워 넣으면 사용자가 못 끝낼 일정을 짠다. */
export type BudgetPlace = {
  place_id: string; name: string; category: string;
  dist_m: number; drive_min: number;
  stay_min: number | null; stay_parties: number | null; left_min: number;
};

export const placesInBudget = (
  lat: number, lng: number, budgetMin: number,
  opts?: { cat?: string | null; limit?: number },
) => rpc<BudgetPlace[]>("api_places_in_budget", {
  p_lng: lng, p_lat: lat, p_budget_min: budgetMin,
  p_cat: safeCat(opts?.cat), p_limit: opts?.limit ?? 30,
});

/* ── 계절 축 (§13.36 · 036) ───────────────────────────────────────
   ★ 관광공사 사진 49,285장에는 **촬영 시각이 한 줄도 없다**(실측). 그래서 계절로
     거를 수 있는 것은 사용자 사진뿐이고, 기관 사진에는 "언제 찍혔는지 모른다"고
     적는 것이 지금 할 수 있는 전부다 — **그 말을 하는 것이 이 기능의 절반이다.** */
export type MonthPlace = {
  place_id: string; name: string; category: string;
  dist_m: number; parties: number; photos: number;
};

export const placesByMonth = (
  lat: number, lng: number, month: number, opts?: { radiusM?: number; limit?: number },
) => rpc<MonthPlace[]>("api_places_by_month", {
  p_lng: lng, p_lat: lat, p_month: month,
  p_radius_m: opts?.radiusM ?? 60000, p_limit: opts?.limit ?? 24,
});

/* 노출 로그 — 웹과 같은 규칙: 보낸 것은 지운다(분모가 부풀면 순위가 흐려진다) */
export const logCoverEvents = (rows: any[]) =>
  rpc<number>("api_log_cover_events", { p_rows: rows });

/* ── 장소 후보 (§13.20) ────────────────────────────────────────
   ★ 인자 이름이 틀리면 PostgREST 는 **함수를 못 찾는다**(404).
     실제 시그니처: (p_lng, p_lat, p_cat, p_cat_conf, p_gps_acc_m, p_limit)
   ★ 모르는 카테고리를 `etc` 로 바꿔 보내면 안 된다 — 일치 가중치가 3.0 이라
     **틀린 힌트가 순서를 흔든다.** 모를 때는 힌트를 안 주는 것이 맞다(null). */
export const PIN_CATEGORY = ["nature","beach","heritage","activity","food",
                             "cafe","bar","stay","shop","event","etc"];
export const safeCat = (c?: string | null) =>
  (c && PIN_CATEGORY.includes(c) ? c : null);

export const candidates = (
  lat: number, lng: number, acc?: number, cat?: string | null, conf?: number, limit = 10,
) => rpc<any[]>("api_place_candidates", {
  p_lng: lng, p_lat: lat,
  p_cat: safeCat(cat), p_cat_conf: safeCat(cat) ? (conf ?? 0) : 0,
  p_gps_acc_m: acc || 15, p_limit: limit,
});

/* ── 사진 올리기 (§13.22) ─────────────────────────────────────
   ★ **축소는 기기에서 한다.** 견적의 "이미지 변환 비용 0"이 이 한 줄이다.
     서버에서 변환하면 업로드마다 함수가 돌고, 그게 사용자 수에 비례해 늘어난다.
   ★ 그리고 올리는 용량이 줄어든다 — 3G 에서 원본 4MB 한 장에 20초면 아무도 안 올린다.
   ★ RN 판이 웹과 다른 곳: canvas 가 없다. 네이티브 변환기를 쓰고,
     업로드도 fetch(Blob) 대신 `uploadAsync` 로 **파일을 그대로** 올린다 —
     base64 로 만들면 메모리에 1.33배로 올라앉는다. */
const MAX_EDGE = 1600;      // 긴 변. 폰 화면에서 이보다 크면 보이지도 않는다
const WEBP_Q = 0.85;        // 원본 기획서 §11 이 적어 둔 값

/* ★ 두 가지를 틀리기 쉽다. 둘 다 실제로 틀렸었다:
   ① `resize:{width}` 는 **가로**만 본다 — 세로 사진은 긴 변이 1600을 넘어 버린다.
   ② 원본이 이미 작아도 1600으로 **늘린다.** 320×240 짜리가 1600×1200 으로 올라갔다.
      늘린 사진은 더 무겁고 더 흐리다 — 없는 화소를 만들어 붙인 것이다.
   그래서 배율을 원본 크기에서 직접 계산하고, 1보다 크면 아예 건드리지 않는다. */
export async function shrink(
  uri: string, srcW?: number, srcH?: number, maxEdge = MAX_EDGE, quality = WEBP_Q,
) {
  const IM = await import("expo-image-manipulator");
  const long = Math.max(srcW || 0, srcH || 0);
  const actions: any[] = [];
  if (long > maxEdge) {
    const k = maxEdge / long;
    actions.push({ resize: { width: Math.round((srcW || long) * k),
                             height: Math.round((srcH || long) * k) } });
  }
  // 크기를 몰라도 포맷 변환(WEBP)만으로 용량이 4분의 1이 된다 (§13.27 실측)
  const r = await IM.manipulateAsync(uri, actions,
    { compress: quality, format: IM.SaveFormat.WEBP });
  return { uri: r.uri, w: r.width, h: r.height };
}

export async function uploadPhoto(
  srcUri: string, opts?: { maxEdge?: number; q?: number; w?: number; h?: number },
): Promise<{ ok: boolean; why?: string; path?: string; url?: string;
             w?: number | null; h?: number | null; bytes?: number; shrunk?: boolean }> {
  if (!isOn()) return { ok: false, why: "서버 연결 없음" };
  if (!SESSION.access_token) return { ok: false, why: "로그인 필요" };
  const id =
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let body = srcUri, w: number | null = null, h: number | null = null;
  let ext = "jpg", mime = "image/jpeg", shrunk = false;
  try {
    const sm = await shrink(srcUri, opts?.w, opts?.h, opts?.maxEdge, opts?.q);
    body = sm.uri; w = sm.w; h = sm.h; ext = "webp"; mime = "image/webp"; shrunk = true;
  } catch (e) {
    /* ★ 축소가 실패해도 **올리기는 막지 않는다.** 원본이라도 올라가는 것이
       한 장도 안 올라가는 것보다 낫다. 대신 그 사실을 돌려준다. */
    console.warn("[api] 축소 실패 — 원본으로 올린다", e);
  }
  const path = `${SESSION.user_id}/${id}.${ext}`;   // 경로 첫 칸이 주인이다(030)
  try {
    const r = await FileSystem.uploadAsync(
      `${CFG.url}/storage/v1/object/photos/${path}`, body,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { apikey: CFG.anonKey, Authorization: `Bearer ${SESSION.access_token}`,
                   "Content-Type": mime, "x-upsert": "false" },
      });
    if (r.status >= 300) {
      STATE.lastError = `upload ${r.status} ${String(r.body).slice(0, 140)}`;
      return { ok: false, why: STATE.lastError };
    }
    const info = await FileSystem.getInfoAsync(body);
    return { ok: true, path, w, h, shrunk,
             url: `${CFG.url}/storage/v1/object/public/photos/${path}`,
             bytes: (info as any)?.size ?? 0 };
  } catch (e: any) {
    STATE.lastError = String(e?.message ?? e);
    return { ok: false, why: STATE.lastError };
  }
}

/* 올린 사진을 기록(핀)에 붙인다 — 저장소에만 있으면 아무도 못 본다 */
export const attachMedia = (pinId: string, up: any, extra?: any) =>
  insert<any>("media", { pin_id: pinId, type: "photo", url: up.url,
                         width: up.w, height: up.h, ...(extra || {}) });

/* ── 여행 하나를 통째로 올린다 (§13.23) ────────────────────────
   ★ **사진은 정거장마다 대표 1장만.** §6 이 그렇게 정했다 — 전부 올리면
     첫 등록에 수십 장이 나가 **사용자가 기다리다 앱을 닫는다.**
     나머지는 뒤에서 올리면 된다(아직 안 만들었다).
   ★ 실패해도 로컬 등록을 되돌리지 않는다. 사용자는 이미 '완료'를 봤다.
     못 올린 것을 **목록으로 돌려준다.** 숨기지 않는다. */
export type PushOpts = {
  picks: Record<string, string[]>;               // 정거장 → 고른 사진 id
  placeOf?: Record<string, { placeId?: string; category?: string } | undefined>;
  memos?: Record<string, string>;
  uriOf: (photoId: string) => string | undefined;
  isPublic?: boolean;
  onStep?: (done: number, total: number) => void;
  /* 대표를 뺀 나머지를 뒤로 넘긴다 (§13.30). 없으면 대표만 올라간다 —
     큐를 안 붙인 화면도 그대로 돌아야 한다. */
  queue?: (jobs: { pinId: string; photoId: string; takenAt: number;
                   sortOrder: number; w?: number; h?: number }[]) => Promise<void>;
};

/** 정거장의 첫 사진 ~ 마지막 사진 (초). 한 장뿐이면 **모르는 것**이라 null. */
function staySecOf(st: any): number | null {
  const ts = (st.items || []).map((x: any) => x.ts).filter(Number.isFinite);
  if (ts.length < 2) return null;
  const sec = Math.round((Math.max(...ts) - Math.min(...ts)) / 1000);
  return sec > 0 && sec <= 86400 ? sec : null;   // 하루를 넘으면 묶기가 틀린 것이다
}

export async function pushTrip(trip: any, stops: any[], o: PushOpts) {
  if (!isOn()) return { ok: false, why: "서버 연결 없음", pins: 0, media: 0, failed: [] as any[] };
  if (!SESSION.access_token) return { ok: false, why: "로그인 필요", pins: 0, media: 0, failed: [] as any[] };
  const out = { trip: null as string | null, pins: 0, media: 0, bytes: 0,
                queued: 0, failed: [] as any[] };

  if (!trip.isOrphan) {
    const t = await insert<any>("trips", {
      user_id: SESSION.user_id, title: trip.title,
      start_date: new Date(trip.start).toISOString().slice(0, 10),
      end_date: new Date(trip.end).toISOString().slice(0, 10),
    });
    if (t.ok) out.trip = t.data?.[0]?.id ?? t.data?.id ?? null;
    else out.failed.push({ what: "여행", why: t.error });
  }

  const todo = stops.filter((st) => (o.picks[st.id] || []).length);
  let n = 0;
  for (const st of todo) {
    o.onStep?.(n++, todo.length);
    const picked = o.picks[st.id];
    const place = o.placeOf?.[st.id];
    const first = st.items.find((v: any) => v.id === picked[0]) || st.items[0];
    const g = first.gps || st.c;
    if (!g) { out.failed.push({ what: st.id, why: "좌표 없음" }); continue; }

    const pin = await insert<any>("pins", {
      user_id: SESSION.user_id,
      trip_id: out.trip,
      place_id: place?.placeId ?? null,
      geom: `SRID=4326;POINT(${g.lng} ${g.lat})`,
      category: safeCat(place?.category) || "etc",
      visited_at: new Date(st.start || first.ts).toISOString(),
      /* ★ 체류 시간은 **여기서만** 정확히 알 수 있다(032). 사진은 전부 기기에 있고
         서버로 가는 것은 정수 하나다 — 이걸 안 보내면 하루 코스의 재료가 사라진다.
         사진 1장이면 0 이 아니라 null 이다. 0분이라고 쓰면 거짓말이 된다. */
      stay_sec: staySecOf(st),
      memo: o.memos?.[st.id] || null,
      /* ★ 장소를 안 고르면 공개하지 않는다 — 좌표만 있는 점은 지도에서
         무엇인지 말할 수 없고, place_stats 에도 붙지 못한다(009·011). */
      is_public: !!o.isPublic && !!place?.placeId,
      verification: first.gps ? "exif" : "manual",
    });
    if (!pin.ok) { out.failed.push({ what: st.id, why: pin.error }); continue; }
    const pinId = pin.data?.[0]?.id ?? pin.data?.id;
    out.pins++;

    const rep = st.items.find((v: any) => v.id === picked[0]);
    const src = rep && o.uriOf(rep.id);
    if (src) {
      const up = await uploadPhoto(src, { w: rep.w, h: rep.h });
      if (!up.ok) out.failed.push({ what: st.id, why: up.why });
      else {
        out.bytes += up.bytes || 0;
        const m = await attachMedia(pinId, up, {
          is_main: true, sort_order: 0,
          taken_at: new Date(rep.ts || Date.now()).toISOString(),
        });
        if (m.ok) out.media++; else out.failed.push({ what: st.id, why: m.error });
      }
    }

    /* ★ 나머지는 **여기서 올리지 않는다.** 대표만 올리고 넘긴다 — 사용자는
       '완료'를 먼저 봐야 한다. 대표가 못 올라갔어도 나머지는 넘긴다:
       핀은 이미 만들어졌고, 사진 한 장이 없다고 나머지를 버릴 이유가 없다. */
    const rest = picked.slice(1)
      .map((id: string) => st.items.find((v: any) => v.id === id))
      .filter(Boolean);
    if (rest.length && o.queue) {
      await o.queue(rest.map((it: any, i: number) => ({
        pinId, photoId: it.id, takenAt: it.ts || Date.now(),
        sortOrder: i + 1, w: it.w, h: it.h,
      })));
      out.queued += rest.length;
    }
  }
  o.onStep?.(todo.length, todo.length);
  return { ok: out.failed.length === 0, ...out };
}
