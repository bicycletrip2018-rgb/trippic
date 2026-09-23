/* =====================================================================
   서버 연결 (§13.17)

   지금까지 프로토타입은 **전부 인메모리**였다. 장소는 `places-real.json`
   2.5MB를 통째로 받아 쓰고, 로그는 `localStorage` 에만 쌓였다.
   027~029로 스키마를 만들었지만 **아무도 부르지 않았다.**

   ★ 이 파일이 지키는 규칙 하나: **서버가 없어도 화면은 돈다.**
     키가 없거나 요청이 실패하면 조용히 로컬 JSON으로 떨어진다.
     프로토타입의 값어치는 **항상 도는 것**이다 — 서버 하나 때문에
     설계를 못 보여주게 되면 안 된다.

   ★ 그래서 모든 호출은 `{ok, data, via}` 를 돌려준다.
     `via` 가 'server' 인지 'local' 인지 **화면이 알 수 있어야** 한다.
     어디서 온 값인지 모르면 디버깅이 추측이 된다.
   ===================================================================== */
(function () {
  const CFG = window.TRIPPIC_CONFIG || {};
  const ON = !!(CFG.url && CFG.anonKey);
  const TIMEOUT = 6000;

  const API = { on: ON, url: CFG.url || "", calls: 0, fails: 0, lastError: null };

  /* ★ Supabase가 키 체계를 바꿨다.
       옛 키: `anon` — JWT(`eyJ...`). `Authorization: Bearer` 에 그대로 넣어도 된다.
       새 키: `publishable` — `sb_publishable_...`. **JWT가 아니라서**
              Bearer 로 보내면 파싱에 실패할 수 있다. `apikey` 헤더로만 보낸다.
       둘 다 받도록 형식을 보고 가른다 — 대시보드가 어느 쪽을 주든 돌아야 한다. */
  function authHeaders() {
    const k = CFG.anonKey || "";
    const h = { "Content-Type": "application/json", apikey: k };
    /* ★ 로그인했으면 **사용자 토큰**이 Bearer 에 들어간다. 이게 있어야
       `auth.uid()` 가 채워지고 RLS·로그·댓글이 전부 살아난다.
       로그인 전에는 옛 JWT 키일 때만 Bearer 에 키를 넣는다 —
       새 `sb_publishable_...` 는 JWT가 아니라 Bearer 로 보내면 파싱에 실패한다. */
    const tok = SESSION.access_token;
    if (tok) h.Authorization = `Bearer ${tok}`;
    else if (k.startsWith("eyJ")) h.Authorization = `Bearer ${k}`;
    return h;
  }

  /* ── 익명 로그인 (§13.19) ─────────────────────────────────────
     ★ 왜 익명부터인가: 만들어 둔 것의 절반이 `auth.uid()` 뒤에 잠겨 있다
       (로그·댓글·업로드). 소셜은 Apple 계정과 카카오 심사가 필요해 며칠이 걸리는데,
       익명은 **오늘 된다.** 그리고 원본 기획서 §3이 *"비로그인도 둘러보기 가능"*
       이라 했으니, **익명으로 시작해 필요할 때 승격**하는 것이 그 설계와 맞다.

     ★ 익명 계정은 **기기에 묶인다.** 앱을 지우면 기록이 사라진다 —
       그걸 화면이 말해야 한다. 말 안 하면 사용자는 잃고 나서야 안다. */
  const SES_KEY = "trippic.session.v1";
  const SESSION = { access_token: null, refresh_token: null, user_id: null, anonymous: false };

  function loadSession() {
    try {
      const v = JSON.parse(localStorage.getItem(SES_KEY) || "null");
      if (v && v.access_token) Object.assign(SESSION, v);
    } catch (e) {}
  }
  function saveSession() {
    try { localStorage.setItem(SES_KEY, JSON.stringify(SESSION)); } catch (e) {}
  }
  function clearSession() {
    SESSION.access_token = SESSION.refresh_token = SESSION.user_id = null;
    SESSION.anonymous = false;
    try { localStorage.removeItem(SES_KEY); } catch (e) {}
  }
  loadSession();

  async function auth(path, body) {
    const r = await fetch(`${CFG.url}/auth/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.anonKey },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: j };
  }

  async function signInAnonymously() {
    if (!ON) return { ok: false, why: "키 없음" };
    if (SESSION.access_token) return { ok: true, why: "이미 로그인", user: SESSION.user_id };
    const r = await auth("signup", {});
    if (!r.ok) {
      const code = r.data && (r.data.error_code || r.data.code);
      return { ok: false, why: code === "anonymous_provider_disabled"
        ? "대시보드에서 Anonymous sign-ins 를 켜야 합니다"
        : (r.data && r.data.msg) || `HTTP ${r.status}` };
    }
    SESSION.access_token = r.data.access_token;
    SESSION.refresh_token = r.data.refresh_token;
    SESSION.user_id = r.data.user && r.data.user.id;
    SESSION.anonymous = true;
    saveSession();
    return { ok: true, user: SESSION.user_id };
  }

  /* 토큰이 만료되면 조용히 갱신한다. 실패하면 **로그아웃 상태로 떨어진다** —
     만료된 토큰을 계속 보내면 모든 호출이 401 이 되는데 원인이 안 보인다. */
  async function refresh() {
    if (!SESSION.refresh_token) return false;
    const r = await auth("token?grant_type=refresh_token",
                         { refresh_token: SESSION.refresh_token });
    if (!r.ok) { clearSession(); return false; }
    SESSION.access_token = r.data.access_token;
    SESSION.refresh_token = r.data.refresh_token;
    saveSession();
    return true;
  }

  // 내부 표식(__retried)은 서버로 보내지 않는다 — 없는 인자를 보내면 404 가 된다
  const stripInternal = (a) => {
    const o = Object.assign({}, a || {}); delete o.__retried; return o;
  };

  async function rpc(fn, args) {
    if (!ON) return { ok: false, via: "off", data: null };
    API.calls++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
        method: "POST", signal: ctl.signal,
        headers: authHeaders(),
        body: JSON.stringify(stripInternal(args)),
      });
      if (r.status === 401 && SESSION.refresh_token && !(args && args.__retried)) {
        /* 토큰 만료 — 한 번만 갱신하고 다시 친다.
           무한 재시도는 안 한다. 갱신이 안 되면 로그아웃 상태로 떨어지는 게 맞다. */
        if (await refresh()) return rpc(fn, Object.assign({}, args, { __retried: true }));
      }
      if (!r.ok) throw new Error(`${fn} ${r.status} ${(await r.text()).slice(0, 120)}`);
      return { ok: true, via: "server", data: await r.json() };
    } catch (e) {
      API.fails++; API.lastError = String(e.message || e);
      console.warn("[api]", fn, "실패 → 로컬로", API.lastError);
      return { ok: false, via: "local", data: null, error: API.lastError };
    } finally { clearTimeout(t); }
  }

  /* ── 검색 ─────────────────────────────────────────────────────
     로컬은 `places-real.json`(2.5MB)을 전부 받아 훑는다. 전국 46만 곳 중
     5만 곳만 담긴 파일이라 **못 찾는 곳이 있다.** 서버는 46만 곳 전부를 본다. */
  async function search(q, limit) {
    const r = await rpc("api_search", { p_q: q, p_limit: limit || 20 });
    if (r.ok) return { ok: true, via: "server", data: r.data };
    return { ok: false, via: "local", data: null };
  }

  /* ── 후보 ─────────────────────────────────────────────────────
     사진 좌표 주변의 장소. 로컬은 반경 계산을 브라우저에서 하고,
     서버는 GiST 인덱스로 한다 — 46만 곳에서 그 차이가 크다. */
  /* ★ 서버 enum `pin_category` 에 없는 값을 보내면 **400 (22P02)** 이다.
     프로토타입에는 데모 전용 `sight` 가 있고 index.html 주석에도
     *"실제 enum에는 없다"* 고 적혀 있는데, 그대로 보내서 후보 조회가 통째로 실패했다.
     ★ 모르는 값을 `etc` 로 바꿔 보내면 안 된다 — 카테고리 일치 가중치가 3.0 이라
       **틀린 힌트가 순서를 흔든다.** 모를 때는 **힌트를 안 주는 것**이 맞다(null). */
  const PIN_CATEGORY = ["nature","beach","heritage","activity","food",
                        "cafe","bar","stay","shop","event","etc"];
  const safeCat = (c) => (PIN_CATEGORY.includes(c) ? c : null);

  async function candidates(lat, lng, acc, cat, conf, limit) {
    /* ★ 인자 이름이 틀리면 PostgREST 는 **함수를 못 찾는다**(404).
       실제 시그니처: (p_lng, p_lat, p_cat, p_cat_conf, p_gps_acc_m, p_limit) */
    const r = await rpc("api_place_candidates", {
      p_lng: lng, p_lat: lat,
      p_cat: safeCat(cat), p_cat_conf: safeCat(cat) ? (conf == null ? 0 : conf) : 0,
      p_gps_acc_m: acc || 15, p_limit: limit || 10,
    });
    return r.ok ? { ok: true, via: "server", data: r.data }
                : { ok: false, via: "local", data: null };
  }

  /* ── 로그 보내기 ──────────────────────────────────────────────
     ★ `api_log_cover_events` 는 로그인을 요구한다(027).
       익명으로도 열어 달라는 유혹이 있는데 — 익명 노출이 초기에는 다수라
       분모가 작으면 Wilson 점수가 전부 낮게 눌려 표지가 안 바뀐다 —
       **열지 않았다.** anon 키는 공개 키라, 누구든 남의 후보 노출을 부풀려
       점수(= 반응/노출)를 **떨어뜨릴 수 있다.** 조작 가능한 값 위에 순위를 세우면
       순위가 아니라 표적이 된다.
       → 익명 노출은 **모아 두었다가 로그인하면 보낸다.** 그때까지는 로컬에만 있다.
         (제대로 된 답은 서버측 집계 + IP 레이트리밋이다. §13.17에 적어 둔다.) */
  async function flushCoverEvents() {
    if (!window.LOG) return { ok: false, via: "off", sent: 0 };
    const all = LOG.all();
    /* 키 형식: `a:<place_id>` (기관 사진) · `u:<이름>:<작성자>` · `m:<이름>` (내 기록).
       ★ **uuid 를 들고 있는 것만** 보낸다. 나머지는 아직 서버에 대응이 없다 —
         보낼 수 없다는 사실을 조용히 넘기지 않고 숫자로 돌려준다. */
    const rows = Object.entries(all).map(([k, v]) => {
      const i = k.indexOf(":");
      return { _key: k, kind: k.slice(0, i), place: k.slice(i + 1), ...v };
    }).filter((r) => r.imp || r.opened || r.research);
    if (!rows.length) return { ok: true, via: "noop", sent: 0 };
    if (!SESSION.access_token) return { ok: false, via: "queued", sent: 0, queued: rows.length };
    /* ★ 프로토타입의 키는 장소 **이름**이다. 서버는 `place_id`(uuid)를 받는다.
       이름으로 매칭하려면 46만 곳을 조회해야 하고, 동명이인 문제도 있다.
       → 실제 앱은 핀을 만들 때 받은 `place_id` 를 그대로 들고 다닌다.
         여기서는 **보낼 수 있는 것이 없다는 사실을 숨기지 않는다.** */
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const sendable = rows.filter((r) => UUID.test(r.place || ""));
    if (!sendable.length) {
      return { ok: false, via: "no-id", sent: 0, queued: rows.length,
               note: "보낼 수 있는 place_id 가 없다 (내 기록 후보는 아직 서버 미디어가 아니다)" };
    }
    const r = await rpc("api_log_cover_events", {
      p_rows: sendable.map((x) => ({ place_id: x.place, media_id: null,
        imp: x.imp | 0, opened: x.opened | 0, research: x.research | 0 })) });
    /* ★ 보낸 것은 지운다. 안 지우면 다음 전송에서 **같은 노출을 또 보내** 분모가 부푼다 —
       노출 대비로 재는 점수에서 분모가 부풀면 모든 후보가 같이 낮아지고 순위가 흐려진다. */
    if (r.ok && window.LOG && LOG.forget) sendable.forEach((x) => LOG.forget(x._key));
    return { ok: r.ok, via: r.via, sent: r.ok ? sendable.length : 0, queued: rows.length };
  }

  /* ── 표(table) 직접 쓰기 ──────────────────────────────────────
     RPC 가 아니라 PostgREST 의 표 엔드포인트를 쓴다. RLS 가 그대로 건다. */
  async function insert(table, row, opts) {
    if (!ON) return { ok: false, via: "off" };
    API.calls++;
    try {
      const r = await fetch(`${CFG.url}/rest/v1/${table}`, {
        method: "POST",
        headers: Object.assign(authHeaders(), { Prefer: "return=representation" }),
        body: JSON.stringify(row),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`${table} ${r.status} ${JSON.stringify(j).slice(0, 140)}`);
      return { ok: true, via: "server", data: Array.isArray(j) ? j[0] : j };
    } catch (e) {
      API.fails++; API.lastError = String(e.message || e);
      console.warn("[api] insert", table, API.lastError);
      return { ok: false, via: "local", error: API.lastError };
    }
  }

  async function select(table, query) {
    if (!ON) return { ok: false, via: "off", data: [] };
    try {
      const r = await fetch(`${CFG.url}/rest/v1/${table}?${query}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`${table} ${r.status}`);
      return { ok: true, via: "server", data: await r.json() };
    } catch (e) {
      API.fails++; API.lastError = String(e.message || e);
      return { ok: false, via: "local", data: [] };
    }
  }

  /* ── 댓글을 서버로 (§13.21) ───────────────────────────────────
     ★ 댓글은 **잎사귀**다. 정책이 `pin_spaces ⋈ space_members` 를 요구하므로
       스페이스·멤버·핀·공유가 **먼저** 있어야 한다. 그게 없으면 댓글은 못 쓴다 —
       화면만 고쳐서는 안 되는 이유다.
     ★ 그래서 **처음 댓글을 달 때** 그 줄기를 만든다. 미리 다 만들어 두지 않는다 —
       쓰지도 않을 방과 핀을 서버에 쌓아 두는 것은 쓰레기다. */
  const LINK_KEY = "trippic.links.v1";
  const LINKS = (() => { try { return JSON.parse(localStorage.getItem(LINK_KEY) || "{}"); }
                         catch (e) { return {}; } })();
  const saveLinks = () => { try { localStorage.setItem(LINK_KEY, JSON.stringify(LINKS)); } catch (e) {} };

  async function ensureSpace(localId, title) {
    if (LINKS["sp:" + localId]) return LINKS["sp:" + localId];
    const uid = SESSION.user_id;
    const sp = await insert("spaces", { type: "shared", title, owner_id: uid });
    if (!sp.ok) return null;
    await insert("space_members", { space_id: sp.data.id, user_id: uid, role: "owner" });
    LINKS["sp:" + localId] = sp.data.id; saveLinks();
    return sp.data.id;
  }

  async function ensurePin(rec, spaceLocalId, spaceTitle) {
    const key = "pin:" + rec.id;
    if (LINKS[key]) return LINKS[key];
    const spaceId = await ensureSpace(spaceLocalId, spaceTitle);
    if (!spaceId) return null;
    const g = rec.gps || (rec.poi && { lat: rec.poi.geometry.coordinates[1],
                                       lng: rec.poi.geometry.coordinates[0] });
    if (!g) return null;
    const pin = await insert("pins", {
      user_id: SESSION.user_id,
      geom: `SRID=4326;POINT(${g.lng} ${g.lat})`,
      category: safeCat(rec.poi && rec.poi.properties.c) || "etc",
      visited_at: new Date(rec.ts || Date.now()).toISOString(),
      memo: rec.memo || null,
    });
    if (!pin.ok) return null;
    await insert("pin_spaces", { pin_id: pin.data.id, space_id: spaceId });
    LINKS[key] = pin.data.id; saveLinks();
    return pin.data.id;
  }

  async function addComment(rec, spaceLocalId, spaceTitle, body) {
    if (!SESSION.access_token) return { ok: false, why: "로그인 필요" };
    const pinId = await ensurePin(rec, spaceLocalId, spaceTitle);
    if (!pinId) return { ok: false, why: API.lastError || "핀을 만들지 못했습니다" };
    const r = await insert("comments",
      { pin_id: pinId, user_id: SESSION.user_id, body });
    return r.ok ? { ok: true, id: r.data.id, pinId } : { ok: false, why: r.error };
  }

  async function listComments(recId) {
    const pinId = LINKS["pin:" + recId];
    if (!pinId) return { ok: true, data: [] };
    return select("comments", `pin_id=eq.${pinId}&deleted_at=is.null&order=created_at.asc&select=id,body,user_id,created_at`);
  }

  /* ── 사진 올리기 (§13.22) ─────────────────────────────────────
     ★ **축소는 기기에서 한다.** 견적에서 "이미지 변환 비용 0"이라고 적은 것이
       이 한 줄이다 — 서버에서 변환하면 업로드마다 함수가 돌고, 그게 사용자 수에
       비례해 늘어난다. 폰이 이미 갖고 있는 캔버스로 하면 **0원**이다.
     ★ 그리고 올리는 용량이 줄어든다. 원본 4MB 를 그대로 올리면 사용자의 데이터도
       쓴다 — 3G 에서 사진 한 장에 20초면 아무도 안 올린다.

     ★ 원본을 버리지 않는다. 나중에 더 좋은 압축이 나와도 다시 만들 수 없기 때문이다.
       (저장비는 전체의 1~3% 라 아끼는 의미가 없다 — 견적에서 이미 쟀다) */
  const MAX_EDGE = 1600;       // 긴 변. 폰 화면에서 이보다 크면 보이지도 않는다
  const WEBP_Q = 0.85;         // 원본 기획서 §11 이 적어 둔 값

  async function shrink(file, maxEdge, quality) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, (maxEdge || MAX_EDGE) / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const blob = await new Promise((res) => cv.toBlob(res, "image/webp", quality || WEBP_Q));
    return { blob, w, h };
  }

  /* 한 장을 올린다. 경로 첫 칸이 주인이라 남의 폴더에는 못 쓴다(030). */
  async function uploadPhoto(file, opts) {
    if (!ON) return { ok: false, why: "서버 연결 없음" };
    if (!SESSION.access_token) return { ok: false, why: "로그인 필요" };
    const uid = SESSION.user_id;
    const id = crypto.randomUUID();
    let body = file, w = null, h = null, ext = "jpg", mime = file.type || "image/jpeg";
    try {
      const sm = await shrink(file, (opts && opts.maxEdge) || MAX_EDGE, (opts && opts.q) || WEBP_Q);
      if (sm.blob && sm.blob.size < file.size) {
        body = sm.blob; w = sm.w; h = sm.h; ext = "webp"; mime = "image/webp";
      }
    } catch (e) {
      /* ★ 축소가 실패해도 **올리기는 막지 않는다.** 원본이라도 올라가는 것이
         한 장도 안 올라가는 것보다 낫다. 대신 그 사실을 돌려준다. */
      console.warn("[api] 축소 실패 — 원본으로 올린다", e);
    }
    const path = `${uid}/${id}.${ext}`;
    const r = await fetch(`${CFG.url}/storage/v1/object/photos/${path}`, {
      method: "POST",
      headers: { apikey: CFG.anonKey, Authorization: `Bearer ${SESSION.access_token}`,
                 "Content-Type": mime, "x-upsert": "false" },
      body,
    });
    if (!r.ok) {
      const t = await r.text();
      API.lastError = `upload ${r.status} ${t.slice(0, 140)}`;
      return { ok: false, why: API.lastError };
    }
    return { ok: true, path, w, h,
             url: `${CFG.url}/storage/v1/object/public/photos/${path}`,
             bytes: body.size, originalBytes: file.size,
             shrunk: body !== file };
  }

  /* 올린 사진을 기록(핀)에 붙인다 — 저장소에만 있으면 아무도 못 본다 */
  async function attachMedia(pinId, up, extra) {
    return insert("media", Object.assign({
      pin_id: pinId, type: "photo", url: up.url,
      width: up.w, height: up.h,
    }, extra || {}));
  }

  /* ── 여행 하나를 통째로 올린다 (§13.23) ────────────────────────
     ★ §6 의 핵심 경로다. 지금까지는 한 장씩만 올라갔다.

     ★ **사진은 정거장마다 대표 1장만** 올린다. §6 이 이미 그렇게 정했다 —
       대표 1장은 지도 타일에, 노출 2장은 핀·피드에, 나머지는 저장.
       전부 올리면 첫 등록에 수십 장이 나가 **사용자가 기다리다 앱을 닫는다.**
       나머지는 나중에 뒤에서 올리면 된다(아직 안 만들었다).

     ★ 실패해도 **로컬 등록은 되돌리지 않는다.** 사용자는 이미 '완료'를 봤다.
       되돌리면 화면이 거짓말을 한 게 되고, 무엇이 사라졌는지도 모른다.
       → 못 올린 것을 **목록으로 돌려준다.** 숨기지 않는다. */
  async function pushTrip(trip, stops, opts) {
    if (!ON) return { ok: false, why: "서버 연결 없음" };
    if (!SESSION.access_token) return { ok: false, why: "로그인 필요" };
    const o = opts || {};
    const out = { trip: null, pins: 0, media: 0, failed: [], bytes: 0 };

    if (!trip.isOrphan) {
      const key = "trip:" + trip.id;
      if (LINKS[key]) out.trip = LINKS[key];
      else {
        const t = await insert("trips", {
          user_id: SESSION.user_id, title: trip.title,
          start_date: new Date(trip.start).toISOString().slice(0, 10),
          end_date: new Date(trip.end).toISOString().slice(0, 10),
        });
        if (t.ok) { out.trip = t.data.id; LINKS[key] = t.data.id; saveLinks(); }
        else out.failed.push({ what: "여행", why: t.error });
      }
    }

    const spaceIds = [];
    for (const sp of (o.spaces || [])) {
      const id = await ensureSpace(sp, o.spaceNames?.[sp] || sp);
      if (id) spaceIds.push(id);
    }

    for (const st of stops) {
      const picked = (o.picks?.[st.id]) || [];
      if (!picked.length) continue;
      const place = o.placeOf?.[st.id];
      const first = st.items.find((v) => v.id === picked[0]) || st.items[0];
      const g = first.gps || (first.poi && { lat: first.poi.geometry.coordinates[1],
                                             lng: first.poi.geometry.coordinates[0] });
      if (!g) { out.failed.push({ what: st.id, why: "좌표 없음" }); continue; }

      const pin = await insert("pins", {
        user_id: SESSION.user_id,
        trip_id: out.trip,
        place_id: place && place.placeId ? place.placeId : null,
        geom: `SRID=4326;POINT(${g.lng} ${g.lat})`,
        category: safeCat(first.poi && first.poi.properties.c) || "etc",
        visited_at: new Date(st.start || first.ts).toISOString(),
        memo: (o.memos?.[st.id]) || null,
        is_public: !!o.isPublic && !!place,
        verification: first.gps ? "exif" : "manual",
      });
      if (!pin.ok) { out.failed.push({ what: st.id, why: pin.error }); continue; }
      out.pins++;
      LINKS["pin:stop:" + st.id] = pin.data.id; saveLinks();

      for (const sid of spaceIds) await insert("pin_spaces", { pin_id: pin.data.id, space_id: sid });

      /* 대표 1장만 — 첫 번째로 고른 사진이 대표다 */
      const rep = st.items.find((v) => v.id === picked[0]);
      const src = rep && o.srcOf && o.srcOf(rep);
      if (!src) continue;
      try {
        const blob = await (await fetch(src)).blob();
        const file = new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" });
        const up = await uploadPhoto(file);
        if (!up.ok) { out.failed.push({ what: st.id, why: up.why }); continue; }
        out.bytes += up.bytes;
        const m = await attachMedia(pin.data.id, up,
          { is_main: true, sort_order: 0,
            taken_at: new Date(rep.ts || Date.now()).toISOString() });
        if (m.ok) out.media++; else out.failed.push({ what: st.id, why: m.error });
      } catch (e) {
        out.failed.push({ what: st.id, why: String(e.message || e) });
      }
    }
    return Object.assign({ ok: out.failed.length === 0 }, out);
  }

  /* ── 서버에서 읽어 오기 (§13.24) ──────────────────────────────
     ★ 지금까지는 **올리기만** 했다. 그러면 기기를 바꾸는 순간 아무것도 안 보인다 —
       §13.21에서 말한 '반쪽'이 앱 전체 규모로 생긴다.
       올린 것이 다시 보이지 않으면, 사용자에게는 **올린 적이 없는 것**과 같다.

     ★ `geom` 은 GeoJSON 으로 온다 (`{type:'Point', coordinates:[lng,lat]}`).
       `media` 는 embed 로 같이 받는다 — 핀마다 따로 부르면 N+1 이 된다. */
  const PIN_COLS = "id,trip_id,place_id,geom,category,visited_at,memo,verification," +
                   "is_public,comment_count,media(url,width,height,is_main,sort_order)";

  async function myRecords(limit) {
    if (!SESSION.access_token) return { ok: false, via: "off", data: [] };
    return select("pins",
      `user_id=eq.${SESSION.user_id}&deleted_at=is.null&order=visited_at.desc` +
      `&limit=${limit || 200}&select=${PIN_COLS}`);
  }

  /* 모두의 지도 — 비로그인도 읽는다(§3).
     ★ 뷰포트를 모를 때만 쓴다(목록 화면 등). 지도는 pinsInBBox 를 쓴다 — 아래 참조. */
  async function publicRecords(limit) {
    return select("pins",
      `is_public=eq.true&deleted_at=is.null&order=visited_at.desc` +
      `&limit=${limit || 200}&select=${PIN_COLS}`);
  }

  /* ── 뷰포트로 잘라 읽기 (§13.31 · 031) ────────────────────────
     ★ 최근 200개를 읽던 방식은 두 가지가 동시에 틀렸다:
       ㉠ 서울을 보는데 제주 기록이 실려 온다 — 5만 개를 남한에 뿌리고 재보니
         **받은 300개 중 화면 안은 0개**였다.
       ㉡ 기록이 200개를 넘는 순간 오래된 곳이 지도에서 사라진다 —
         사용자에게는 자기가 올린 것이 없어진 것이다. §13.24 가 막으려던 바로 그 일이다.
     ★ 내 것과 공개 것을 **한 번에** 받는다. 따로 부르면 왕복이 두 번이고
       두 응답의 시점이 어긋나 지도가 깜빡인다.
     ★ `more` 는 개수가 아니라 "더 있다"는 사실이다 — 정확한 개수를 알려면
       뷰포트 전체를 세야 하는데, 그게 이 함수가 피하려는 일이다. */
  /* ★ `scope` 는 **무엇을 볼지**다 — 핀을 분류하는 값이 아니다(037).
     mine · shared · public 은 겹친다. 한 핀이 셋 모두에 있을 수 있다. */
  async function pinsInBBox(b, opts) {
    const o = opts || {};
    const r = await rpc("api_pins_in_bbox", {
      p_w: b.w, p_s: b.s, p_e: b.e, p_n: b.n,
      p_limit: o.limit || 300, p_cat: safeCat(o.cat), p_scope: o.scope || "all",
    });
    if (!r.ok) return { ok: false, via: "local", data: [], more: false };
    const rows = r.data || [];
    return { ok: true, via: "server", data: rows, more: !!(rows[0] && rows[0].more) };
  }

  async function myTrips() {
    if (!SESSION.access_token) return { ok: false, data: [] };
    return select("trips",
      `user_id=eq.${SESSION.user_id}&order=start_date.desc&limit=100&select=id,title,start_date,end_date`);
  }

  /* 서버 줄 → 화면이 쓰는 모양. **여기 한 곳에서만 바꾼다** —
     여러 곳에서 각자 바꾸면 필드 이름이 갈라진다(§13.17에서 겪었다). */
  function toFeature(r) {
    /* ★ 두 가지 모양이 들어온다: PostgREST 의 `geom`(GeoJSON) + embed 된 `media`,
       그리고 031 의 `lng/lat` + `media_url`. **여기서 하나로 만든다** —
       화면이 출처를 알게 하면 화면마다 분기가 생기고, 그게 필드 이름이 갈라지는 길이다. */
    const c = (r.geom && r.geom.coordinates)
           || (r.lng != null && r.lat != null ? [r.lng, r.lat] : null);
    if (!c) return null;
    const m = r.media_url ? { url: r.media_url, width: r.media_w, height: r.media_h }
      : (r.media || []).slice().sort((a, b) =>
          (b.is_main - a.is_main) || (a.sort_order - b.sort_order))[0];
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [c[0], c[1]] },
      properties: {
        n: r.memo ? r.memo.slice(0, 20) : "내 기록",
        c: r.category || "etc", rn: "", likes: 0,
        server: true, pinId: r.id, tripId: r.trip_id,
        mine: r.is_mine !== undefined ? !!r.is_mine : true, pub: !!r.is_public, au: "u1",
        /* 출처 배지 — 'mine' | 'shared' | 'other'. 한 핀에 배지는 하나다(037). */
        src: r.source || null,
        ver: r.verification === "live" ? "live" : "exif",
        photoUrl: m ? m.url : null,
        nu: 1, np: r.media_url ? 1 : (r.media || []).length,
        visitedAt: r.visited_at, memo: r.memo, comments: r.comment_count || 0,
      },
    };
  }

  /* ── 초대 링크 (§13.38 · 038) ────────────────────────────────
     ★ 미리보기는 **로그인 없이** 된다 — 무엇을 수락하는지 모르고 계정부터 만들게 하면
       허들을 낮춘 게 아니라 순서만 바꾼 것이다.
     ★ 합류는 계정이 필요하다(익명이라도). 그래서 여기서 **조용히 만든다** —
       사용자에게 회원가입을 묻지 않는다. 여러 사람이 보낸 링크가 한 계정에 쌓인다. */
  async function invitePreview(code) {
    const r = await rpc("api_invite_preview", { p_code: code });
    return r.ok ? r.data : { ok: false, why: "서버에 닿지 못했습니다" };
  }

  async function joinSpace(code) {
    if (!SESSION.access_token) {
      const a = await signInAnonymously();          // ★ 묻지 않고 만든다
      if (!a.ok) return { ok: false, why: a.why };
    }
    const r = await rpc("api_join_space", { p_code: code });
    return r.ok ? r.data : { ok: false, why: (r.error || "합류하지 못했습니다") };
  }

  /* 잘못 보낸 링크를 되돌린다 (owner 만) */
  async function rotateInvite(spaceId) {
    const r = await rpc("api_rotate_invite", { p_space: spaceId });
    return r.ok ? r.data : { ok: false, why: r.error };
  }

  /* 서버가 살아 있는지 — 화면 구석에 표시한다 */
  async function ping() {
    if (!ON) return { ok: false, via: "off", note: "anonKey 미설정 — 로컬 JSON으로 돕니다" };
    const r = await rpc("api_search", { p_q: "해운대", p_limit: 1 });
    return { ok: r.ok, via: r.via, note: r.ok ? "서버 연결됨" : (r.error || "연결 실패") };
  }

  window.API = Object.assign(API, { rpc, search, candidates, flushCoverEvents, ping,
    safeCat, PIN_CATEGORY, signInAnonymously, refresh, clearSession, session: SESSION,
    insert, select, addComment, listComments, links: LINKS,
    shrink, uploadPhoto, attachMedia, ensurePin, ensureSpace, pushTrip,
    myRecords, publicRecords, pinsInBBox, myTrips, toFeature,
    invitePreview, joinSpace, rotateInvite });
})();
