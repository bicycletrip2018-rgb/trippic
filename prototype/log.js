/* =====================================================================
   노출 · 열람 · 재검색 로깅 (§13.9)

   §13.8의 표지 경쟁은 **노출 대비 반응**으로 점수를 낸다. 그 분모가 없으면
   로직이 아예 못 돈다. 여기서 그 분모와 분자를 실제로 센다.

   ★ 가장 중요한 결정: **노출은 '그려졌다'가 아니라 '보였다'다.**
     가로 묶음은 화면 밖 카드까지 전부 DOM에 그린다. 그걸 노출로 세면
     분모가 뻥튀기돼 **모든 점수가 0에 수렴하고 순위가 뒤집힌다.**
     → 화면에 절반 이상이 **0.5초 넘게** 머물렀을 때만 1회.

   ★ 열람은 노출의 부분집합이어야 한다 — 안 본 것을 열 수는 없다.
     열람이 먼저 들어오면 노출도 같이 채운다. 안 그러면 비율이 1을 넘는다.

   ★ 개인정보를 남기지 않는다. 좌표도 닉네임도 안 넣는다.
     후보 키와 **숫자만** 남긴다 (§10 `home_geom` 원칙과 같다).
   ===================================================================== */
(function () {
  const KEY = "trippic.log.v1";
  const SEEN_MS = 500;      // 이만큼 머물러야 '봤다'
  const SEEN_RATIO = 0.5;   // 절반 이상 보여야
  const RESEARCH_WIN = 30 * 60e3;   // 본 뒤 30분 안에 다시 찾으면 '답을 못 준 것'

  const L = {
    stat: {},        // key -> {imp, open, like, save, research}
    lastSeen: {},    // 장소명 -> 마지막으로 본 시각 (재검색 판정용)
    session: new Set(),   // 이번 세션에 이미 센 노출 (스크롤로 들락날락해도 1회)
    io: null,
    timers: new Map(),
  };

  const blank = () => ({ imp: 0, open: 0, like: 0, save: 0, research: 0 });
  const row = (k) => (L.stat[k] ||= blank());

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ stat: L.stat, lastSeen: L.lastSeen })); }
    catch (e) { /* 사파리 프라이빗 등 — 로그가 없어도 화면은 돌아야 한다 */ }
  }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (v.stat) L.stat = v.stat;
      if (v.lastSeen) L.lastSeen = v.lastSeen;
    } catch (e) {}
  }
  load();

  /* ── 노출 ─────────────────────────────────────────────────── */
  function impression(key, place) {
    if (!key || L.session.has(key)) return false;
    L.session.add(key);
    row(key).imp++;
    if (place) L.lastSeen[place] = Date.now();
    save();
    return true;
  }

  /* ── 열람 — 노출보다 먼저 들어오면 노출도 채운다 ─────────────── */
  function open(key, place) {
    if (!key) return;
    const r = row(key);
    if (!L.session.has(key)) { L.session.add(key); r.imp++; }
    r.open++;
    if (place) L.lastSeen[place] = Date.now();
    save();
  }

  /* ── 좋아요 · 저장 ────────────────────────────────────────── */
  function react(key, kind) {
    if (!key || (kind !== "like" && kind !== "save")) return;
    row(key)[kind]++;
    save();
  }
  function unreact(key, kind) {
    if (!key) return;
    const r = row(key);
    r[kind] = Math.max(0, r[kind] - 1);
    save();
  }

  /* ── 재검색 ───────────────────────────────────────────────────
     ★ 단순히 "검색했다"가 아니다. **최근에 카드로 보여 줬는데도 다시 찾았을 때**만이
       우리 잘못이다. 처음 검색하는 사람에게 감점을 매기면 신호가 아니라 잡음이다. */
  function research(place, keyOf) {
    const t = L.lastSeen[place];
    if (!t || Date.now() - t > RESEARCH_WIN) return false;
    const k = keyOf ? keyOf(place) : null;
    if (!k) return false;
    row(k).research++;
    save();
    return true;
  }

  /* ── 화면에 실제로 보였는지 지켜본다 ──────────────────────────── */
  function ensureIO() {
    if (L.io || typeof IntersectionObserver === "undefined") return L.io;
    L.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const el = e.target, key = el.dataset.ck;
        if (e.isIntersecting && e.intersectionRatio >= SEEN_RATIO) {
          if (L.timers.has(el)) continue;
          L.timers.set(el, setTimeout(() => {
            L.timers.delete(el);
            impression(key, el.dataset.place || "");
          }, SEEN_MS));
        } else {
          clearTimeout(L.timers.get(el));
          L.timers.delete(el);
        }
      }
    }, { threshold: [0, SEEN_RATIO, 1] });
    return L.io;
  }

  /* root 안의 후보들을 지켜본다. 다시 그릴 때마다 부르면 된다 —
     옛 노드는 GC와 함께 사라지므로 따로 해제할 필요가 없다. */
  function watch(root) {
    const io = ensureIO();
    if (!io || !root) return 0;
    const els = root.querySelectorAll("[data-ck]");
    els.forEach((el) => io.observe(el));
    return els.length;
  }

  window.LOG = {
    impression, open, react, unreact, research, watch,
    stat: (k) => L.stat[k] || blank(),
    all: () => L.stat,
    /* 실제 앱은 여기서 서버로 보낸다. 보내는 것은 **키와 숫자뿐**이다. */
    flush: () => { const s = L.stat; return { rows: Object.keys(s).length, sample: s }; },
    /* ★ 비울 때는 관찰자도 다시 건다. IntersectionObserver 는 **상태가 바뀔 때만** 부르므로,
       이미 화면에 걸려 있던 카드는 비운 뒤에도 영영 다시 안 세진다 (실제로 0장이 나왔다). */
    reset: () => {
      L.stat = {}; L.lastSeen = {}; L.session.clear();
      L.timers.forEach((t) => clearTimeout(t)); L.timers.clear();
      if (L.io) { L.io.disconnect(); L.io = null; }
      save();
    },
    _internal: L,
  };
})();
