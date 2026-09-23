/* =====================================================================
   탭3 `소식` — 피드형 홈 (PLAN §12.21)

   ★ 페이스북 홈처럼 "계속 올라오는" 화면이되, **팔로우 그래프를 만들지 않는다.**
     팔로우를 넣으면 피드가 '지인 소식'이 되고 장소 축이 흐려진다(§12.6).
     대신 포스트마다 **왜 내게 보이는지**가 한 줄로 설명된다. 설명할 수 없으면 안 띄운다.

   ★ 공급이 0이어도 빈 화면이 아니다(§12.7).
     남이 아무것도 안 올려도 **내 N년 전 오늘**은 첫날부터 있다.

   ★ 댓글은 없다. 운영자가 0명인데 모더레이션 비용을 만들지 않는다(§12.6).
     좋아요·저장까지만 한다.

   ★ 스페이스는 사라지지 않았다. 여기 상단 칩이 곧 스페이스이고,
     `[스페이스 열기]`가 기존 화면(spaces.js)을 그대로 연다.
   ===================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  function photoSrc(i) { try { return PHOTOS[i] || ""; } catch (e) { return ""; } }

  const PAGE = 6;                       // 한 번에 그리는 포스트 수
  const HM = { posts: [], shown: 0, filter: null, like: new Set(), save: new Set(), built: false };

  /* 누가 어느 스페이스 사람인지 — 팔로우가 아니라 **내가 같이 간 사람**이다.
     ★ 매핑은 upload.js 한 곳에만 있다. 여기서 또 적으면 둘이 갈라진다. */
  const WHO_SPACE = window.WHO_SPACE || {};
  const SPNAME = window.SPACE_NAME || {};

  /* 지도에서 보던 자리로부터의 거리 (§12.14 — 탭은 서로 이어진다) */
  const NEAR_KM = 40;
  function nearKm(x) {
    try {
      const c = map.getCenter(), [lng, lat] = x.poi.geometry.coordinates;
      const t = Math.PI / 180, R = 6371;
      const dLat = (lat - c.lat) * t, dLng = (lng - c.lng) * t;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(c.lat * t) * Math.cos(lat * t) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    } catch (e) { return null; }
  }

  const ymd = (t) => { const d = new Date(t);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; };
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
    if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)}일 전`;
    return ymd(t);
  }

  /* ── 포스트를 모은다 ───────────────────────────────────────────
     세 갈래뿐이다. 갈래마다 **한 줄로 설명된다** — 그게 자격 조건이다.

     ★ 시각 축이 둘이다. **찍은 때(taken_at)와 올린 때(created_at)는 다르다.**
       소식은 올린 때로 줄을 세운다 — 3년 전 사진을 오늘 올렸으면 오늘 소식이다.
       처음엔 찍은 때로 세웠더니 남의 기록이 전부 1~3년 전이라 **첫 화면이 내 회고로만 찼다.**
       '소식' 탭에 남의 소식이 한 건도 없었다. */
  function build() {
    const out = [];
    const pub = (window.PUBLIC_ALBUM_VIEW ? PUBLIC_ALBUM_VIEW() : []);
    const DAY = 864e5;

    pub.forEach((x, i) => {
      // 씨앗에 '올린 때'가 없어 만들어 쓴다. 실제 앱은 `pins.created_at`을 그대로 쓴다.
      const at = Date.now() - (i * 7 + (i % 5) * 3) * 3600e3;   // 최근 열흘 남짓에 흩는다
      const sp = WHO_SPACE[x.who];
      const km = nearKm(x);
      if (sp) {
        // ① 같이 간 사람 — 스페이스 멤버. 팔로우가 아니라 **같이 여행한 사이**다.
        out.push({ ...x, src: "space", sp, km, why: `${SPNAME[sp]} · 같이 여행한 사람입니다`, at });
      } else if (km !== null && km <= NEAR_KM) {
        /* ③ 가까운 곳에서 올라온 것 — 페이스북 홈의 친숙한 형태를 쓰되
           **팔로우가 아니라 거리**로 고른다. 인스타는 팔로우 기반이라 이걸 못 한다.
           그리고 우리 규칙은 그대로다 — 왜 보이는지 한 줄이 붙는다. */
        out.push({ ...x, src: "near", km,
          why: `${km < 1 ? Math.round(km * 1000) + "m" : km.toFixed(1) + "km"} · ${
            (x.poi.properties.rn || "")}에서 올라왔습니다`, at });
      } else {
        // ② 내가 저장한 장소에 새 기록이 붙었다. 사람이 아니라 **장소**를 따라간다.
        out.push({ ...x, src: "saved", km, why: `저장한 곳입니다 — ${x.poi.properties.n}`, at });
      }
    });

    // ③ N년 전 오늘 — 공급자가 0명이어도 첫날부터 채워진다(§12.7, §12.5 A)
    //    ★ 회고는 **하루 3건까지**다. 오늘 날짜를 달고 들어오니 개수를 안 막으면
    //      맨 위를 전부 차지한다 — 실제로 첫 화면 6개가 전부 내 회고였다.
    //      회고는 소식의 바닥을 받쳐 주는 것이지 소식을 밀어내는 게 아니다.
    const MEMORY_MAX = 3;
    const now = new Date();
    const seen = new Set(); let m = 0;
    (window.UP ? UP.album : []).filter((x) => x.gps && x.poi)
      .sort((a, b) => b.ts - a.ts)
      .forEach((x) => {
        if (m >= MEMORY_MAX) return;
        const d = new Date(x.ts), yr = now.getFullYear() - d.getFullYear();
        if (yr < 1) return;
        if (seen.has(x.poi.properties.n)) return;
        seen.add(x.poi.properties.n); m++;
        out.push({ ...x, src: "memory", who: "minji", memo: x.memo || "",
          why: `${yr}년 전 오늘 — 여기 있었습니다`,
          // 찍힌 건 N년 전이지만 **오늘 떠오른 것**이다. 시간순 자리는 오늘이 맞다.
          at: Date.now() - m * 9e6 });
      });

    // ★ id를 문자열로 못 박는다. 남의 기록은 "pub3"인데 내 앨범은 숫자 3이라,
    //   `dataset.like`가 준 "3"이 Set 안의 3과 안 맞아 **좋아요가 눌러도 안 눌렸다.**
    //   화면은 멀쩡했고 아무 예외도 안 났다.
    out.forEach((p) => { p.id = String(p.id); });
    HM.posts = out.sort((a, b) => b.at - a.at);
    /* 가까운 것끼리는 **거리 → 반응** 순으로 다시 세운다.
       시간순만 쓰면 아무도 안 간 곳이 위에 오는데, 그건 '소식'이 아니라 '목록'이다. */
    HM.near = out.filter((p) => p.src === "near")
      .sort((a, b) => (a.km - b.km) || ((b.poi.properties.likes || 0) - (a.poi.properties.likes || 0)));
    HM.built = true;
  }

  function visible() {
    if (!HM.filter) return HM.posts;
    if (HM.filter === "memory" || HM.filter === "near")
      return HM.filter === "near" ? HM.near : HM.posts.filter((p) => p.src === "memory");
    return HM.posts.filter((p) => p.sp === HM.filter);
  }

  /* ── 포스트 한 장 ─────────────────────────────────────────── */
  function post(p, i) {
    const n = p.poi.properties.n, liked = HM.like.has(p.id), saved = HM.save.has(p.id);
    const badge = p.verification === "live"
      ? `<span class="hmBadge live">현장 인증</span>`
      : `<span class="hmBadge">사진 정보</span>`;
    return `
      <article class="hmPost" data-i="${i}" data-id="${esc(p.id)}">
        <div class="hmWhy ${p.src}">${esc(p.why)}</div>
        <header class="hmWho">
          <i>${esc(p.who[0].toUpperCase())}</i>
          <div><b>@${esc(p.who)}</b><small>${ago(p.at)} · 촬영 ${ymd(p.ts)}</small></div>
        </header>
        <div class="hmImg" data-view="${esc(n)}"><img src="${photoSrc(p.img)}" alt="" loading="lazy"></div>
        <button class="hmPlace" data-go="${esc(n)}">
          <span>📍 ${esc(n)}</span>${badge}<em>지도에서 보기 ›</em>
        </button>
        ${p.memo ? `<p class="hmMemo">${esc(p.memo)}</p>` : ""}
        <div class="hmActs">
          <button class="hmAct${liked ? " on" : ""}" data-like="${esc(p.id)}">${liked ? "♥" : "♡"} 좋아요</button>
          <button class="hmAct${saved ? " on" : ""}" data-save="${esc(p.id)}">${saved ? "★" : "☆"} 저장</button>
        </div>
      </article>`;
  }

  /* ★ 다시 그리는 이유가 세 가지고, 셋 다 다르게 굴어야 한다.
       처음엔 하나로 묶었더니 **좋아요를 누를 때마다 포스트가 6개씩 늘었다.**
       '상태가 바뀌어서 다시 그린다'와 '더 달라고 해서 다시 그린다'는 다른 일이다. */
  function render(mode) {                     // "reset" | "more" | "same"
    if (!HM.built) build();
    const list = visible();
    if (mode === "reset") HM.shown = PAGE;
    else if (mode === "more") HM.shown += PAGE;
    HM.shown = Math.min(list.length, Math.max(PAGE, HM.shown));
    const chips = [["", "전체"], ["near", "가까운 곳"],
                   ["sp1", SPNAME.sp1], ["sp2", SPNAME.sp2], ["memory", "내 기록"]];
    $("#hmBody").innerHTML = `
      <div class="hmHead">
        <div class="hmTitle">소식<button class="hmOpen" data-open="1">스페이스 ›</button></div>
        <small>포스트마다 <b>왜 내게 보이는지</b> 적혀 있습니다. 설명할 수 없으면 띄우지 않습니다.
          <b>댓글은 없습니다</b> — 운영할 수 있는 만큼만 엽니다.</small>
      </div>
      <div class="hmChips">
        ${chips.map(([v, t]) => `<button class="hmChip${(HM.filter || "") === v ? " on" : ""}" data-f="${v}">${t}</button>`).join("")}
      </div>
      ${list.length ? list.slice(0, HM.shown).map(post).join("")
                    : `<div class="hmEmpty">이 묶음에는 아직 소식이 없습니다.</div>`}
      ${HM.shown < list.length
        ? `<button class="hmMore" data-more="1">더 보기 <span>${list.length - HM.shown}개 남음</span></button>`
        : list.length ? `<div class="hmEnd">여기까지입니다 · 오늘 ${list.length}건</div>` : ""}`;
  }

  function show(on) {
    $("#hmPanel").classList.toggle("on", on);
    if (on) {
      $("#fdPanel") && $("#fdPanel").classList.remove("on");
      $("#spPanel") && $("#spPanel").classList.remove("on");
      render("reset");
    }
  }

  window.initHome = function () {
    document.body.appendChild(el(`<div id="hmPanel" class="glass"><div id="hmBody"></div></div>`));
    const tb = $("#tabbar");
    if (tb) {
      const b = el(`<button data-tab="home">📰<span>소식</span></button>`);
      // 갈 곳 다음, 스페이스 앞
      tb.insertBefore(b, tb.querySelector('[data-tab="space"]'));
      tb.addEventListener("click", (e) => {
        const t = e.target.closest("button"); if (!t) return;
        show(t.dataset.tab === "home");
        if (t.dataset.tab === "home")
          document.querySelectorAll("#tabbar button").forEach((x) => x.setAttribute("aria-pressed", x === t));
      });
    }
    $("#hmBody").addEventListener("click", (e) => {
      const f = e.target.closest("[data-f]");
      if (f) { HM.filter = f.dataset.f || null; return render("reset"); }
      if (e.target.closest("[data-open]")) {            // 스페이스는 사라지지 않았다
        show(false);
        return $('#tabbar button[data-tab="space"]').click();
      }
      if (e.target.closest("[data-more]")) return render("more");
      const v = e.target.closest("[data-view]");
      if (v && window.screenViewer) return screenViewer(v.dataset.view, {});
      const g = e.target.closest("[data-go]");
      if (g) { show(false); $('#tabbar button[data-tab="map"]').click();
               return window.flyToPlace ? flyToPlace(g.dataset.go) : null; }
      /* ★ 반응은 **표지 경쟁의 분자**다(§13.8). 화면 상태만 바꾸고 끝내면
         점수가 영영 안 움직인다 — 같은 로그로 흘려보낸다. */
      const ckOf = (p) => p && p.poi
        ? (p.who && p.who !== "minji" ? "u:" + p.poi.properties.n + ":" + p.poi.properties.au
                                      : "m:" + p.poi.properties.n)
        : null;
      const lk = e.target.closest("[data-like]");
      if (lk) { const id = lk.dataset.like, post = HM.posts.find((p) => p.id === id);
                const on = !HM.like.has(id);
                on ? HM.like.add(id) : HM.like.delete(id);
                if (window.LOG) (on ? LOG.react : LOG.unreact)(ckOf(post), "like");
                return render("same"); }
      const sv = e.target.closest("[data-save]");
      if (sv) { const id = sv.dataset.save, post = HM.posts.find((p) => p.id === id);
                const on = !HM.save.has(id);
                on ? HM.save.add(id) : HM.save.delete(id);
                if (window.LOG) (on ? LOG.react : LOG.unreact)(ckOf(post), "save");
                return render("same"); }
    });
  };
  window.__home = HM;
})();
