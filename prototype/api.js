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

  /* 서버가 살아 있는지 — 화면 구석에 표시한다 */
  async function ping() {
    if (!ON) return { ok: false, via: "off", note: "anonKey 미설정 — 로컬 JSON으로 돕니다" };
    const r = await rpc("api_search", { p_q: "해운대", p_limit: 1 });
    return { ok: r.ok, via: r.via, note: r.ok ? "서버 연결됨" : (r.error || "연결 실패") };
  }

  window.API = Object.assign(API, { rpc, search, candidates, flushCoverEvents, ping,
    safeCat, PIN_CATEGORY, signInAnonymously, refresh, clearSession, session: SESSION });
})();
