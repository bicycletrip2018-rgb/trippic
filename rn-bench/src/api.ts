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

/* ── 읽기 ──────────────────────────────────────────────────── */
const PIN_COLS =
  "id,trip_id,place_id,geom,category,visited_at,memo,verification,is_public,comment_count," +
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

export const myTrips = () =>
  SESSION.user_id
    ? select<any[]>("trips",
        `user_id=eq.${SESSION.user_id}&order=start_date.desc&limit=100&select=id,title,start_date,end_date`)
    : Promise.resolve({ ok: false, via: "off", data: [] } as R<any[]>);

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
