/* =====================================================================
   스페이스 / 여행 화면 — PLAN.md §6.7

   Space (누구와)  관계 단위. 지속된다. 여행마다 새로 만들지 않는다
     └ Trip (언제 어디)  여행 단위. 자동 생성 + 이름만 수정
         └ Pin

   이 화면이 증명해야 하는 것:
     "여자친구와 열 번 여행 가도 스페이스는 하나다"
   ===================================================================== */

(function () {
  const $ = (s) => document.querySelector(s);
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  /* 데모 데이터 — 한 스페이스에 여행이 여러 개 쌓인 모습이 핵심 */
  const SP_TRIPS = {
    sp1: [
      { id: "s1t1", title: "제주 우정여행", note: "졸업하고 다 같이 처음", start: "2026.03.14", end: "03.17", places: 12, photos: 84, region: "제주시" },
      { id: "s1t2", title: "강릉 바다", note: "", start: "2025.08.02", end: "08.03", places: 6, photos: 41, region: "강릉시" },
      { id: "s1t3", title: "생일 여행", note: "민지 생일에 급하게 떠난 1박", start: "2024.11.22", end: "11.23", places: 4, photos: 27, region: "속초시" },
    ],
    sp2: [
      { id: "s2t1", title: "부모님과 남해", note: "아버지 환갑", start: "2025.05.05", end: "05.07", places: 9, photos: 63, region: "통영시" },
      { id: "s2t2", title: "경주 벚꽃", note: "", start: "2023.04.01", end: "04.02", places: 7, photos: 38, region: "경주시" },
    ],
    mine: [],
  };
  /* ★ 멤버는 index.html 의 SPACES 한 곳에만 있다. 여기서 또 적으면 둘이 갈라진다. */
  const membersOf = (id) => {
    try { return (SPACES.find((s) => s.id === id)?.users || []).map((u) => USER[u]); }
    catch (e) { return []; }
  };

  /* ── 함께 채운 지도 (§13.16) ───────────────────────────────────
     ★ `우리가 함께 채운 N곳` 은 **합집합**이지 합계가 아니다.
       셋이 같은 곳에 갔으면 3곳이 아니라 1곳이다. 합계로 세면
       "같이 간 여행"이 세 배로 부풀어 숫자가 거짓말을 한다.

     ★ 그리고 **같이 간 곳과 혼자 간 곳을 가른다.** 이게 '함께'의 실체다 —
       혼자 다 채운 스페이스와 셋이 나눠 채운 스페이스는 완전히 다른 관계인데,
       총량만 보면 똑같아 보인다. 공유 지도 앱만 보여줄 수 있는 구별이다. */
  function spaceCoverage(id) {
    const users = (SPACES.find((s) => s.id === id)?.users) || [];
    const byRegion = {};                 // 지역 -> 그 지역을 연 사람들
    const byUser = {};                   // 사람 -> 연 지역 수
    users.forEach((u) => (byUser[u] = 0));
    poi.features.forEach((f) => {
      const p = f.properties;
      if (p.sp !== id || !p.rn) return;
      (byRegion[p.rn] ||= new Set()).add(p.au);
    });
    const regions = Object.keys(byRegion);
    regions.forEach((r) => byRegion[r].forEach((u) => { byUser[u] = (byUser[u] || 0) + 1; }));
    const together = regions.filter((r) => byRegion[r].size >= 2);
    const alone = regions.filter((r) => byRegion[r].size === 1);
    const total = (window.feats || []).length || 250;
    return { regions, byRegion, byUser, together, alone, total,
             pct: (regions.length / total) * 100 };
  }

  let curSpace = null;

  function tripsOf(id) {
    if (id !== "mine") return SP_TRIPS[id] || [];
    // 내 지도 = 업로드로 만든 여행들 + 스페이스에 안 묶인 것
    return (window.UP?.trips || [])
      .filter((t) => UP.registered.has(t.id))
      .map((t) => ({
        id: t.id, title: t.title, note: "",
        start: new Date(t.start).toLocaleDateString("ko-KR").replace(/\. /g, ".").replace(/\.$/, ""),
        end: "", places: t.placeCount, photos: t.items.length, region: t.region,
      }));
  }

  function coverFor(region) {
    const f = poi.features.find((x) => x.properties.rn === region);
    return PHOTOS[f ? f.properties.imgi : 0];
  }

  /* ── 스페이스 목록 ─────────────────────────────────────────── */
  function renderList() {
    const cards = [
      { id: "mine", title: "내 지도", sub: "나만 보는 기록 전부", members: null },
      ...SPACES.map((sp) => ({ id: sp.id, title: sp.name, sub: null,
                               members: membersOf(sp.id).map((u) => u.name) })),
    ];
    $("#spBody").innerHTML = `
      <div class="spIntro">
        스페이스는 <b>사람</b>입니다. 여행마다 새로 만들지 않습니다 —
        여행은 그 안에 쌓입니다.
      </div>
      ${cards.map((c) => {
        const ts = tripsOf(c.id);
        const cov = ts.length ? coverFor(ts[0].region) : PHOTOS[3];
        return `
        <button class="spCard" data-sp="${c.id}">
          <img src="${cov}" alt="">
          <div class="spMeta">
            <b>${esc(c.title)}</b>
            <small>${c.members ? `멤버 ${c.members.length}명 · ${c.members.join(", ")}` : esc(c.sub)}</small>
            <div class="spStat">여행 ${ts.length}개 · 사진 ${ts.reduce((a, t) => a + t.photos, 0)}장</div>
          </div>
          <em>›</em>
        </button>`;
      }).join("")}
      <button class="spNew" id="spNew">＋ 새 스페이스 <span>지인을 초대해 함께 채웁니다</span></button>`;
  }

  /* ── 스페이스 상세 = 여행 목록 ─────────────────────────────── */
  function renderSpace(id) {
    curSpace = id;
    const name = id === "mine" ? "내 지도" : (SPACES.find((s) => s.id === id)?.name ?? id);
    const mem = id === "mine" ? [] : membersOf(id);
    const members = mem.map((u) => u.name);
    const ts = tripsOf(id);
    const cv = id === "mine" ? null : spaceCoverage(id);
    $("#spBody").innerHTML = `
      <div class="spHead2">
        <button class="spBack">‹ 스페이스</button>
        <b>${esc(name)}</b>
        ${members.length ? `<div class="spAv">${members.map((m) => `<i>${esc(m[0])}</i>`).join("")}<span>${members.length}명</span></div>` : ""}
      </div>
      ${cv ? sharedMap(id, name, cv, mem) : ""}
      ${members.length ? `<button class="spInvite">카카오톡으로 초대</button>` : ""}
      <div class="spTripHead">여행 ${ts.length}개</div>
      ${ts.length ? ts.map((t) => `
        <div class="spTrip" data-trip="${t.id}" data-region="${esc(t.region)}">
          <img src="${coverFor(t.region)}" alt="">
          <div>
            <b>${esc(t.title)}</b>
            <small>${t.start}${t.end ? "–" + t.end : ""} · ${t.places}곳 · 사진 ${t.photos}장</small>
            ${t.note ? `<p class="spNote">“${esc(t.note)}”</p>` : `<p class="spNoteEmpty">＋ 이 여행 한 줄 남기기</p>`}
          </div>
          <span class="spGo">지도에서 보기</span>
        </div>`).join("")
        : `<div class="spEmpty">아직 여행이 없습니다.<br>지도 화면의 <b>＋</b>에서 앨범을 스캔해 보세요.</div>`}`;
  }

  /* 스페이스 화면의 머리 — **목록이 아니라 지도**여야 한다 (§12.13).
     목록·초대만 있으면 파일 탐색기다. 초대받은 사람이 처음 보는 화면이 파일 탐색기면
     수락할 이유가 약하다 (§3: 초대 수락률이 핵심 지표). */
  function sharedMap(id, name, cv, mem) {
    if (!cv.regions.length) {
      return `<div class="spEmptyMap">아직 아무도 지도를 열지 않았습니다.
        <small>첫 기록을 남기면 여기에 ${esc(name)}의 지도가 생깁니다.</small></div>`;
    }
    const top = Object.entries(cv.byUser).sort((a, b) => b[1] - a[1]);
    const maxU = Math.max(1, ...top.map(([, n]) => n));
    return `
      <section class="spMap" data-lens="${esc(id)}">
        <div class="spMapTop">
          <div><i>함께 채운 곳</i><b>${cv.regions.length}</b><span>/ ${cv.total} 시·군·구</span></div>
          <em>${cv.pct.toFixed(1)}%</em>
        </div>
        <div class="spBar"><span style="width:${Math.min(100, cv.pct).toFixed(1)}%"></span></div>
        <div class="spSplit">
          <div><b>${cv.together.length}</b><small>같이 간 곳</small></div>
          <div><b>${cv.alone.length}</b><small>혼자 다녀온 곳</small></div>
        </div>
        <div class="spWho">
          ${top.map(([u, n]) => `
            <div class="spWhoRow">
              <i>${esc((USER[u] || {}).name || u)[0]}</i>
              <span>${esc((USER[u] || {}).name || u)}</span>
              <div class="spWhoBar"><span style="width:${(n / maxU * 100).toFixed(0)}%"></span></div>
              <em>${n}곳</em>
            </div>`).join("")}
        </div>
        <button class="spOpenMap" data-lens="${esc(id)}">지도에서 함께 보기 ›</button>
      </section>`;
  }

  /* ── 탭 ───────────────────────────────────────────────────── */
  function show(tab) {
    document.querySelectorAll("#tabbar button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tab === tab));
    const panel = $("#spPanel");
    if (tab === "map") { panel.classList.remove("on"); return; }
    panel.classList.add("on");
    if (tab === "space") { curSpace = null; renderList(); }
    else renderMy();
  }

  /* ── 마이 ─────────────────────────────────────────────────── */
  function renderMy() {
    const mine = poi.features.filter((f) => f.properties.mine);
    const pub = mine.filter((f) => f.properties.pub);
    const regions = new Set(mine.map((f) => f.properties.r).filter(Boolean));
    const cats = {};
    mine.forEach((f) => { cats[f.properties.c] = (cats[f.properties.c] || 0) + 1; });
    $("#spBody").innerHTML = `
      <div class="myHead">
        <div class="myAv">민</div>
        <div><b>@minji</b><small>민지</small></div>
      </div>
      <div class="myGrid">
        <div><i>정복 지역</i><b>${regions.size}</b></div>
        <div><i>장소</i><b>${mine.length.toLocaleString()}</b></div>
        <div><i>공개한 기록</i><b>${pub.length.toLocaleString()}</b></div>
        <div><i>커버리지</i><b>${(regions.size / feats.length * 100).toFixed(1)}%</b></div>
      </div>
      <div class="myNote">
        남이 보는 <b>@minji의 지도</b>에는 공개한 ${pub.length.toLocaleString()}곳만 나옵니다.
        내가 보는 내 지도는 ${mine.length.toLocaleString()}곳입니다.
      </div>
      <div class="spTripHead">카테고리</div>
      <div class="myCats">
        ${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
          const c = CAT[k] || CAT.sight;
          return `<div class="myCat"><em style="background:${c.c}"></em>${c.k}<b>${v}</b></div>`;
        }).join("")}
      </div>`;
  }

  /* ── 초기화 ───────────────────────────────────────────────── */
  window.initSpaces = function () {
    document.body.appendChild(el(`
      <div id="spPanel" class="glass">
        <div id="spBody"></div>
      </div>`));
    document.body.appendChild(el(`
      <div id="tabbar" class="glass">
        <button data-tab="map" aria-pressed="true">🗺️<span>지도</span></button>
        <button data-tab="space">👥<span>스페이스</span></button>
        <button data-tab="my">👤<span>마이</span></button>
      </div>`));

    $("#tabbar").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (b) show(b.dataset.tab);
    });

    $("#spBody").addEventListener("click", (e) => {
      const card = e.target.closest(".spCard");
      if (card) return renderSpace(card.dataset.sp);
      if (e.target.closest(".spBack")) return renderList();
      if (e.target.closest("#spNew"))
        return alert("새 스페이스 — 사람 단위로 만듭니다.\n예) 지은이와 · 대학 동기들 · 가족\n\n여행은 그 안에 쌓입니다.");
      const om = e.target.closest(".spOpenMap");
      if (om) {
        /* ★ 렌즈를 바꾸고 탭1로 나간다. 같은 지도를 **다른 눈**으로 보는 것이지
           새 화면을 여는 것이 아니다 (§12.2 뷰어와 같은 원칙). */
        state.lens = om.dataset.lens;
        clearRegionScope();                 // 지역 스코프가 남아 있으면 스페이스가 안 보인다
        show("map");
        renderLensMenu(); refreshPoi(); renderList();
        return;
      }
      if (e.target.closest(".spInvite"))
        return alert("카카오톡 딥링크로 초대합니다.\n받은 사람은 앱을 깔기 전에 웹에서 먼저 지도를 봅니다.");
      const trip = e.target.closest(".spTrip");
      if (trip) {
        // 여행을 지도에서 본다 — 그 지역으로 이동 + 렌즈 전환
        const region = trip.dataset.region;
        const f = feats.find((x) => x.properties.name === region);
        show("map");
        if (curSpace && curSpace !== "mine") { state.lens = curSpace; }
        else { state.lens = "mine"; }
        renderLensMenu(); refreshPoi();
        if (f) {
          const b = f.properties.bbox;
          map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, duration: 900 });
        }
      }
    });
  };
})();
