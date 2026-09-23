/* =====================================================================
   탭5 `마이` — 내 금고와 리포트 (원본 기획서 §6 탭5 + PLAN §12.13)

   원본 기획서가 이 화면에 적어 둔 것:
     · 내 국토 정복 통계 리포트 (정복률 %, 방문 시·군·구 수)
     · 내가 수집한 A컷 감성 사진 보관함(Vault)
     · 액션: 지도 테마 변경 / **감성 사진 대표 픽 변경** / 프로필 수정

   ★ `대표 픽`은 장식이 아니라 **데이터 모델에 원래 있던 것**이다
     (TravelRecord.is_main_pick). 장소당 사진 3장 제한(§8)과 한 몸이다 —
     3장 중 지도에 나갈 한 장을 고르는 것이 큐레이션의 실체다.
     지금까지 프로토타입에 없었다. 여기서 만든다.

   ★ 커버리지는 수집욕이 아니라 **계획 도구**다(§12.5 C).
     "23곳 중 4곳"은 자랑이면서 동시에 **다음에 갈 곳의 목록**이다.

   ★ 공유 카드가 이 앱의 마케팅 경로다(§12.13). 앱 안에 머무는 숫자는 퍼지지 않는다.
   ===================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  function photoSrc(i) { try { return PHOTOS[i] || ""; } catch (e) { return ""; } }
  /* ★ `feats`(전국 시·군·구)도 index.html 의 top-level `let` 이라 window 에 안 붙는다.
       window 을 거쳤더니 **시·도 목록이 통째로 비었고**, 분모가 하드코딩
       폴백 250으로 떨어져 있었다. PHOTOS 에서 한 번 겪은 함정을 또 밟았다. */
  function sgg() { try { return feats || []; } catch (e) { return []; } }

  const MY = { mainPick: {}, sidoOpen: false, view: "home", pickFor: null };
  const PHOTO_MAX = 3;                 // 원본 기획서 §8 — 장소당 3장

  /* ── 내 기록을 장소 단위로 접는다 (= 금고의 한 칸) ──────────── */
  function vault() {
    const by = {};
    (window.UP ? UP.album : []).forEach((x) => {
      if (!x.poi || !x.gps) return;
      (by[x.poi.properties.n] ||= []).push(x);
    });
    return Object.entries(by)
      .map(([n, items]) => {
        items.sort((a, b) => b.ts - a.ts);
        const f = items[0].poi;
        const pickId = MY.mainPick[n];
        const main = items.find((x) => String(x.id) === String(pickId)) || items[0];
        return { n, items, main, region: f.properties.rn, cat: f.properties.c,
                 over: items.length > PHOTO_MAX };
      })
      .sort((a, b) => b.items.length - a.items.length);
  }

  function stats() {
    const mine = poi.features.filter((f) => f.properties.mine);
    const pub = mine.filter((f) => f.properties.pub);
    const regionNames = new Set(mine.map((f) => f.properties.rn).filter(Boolean));
    const total = sgg().length || 250;
    return { mine, pub, regions: regionNames, total,
             pct: (regionNames.size / total) * 100 };
  }

  /* 시도별 — "23곳 중 4곳"은 자랑이자 **다음에 갈 곳 목록**이다 */
  function bySido() {
    const s = stats();
    const out = {};
    sgg().forEach((f) => {
      const sd = f.properties.sido || "기타";
      (out[sd] ||= { all: 0, got: 0, left: [] }).all++;
      if (s.regions.has(f.properties.name)) out[sd].got++;
      else out[sd].left.push(f.properties.name);
    });
    // ★ 정복률 높은 순으로 놨더니 제목이 `아직 안 간 곳`인데 **맨 위가 5/5(다 간 곳)**이었다.
    //   제목과 내용이 어긋난 것이다. 계획 도구라면 **곧 끝낼 수 있는 곳**이 위에 와야 한다 —
    //   "2곳 남음"은 실행할 수 있는 목표고, "5/5"는 더 볼 것이 없다.
    return Object.entries(out).sort((a, b) =>
      (a[1].all - a[1].got) - (b[1].all - b[1].got) || b[1].all - a[1].all);
  }

  /* ── 화면 ─────────────────────────────────────────────────── */
  function renderHome() {
    const s = stats(), v = vault();
    const over = v.filter((x) => x.over).length;
    const rep = (window.UP ? UP.reports : []) || [];
    const sdAll = bySido();
    const done = sdAll.filter(([, d]) => d.got >= d.all);
    const sd = sdAll.filter(([, d]) => d.got < d.all);     // 다 간 곳은 목록에서 뺀다
    const shownSd = MY.sidoOpen ? sd : sd.slice(0, 5);

    $("#myBody").innerHTML = `
      <div class="myTop">
        <div class="myAv2">민</div>
        <div class="myWho"><b>@minji</b><small>민지 · 2026년 3월부터</small></div>
        <button class="myEdit" data-edit="1">프로필 수정</button>
      </div>

      <section class="myCard">
        <div class="myPctRow">
          <div><i>국토 정복률</i><b>${s.pct.toFixed(1)}%</b></div>
          <div class="myPctSub">${s.regions.size} / ${s.total} 시·군·구</div>
        </div>
        <div class="myBar"><span style="width:${Math.min(100, s.pct).toFixed(1)}%"></span></div>
        <div class="myMini">
          <div><i>장소</i><b>${s.mine.length.toLocaleString()}</b></div>
          <div><i>공개한 기록</i><b>${s.pub.length.toLocaleString()}</b></div>
          <div><i>금고</i><b>${v.length.toLocaleString()}</b></div>
        </div>
        <button class="myShare" data-share="1">공유 카드 만들기 ›
          <span>숫자가 앱 안에만 있으면 아무도 모릅니다</span></button>
      </section>

      <div class="myNote2">
        남이 보는 <b>@minji의 지도</b>에는 공개한 ${s.pub.length.toLocaleString()}곳만 나옵니다.
        내가 보는 내 지도는 ${s.mine.length.toLocaleString()}곳입니다.
        <em>공개 범위는 기록마다 따로 정합니다 — 전부 아니면 전무가 아닙니다.</em>
      </div>

      <div class="mySec">아직 안 간 곳
        <small>정복률은 자랑이면서 <b>다음에 갈 곳 목록</b>입니다 — 곧 끝낼 수 있는 순서입니다</small></div>
      ${done.length ? `<div class="myDone">다 연 시·도 <b>${done.length}곳</b>
        · ${done.map(([n]) => esc(n)).join(" · ")}</div>` : ""}
      <div class="mySido">
        ${shownSd.map(([name, d]) => `
          <div class="mySidoRow" data-sido="${esc(name)}">
            <b>${esc(name)}</b>
            <div class="mySidoBar"><span style="width:${(d.got / d.all * 100).toFixed(1)}%"></span></div>
            <em>${d.all - d.got}곳 남음</em>
          </div>`).join("")}
      </div>
      ${sd.length > 5 ? `<button class="myMore" data-sido-all="1">${
        MY.sidoOpen ? "접기" : `남은 ${sd.length}개 시·도 전부 보기`}</button>` : ""}

      <div class="mySec">A컷 금고
        <small>장소마다 <b>지도에 나갈 한 장</b>을 고릅니다 — 그게 큐레이션입니다</small></div>
      ${over ? `<div class="myWarn">${over}곳이 ${PHOTO_MAX}장을 넘었습니다.
        지도에는 대표 픽 한 장만 나갑니다.</div>` : ""}
      <div class="myVault">
        ${v.slice(0, 12).map((x) => `
          <button class="myVCard" data-pick="${esc(x.n)}">
            <img src="${photoSrc(x.main.img)}" alt="" loading="lazy">
            <span class="myVN">${esc(x.n)}</span>
            <span class="myVC">${esc(x.region || "")} · ${x.items.length}장${x.over ? " ⚠︎" : ""}</span>
          </button>`).join("")}
      </div>

      <div class="mySec">내 신고<small>보낸 것이 어떻게 됐는지 여기서 봅니다 (§10.47)</small></div>
      ${rep.length ? `<div class="myReps">${rep.map((r) => `
          <div class="myRep"><b>${esc(r.reasonLabel || r.reason)}</b>
            <small>${esc(r.target.name || r.target.type)}</small>
            <em>확인 중</em></div>`).join("")}</div>`
        : `<div class="myEmpty2">보낸 신고가 없습니다.</div>`}

      <div class="mySec">계정
        <small>지금은 <b>이 기기에만</b> 있습니다 — 앱을 지우면 기록이 사라집니다</small></div>
      <div class="myAcct" id="myAcct">불러오는 중…</div>

      <div class="mySec">설정</div>
      <div class="myRows">
        <button class="myRow" data-theme="1">지도 테마<em>어두운 지도 ›</em></button>
        <button class="myRow" data-scope="1">기본 공개 범위<em>나만 보기 ›</em></button>
        <button class="myRow" data-op="1">운영자 신청<em>›</em></button>
      </div>`;
  }

  /* 대표 픽 고르기 — 원본 기획서가 적어 둔 액션이다 */
  function renderPick(name) {
    const v = vault().find((x) => x.n === name);
    if (!v) return renderHome();
    MY.view = "pick"; MY.pickFor = name;
    $("#myBody").innerHTML = `
      <button class="myBack" data-back="1">‹ 마이</button>
      <div class="mySec">${esc(name)}<small>지도와 남의 화면에 나갈 <b>한 장</b>을 고릅니다</small></div>
      <div class="myPickGrid">
        ${v.items.map((x) => `
          <button class="myPickCell${String(x.id) === String(v.main.id) ? " on" : ""}"
                  data-set="${esc(String(x.id))}">
            <img src="${photoSrc(x.img)}" alt="">
            ${String(x.id) === String(v.main.id) ? `<span class="myPickTag">대표 픽</span>` : ""}
          </button>`).join("")}
      </div>
      <div class="myNote2">나머지 ${Math.max(0, v.items.length - 1)}장은 지워지지 않습니다.
        장소를 열면 전부 보입니다 — <b>지도에 나가는 것만 한 장</b>입니다.</div>`;
  }

  function renderShare() {
    const s = stats();
    MY.view = "share";
    $("#myBody").innerHTML = `
      <button class="myBack" data-back="1">‹ 마이</button>
      <div class="mySec">공유 카드<small>앱 밖으로 나가는 유일한 숫자입니다</small></div>
      <div class="myShareCard">
        <div class="mscTop">TRIPPIC</div>
        <div class="mscPct">${s.pct.toFixed(1)}<i>%</i></div>
        <div class="mscSub">@minji 는 대한민국 ${s.total}개 시·군·구 중<br><b>${s.regions.size}곳</b>을 열었습니다</div>
        <div class="mscBar"><span style="width:${Math.min(100, s.pct).toFixed(1)}%"></span></div>
        <div class="mscFoot">trippic.app</div>
      </div>
      <div class="myNote2">이미지로 저장해 인스타·카톡에 올립니다.
        <em>카드에 사진은 넣지 않습니다 — 남의 얼굴이나 집 앞이 섞일 수 있습니다.</em></div>`;
  }

  /* ★ 익명 계정은 **기기에 묶인다.** 앱을 지우면 기록이 사라진다 —
     그걸 화면이 말해야 한다. 말 안 하면 사용자는 **잃고 나서야 안다.**
     그래서 '로그인됨' 이라고만 적지 않고 무엇이 위험한지까지 적는다. */
  async function renderAccount() {
    const box = $("#myAcct");
    if (!box) return;
    if (!(window.API && API.on)) {
      box.innerHTML = `<div class="myAcctRow off">서버에 연결되어 있지 않습니다
        <small>기록이 이 브라우저에만 있습니다</small></div>`;
      return;
    }
    const s = API.session;
    if (!s.access_token) {
      box.innerHTML = `<button class="myAcctBtn" id="myAnon">시작하기 (가입 없이)
        <span>계정을 만들지 않고 바로 씁니다 — 나중에 옮길 수 있습니다</span></button>`;
      return;
    }
    renderServerCount();
    box.innerHTML = `
      <div class="myAcctRow">
        <b>${s.anonymous ? "임시 계정" : "계정"}</b>
        <code>${esc(String(s.user_id || "").slice(0, 8))}…</code>
        ${s.anonymous ? `<em>이 기기에만</em>` : ""}
      </div>
      <div class="myServer" id="myServer"></div>
      <div class="myUp">
        <label class="myUpBtn">사진 한 장 올려보기
          <input type="file" id="myUpFile" accept="image/*" hidden>
          <span>기기에서 줄여서 올립니다 — 원본을 그대로 보내지 않습니다</span></label>
        <div class="myUpOut" id="myUpOut"></div>
      </div>
      ${s.anonymous ? `<div class="myAcctWarn">
        앱을 지우거나 기기를 바꾸면 <b>기록이 사라집니다.</b>
        <small>나중에 카카오·애플로 이어 두면 옮길 수 있습니다 — 지금은 준비 중입니다.</small>
      </div>` : ""}`;
    /* ★ `#myServer` 는 **바로 위 innerHTML 이 만든다.** 그 전에 채우려 했더니
       노드가 아직 없어서(또는 곧 지워져서) 칸이 늘 비어 있었다.
       그리는 쪽과 채우는 쪽의 순서를 지킨다. */
    renderServerCount();
  }

  /* ★ 서버에 **무엇이 남아 있는지** 숫자로 보여준다.
     올렸다는 말만 하고 확인할 방법이 없으면, 사용자는 기기를 바꿀 때
     비로소 **없다는 것**을 알게 된다. */
  async function renderServerCount() {
    const box = $("#myServer");
    if (!box || !(window.API && API.on && API.session.access_token)) return;
    box.textContent = "서버 기록 확인 중…";
    const [pins, trips] = await Promise.all([API.myRecords(200), API.myTrips()]);
    if (!pins.ok) { box.textContent = ""; return; }
    const photos = pins.data.reduce((n, p) => n + (p.media || []).length, 0);
    box.innerHTML = `
      <div class="mySrvRow">
        <b>서버에 있는 내 기록</b>
        <em>${pins.data.length.toLocaleString()}곳 · 사진 ${photos.toLocaleString()}장 ·
            여행 ${(trips.data || []).length}개</em>
      </div>
      <small>${pins.data.length
        ? "기기를 바꿔도 여기서 다시 불러옵니다."
        : "아직 서버에 올라간 기록이 없습니다 — 지도에서 여행을 등록해 보세요."}</small>`;
  }

  function render() {
    if (MY.view === "pick") return renderPick(MY.pickFor);
    if (MY.view === "share") return renderShare();
    renderHome();
    renderAccount();
  }

  function show(on) {
    $("#myPanel").classList.toggle("on", on);
    if (on) {
      ["#fdPanel", "#hmPanel", "#spPanel"].forEach((s) => $(s) && $(s).classList.remove("on"));
      MY.view = "home"; render();
    }
  }

  /* ★ 올린 결과를 **숫자로** 보여준다. "올렸습니다"만으로는
     기기에서 줄인 것이 실제로 효과가 있었는지 알 수 없다 —
     이 숫자가 곧 사용자의 데이터 요금이고 우리의 저장비다. */
  async function onPickFile(file) {
    const out = $("#myUpOut");
    if (!out) return;
    out.textContent = "줄이는 중…";
    const up = await API.uploadPhoto(file);
    if (!up.ok) { out.innerHTML = `<b class="bad">올리지 못했습니다</b><small>${esc(up.why || "")}</small>`; return; }
    const kb = (n) => Math.round(n / 1024).toLocaleString();
    const cut = Math.round((1 - up.bytes / up.originalBytes) * 100);
    out.innerHTML = `
      <img src="${esc(up.url)}" alt="">
      <div>
        <b>올라갔습니다</b>
        <small>${kb(up.originalBytes)}KB → <b>${kb(up.bytes)}KB</b>
          ${up.shrunk ? `(${cut}% 줄임 · ${up.w}×${up.h})` : "(원본 그대로 — 축소 실패)"}</small>
        <small class="dim">${esc(up.path)}</small>
      </div>`;
  }

  window.initMy = function () {
    document.body.appendChild(el(`<div id="myPanel" class="glass"><div id="myBody"></div></div>`));
    const tb = $("#tabbar");
    if (tb) {
      tb.addEventListener("click", (e) => {
        const t = e.target.closest("button"); if (!t) return;
        show(t.dataset.tab === "my");
        if (t.dataset.tab === "my")
          document.querySelectorAll("#tabbar button").forEach((x) => x.setAttribute("aria-pressed", x === t));
      });
    }
    $("#myBody").addEventListener("change", (e) => {
      const f = e.target.closest("#myUpFile");
      if (f && f.files && f.files[0]) onPickFile(f.files[0]);
    });

    $("#myBody").addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) { MY.view = "home"; return render(); }
      if (e.target.closest("[data-share]")) return renderShare();
      if (e.target.closest("[data-sido-all]")) { MY.sidoOpen = !MY.sidoOpen; return render(); }
      const pk = e.target.closest("[data-pick]");
      if (pk) return renderPick(pk.dataset.pick);
      const set = e.target.closest("[data-set]");
      if (set) { MY.mainPick[MY.pickFor] = set.dataset.set; return renderPick(MY.pickFor); }
      const sd = e.target.closest("[data-sido]");
      if (sd) {
        const d = bySido().find(([n]) => n === sd.dataset.sido);
        return alert(`${sd.dataset.sido} — ${d[1].got}/${d[1].all}곳\n\n아직 안 간 곳:\n` +
                     d[1].left.slice(0, 12).join(" · ") + (d[1].left.length > 12 ? " …" : ""));
      }
      /* ★ `[data-theme]` 로 잡았더니 **모든 클릭이 여기로 빨려 들어갔다.**
         `index.html` 이 테마를 `:root` 에 `data-theme` 로 걸어 두기 때문에
         `closest()` 가 문서 끝까지 올라가 항상 맞는다.
         아래 어떤 줄도 실행되지 않았고, 새로 붙인 버튼이 그제야 그걸 드러냈다.
         → 속성만으로 잡지 않는다. **그 줄의 클래스까지** 같이 본다. */
      if (e.target.closest(".myEdit[data-edit]")) return alert("프로필 수정 — 닉네임·소개·아바타");
      if (e.target.closest(".myRow[data-theme]")) return alert("지도 테마 — 어두운 지도 / 밝은 지도\n원본 기획서 §10: 다크모드에서 지적도와 사진의 대비가 커집니다.");
      if (e.target.closest(".myRow[data-scope]")) return alert("기본 공개 범위 — 나만 보기 / 스페이스 / 전체\n기록마다 따로 바꿀 수 있습니다.");
      if (e.target.closest(".myRow[data-op]")) return alert("운영자 신청 (§10.46)\n\n운영자는 초대로만 됩니다. 신청은 대기열에 들어갑니다.");
      if (e.target.closest("#myAnon")) {
        const r = await API.signInAnonymously();
        if (!r.ok) return alert("시작하지 못했습니다\n\n" + r.why);
        await renderAccount();
        // 로그인했으니 모아 둔 로그를 보낸다 (§13.17 — 그때까지는 로컬에만 있었다)
        const f = await API.flushCoverEvents();
        console.log("[account] 로그 전송", f);
        return;
      }
    });
  };
  window.__my = MY;
  window.__myVault = vault;
})();
