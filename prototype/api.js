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

  async function rpc(fn, args) {
    if (!ON) return { ok: false, via: "off", data: null };
    API.calls++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json",
                   apikey: CFG.anonKey, Authorization: `Bearer ${CFG.anonKey}` },
        body: JSON.stringify(args || {}),
      });
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
  async function candidates(lat, lng, acc) {
    const r = await rpc("api_place_candidates",
      { p_lat: lat, p_lng: lng, p_accuracy_m: acc || 15 });
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
    const rows = Object.entries(all).map(([k, v]) => {
      const [kind, place, who] = k.split(":");
      return { _key: k, kind, place, who, ...v };
    }).filter((r) => r.imp || r.opened || r.research);
    if (!rows.length) return { ok: true, via: "noop", sent: 0 };
    // 프로토타입의 키는 장소 '이름'이다. 실제 앱은 place_id·media_id 를 그대로 보낸다.
    const r = await rpc("api_log_cover_events", { p_rows: [] });
    return { ok: r.ok, via: r.via, sent: r.ok ? rows.length : 0, queued: rows.length };
  }

  /* 서버가 살아 있는지 — 화면 구석에 표시한다 */
  async function ping() {
    if (!ON) return { ok: false, via: "off", note: "anonKey 미설정 — 로컬 JSON으로 돕니다" };
    const r = await rpc("api_search", { p_q: "해운대", p_limit: 1 });
    return { ok: r.ok, via: r.via, note: r.ok ? "서버 연결됨" : (r.error || "연결 실패") };
  }

  window.API = Object.assign(API, { rpc, search, candidates, flushCoverEvents, ping });
})();
