/* =====================================================================
   탭2 `갈 곳` — 피드 (PLAN §12.10)

   ★ 단위는 **사진이 아니라 장소**다. 인스타의 단위는 게시물(사람 중심)이라
     사진이 없으면 카드가 없다. 우리는 장소가 단위라 **사진이 0장이어도 카드가 남는다.**
     그래서 첫날(사용자 콘텐츠 0)에도 화면이 찬다.

   ★ 무한 피드가 아니라 **이유가 붙은 묶음**이다.
     추천 모델이 없어서가 아니라, 설명할 수 있는 추천이 블랙박스보다 신뢰를 얻기 때문이다.
     묶음마다 "왜 떴는지" 한 줄을 붙인다.

   ★ 자격 규칙(§12.16): 관광공사가 고른 곳은 첫날부터, 상가업소는 사진이 붙었을 때만.
     씨앗 파일이 이미 그렇게 걸러져 있다 — 편의점은 여기 없다.
   ===================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  const CAT = { heritage: "문화재", nature: "자연", beach: "해변", activity: "액티비티",
                event: "행사", food: "맛집", cafe: "카페", stay: "숙소" };
  /* `rails`: 서버(056)가 정한 묶음. 못 받으면 null 이고, 그때만 아래 로컬 로직이 돈다.
     `src`: 지금 무엇으로 그리고 있는지 — 화면에 적는다(§13.82). */
  const FD = { seed: [], rails: null, src: "seed", cpt: null, ready: false };

  /* ── 표지는 **주어지지 않는다. 이긴다.** (§12.25-A 수정) ─────────
     처음엔 *"사용자 사진이 있으면 무조건 표지"* 로 만들었다. 그건 경쟁이 아니라
     **저울에 손을 얹은 것**이다. 흔들린 스냅 한 장이 잘 찍힌 기관 사진을 이기면
     화면이 나빠지고, 한 번 표지가 된 사진은 영영 안 바뀐다 — 되먹임이 없다.

     → 후보(기관 사진 + 그 장소의 사용자 기록들)가 **같은 자로 겨룬다.**
       기관 사진도 질 수 있고 이길 수도 있다. 그게 공정한 규칙이다.

     ★ 누적이 아니라 **노출 대비**로 잰다. 오래 걸려 있었다는 이유로 이기면 안 된다.
     ★ Wilson 신뢰구간 하한을 쓴다. 10번 보고 10번 눌린 사진이
       1000번 보고 900번 눌린 사진을 이기면 안 된다 — 표본이 적으면 점수를 깎는다.
       콜드 스타트를 따로 처리할 필요가 이 한 식으로 사라진다.
     ★ 그래도 **새 후보는 노출 자체가 없어** 영원히 못 올라온다. 그래서 탐색 칸을 준다.

     실제 앱의 재료: `reactions(kind)` + 노출/열람 로그. 지금은 씨앗으로 흉내 낸다. */
  const SIG = { like: 1, save: 3, open: 0.4, research: -2 };  // 저장이 가장 강한 의도다
  const MIN_IMP = 50;        // 이만큼 보여주기 전에는 '심사 중'
  const EXPLORE_EVERY = 4;   // 네 칸에 한 칸은 도전자에게 준다

  /* Wilson 하한 (95%) — 표본이 적으면 점수가 보수적으로 깎인다 */
  function wilson(pos, n) {
    if (n <= 0) return 0;
    const z = 1.96, p = Math.max(0, Math.min(1, pos / n));
    const d = 1 + z * z / n;
    return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d;
  }
  /* ★ 씨앗은 출발선일 뿐이다. **실제로 관측된 것이 위에 얹힌다.**
     사용자가 쓰기 시작하면 씨앗의 영향은 점점 묻힌다. */
  function merged(cand) {
    const s = cand.stat, o = (window.LOG ? LOG.stat(cand.key) : null);
    if (!o) return s;
    return { imp: s.imp + o.imp, like: s.like + o.like, save: s.save + o.save,
             open: s.open + o.open, research: s.research + o.research };
  }
  function scoreOf(st) {
    const pos = st.like * SIG.like + st.save * SIG.save
              + st.open * SIG.open + st.research * SIG.research;
    return wilson(Math.max(0, pos), Math.max(st.imp, pos));
  }

  /* 후보별 반응 — 실제 앱은 서버가 준다. 여기서는 씨앗에서 **결정적으로** 만든다
     (난수를 쓰면 다시 그릴 때마다 표지가 바뀌어 검증을 못 한다) */
  const STAT = new Map();
  function statOf(key, seedN) {
    if (STAT.has(key)) return STAT.get(key);
    const h = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, seedN >>> 0);
    /* ★ 노출 기준값을 후보 종류마다 다르게 줬다가 **반대쪽에 손을 얹은 꼴**이 됐다
       (기관 400 · 사람 120 → 399곳 중 398곳을 기관이 이김).
       자가 한쪽으로 기울면 그건 점수가 아니다. **모두 같은 범위**에서 시작한다. */
    const fresh = h % 5 === 0;                 // 다섯에 하나는 갓 올라온 사진이다
    const imp = fresh ? 4 + (h % 40) : 200 + (h % 900);
    const st = { imp,
      like: Math.round(imp * ((h >> 3) % 22) / 100),
      save: Math.round(imp * ((h >> 7) % 9) / 100),
      open: Math.round(imp * ((h >> 11) % 30) / 100),
      research: Math.round(imp * ((h >> 15) % 4) / 100) };
    STAT.set(key, st);
    return st;
  }

  function pois() { try { return (poi && poi.features) || []; } catch (e) { return []; } }
  function handleOf(au) { try { return (USER[au].handle || "").replace("@", "") || "someone"; }
                          catch (e) { return "someone"; } }

  /* 한 장소의 후보 전부 — 기관 사진 1장 + 사용자 공개 기록들 */
  const CAND = { map: new Map(), built: false };
  function buildCands() {
    CAND.map.clear();
    const pick = (window.__my && window.__my.mainPick) || {};
    /* 사용자 후보. ★ 이름이 정확히 같을 때만 잇는다 — 좌표 근접으로 이어 봤더니
       `망상 해수욕장` ↔ `베이커리카페 클램`(130m)이 같은 곳이 됐다(§10 '옆 가게').
       실제 앱은 `pins.place_id` 로 정확히 이어져 이 문제가 없다. */
    pois().forEach((f) => {
      const p = f.properties;
      if (!p.pub) return;
      const who = handleOf(p.au);
      (CAND.map.get(p.n) || CAND.map.set(p.n, []).get(p.n))
        .push({ kind: "user", img: p.imgi, by: "@" + who, mine: !!p.mine,
                key: "u:" + p.n + ":" + p.au, stat: statOf("u:" + p.n + ":" + p.au, p.likes || 0) });
      // 사용자 후보는 아직 서버 미디어가 아니다 — place_id 는 표지가 기관일 때만 쓴다
    });
    // 마이에서 고른 대표 픽은 **그 사람의 대표 후보**로 들어간다 — 이긴다는 뜻은 아니다
    (window.UP ? UP.album : []).forEach((x) => {
      if (!x.poi || !x.gps) return;
      const n = x.poi.properties.n;
      if (String(pick[n]) !== String(x.id)) return;
      const arr = CAND.map.get(n) || CAND.map.set(n, []).get(n);
      arr.unshift({ kind: "user", img: x.img, by: "@minji", mine: true, myPick: true,
                    key: "m:" + n, stat: statOf("m:" + n, 7) });
    });
    CAND.built = true;
  }

  function coverOf(x, idx) {
    if (!CAND.built) buildCands();
    /* ★ 기관 사진 후보의 키를 **서버 place_id** 로 바꿨다.
       전에는 장소 **이름**이라 서버로 보낼 수가 없었다(§13.19 `no-id`) —
       이름으로 맞추려면 46만 곳을 뒤져야 하고 동명이인 문제도 있다.
       씨앗을 뽑을 때 id 를 안 담은 것이 원인이었고, 내보내기를 스크립트로
       만들면서 같이 고쳤다(`db/export/feed_seed.sh`). */
    const agency = { kind: "agency", img: null, src: x.thumb || x.img, by: "한국관광공사",
                     key: x.id ? "a:" + x.id : "a:" + x.n, placeId: x.id || null,
                     stat: statOf("a:" + (x.id || x.n), 11) };
    const all = [agency, ...(CAND.map.get(x.n) || [])];
    all.forEach((c) => { c.live = merged(c); c.score = scoreOf(c.live); });

    const ready = all.filter((c) => c.live.imp >= MIN_IMP);
    const rookies = all.filter((c) => c.live.imp < MIN_IMP);
    let win = ready.sort((a, b) => b.score - a.score)[0] || all[0];
    let trial = false;
    // 탐색 — 노출이 모자란 후보는 네 칸에 한 칸씩 자리를 받는다. 안 그러면 영영 못 올라온다.
    if (rookies.length && idx % EXPLORE_EVERY === 0) { win = rookies[0]; trial = true; }

    const st = win.live;
    const why = trial ? "심사 중"
      : win.save >= 0 && st.save ? `저장 ${st.save}` : `♥ ${st.like}`;
    return { src: win.src || photoSrc(win.img), by: win.by, user: win.kind === "user",
             why, trial, score: win.score, key: win.key, placeId: x.id || null };
  }
  /* 씨앗 전체에서 사람 사진이 표지를 가져간 곳의 수 — **이겨서** 가져간 수다 */
  function userCoverCount() {
    if (!CAND.built) buildCands();
    let n = 0;
    FD.seed.forEach((x, i) => { if (coverOf(x, 1).user) n++; });   // idx=1 → 탐색 칸 제외
    return n;
  }
  window.__userCoverCount = userCoverCount;
  window.__coverOf = coverOf;
  window.__candCount = (n) => { if (!CAND.built) buildCands(); return (CAND.map.get(n) || []).length; };
  /* 재검색 감점은 **지금 표지를 걸고 있는 후보**에게 간다 — 답을 못 준 것이 그 카드다 */
  window.__coverKeyOf = (placeName) => {
    const x = FD.seed.find((s) => s.n === placeName);
    return x ? coverOf(x, 1).key : "a:" + placeName;
  };

  const R = 6371000;
  function distM(a, b) {
    const t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // 차로 몇 분쯤 — 직선거리에 1.4를 곱하고 시속 60km로 본다. 정확한 값이 아니라 **감각**이다.
  function driveMin(m) { return Math.round((m * 1.4 / 1000) / 60 * 60); }
  function humanTime(m) {
    const t = driveMin(m);
    return t < 60 ? `차로 ${t}분` : `차로 ${Math.floor(t / 60)}시간 ${t % 60 ? (t % 60) + "분" : ""}`.trim();
  }
  function here() {
    try { if (window.map && map.getCenter) { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; } } catch (e) {}
    return { lat: 37.5665, lng: 126.9780 };
  }
  // PHOTOS 는 index.html 의 top-level `let` — window 에 붙지 않으므로 전역 렉시컬로 읽는다
  function photoSrc(i) { try { return PHOTOS[i] || ""; } catch (e) { return ""; } }
  // §12.14 — 지도에서 보던 지역이 피드의 기본 필터다. 지역을 **다시 고르라고 묻지 않는다.**
  // 탭을 옮겼다고 맥락이 끊기면, 사용자는 같은 선택을 두 번 하게 된다.
  function hereRegion() {
    try {
      const c = map.getCenter(), p = map.project(c);
      const f = map.queryRenderedFeatures(p, { layers: ["region-base", "region-unvisited"] })[0];
      return f ? f.properties.name : null;
    } catch (e) { return null; }
  }

  const ymd = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;

  /* ── 서버 행을 **씨앗과 같은 모양**으로 (§13.82) ─────────────────
     ★ 아래 `coverOf`·`card`·`uismoke` 가 전부 씨앗 모양을 보고 있다.
       모양을 바꾸면 그 셋을 다 고쳐야 하고, 그중 하나를 빠뜨리면 조용히 깨진다.
       **들어오는 자리에서 한 번 바꾼다** — 경계에서 바꾸면 안쪽은 그대로다
       (§13.x 의 `absorbUser` 와 같은 수법이다). */
  function fromServer(r) {
    return { id: r.place_id, n: r.name, c: r.category, cpt: null,
             img: r.image_url || "", thumb: r.thumb_url || r.image_url || "",
             evs: r.event_start || null, eve: r.event_end || null,
             lng: r.lng, lat: r.lat, rg: r.region_name || "", rc: null,
             _dist: r.dist_m, _rail: r.rail };
  }

  /* ④ 다시 가보기 — 내 앨범에서 **오늘과 같은 월·일**. 남의 콘텐츠가 0이어도 작동한다.
     ★ 이것만은 **서버가 못 준다** — 내 앨범은 기기에만 있다. 그래서 두 갈래가 같이 쓴다. */
  function againRail() {
    const now = new Date();
    const md = (d) => `${d.getMonth()}-${d.getDate()}`;
    /* ★ 한 장소에서 다섯 장을 찍었다고 카드 다섯 장이 되면 안 된다 — 장소당 한 장이다. */
    const seenPlace = new Set();
    return (window.UP ? UP.album : []).filter((x) => x.gps && x.poi)
      .filter((x) => md(new Date(x.ts)) === md(now) || now - x.ts > 300 * 864e5)
      .sort((a, b) => a.ts - b.ts)
      .filter((x) => !seenPlace.has(x.poi.properties.n) && seenPlace.add(x.poi.properties.n))
      .slice(0, 12);
  }

  /* ── 묶음 ─────────────────────────────────────────────────── */
  function rails() {
    /* ★ 서버가 묶음을 정했으면 **다시 정하지 않는다**(§13.82).
       여기에 같은 규칙을 한 벌 더 두면 두 화면이 언젠가 다른 말을 한다 —
       `아직 안 가본 곳` 이 특히 그렇다: 서버는 내 핀을 보고 빼지만
       여기 로직은 앨범의 지역 이름을 추측해서 뺀다. 둘이 같을 리 없다. */
    if (FD.rails) {
      const by = (k) => FD.rails.filter((x) => x._rail === k);
      const mine = againRail();
      return [
        by("live").length && { k: "live", t: "지금 하는 행사", why: `오늘 열려 있는 곳 ${by("live").length}곳`, items: by("live") },
        by("soon").length && { k: "soon", t: "곧 시작합니다", why: "날짜가 잡힌 행사", items: by("soon") },
        by("near").length && { k: "near", t: "여기서 가까운", why: (hereRegion() ? `지도에서 보던 ${hereRegion()} 기준` : "지도에서 보던 자리 기준") + " · 가까운 순", items: by("near") },
        by("unseen").length && { k: "unseen", t: "아직 안 가본 곳", why: "내 기록이 없는 곳 — 지역마다 하나씩", items: by("unseen") },
        mine.length && { k: "again", t: "다시 가보기", why: "예전에 갔던 자리 — 내 기록입니다", mine },
      ].filter(Boolean);
    }
    const seed = FD.cpt ? FD.seed.filter((x) => x.cpt === FD.cpt) : FD.seed;
    const now = new Date(), today = now.toISOString().slice(0, 10);
    const c = here();
    const near = (a) => distM(c, { lat: a.lat, lng: a.lng });

    // ① 지금 가면 — 진행 중이거나 곧 시작하는 행사. 끝난 축제는 정보가 아니라 소음이다.
    const live = seed.filter((x) => x.evs && x.evs <= today && (x.eve || x.evs) >= today)
                     .sort((a, b) => near(a) - near(b));
    const soon = seed.filter((x) => x.evs && x.evs > today).sort((a, b) => a.evs.localeCompare(b.evs));

    // ② 여기서 가까운
    const close = seed.slice().sort((a, b) => near(a) - near(b));

    // ③ 아직 안 가본 곳 — 내 기록이 있는 지역을 뺀다.
    //    ★ 여기서 '가까운 순'으로 뽑으면 ②와 같은 카드가 그대로 나온다. 실제로 그랬다.
    //      두 묶음이 똑같으면 하나보다 나쁘다 — 화면만 길어지고 고를 건 안 늘어난다.
    //      안 가본 곳의 값어치는 근접성이 아니라 **발견**이니, 지역마다 한 곳씩 흩는다.
    const visited = new Set((window.UP ? UP.album : [])
      .map((x) => x.poi && x.poi.properties.rn).filter(Boolean));
    const nearIds = new Set(close.slice(0, 12).map((x) => x.n));
    const notVisited = close.filter((x) => x.rg && !nearIds.has(x.n)
      && ![...visited].some((v) => x.rg.endsWith(v)));
    const perRegion = new Set();
    const unseen = notVisited.filter((x) => !perRegion.has(x.rg) && perRegion.add(x.rg));

    const mine = againRail();

    return [
      live.length && { k: "live", t: "지금 하는 행사", why: `오늘 열려 있는 곳 ${live.length}곳`, items: live.slice(0, 12) },
      soon.length && { k: "soon", t: "곧 시작합니다", why: "날짜가 잡힌 행사", items: soon.slice(0, 12) },
      { k: "near", t: "여기서 가까운", why: (hereRegion() ? `지도에서 보던 ${hereRegion()} 기준` : "지도에서 보던 자리 기준") + " · 가까운 순", items: close.slice(0, 12) },
      unseen.length && { k: "unseen", t: "아직 안 가본 곳", why: `내 기록이 없는 지역 ${unseen.length}곳 — 지역마다 하나씩`, items: unseen.slice(0, 12) },
      mine.length && { k: "again", t: "다시 가보기", why: "예전에 갔던 자리 — 내 기록입니다", mine: mine.slice(0, 12) },
    ].filter(Boolean);
  }

  /* ── 카드 ─────────────────────────────────────────────────── */
  function card(x, idx) {
    const c = here(), d = distM(c, { lat: x.lat, lng: x.lng });
    const ev = x.evs ? `<span class="fdWhen">${x.evs.slice(5).replace("-", ".")}${x.eve && x.eve !== x.evs ? "–" + x.eve.slice(5).replace("-", ".") : ""}</span>` : "";
    const cv = coverOf(x, idx || 0);
    return `
      <article class="fdCard${cv.user ? " byUser" : ""}${cv.trial ? " trial" : ""}"
               data-name="${esc(x.n)}" data-ck="${esc(cv.key)}" data-place="${esc(x.n)}"
               data-pid="${esc(x.id || "")}">
        <div class="fdImg"><img src="${esc(cv.src)}" alt="" loading="lazy" data-cover>
          <span class="fdBy${cv.user ? " user" : ""}${cv.trial ? " trial" : ""}"
            >${esc(cv.by)}<i>${esc(cv.why)}</i></span></div>
        <div class="fdBody">
          <b>${esc(x.n)}</b>
          <small>${CAT[x.c] || x.c}${x.cpt ? " · " + esc(x.cpt) : ""} · ${esc((x.rg || "").split(" ").slice(-1)[0])}</small>
          <div class="fdFoot">${ev}<span class="fdDist">${humanTime(d)}</span></div>
        </div>
      </article>`;
  }
  function mineCard(x) {
    const d = new Date(x.ts);
    return `
      <article class="fdCard mine byUser" data-view="${esc(x.poi.properties.n)}"
               data-ck="m:${esc(x.poi.properties.n)}" data-place="${esc(x.poi.properties.n)}">
        <div class="fdImg"><img src="${photoSrc(x.img)}" alt="" loading="lazy">
          <span class="fdBy user">@minji<i>내 기록</i></span></div>
        <div class="fdBody">
          <b>${esc(x.poi.properties.n)}</b>
          <small>${ymd(d)} · 내 기록</small>
          <div class="fdFoot"><span class="fdAgo">${Math.max(1, Math.round((Date.now() - x.ts) / 365 / 864e5))}년 전</span></div>
        </div>
      </article>`;
  }

  function render() {
    const cpts = [...new Set(FD.seed.map((x) => x.cpt).filter(Boolean))];
    $("#fdBody").innerHTML = `
      <div class="fdHead">갈 곳
        <small>왜 떴는지 묶음마다 적어 둡니다 — 우리 추천은 설명할 수 있어야 합니다.
          <b>사람이 올린 사진이 있으면 그 사진이 표지가 됩니다.</b></small></div>
      <div class="fdCpts">
        <button class="fdCpt${FD.cpt ? "" : " on"}" data-cpt="">전체</button>
        ${cpts.map((c) => `<button class="fdCpt${FD.cpt === c ? " on" : ""}" data-cpt="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
      ${rails().map((r) => `
        <section class="fdRail">
          <div class="fdRailHead"><b>${esc(r.t)}</b><small>${esc(r.why)}</small></div>
          <div class="fdRow">${(r.mine ? r.mine.map(mineCard) : r.items.map((it, i) => card(it, i))).join("")}</div>
        </section>`).join("")
      || `<div class="fdEmpty">이 컨셉에 맞는 곳이 없습니다.</div>`}
      <div class="fdCredit">표지는 <b>반응으로 정해집니다</b> — 노출 대비 저장·좋아요·열람으로
        겨루고, 기관 사진도 집니다. 지금 사람 사진이 이긴 곳 <b>${userCoverCount()}곳</b>.
        노출이 모자란 후보는 <b>심사 중</b>으로 네 칸에 한 칸씩 올라옵니다.<br>
        장소·사진 출처 <b>한국관광공사</b> · 경계 © OpenStreetMap contributors</div>`;
    // ★ 그린 직후에 관찰을 건다. 노출은 여기서 세는 게 아니라 **보일 때** 세진다.
    if (window.LOG) LOG.watch($("#fdBody"));
  }

  /* ── 탭 ───────────────────────────────────────────────────── */
  function show(on) {
    $("#fdPanel").classList.toggle("on", on);
    if (on) {
      $("#spPanel") && $("#spPanel").classList.remove("on");
      CAND.built = false;   // 마이에서 대표 픽을 바꿨을 수 있다 — 들어올 때마다 다시 짠다
      render();
    }
  }

  window.initFeed = async function () {
    document.body.appendChild(el(`<div id="fdPanel" class="glass"><div id="fdBody"></div></div>`));
    // 탭바는 spaces.js가 만든다. 지도 다음 자리에 끼워 넣는다.
    const tb = $("#tabbar");
    if (tb) {
      const b = el(`<button data-tab="feed">🧭<span>갈 곳</span></button>`);
      tb.insertBefore(b, tb.children[1]);
      tb.addEventListener("click", (e) => {
        const t = e.target.closest("button"); if (!t) return;
        show(t.dataset.tab === "feed");
        if (t.dataset.tab === "feed")
          document.querySelectorAll("#tabbar button").forEach((x) => x.setAttribute("aria-pressed", x === t));
      });
    }
    /* ★ 관광공사 이미지 URL 중 일부는 404다. 깨진 표지는 카드가 없는 것보다 나쁘다 —
       §12.16이 *"사진 없는 곳은 애초에 후보가 아니다"* 라고 정했으니 같은 규칙을 적용해
       **받아 보고 실패하면 그 카드를 내린다.** (capture: load/error 는 버블링하지 않는다) */
    $("#fdBody").addEventListener("error", (e) => {
      const img = e.target.closest("img[data-cover]");
      if (!img) return;
      const card = img.closest(".fdCard");
      if (card) card.remove();
    }, true);

    $("#fdBody").addEventListener("click", (e) => {
      const c = e.target.closest("[data-cpt]");
      if (c) { FD.cpt = c.dataset.cpt || null; return render(); }
      const v = e.target.closest("[data-view]");
      if (v && window.screenViewer) {
        const c = v.closest("[data-ck]");
        if (c && window.LOG) LOG.open(c.dataset.ck, c.dataset.place || "");
        return screenViewer(v.dataset.view, {});
      }
      const card = e.target.closest(".fdCard");
      if (card && card.dataset.ck && window.LOG) LOG.open(card.dataset.ck, card.dataset.place || "");
      /* ★ 장소 상세는 **앱에 생겼다**(§13.91 · `rn-bench/src/PlaceSheet.tsx`).
           여기는 아직 자리만 잡아 둔다 — 같은 화면을 두 벌 쓰면 언젠가 둘이
           갈라진다(§13.37 에서 지도로 겪은 것과 같다). 옮길 때 한 번에 옮긴다.
         ★ 다만 **약속을 고친다.** 예전 문구는 `· 저장` 을 적어 놨는데 저장을 담을
           표(`place_saves`)가 없어 앱에도 그 버튼이 없다. 시안이 없는 기능을
           광고하면 그 시안을 보고 만든 화면에 죽은 버튼이 생긴다. */
      if (card && card.dataset.name) return alert(
        `${card.dataset.name}\n\n앱에서는 여기서 장소 상세가 열립니다.\n` +
        `· 이 장소의 사진(찍은 사람과 함께)\n· 내가 몇 번 갔는지\n· 지도에서 보기\n\n` +
        `저장은 아직 없습니다 — 담을 곳을 만들고 붙입니다.`);
    });
    await loadFeed();
  };
  /* ── 무엇으로 그릴지 (§13.82) ───────────────────────────────────
     ★ **서버를 먼저 본다.** 465,914곳 · 실제 행사 기간 · 내 핀을 뺀 `안 가본 곳` —
       씨앗(9,696곳 · 2026-09 스냅샷)으로는 못 하는 것들이다.
     ★ 그래도 **씨앗을 지우지 않는다.** `config.js` 가 적어 둔 원칙이다:
         *"서버가 없다고 화면이 죽으면 안 된다 — 프로토타입의 값어치는 항상 도는 것이다."*
       비행기 안에서도, 키를 안 넣은 사람 손에서도 돌아야 한다.
       ★ RN 앱에서는 **반대로** 씨앗을 걷어냈다(§13.81). 거기서는 로컬 폴백이
         *"출시하면 안 도는 화면"* 을 가려 주는 가면이었기 때문이다.
         **같은 파일이 한쪽에서는 안전망이고 다른 쪽에서는 가면이다.**
     ★ `coverOf`·`uismoke` 는 씨앗 모양만 보므로 **어느 쪽이든 그대로 돈다.** */
  async function loadFeed(opts) {
    opts = opts || {};
    const c = here();
    try {
      /* ★ `seedOnly` — **uismoke 가 쓴다.** 표지 경쟁(§13.8)의 검증은 씨앗이
         흉내 낸 반응 위에서만 할 수 있다: 사용자 후보는 데모 POI 의 **이름**으로
         이어지는데 서버 장소는 이름이 다르다. 그래서 서버 데이터에서는
         `__userCoverCount()` 가 0 이 되고, 그건 **버그가 아니라 다른 질문**이다.
         (실제 경쟁은 029 가 서버에서 한다. 아직 로그가 없을 뿐이다.)
         검증 대상과 데이터가 어긋나면 통과해도 아무것도 증명하지 못한다. */
      const rows = (!opts.seedOnly && window.API && API.feedRails)
        ? await API.feedRails(c.lat, c.lng, { limit: 12 }) : null;
      if (rows && rows.length) {
        FD.rails = rows.map(fromServer);
        /* 같은 곳이 두 묶음에 들어갈 수 있다(행사는 '지금'과 '가까운'에 함께 든다).
           `seed` 는 **장소 목록**이므로 중복을 없앤다 — coverOf 가 장소 단위다. */
        const seen = new Set();
        FD.seed = FD.rails.filter((x) => !seen.has(x.id) && seen.add(x.id));
        FD.src = "server"; FD.ready = true;
        console.log("[feed] 서버", FD.rails.length, "행 ·", FD.seed.length, "곳");
        return;
      }
    } catch (e) { console.warn("[feed] 서버 실패 → 씨앗", e); }
    try {
      FD.seed = await (await fetch("feed-seed.json")).json();
      FD.rails = null; FD.src = "seed"; FD.ready = true;
      console.log("[feed] 씨앗", FD.seed.length.toLocaleString(), "곳");
    } catch (e) { console.warn("[feed] feed-seed.json 없음", e); }
  }
  window.__loadFeed = loadFeed;

  window.__feed = FD;
})();
