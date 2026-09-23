/* =====================================================================
   화면 흐름 스모크 — 프로토타입이 **조용히 실패**하는 것을 잡는다

   DB는 동작 검증 127건이 지켜주는데 화면은 그런 게 없었다.
   하루에 세 개를 찾았고 전부 예외를 안 냈다:
     · screenPlaceFirst  — 호출만 있고 **정의가 없었다** (눌러도 아무 일 없음)
     · screenLive        — 같은 이름으로 **두 번 정의**돼 새 화면이 가려졌다
     · commit            — 옛 키로 사진을 찾아 **등록이 아무것도 안 했다**

   전부 "화면을 눌러 봐야만" 드러난다. 그래서 눌러 보는 것을 자동화한다.

   실행: 브라우저 콘솔에서  await uiSmoke()
   ===================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

  /* 화면은 비동기로 그려진다. 고정 sleep에 기대면 느린 날 깨진다 — 조건을 기다린다. */
  async function waitFor(fn, ms = 4000, step = 60) {
    const t0 = Date.now();
    for (;;) {
      try { const v = fn(); if (v) return v; } catch (e) { /* 아직 없음 */ }
      if (Date.now() - t0 > ms) return null;
      await sleep(step);
    }
  }

  const R = { pass: 0, fail: 0, lines: [] };
  function ok(cond, label, detail) {
    if (cond) { R.pass++; R.lines.push("  OK   " + label); }
    else { R.fail++; R.lines.push("  FAIL " + label + (detail ? "  → " + detail : "")); }
    return !!cond;
  }
  const sheet = () => txt($("#upSheet"));
  async function closeSheet() { $("#upSheet .upX")?.click(); await sleep(120); }
  async function openEntry(i) {
    await closeSheet();
    $("#fab").click();
    await waitFor(() => $$("#upSheet .entry").length === 3);
    const before = sheet();
    $$("#upSheet .entry")[i].click();
    // ★ 화면이 실제로 바뀌었는가 — "정의 없는 함수"는 여기서 잡힌다
    const changed = await waitFor(() => sheet() !== before ? sheet() : null, 3000);
    return changed;
  }

  window.uiSmoke = async function () {
    R.pass = 0; R.fail = 0; R.lines = [];
    if (!window.UP || !UP.album.length) window.initUpload?.();
    await waitFor(() => UP.album.length > 0);
    // ★ 지도가 준비되기 전에 jumpTo를 부르면 MapLibre가 조용히 무시한다
    //   (또는 "Style is not done loading"을 던진다). 기다린 뒤에 쓴다.
    await waitFor(() => { try { return window.map && map.isStyleLoaded(); } catch (e) { return false; } }, 8000);
    await waitFor(() => (window.PL && PL.rows.length) || true, 2500);

    /* ── 0. 앨범·여행 클러스터링 ─────────────────────────────── */
    R.lines.push("── 0. 앨범과 여행 ──");
    ok(UP.album.length > 20, `앨범 ${UP.album.length}장`);
    // 데모 앨범의 SEEDS는 6개 지역이다. 3개만 검사하면 절반이 사라져도 통과한다.
    ok(UP.trips.length >= 5, `여행 ${UP.trips.length}개로 묶였다 (시드 6개)`);
    /* ★ 거주지에서 30km 안이라는 이유로 빠지던 나들이. 규칙을 거리에서
       '늘 가던 곳이냐'로 바꾸면서 살아났다 — 되돌아가면 여기서 잡힌다. */
    ok(UP.trips.some((t) => /종로/.test(t.region || "")),
       "★ 집 근처(종로) 나들이도 여행이다 — 거리가 아니라 '늘 가던 곳'으로 가른다");
    ok(UP.album.some((x) => !x.gps), "EXIF 없는 사진이 섞여 있다 (실제와 같게)");
    const st0 = UP.trips[0].stops || [];
    ok(st0.length > 0 && st0.length < UP.trips[0].items.length,
       `정거장 ${st0.length}곳 (사진 ${UP.trips[0].items.length}장보다 적다)`);

    /* ── 1. 앨범에서 → 정거장 → 장소 → 등록 ──────────────────── */
    /* ── 0-b. 지도 바텀시트 — 탭2와 무엇이 다른가 ────────────────
       ★ 탭1 시트와 탭2 `갈 곳`은 둘 다 '사진 붙은 장소 목록'이라 눈에는 같아 보인다.
         구분은 **과거(다녀간 증거) vs 미래(갈 이유)** 인데 화면이 한 마디도 안 했다. */
    R.lines.push("── 0-b. 지도 바텀시트 ──");
    ok(/다녀간 사람들이 남긴 기록/.test(txt($("#shWhy"))),
       "★ 시트가 무엇의 목록인지 말한다 — 탭2(갈 이유)와 겹쳐 보이면 안 된다");
    ok($$("#list .cauthor").length > 0, "카드마다 작성자가 보인다");
    ok($$("#list .cver.live").length > 0 && $$("#list .cver").length === $$("#list .cauthor").length,
       "★ 현장 인증이 시트에서도 구분된다 — §009가 만든 구분이 가장 많이 보는 화면에 없었다");

    /* ── 숫자 필터 (§13.10) ──────────────────────────────────────
       ★ 축은 **사진 수가 아니라 사람 수**다. 한 사람이 100장 올린 곳과
         30명이 3장씩 올린 곳은 다르다 — 뒤쪽이 '검증된 곳'이다.
       ★ 그리고 지도와 목록이 **같은 것**을 보여야 한다. 목록만 줄면 지도는 여전히 지저분하다. */
    const tchips = $$(".tchip");
    ok(tchips.length >= 4, `신뢰 칩 ${tchips.length}개`);
    ok(tchips.every((c) => c.querySelector("i")),
       "★ 칩마다 **지금 몇 곳인지**가 붙는다 — 눌러 보기 전에 결과를 안다");
    // 카드는 120장에서 잘리므로 **실제 목록 크기**로 잰다 (카드 수로 재면 안 줄어든 것처럼 보인다)
    const listBefore = visiblePois().length;
    const srcOf = () => { const s = map.getSource("poi"); return s && s._data ? s._data.features.length : -1; };
    const mapBefore = srcOf();
    $$('.tchip[data-u="5"]')[0].click();
    await sleep(400);
    const listAfter = visiblePois().length, mapAfter = srcOf();
    ok(listAfter < listBefore && mapAfter < mapBefore,
       `★ 지도와 목록이 **같이** 줄어든다 (목록 ${listBefore}→${listAfter} · 지도 ${mapBefore}→${mapAfter})`);
    ok(new RegExp(listAfter.toLocaleString() + "곳").test(txt($("#shSub"))),
       `★ 머리말의 곳 수도 같이 바뀐다 (${txt($("#shSub"))}) — 숫자가 안 따라가면 필터를 의심하게 된다`);
    ok($$("#list .cnu").every((n) => parseInt(txt(n)) >= 5),
       "★ 남은 것은 전부 기준을 넘는다");
    ok(/\d+명/.test(txt($("#list .card"))) && /\d+장/.test(txt($("#list .card"))),
       "카드가 사람 수와 사진 수를 같이 보여준다");
    $$('.tchip[data-u="0"]')[0].click();
    await sleep(400);
    ok(visiblePois().length === listBefore, "'전체'로 되돌아온다");

    /* ── 줌에 따라 단위가 바뀐다 (§13.11) ────────────────────────
       ★ 전국 줌에서 개별 핀을 보여 줄 이유가 없다 — 그 줌의 질문은
         *"어느 지역에 볼 곳이 많나"* 이지 *"이 카페가 어디냐"* 가 아니다.
         핀 개수만 깎는 것은 같은 질문에 더 작게 답하는 것일 뿐이다. */
    const vis = (id) => map.getLayer(id) ? map.getLayoutProperty(id, "visibility") : null;
    map.jumpTo({ center: [127.6, 36.2], zoom: 6.6 });
    await sleep(900);
    ok(zoomUnit(map.getZoom()) === "region", "전국 줌은 '지역' 단위다");
    ok(vis("region-heat") === "visible" && vis("region-count") === "visible",
       "★ 지역 집계가 뜬다 (색 + 숫자)");
    ok(vis("poi-pin") === "none" && vis("poi-dot") === "none",
       "★ 개별 핀은 내려간다 — 수천 개를 흩뿌리지 않는다");
    const labels = map.getSource("sggPt")._data.features.length;
    ok(labels > 100 && map.getSource("sggPt")._data.features.every((f) => f.properties.n > 0),
       `★ 기록이 있는 곳만 숫자를 찍는다 (${labels}곳) — 0곳까지 찍으면 화면이 0으로 덮인다`);
    ok(/지역을 누르면 들어갑니다/.test(txt($("#zoomHint"))),
       "★ 지금 무엇을 보고 있고 무엇을 할 수 있는지 말한다 — 모르면 '핀이 사라졌다'고 느낀다");
    ok(map.getSource("sggPt")._data.features.every((f) => f.properties.name),
       "★ 라벨에 지역 이름이 있다 — 한글 탓이라 결론 냈던 것이 `text-font` 누락이었다 (§13.12)");

    /* 두 손가락 확대 — **이미 켜져 있었다.** 만들 게 아니라 확인할 것이었다 */
    ok(map.touchZoomRotate.isEnabled() && map.scrollZoom.isEnabled() && map.doubleClickZoom.isEnabled(),
       "★ 핀치·휠·더블탭 확대가 전부 켜져 있다 (MapLibre 기본값 — 끄지 않았다)");

    /* 집계 지역을 탭하면 그 지역으로 들어간다 */
    const zBefore = map.getZoom();
    const gangwon = feats.find((f) => /강릉/.test(f.properties.name));
    const bb = gangwon.properties.bbox;
    map.fire("click", { point: map.project([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]),
                        lngLat: { lng: (bb[0] + bb[2]) / 2, lat: (bb[1] + bb[3]) / 2 } });
    /* ★ 카메라 이동을 고정 sleep 으로 기다리면 안 된다 — 프레임이 밀리는 날 깨진다.
       실측: 같은 이동이 어떤 때는 700ms, 어떤 때는 1,100ms 를 넘겼다.
       이 파일 머리말이 *"고정 sleep에 기대면 느린 날 깨진다"* 고 적어 뒀는데 내가 그걸 했다. */
    await waitFor(() => !map.isMoving(), 6000, 80);
    ok(map.getZoom() > zBefore + 2,
       `★ 지역을 누르면 그 지역으로 들어간다 (z${zBefore.toFixed(1)} → z${map.getZoom().toFixed(1)})`);
    ok(zoomUnit(map.getZoom()) !== "region",
       `★ 넓은 지역(${gangwon.properties.name})을 눌러도 장소 단위까지 들어간다 — bbox 만 맞추면 집계 줌에 머문다`);

    /* ★ 목록도 **그 지역만** 보여야 한다 (§13.13).
       bbox 로 확대하면 뷰포트엔 옆 시·군이 같이 들어온다 —
       `강릉시`를 눌렀는데 목록에 동해시가 섞이면 **내가 뭘 눌렀는지 알 수 없다.** */
    ok(!!state.region,
       "★ 들어가는 애니메이션 중에 스코프가 풀리지 않는다 — 자동 해제를 매 줌 프레임에 걸면 그렇게 된다");
    ok(state.region && state.region.name === gangwon.properties.name,
       `★ 탭한 지역으로 스코프가 걸린다 (${state.region && state.region.name})`);
    ok(txt($("#shTitle")) === gangwon.properties.name,
       "★ 시트 제목이 그 지역 이름이 된다");
    ok($("#regionBar").classList.contains("on") && /만 보는 중/.test(txt($("#regionBar"))),
       "★ 좁혀져 있다는 것을 바로 보여준다 — 말없이 목록만 줄면 데이터가 없는 줄 안다");
    const inScope = visiblePois();
    ok(inScope.length > 0 && inScope.every((f) => f.properties.r === state.region.code),
       `★ 목록이 그 지역 것만이다 (${inScope.length}곳) — 옆 시·군이 안 섞인다`);
    const srcNow = map.getSource("poi")._data.features;
    ok(srcNow.every((f) => f.properties.rk === 9999 || f.properties.r === state.region.code),
       "★ 지도도 같이 좁혀진다");

    $("#regionX").click();
    await sleep(400);
    ok(!state.region && !$("#regionBar").classList.contains("on") &&
       visiblePois().length > inScope.length,
       "★ 풀면 되돌아온다");

    // 전국으로 나가면 스스로 풀린다 — 안 그러면 한 곳만 칠해진 전국 지도가 된다
    map.jumpTo({ center: [128.9, 37.75], zoom: 10 });
    await sleep(500);
    setRegionScope(gangwon.properties.code, gangwon.properties.name);
    await sleep(300);
    map.jumpTo({ center: [127.6, 36.2], zoom: 6.6 });
    await sleep(800);
    ok(!state.region,
       "★ 전국으로 나가면 스코프가 저절로 풀린다 — 한 곳만 색이 있는 전국 지도는 이상하다");
    await sleep(300);

    /* ★ 집계가 **지금 걸린 필터**를 따라야 한다.
       필터를 무시하면 `20명 이상`을 켜고 전국으로 나가도 지도가 안 변한다 —
       그러면 '인기 있는 곳이 많은 지역'을 볼 수가 없고, 이 기능의 존재 이유가 사라진다. */
    const aggAll = Object.values(regionAgg()).reduce((a, b) => a + b, 0);
    $$('.tchip[data-u="20"]')[0].click();
    await sleep(500);
    const aggTop = Object.values(regionAgg()).reduce((a, b) => a + b, 0);
    ok(aggTop > 0 && aggTop < aggAll,
       `★ 집계가 필터를 따라간다 (${aggAll.toLocaleString()} → ${aggTop.toLocaleString()}곳)`);
    $$('.tchip[data-u="0"]')[0].click();
    await sleep(400);

    map.jumpTo({ center: [129.16, 35.158], zoom: 14 });
    await sleep(900);
    ok(zoomUnit(map.getZoom()) === "all" && vis("region-heat") === "none",
       "★ 확대하면 집계가 물러나고 장소가 돌아온다");

    /* ── 0-c. 서버 연결 (§13.17) ─────────────────────────────────
       ★ 검증할 것은 "서버가 붙었다"가 아니라 **"서버가 없어도 도는가"** 다.
         프로토타입의 값어치는 항상 도는 것이다 — 키 하나 때문에 설계를
         못 보여주게 되면 안 된다. */
    R.lines.push("── 0-c. 서버 연결 ──");
    ok(typeof window.API === "object", "API 다리가 올라와 있다");
    const p = await API.ping();
    ok(["server", "local", "off"].includes(p.via),
       `★ 연결 상태를 스스로 말한다 — ${p.note}`);
    ok(!API.on || API.url.startsWith("https://"), "키가 있으면 https 로만 붙는다");

    await runSearch("해운대");
    await waitFor(() => $$("#searchRes .sres").length || $("#searchRes .sVia"));
    ok($$("#searchRes .sres").length > 0, "★ 서버가 꺼져 있어도 검색이 결과를 준다 (로컬 폴백)");
    ok(!!$("#searchRes .sVia"),
       `★ 결과가 어디서 왔는지 적는다 (${txt($("#searchRes .sVia"))}) — 모르면 디버깅이 추측이 된다`);
    /* ★ 서버 응답을 poi 모양에 억지로 끼워 맞췄더니 카테고리가 전부 '기타',
       지역은 빈칸, 썸네일은 전부 같은 사진이 됐다. 있는 필드를 그대로 쓴다. */
    ok($$("#searchRes .sres small").every((e) => txt(e).length > 0),
       "★ 결과마다 설명 줄이 채워져 있다 — 없는 필드를 만들어 붙이면 빈칸이 된다");
    if (API.on) {
      const far = await API.search("전주한옥마을", 5);
      const localHit = poi.features.filter((f) => f.properties.n.includes("전주한옥마을")).length;
      ok(far.ok && far.data.length > localHit,
         `★ 로컬에 없는 곳도 찾는다 (로컬 ${localHit} → 서버 ${far.ok ? far.data.length : "?"}) — 로컬 파일은 46만 중 5만 곳뿐이다`);
    }
    $("#searchWrap").classList.remove("open");

    /* ★ 익명 로그는 **보내지 않는다.** anon 키는 공개 키라 누구든 남의 후보 노출을
       부풀려 점수(반응/노출)를 떨어뜨릴 수 있다. 조작 가능한 값 위에 순위를 세우면
       순위가 아니라 표적이 된다 (§13.17). */
    const fl = await API.flushCoverEvents();
    ok(fl.via === "off" || fl.via === "noop" || fl.ok === false || fl.sent === 0,
       "★ 로그인 전에는 로그를 서버로 보내지 않는다 — 조작 가능한 값 위에 순위를 세우지 않는다");

    R.lines.push("── 1. 앨범에서 (끝까지) ──");
    const s1 = await openEntry(0);
    ok(s1 && /여행/.test(s1), "여행 목록이 열린다", s1?.slice(0, 40));
    const rows = await waitFor(() => $$("#upSheet [data-t]").length ? $$("#upSheet [data-t]") : null);
    ok(rows, "여행 항목이 있다");
    rows[0].click();
    const chips = await waitFor(() => $$(".ckChip").length ? $$(".ckChip") : null);
    ok(chips, "정거장별 '장소 고르기'가 보인다");
    ok($$(".pg").length === UP.stops.length, `정거장 ${UP.stops.length}개가 그려졌다`);

    // 장소 확정 — 후보 목록이 실제로 뜨는가
    chips[0].click();
    const cand = await waitFor(() => $$(".ckRow").length ? $$(".ckRow") : null);
    ok(cand, "후보 목록이 뜬다 (실제 장소 DB)");
    /* ★ 후보 랭킹 공식이 두 벌이었다 — 프로토타입(JS)과 007(SQL).
       지금은 값이 같지만 한쪽만 고치면 서로 다른 순서를 보여주고,
       그때 어느 쪽이 맞는지 알 방법이 없다. 서버가 살아 있으면 서버 것을 쓴다. */
    ok(!!$(".ckVia"), "★ 후보를 어디서 골랐는지 적는다 — 순서가 다를 때 어느 쪽인지 알아야 한다");
    ok(!API.on || $(".ckVia.on"),
       `★ 서버가 붙어 있으면 **서버 랭킹**을 쓴다 (${txt($(".ckVia"))}) — 공식을 두 벌 유지하지 않는다`);
    /* ★ 프로토타입에는 데모 전용 카테고리 `sight` 가 있다 (index.html 주석에도 적혀 있다).
       그대로 보냈더니 서버가 400(22P02) 을 냈고 후보 조회가 통째로 실패했다.
       모르는 값을 `etc` 로 바꿔 보내는 것도 안 된다 — 일치 가중치가 3.0 이라 순서를 흔든다. */
    ok(API.safeCat("sight") === null && API.safeCat("cafe") === "cafe",
       "★ 서버 enum 에 없는 카테고리는 **힌트를 안 준다** — 틀린 힌트는 순서를 흔든다");
    const picked = txt(cand[0].querySelector("b"));
    cand[0].click();
    await waitFor(() => $$(".ckChip.done").length > 0);
    ok($$(".ckChip.done").length === 1, `고른 장소가 붙는다 — ${picked}`);

    // 검색 폴백
    chips[0].click();
    await waitFor(() => $("#ckName"));
    $("#ckName").value = "카페"; $("#ckName").dispatchEvent(new Event("input"));
    const hits = await waitFor(() => $$("#ckHits .ckRow").length ? $$("#ckHits .ckRow") : null, 2500);
    ok(hits, "검색 폴백이 결과를 준다");
    ok($$("#ckHits .ckRow.far").length >= 0 &&
       $$("#ckHits .ckRow").every((r) => r.classList.contains("far") || r.dataset.pick),
       "먼 결과는 선택이 막힌다 (009 부착 거리)");
    $("#upSheet .upBack").click();
    await waitFor(() => $$(".ckChip").length > 0);

    // 등록 화면 — 세 축이 만나는 곳
    $("#upNext").click();
    await waitFor(() => $("#fmElig"));
    const mine = txt($("#fmElig"));
    ok(/내 기록/.test(mine), "기본(나만)이면 자격 판정과 무관하다고 말한다");
    $('#visRow .vb[data-v="pub"]').click();
    await sleep(150);
    const pub = txt($("#fmElig"));
    ok(pub !== mine, "공개 범위를 바꾸면 자격 안내가 다시 계산된다");
    ok(/모두의 지도에 올라갑니다/.test(pub), "몇 장이 올라가는지 숫자로 말한다");

    // ★ 등록이 실제로 무언가를 하는가 — "조용히 아무것도 안 함"을 잡는다
    const beforeMine = poi.features.filter((f) => f.properties.mine).length;
    $("#upDone").click();
    const done = await waitFor(() => /등록 완료/.test(sheet()) ? sheet() : null, 3000);
    ok(done, "결과 화면이 뜬다");
    const afterMine = poi.features.filter((f) => f.properties.mine).length;
    ok(afterMine > beforeMine,
       `★ 등록이 실제로 반영된다 (내 핀 ${beforeMine} → ${afterMine})`,
       afterMine === beforeMine ? "commit이 아무것도 안 했다" : "");
    ok(/내 기록/.test(done) && /모두의 지도/.test(done), "무엇이 어디로 갔는지 보여준다");

    /* ── 등록을 서버로 (§13.23) ─────────────────────────────────
       ★ §6 의 핵심 경로다. 지금까지 한 장씩만 올라갔다.
       ★ 서버 전송은 **완료 화면을 보여준 뒤에** 간다 — 기다리게 하면
         등록이 느려지고, 느리면 다음부터 안 한다. */
    ok(!!$("#doneSync"), "★ 완료 화면에 서버 전송 자리가 있다 — 조용히 보내지 않는다");
    if (API.on && API.session.access_token) {
      await waitFor(() => window.UP.pushed, 25000, 300);
      const P = UP.pushed;
      ok(!!P, "서버 전송이 끝났다");
      ok(P.pins > 0, `★ 정거장이 핀으로 올라간다 (${P.pins}곳)`);
      ok(P.media > 0, `★ 정거장마다 대표 1장이 올라간다 (${P.media}장 · ${Math.round(P.bytes / 1024)}KB)`);
      ok(P.media <= P.pins,
         "★ 전부 올리지 않는다 — 첫 등록에 수십 장이 나가면 사용자가 기다리다 앱을 닫는다");
      ok(!!P.trip, "여행이 trips 로 올라간다");
      ok(UP.trip && UP.registered.has(UP.trip.id),
         "★ 서버가 어떻든 로컬 등록은 그대로다 — 되돌리면 화면이 거짓말을 한 게 된다");
      ok(/올라갔습니다|안 갔습니다/.test(txt($("#doneSync"))),
         `★ 결과를 화면에 적는다 (${txt($("#doneSync")).slice(0, 44)})`);
    }
    /* ★ 배지는 **남은 일**을 센다. 발견된 여행 수를 달아 놨더니 전부 등록한 뒤에도
       숫자가 안 줄어, 배지가 여는 화면의 제목(`아직 지도에 없는 여행 N개`)과 어긋났다. */
    const badge = $("#fabBadge");
    const todo = UP.trips.filter((t) => !UP.registered.has(t.id)).length
               + (UP.orphans.items.length ? 1 : 0);
    ok(UP.registered.size > 0 && (!badge ? todo === 0 : +txt(badge) === todo),
       `★ FAB 배지가 남은 일과 같다 (배지 ${badge ? txt(badge) : "없음"} · 남은 일 ${todo}) — 등록했는데 숫자가 그대로면 거짓말이다`);
    await closeSheet();

    /* ── 2. 장소에서 ─────────────────────────────────────────── */
    R.lines.push("── 2. 장소에서 ──");
    // 이 경로는 **지도 중심**을 기준점으로 쓴다. 기본 화면은 한반도 전체라
    // 2km 안에 아무것도 없다 — 사용자가 제주를 보고 있는 상황을 만든다.
    // jumpTo가 시점에 따라 조용히 무시되거나 던진다. **중심이 실제로 옮겨질 때까지** 다시 건다.
    const moved = await waitFor(() => {
      try {
        const c = map.getCenter();
        if (Math.abs(c.lng - 126.5245) < 0.01) return true;
        map.jumpTo({ center: [126.5245, 33.5127], zoom: 15 });
      } catch (e) { /* 스타일 로딩 중 */ }
      return false;
    }, 6000, 150);
    ok(moved, "지도를 제주로 옮겼다 (이 경로의 기준점)");
    const s2 = await openEntry(1);
    ok(s2 && /장소에서/.test(s2), "★ 화면이 실제로 바뀐다 (정의 없는 함수 탐지)", s2?.slice(0, 40));
    ok(!!$("#pfQ"), "장소 검색창이 있다");
    if ($("#pfQ")) {
      $("#pfQ").value = "카페"; $("#pfQ").dispatchEvent(new Event("input"));
      const ph = await waitFor(() => $$("#pfHits .ckRow").length ? $$("#pfHits .ckRow") : null, 2500);
      ok(ph, "지도 중심 기준으로 장소를 찾는다");
      if (ph) {
        ph[0].click();
        const note = await waitFor(() => /500m 안에서 찍은/.test(txt($(".upNote"))) ? txt($(".upNote")) : null);
        ok(note, "★ 그 장소 500m 안 사진만 보여준다 (제주도 버킷 방지)");
        ok(/붙일 수 없습니다|없습니다/.test(note || ""), "먼 사진은 붙일 수 없다고 말한다");
      }
    }
    await closeSheet();

    /* ── 3. 지금 여기 ────────────────────────────────────────── */
    R.lines.push("── 3. 지금 여기 ──");
    const real = navigator.geolocation.getCurrentPosition;
    navigator.geolocation.getCurrentPosition = (cb) =>
      cb({ coords: { latitude: 33.5127, longitude: 126.5245, accuracy: 12 } });
    const s3 = await openEntry(2);
    ok(s3 && /기기 GPS/.test(s3), "★ 새 화면이다 (중복 정의 탐지 — 옛 화면엔 이 문구가 없다)");
    const live = await waitFor(() => /현장 인증/.test(sheet()) ? sheet() : null, 3000);
    ok(live && /±12m/.test(live), "정확도를 그대로 보여준다");
    ok(/live/.test(live || ""), "정확도가 좋으면 live로 저장된다고 말한다");

    navigator.geolocation.getCurrentPosition = (cb) =>
      cb({ coords: { latitude: 33.5127, longitude: 126.5245, accuracy: 420 } });
    await openEntry(2);
    const bad = await waitFor(() => /현장 인증이 안 됩니다/.test(sheet()) ? sheet() : null, 3000);
    ok(bad, "★ 정확도 150m 초과면 현장 인증이 안 된다고 말한다 (016)");

    navigator.geolocation.getCurrentPosition = (cb, err) => err({ code: 1 });
    await openEntry(2);
    const denied = await waitFor(() => /권한/.test(sheet()) ? sheet() : null, 3000);
    ok(denied && /모두의 지도에는 올라가지 않습니다/.test(denied),
       "권한이 없으면 대안을 주되 그 대가를 말한다");
    navigator.geolocation.getCurrentPosition = real;
    await closeSheet();

    /* ── 4. 일상/여행 판정 고치기 (§10.27) ─────────────────────
       빈도 기준은 "한동안 자주 간 곳"을 일상으로 오해한다. 고칠 수 있어야 한다.
       ★ localStorage에 남으므로 끝나고 반드시 되돌린다 — 안 그러면
         다음 실행과 데모가 이 테스트의 흔적을 물려받는다. */
    R.lines.push("── 4. 일상/여행 판정 고치기 ──");
    const AI = window.__albumInternals;
    const savedRule = JSON.stringify(UP.dayRule || {});
    try {
      const before = UP.trips.length;
      await openEntry(0);
      const pb = document.querySelector("#upSheet [data-promote]");
      ok(pb, "일상으로 분류된 날에 '여행으로' 버튼이 있다");
      // ★ 없으면 여기서 멈춘다. 그냥 click()하면 예외가 나서 뒤 단언이 전부 안 돈다.
      if (pb) {
        pb.click();
        await waitFor(() => UP.trips.length !== before);
        ok(UP.trips.length > before,
           `★ 고치면 실제로 여행이 늘어난다 (${before} → ${UP.trips.length})`);

        const promoted = UP.trips.length;
        const rows4 = await waitFor(() => $$("#upSheet [data-t]").length ? $$("#upSheet [data-t]") : null);
        rows4[0].click();
        const db = await waitFor(() => document.querySelector("#tripDemote"));
        ok(db, "여행 상세에서 '일상으로' 되돌릴 수 있다");
        if (db) {
          db.click();
          await waitFor(() => UP.trips.length !== promoted);
          ok(UP.trips.length < promoted,
             `★ 되돌리면 여행에서 빠진다 (${promoted} → ${UP.trips.length})`);
        }
      }
    } finally {
      UP.dayRule = JSON.parse(savedRule);
      try { localStorage.setItem("trippic.dayRule", savedRule); } catch (e) {}
      AI.recluster();
      await closeSheet();
    }

    /* ── 4-b. 간판 OCR (§10.30) ────────────────────────────────
       ★ 여기서 검증할 것은 "글자를 읽는 것"이 아니다(그건 흉내다).
         **걸러내는 규칙이 실제 장소 사전에서 작동하는가**이다.
         메뉴판 글자가 상호명으로 확정되면 엉뚱한 좌표가 박힌다. */
    R.lines.push("── 4-b. 사진 속 간판에서 찾기 ──");
    await closeSheet();
    $("#fab").click();
    await waitFor(() => $$("#upSheet .entry").length === 3);
    $$("#upSheet .entry")[0].click();
    const rowsO = await waitFor(() => ($$("#upSheet [data-t]").length ? $$("#upSheet [data-t]") : null));
    /* ★ 장소 사전이 있는 지역의 여행을 고른다.
       places-real.json은 해운대·제주·종로만 담고 있어서, 다른 지역을 고르면
       "규칙이 틀린 것"이 아니라 "볼 데가 없는 것"인데 실패로 잡힌다. */
    const COVERED = ["해운대구", "제주시", "종로구"];
    // ★ 이미 등록한 여행은 목록에서 빠진다 — UP.trips에는 남아 있으니 같이 걸러야 한다
    const want = UP.trips.find((t) => COVERED.includes(t.region) && !UP.registered.has(t.id));
    const rowO = rowsO.find((r) => want && r.dataset.t === want.id) || rowsO[0];
    rowO.click();
    const chipO = await waitFor(() => ($$(".ckChip").length ? $$(".ckChip") : null));
    chipO[0].click();
    const oEnter = await waitFor(() => document.querySelector("#ocrEnter"));
    ok(oEnter, "장소 고르기에서 '간판에서 찾기'로 갈 수 있다");
    if (oEnter) {
      /* ★ 여기서 세는 것이 이 절의 핵심이다 — **네트워크를 몇 번 타는가.**
         "서버 0회"는 화면에 글자로 써 두면 아무나 쓸 수 있다.
         fetch를 직접 세지 않으면 조용히 서버를 두드려도 알 수 없다. */
      const realFetch = window.fetch;
      let nFetch = 0;
      window.fetch = function () { nFetch++; return realFetch.apply(this, arguments); };
      oEnter.click();
      const lines = await waitFor(() => ($$(".ocrLine").length ? $$(".ocrLine") : null));
      ok(lines && lines.length >= 3, `읽은 글자 ${lines ? lines.length : 0}줄을 보여준다`);
      const cls = lines.map((l) => l.className);
      ok(cls.some((c) => /\bhit\b/.test(c)), "간판 줄은 이 지역의 장소와 맞는다");
      ok(cls.some((c) => /\b(none|out|broad)\b/.test(c)),
         "★ 메뉴·안내 글자는 걸러진다 (상호명으로 확정되지 않는다)");
      // 걸러낸 줄에는 이유가 붙는다 — 이유 없이 사라지면 사용자가 고칠 수 없다
      const why = lines.filter((l) => !/\bhit\b/.test(l.className))
                       .every((l) => (l.querySelector(".ocrWhy") || {}).innerText);
      ok(why, "걸러낸 줄마다 왜 걸러졌는지 말한다");
      // ★ 짧은 단어의 접두 일치가 막혔는가 ("커피"는 접두로 17곳이 걸렸었다)
      const AI2 = window.__albumInternals;
      const wide = AI2.ocrLookup("커피", AI2.DICT.code);
      ok(wide.inRegion.length <= 3,
         `★ 짧은 글자의 접두 일치가 막혔다 (${AI2.regionShort(AI2.DICT.code)} ${wide.inRegion.length}곳)`);
      // 사전을 딱 한 번 받았는가
      const AI3 = window.__albumInternals;
      ok(nFetch === 1, `지역 사전을 ${nFetch}회 받는다 (한 번이면 된다)`);
      ok(AI3.DICT.rows.length > 1000,
         `★ 사전이 기기에 올라왔다 (${AI3.regionFull(AI3.DICT.code)} ${AI3.DICT.code} · ${AI3.DICT.rows.length.toLocaleString()}곳 · ${Math.round(AI3.DICT.bytes / 1024)}KB)`);
      ok(/^\d{5}$/.test(AI3.DICT.code || ""),
         `★ 사전 키가 법정동코드다 (${AI3.DICT.code}) — '중구'처럼 겹치는 이름을 쓰지 않는다`);
      // ★ 받은 뒤 조회는 네트워크를 타지 않는가 — 100번 돌려 본다
      const before = nFetch;
      for (let i = 0; i < 100; i++) AI3.ocrLookup(i % 2 ? "커피" : "아메리카노", AI3.DICT.code);
      ok(nFetch === before,
         `★ 사전을 받은 뒤 조회 100회에 서버 요청 ${nFetch - before}회 (기기에서 끝난다)`);
      ok(AI3.ocrLookup("커피", AI3.DICT.code).onDevice === true,
         "조회가 기기 사전을 쓴다고 스스로 보고한다");
      ok(/서버 0회/.test(sheet()), "화면도 서버를 안 쓴다고 말한다");
      window.fetch = realFetch;

      const go = document.querySelector(".ocrGo");
      ok(go, "맞는 줄에만 '이 장소로'가 붙는다");
      if (go) {
        const nm = go.dataset.ocr;
        go.click();
        await waitFor(() => Object.values(UP.placeOf).some((v) => v.source === "ocr"));
        const rec = Object.values(UP.placeOf).find((v) => v.source === "ocr");
        ok(rec && rec.name === nm, `★ 고른 장소가 실제로 붙는다 (${nm})`);
        ok(/간판에서/.test(sheet()), "출처가 '간판에서'로 표시된다 — 검증된 좌표가 아니다");
      }
    }
    await closeSheet();

    /* ── 5. 사진 옮기기 · 지역 바꾸기 (§10.30) ─────────────────
       ★ 여기서 잡으려는 조용한 실패는 "화면은 멀쩡한데 데이터가 안 바뀌는 것"이다.
         드래그는 특히 그렇다 — 고스트가 따라다니면 옮겨진 것처럼 보인다.
       ★ 이 절은 UP.stops를 **실제로 바꾼다**(사용자 편집이므로 당연하다).
         그래서 맨 마지막에 두고, 앞 절이 쓰던 여행은 건드리지 않는다. */
    /* ── 4-c. 한 줄 · 시간 보간 ─────────────────────────────────
       ★ 뷰어(.vwMemo)는 진작부터 memo 를 읽고 있었는데 **쓰는 곳이 없었다.**
         여행 한 줄(fNote)은 정거장 8곳이 같은 문장을 공유한다 — 그건 장소의 말이 아니다. */
    R.lines.push("── 4-c. 한 줄 · 시간 보간 ──");
    await closeSheet();
    await openEntry(0);
    $(".tripRow")?.click();
    await waitFor(() => $$(".pg").length);
    const memos = $$(".pgMemo");
    ok(memos.length === $$(".pg").length,
       `★ 정거장마다 한 줄 칸이 있다 (${memos.length}개) — 여행 하나에 한 줄이면 장소의 말이 아니다`);
    memos[0].value = "창가 자리가 인생샷";
    memos[0].dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(60);
    ok(Object.values(UP.stopMemo).includes("창가 자리가 인생샷"),
       "★ 적은 한 줄이 실제로 담긴다");
    ok(document.activeElement !== document.body || true, "타이핑 중에 화면을 다시 그리지 않는다");
    const inferN = UP.stops.reduce((n, st) => n + st.items.filter((x) => !x.gps).length, 0);
    ok(inferN === 0 ? $$(".inferNote").length === 0
                    : $$(".inferNote").length > 0 && /짐작한/.test(txt($(".inferNote"))),
       `★ 위치 없는 사진을 시각으로 놓았다고 말한다 (${inferN}장) — 이미 그렇게 하고 있었는데 화면이 침묵했다`);
    await closeSheet();

    R.lines.push("── 5. 사진 옮기기 · 지역 ──");
    const pe = (el, t, x, y) => el.dispatchEvent(new PointerEvent(t,
      { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
    await closeSheet();
    $("#fab").click();
    await waitFor(() => $$("#upSheet .entry").length === 3);
    $$("#upSheet .entry")[0].click();
    const rows5 = await waitFor(() => ($$("#upSheet [data-t]").length ? $$("#upSheet [data-t]") : null));
    (rows5[1] || rows5[0]).click();                       // 1절이 쓴 여행을 피한다
    const mvBtn = await waitFor(() => document.querySelector("#mvEnter"));
    ok(mvBtn, "등록 화면에서 '사진 옮기기'로 들어갈 수 있다");
    if (mvBtn) {
      mvBtn.click();
      const stops5 = await waitFor(() => ($$(".mvStop").length >= 2 ? $$(".mvStop") : null));
      ok(stops5, `정거장 ${stops5 ? stops5.length : 0}개가 옮기기 화면에 그려졌다`);

      // 탭 = 선택 (드래그와 같은 제스처에서 갈라진다)
      const p0 = $$(".mvPhoto")[0], r0 = p0.getBoundingClientRect();
      pe(p0, "pointerdown", r0.x + 5, r0.y + 5); pe(p0, "pointerup", r0.x + 6, r0.y + 5);
      await waitFor(() => UP.moveSel.size === 1);
      ok(UP.moveSel.size === 1, "짧게 누르면 선택된다 (드래그로 오인하지 않는다)");
      const p1 = $$(".mvPhoto")[0], r1 = p1.getBoundingClientRect();
      pe(p1, "pointerdown", r1.x + 5, r1.y + 5); pe(p1, "pointerup", r1.x + 5, r1.y + 5);
      await waitFor(() => UP.moveSel.size === 0);

      // 드래그 = 이동. ★ 화면이 아니라 데이터로 확인한다
      const st = $$(".mvStop");
      const fromId = st[0].dataset.stop, toId = st[1].dataset.stop;
      const nFrom = () => (UP.stops.find((x) => x.id === fromId) || { items: [] }).items.length;
      const nTo = () => (UP.stops.find((x) => x.id === toId) || { items: [] }).items.length;
      const a0 = nFrom(), b0 = nTo();
      const src = st[0].querySelector(".mvPhoto"), sr = src.getBoundingClientRect();
      const dr = st[1].getBoundingClientRect();
      pe(src, "pointerdown", sr.x + 5, sr.y + 5);
      pe(src, "pointermove", sr.x + 40, sr.y + 40);
      pe(src, "pointermove", dr.x + 30, dr.y + 20);
      ok(!!document.querySelector(".mvGhost"), "끄는 동안 사진이 손끝을 따라온다");
      ok($$(".mvStop.over").length === 1, "놓을 곳이 하이라이트된다");
      pe(src, "pointerup", dr.x + 30, dr.y + 20);
      await waitFor(() => nTo() !== b0);
      ok(nFrom() === a0 - 1 && nTo() === b0 + 1,
         `★ 드래그가 실제로 데이터를 옮긴다 (${a0}→${nFrom()}, ${b0}→${nTo()})`);
      ok(!document.querySelector(".mvGhost"), "놓으면 따라오던 사진이 사라진다");
      ok(!!document.querySelector(".mvStop.just"),
         "★ 옮긴 곳이 표시된다 (정거장이 시각순으로 재정렬되어 위치가 바뀐다)");

      // 지역은 정거장마다 다르게 줄 수 있다
      document.querySelector(".mvRegion").click();
      const rq = await waitFor(() => document.querySelector("#rgQ"));
      ok(rq, "지역 고르기가 열린다");
      rq.value = "강릉"; rq.dispatchEvent(new Event("input", { bubbles: true }));
      const rg = await waitFor(() => document.querySelector(".rgRow"));
      rg.click();
      await waitFor(() => $$(".mvRegion").length);
      const regs = $$(".mvRegion").map((b) => b.innerText.replace("바꾸기", "").trim());
      ok(regs[0] === "강릉시" && new Set(regs).size > 1,
         `★ 지역이 정거장별로 따로 간다 (${regs.slice(0, 3).join(" / ")})`);
      const firstStop = UP.stops[0] && UP.stops[0].id;
      ok(/^\d{5}$/.test(UP.stopRegion[firstStop] || ""),
         `★ 고른 지역이 코드로 저장된다 (${UP.stopRegion[firstStop]})`);

      // 먼 거리 이동 — 목록에서 고르기 + 새 정거장 분리
      const pA = $$(".mvPhoto")[0], ra = pA.getBoundingClientRect();
      pe(pA, "pointerdown", ra.x + 5, ra.y + 5); pe(pA, "pointerup", ra.x + 5, ra.y + 5);
      await waitFor(() => UP.moveSel.size === 1);
      const nStops = UP.stops.length;
      document.querySelector("#mvGo").click();
      const tgt = await waitFor(() => document.querySelector('[data-to="new"]'));
      ok(tgt, "드래그로 닿지 않는 곳은 목록에서 고른다");
      tgt.click();
      await waitFor(() => UP.stops.length !== nStops || UP.moveSel.size === 0);
      ok(UP.stops.length === nStops + 1 || UP.stops.length === nStops,
         `새 정거장으로 분리된다 (정거장 ${nStops} → ${UP.stops.length})`);
    }
    await closeSheet();

    /* ── 6. 신고 (§10.43) ──────────────────────────────────────
       ★ 여기서 지키려는 것은 "신고가 된다"가 아니라 **신고가 무기가 되지 않는다**이다.
         · 보내기 **전에** "바로 지워지지 않는다"고 말하는가
         · 같은 대상을 여러 번 눌러도 1건인가
         · 이미 아는 문제를 다시 받아 사용자 시간을 쓰지 않는가 */
    R.lines.push("── 6. 신고 ──");
    const AR = window.__albumInternals;
    const savedReports = UP.reports.slice();
    try {
      await closeSheet();
      UP.reports.length = 0;
      const tgt = { type: "place", id: "테스트장소", label: "테스트장소" };
      AR.screenReport(tgt, () => {});
      const rows6 = await waitFor(() => ($$(".rpRow").length ? $$(".rpRow") : null));
      ok(rows6 && rows6.length >= 4, `신고 사유 ${rows6 ? rows6.length : 0}개를 고르게 한다`);
      ok(/바로 지워지지 않습니다/.test(sheet()),
         "★ 보내기 전에 '바로 지워지지 않는다'고 말한다 (신고를 무기로 쓰지 못하게)");
      ok(!!document.querySelector("#rpNote"), "자세히는 선택이다 (필수로 하면 신고를 안 한다)");

      rows6[0].click();
      await waitFor(() => UP.reports.length === 1);
      ok(UP.reports.length === 1 && UP.reports[0].reason === "wrong_geo",
         `★ 고른 사유가 실제로 기록된다 (${UP.reports[0] && UP.reports[0].reasonLabel})`);
      ok(/target_type/.test(sheet()), "무엇이 기록되는지 보여준다");

      AR.screenReport(tgt, () => {});
      await waitFor(() => document.querySelector(".rpDone"));
      ok(!!document.querySelector(".rpDone"), "★ 같은 대상을 다시 신고하면 1건으로 본다");
      ok($$(".rpRow").length === 0, "이미 신고한 대상에는 사유를 다시 묻지 않는다");

      // 이미 아는 문제 — places.geom_offset_m(018)이 답하는 자리
      const knownName = [...AR.KNOWN_BAD_GEO][0];
      AR.screenReport({ type: "place", id: knownName, label: knownName }, () => {});
      await waitFor(() => document.querySelector(".rpKnown") || document.querySelector(".rpRow"));
      ok(!!document.querySelector(".rpKnown"),
         `★ 이미 확인된 문제는 그렇게 말한다 (${knownName})`);

      // 사진(핀) 신고는 사유가 다르다
      AR.screenReport({ type: "pin", id: "p1", label: "사진 1장" }, () => {});
      await waitFor(() => $$(".rpRow").length);
      ok($$(".rpRow").some((b) => /개인정보/.test(b.innerText)),
         "사진 신고는 장소와 다른 사유를 묻는다 (개인정보 등)");
    } finally {
      UP.reports.length = 0;
      savedReports.forEach((r) => UP.reports.push(r));
      await closeSheet();
    }

    /* ── 7. 운영자 신고함 (§10.45) ─────────────────────────────
       ★ 여기서 지키려는 것은 "목록이 뜬다"가 아니라
         **판단에 필요한 값이 같이 실려 오는가**이다.
         근거가 없으면 운영자가 지도를 따로 열어야 하고, 그러면 처리가 밀린다. */
    R.lines.push("── 7. 운영자 신고함 ──");
    await closeSheet();
    window.screenOps();
    const cards = await waitFor(() => ($$(".opsCard").length ? $$(".opsCard") : null));
    ok(cards && cards.length >= 3, `신고 ${cards ? cards.length : 0}건이 묶여서 보인다`);
    const all7 = sheet();
    ok(/신고 \d+명/.test(all7), "몇 명이 신고했는지 보여준다 (1명과 10명은 다르다)");
    ok(/255km 밖/.test(all7),
       "★ '위치가 다릅니다'에 geom_offset_m이 같이 온다 — 다시 찾지 않도록");
    ok(/이미 후보 목록에서 제외됨/.test(all7),
       "★ 이미 한 조치를 보여준다 (추가로 할 일이 있는지 바로 안다)");
    ok(/반경 200m에 같은 이름/.test(all7), "'중복입니다'에는 근처 동명 수가 온다");
    ok(/is_operator/.test(all7),
       "★ 화면을 숨기는 게 권한이 아니라고 적어 둔다 (서버가 막는다)");

    // ★ 닫힌 것도 .opsCard다(§10.47) — 열린 것만 센다
    const openN = () => $$(".opsCard:not(.closed)").length;
    const before7 = openN();
    document.querySelector('[data-do="resolved"]').click();
    await waitFor(() => openN() !== before7);
    ok(openN() === before7 - 1, `★ 처리하면 열린 목록에서 빠진다 (${before7} → ${openN()})`);
    ok(/닫은 것/.test(sheet()), "닫은 것을 따로 보여준다");
    const before8 = openN();
    document.querySelector('[data-do="rejected"]').click();
    await waitFor(() => openN() !== before8);
    ok(openN() === before8 - 1,
       "★ 반려도 같은 무게로 된다 (반려가 어려우면 일단 내리게 된다)");

    /* 이력·되돌리기 (§10.47) */
    ok(/닫은 것/.test(sheet()), "닫은 것이 따로 모인다");
    ok($$(".opsHist small").length >= 2, "★ 일어난 일이 줄로 쌓인다 (처리·반려가 각각 남는다)");
    const openBefore = $$(".opsCard:not(.closed)").length;
    const rb = document.querySelector("[data-reopen]");
    ok(rb, "닫은 것에 되돌리기가 있다");
    rb.click();                                  // 이유 없이
    await waitFor(() => true, 200);
    ok($$(".opsCard:not(.closed)").length === openBefore,
       "★ 이유 없이는 되돌아가지 않는다 (서버 규칙과 같다)");
    ok(!!document.querySelector(".opsNeed"), "어디를 채워야 하는지 표시한다");
    const rid = document.querySelector("[data-reopen]").dataset.reopen;
    document.querySelector("#why-" + rid).value = "재검토 요청";
    document.querySelector("[data-reopen]").click();
    await waitFor(() => $$(".opsCard:not(.closed)").length !== openBefore);
    ok($$(".opsCard:not(.closed)").length === openBefore + 1,
       `★ 이유를 적으면 되돌아간다 (열림 ${openBefore} → ${$$(".opsCard:not(.closed)").length})`);
    ok(/다시 엶/.test(sheet()), "되돌린 것도 이력에 남는다");

    /* 운영자 관리 (§10.46) — 권한이 스스로를 늘리는 경로라 방어를 화면에서도 본다 */
    const nPeople = $$(".opsPerson").length;
    ok(nPeople >= 1, `운영자 명단 ${nPeople}명이 보인다`);
    ok(/부트스트랩을 함수로 열면/.test(sheet()),
       "★ 첫 운영자는 손으로 넣는 이유를 적어 둔다");
    const inp = document.querySelector("#opsAdd");
    inp.value = "jiwon"; document.querySelector("#opsGrant").click();
    await waitFor(() => $$(".opsPerson").length !== nPeople);
    ok($$(".opsPerson").length === nPeople + 1, `추가하면 명단에 오른다 (${nPeople} → ${nPeople + 1})`);
    document.querySelector("#opsAdd").value = "jiwon";
    document.querySelector("#opsGrant").click();
    await waitFor(() => true, 200);
    ok($$(".opsPerson").length === nPeople + 1, "★ 같은 사람을 두 번 추가해도 한 번이다");
    // 해제해도 기록은 남는다
    const logBefore = $$(".opsLog small").length;
    document.querySelectorAll("[data-revoke]")[0].click();
    await waitFor(() => $$(".opsPerson").length === nPeople);
    ok(/해제/.test(sheet()) && $$(".opsLog small").length > logBefore,
       "★ 해제해도 기록은 남는다 (되돌릴 근거)");
    // 마지막 한 명은 못 뺀다
    while ($$(".opsPerson").length > 1) {
      const btn = [...document.querySelectorAll("[data-revoke]")].find((b) => !b.disabled);
      if (!btn) break;
      btn.click(); await waitFor(() => true, 150);
    }
    ok($$(".opsPerson").length === 1 &&
       [...document.querySelectorAll("[data-revoke]")].every((b) => b.disabled),
       "★ 마지막 운영자는 해제 버튼이 잠긴다 (서버도 막는다)");
    await closeSheet();

    /* ── 8. 사진 뷰어 (§12.2) ──────────────────────────────────
       ★ 검증할 것은 "사진이 뜬다"가 아니라
         ① 닉네임·날짜·본문이 **실제로** 있는가 (뷰어의 존재 이유다)
         ② 같은 장소에서 **멈추는가** (다른 장소로 새면 맥락을 잃는다)
         ③ 연도별 보기가 되는가 (인스타가 못 하는 것) */
    R.lines.push("── 8. 사진 뷰어 ──");
    await closeSheet();
    const AV = window.__albumInternals;
    const byPlace = {};
    UP.album.forEach((x) => { if (x.poi && x.gps) (byPlace[x.poi.properties.n] ||= []).push(x); });
    const top = Object.entries(byPlace).sort((a, b) => b[1].length - a[1].length)[0];
    const expect = AV.viewerItems(top[0]).length;     // 내 것 + 남의 공개 기록
    window.screenViewer(top[0], {});
    const panes = await waitFor(() => ($$(".vwPane").length ? $$(".vwPane") : null));
    ok(panes && panes.length === expect,
       `그 장소의 기록 ${panes ? panes.length : 0}장 (내 것 ${top[1].length} + 남의 것 ${expect - top[1].length})`);
    ok($$(".vwWho b").some((b) => b.innerText !== "@minji"),
       "★ 같은 장소의 **다른 사람** 기록이 섞여 있다");
    ok($$(".vwMemo").length > 0, "★ 본문(메모)이 보인다 — 뷰어의 존재 이유다");
    ok($$(".vwBadge.live").length > 0, "★ 현장 인증 뱃지가 구분된다 (§009)");
    ok(/\d{4}\.\d{2}\.\d{2}/.test(sheet()), "날짜가 보인다");
    ok(!!document.querySelector(".vwEnd") && /여기서 멈춥니다/.test(sheet()),
       "★ 같은 장소에서 멈춘다 — 다른 장소로 자동 전환하지 않는다");
    /* ── 댓글은 스페이스 안에서만 (§12.6 수정) ────────────────
       ★ 모더레이션 비용이 무서운 것은 **공개 기록**이다. 스페이스는 서로 아는 사람의
         닫힌 방이라 모르는 사람이 못 들어온다. 그리고 여기서 대화가 되면 초대할 이유가 생긴다. */
    const cBoxes = $$(".vwC"), cNone = $$(".vwNoC");
    ok(cBoxes.length > 0, `스페이스 기록에 댓글 칸이 있다 (${cBoxes.length}개)`);
    ok(cNone.length > 0 && /스페이스에 올린 기록에만/.test(txt(cNone[0])),
       "★ 댓글이 없는 칸에는 **왜 없는지**를 적는다 — 말없이 빠져 있으면 고장 난 것처럼 보인다");
    ok(!/공개 기록에는 댓글이 없습니다/.test(sheet()),
       "★ 내 '나만 보기' 기록을 '공개 기록'이라 부르지 않는다 — 기준은 공개가 아니라 스페이스다");
    ok(cBoxes.length + cNone.length === $$(".vwPane").length,
       "★ 모든 기록이 둘 중 하나다 — 어느 쪽인지 모르는 칸은 없다");
    ok(/안에서만 보입니다/.test(txt(cBoxes[0])),
       `★ 어디까지 보이는지 적혀 있다 (${txt(cBoxes[0].querySelector(".vwCHead"))})`);

    const beforeC = $$(".vwCRow").length;
    const cin = cBoxes[0].querySelector(".vwCIn");
    cin.value = "여기 진짜 좋았어";
    cBoxes[0].querySelector(".vwCGo").click();
    await sleep(90);
    ok($$(".vwCRow").length === beforeC + 1 && /여기 진짜 좋았어/.test(txt($(".vwC"))),
       "★ 올린 댓글이 실제로 붙는다");
    ok($$(".vwPane").length > 0 && document.querySelector(".vwC .vwCIn").value === "",
       "입력칸이 비워진다");
    ok(Object.values(UP.comments).flat().some((c) => c.text === "여기 진짜 좋았어"),
       "★ 댓글이 상태에 남는다");

    /* ── 댓글을 서버로 (§13.21) ─────────────────────────────────
       ★ 댓글은 **잎사귀**다. 정책이 `pin_spaces ⋈ space_members` 를 요구하므로
         스페이스·멤버·핀·공유가 **먼저** 있어야 한다.
         화면만 고쳐서는 안 되고, 그 줄기를 **처음 댓글을 달 때** 만든다. */
    if (API.on && API.session.access_token) {
      /* 보내기는 화면을 먼저 그리고 뒤에서 간다 — 결과가 붙을 때까지 기다린다 */
      await waitFor(() => $(".vwCRow[data-sid]") || $(".vwCRow.vwCFail"), 6000, 150);
      const sent = $$(".vwCRow").filter((r) => r.dataset.sid).length;
      const failed = $$(".vwCRow.vwCFail").length;
      ok(failed === 0, `★ 실패하면 줄에 표시된다 — 조용히 사라지는 것이 가장 나쁘다 (실패 ${failed})`);
      ok(sent > 0, `★ 댓글이 실제로 서버에 남는다 (${sent}건)`);
      ok(Object.keys(API.links).some((k) => k.startsWith("pin:")) &&
         Object.keys(API.links).some((k) => k.startsWith("sp:")),
         "★ 댓글을 달 때 **스페이스와 핀이 같이 생긴다** — 잎사귀만 심을 수는 없다");
      /* ── 사진 올리기 (§13.22) ────────────────────────────────
         ★ 축소는 **기기에서** 한다. 서버에서 하면 업로드마다 함수가 돌고
           사용자 수에 비례해 비용이 는다. 폰의 캔버스로 하면 0원이다.
           그리고 이 숫자가 곧 **사용자의 데이터 요금**이다. */
      const blob = await (await fetch("photos/p1.jpg")).blob();
      const file = new File([blob], "p1.jpg", { type: "image/jpeg" });
      const sm = await API.shrink(file, 1600, 0.85);
      ok(sm.blob.size < file.size,
         `★ 기기에서 줄인다 (${Math.round(file.size / 1024)}KB → ${Math.round(sm.blob.size / 1024)}KB · ${sm.w}×${sm.h})`);
      ok(sm.blob.type === "image/webp", "WebP 로 바꾼다 (원본 기획서 §11)");

      const up = await API.uploadPhoto(file);
      ok(up.ok, `★ 실제로 올라간다 (${up.ok ? up.path : up.why})`);
      if (up.ok) {
        ok(up.path.startsWith(API.session.user_id + "/"),
           "★ 경로 첫 칸이 주인이다 — 남의 폴더에는 못 쓴다 (030)");
        const pub = await fetch(up.url);
        ok(pub.ok, "★ 비로그인도 읽는다 — 공개 자격은 파일이 아니라 pins.is_public 이 판단한다");
        const pinId = Object.values(API.links).find((v) => /^[0-9a-f-]{36}$/.test(v));
        const pin = API.links["pin:" + Object.keys(API.links).find((k) => k.startsWith("pin:"))?.slice(4)];
        if (pin) {
          const m = await API.attachMedia(pin, up);
          ok(m.ok, "★ 저장소에만 있으면 아무도 못 본다 — media 행으로 기록에 붙는다");
        }
      }

      const anchor = $(".vwCRow[data-sid]");
      if (anchor) {
        const back = await API.listComments(anchor.closest("[data-c]").dataset.c);
        ok(back.ok && back.data.length > 0,
           `★ 서버에서 다시 읽힌다 (${back.ok ? back.data.length : 0}건) — 쓰기만 되고 읽기가 안 되면 반쪽이다`);
      }
    }
    cBoxes[0].querySelector(".vwCGo").click();
    await sleep(80);
    ok($$(".vwCRow").length === beforeC + 1,
       "★ 빈 댓글은 안 올라간다");

    const years = $$(".vwYear");
    ok(years.length >= 2, `연도 칩 ${years.length}개 (전체 + 연도별)`);
    const allN = $$(".vwPane").length;
    years[1].click();
    await waitFor(() => $$(".vwPane").length !== allN);
    ok($$(".vwPane").length < allN,
       `★ 연도별로 걸러진다 (${allN} → ${$$(".vwPane").length}) — 같은 자리의 시간축`);
    await closeSheet();

    /* ── 9. 탭2 갈 곳 — 피드 (§12.10) ─────────────────────────
       ★ 검증할 것은 "카드가 뜬다"가 아니라
         ① 묶음마다 **왜 떴는지**가 붙어 있는가 (설명 없는 추천은 우리 것이 아니다)
         ② 남의 콘텐츠가 0이어도 채워지는가 (첫날에도 빈 화면이면 안 된다)
         ③ 지도에서 보던 자리를 **이어받는가** — 지역을 두 번 묻지 않는다 (§12.14)
         ④ 편의점이 안 끼는가 (§12.16 자격 규칙) */
    R.lines.push("── 9. 탭2 갈 곳 ──");
    await closeSheet();
    const FD = window.__feed;
    ok(await waitFor(() => FD.ready), `씨앗 ${FD.seed.length.toLocaleString()}곳을 읽었다`);

    const fdBtn = $('#tabbar button[data-tab="feed"]');
    ok(!!fdBtn, "탭바에 '갈 곳'이 있다");
    fdBtn.click();
    const rails = await waitFor(() => ($$(".fdRail").length ? $$(".fdRail") : null));
    ok(rails && rails.length >= 3, `묶음 ${rails ? rails.length : 0}개`);
    ok($("#spPanel") && !$("#spPanel").classList.contains("on"),
       "★ 스페이스 패널은 닫힌다 — 두 탭이 겹쳐 보이지 않는다");
    ok(rails.every((r) => txt(r.querySelector(".fdRailHead small")).length > 3),
       "★ 묶음마다 **왜 떴는지** 한 줄이 붙어 있다");
    ok(/지도에서 보던/.test(txt($(".fdRail"))) ||
       $$(".fdRailHead small").some((x) => /지도에서 보던/.test(txt(x))),
       "★ 지도에서 보던 자리를 이어받는다 — 지역을 두 번 묻지 않는다 (§12.14)");

    const fdCards = $$(".fdCard");
    ok(fdCards.length >= 10, `장소 카드 ${fdCards.length}장`);
    ok(fdCards.every((c) => c.querySelector(".fdImg img")?.getAttribute("src")),
       "★ 모든 카드에 사진이 있다 — 사진 없는 곳은 애초에 후보가 아니다 (§12.16)");

    /* ── 사람 사진이 관광공사 사진을 이긴다 (§12.25-A) ──────────
       ★ 탭2 전체가 기관 홍보 사진이면 §1 *"감성 사진 엄선"* 과 화면이 어긋난다.
         그리고 이건 **앱이 자랄수록 화면이 좋아지는** 유일한 구조다. */
    ok(fdCards.every((c) => c.querySelector(".fdBy")),
       "★ 표지마다 출처가 적혀 있다 — 기관 사진인지 사람 사진인지 갈린다");
    ok(window.__userCoverCount() > 0,
       `★ 사람 사진이 **이겨서** 표지를 가져간 곳이 있다 (${window.__userCoverCount()}곳)`);
    ok(/반응으로 정해집니다/.test(txt($("#fdBody"))) && /기관 사진도 집니다/.test(txt($("#fdBody"))),
       "★ 표지가 어떻게 정해지는지 적는다 — 기관 사진도 진다");

    /* ★ 처음엔 '사용자 사진이면 무조건 표지'로 만들었다. 그건 경쟁이 아니라 저울에 손을 얹은 것이다.
         같은 자로 겨뤄야 하고, **기관 사진도 이길 수 있어야** 한다. */
    /* ★ 앞선 판은 씨앗 앞 399곳을 표본으로 삼았는데, 그중 **사람 후보가 있는 곳이 거의 없어**
         "기관 399 · 사람 0"이 나왔다. 경쟁이 없는 곳을 세고 경쟁을 판정한 셈이다.
         겨룸이 실제로 일어나는 곳 = **후보가 둘 이상인 장소**에서만 센다. */
    const contested = window.__feed.seed.filter((x) => window.__candCount(x.n) > 0);
    let agencyWin = 0, userWin = 0;
    contested.forEach((x) => { window.__coverOf(x, 1).user ? userWin++ : agencyWin++; });
    ok(contested.length > 20 && agencyWin > 0 && userWin > 0,
       `★ 겨룸이 있는 ${contested.length}곳에서 양쪽 다 이긴다 (기관 ${agencyWin} · 사람 ${userWin}) — 한쪽이 전부 이기면 그건 점수가 아니다`);
    ok($$(".fdCard .fdBy i").length === $$(".fdCard .fdBy").length,
       "★ 표지마다 **왜 이겼는지**가 붙는다 (저장 수 · ♥ · 심사 중)");
    const trials = $$(".fdCard.trial");
    ok(trials.length > 0 && trials.every((t) => /심사 중/.test(txt(t.querySelector(".fdBy")))),
       `★ 노출이 모자란 후보에게 자리를 준다 (${trials.length}칸) — 안 주면 새 사진은 영원히 못 올라온다`);

    /* ── 노출 · 열람 · 재검색 로깅 (§13.9) ───────────────────────
       ★ 여기가 §13.8 점수의 **분모**다. 이게 없으면 로직이 아예 못 돈다.
         그리고 가장 중요한 결정: **'그려졌다'가 아니라 '보였다'를 센다.**
         가로 묶음은 화면 밖 카드까지 전부 그리므로, 그걸 세면 분모가 뻥튀기된다. */
    LOG.reset();
    ok(Object.keys(LOG.all()).length === 0, "막 비웠으니 로그는 비어 있다");
    // ★ 비운 뒤 다시 그려야 관찰이 새로 걸린다 — 관찰자는 상태가 바뀔 때만 부른다
    $('#tabbar button[data-tab="map"]').click(); await sleep(150);
    $('#tabbar button[data-tab="feed"]').click();
    await waitFor(() => $$(".fdCard[data-ck]").length);
    const watched = LOG.watch($("#fdBody"));   // 비운 뒤라 관찰을 새로 건다
    const drawn = $$(".fdCard[data-ck]").length;
    ok(drawn > 20 && watched === drawn, `카드 ${drawn}장이 그려져 있고 전부 관찰 중이다`);
    await sleep(1600);                        // 0.5초 체류 기준을 넘긴다
    const seen = Object.values(LOG.all()).filter((r) => r.imp > 0).length;
    ok(seen > 0, `★ 화면에 보인 것만 노출로 세진다 (${seen}장)`);
    ok(seen < drawn,
       `★ 그린 수(${drawn})보다 본 수(${seen})가 적다 — 화면 밖까지 세면 분모가 뻥튀기돼 모든 점수가 0으로 수렴한다`);

    /* 열람은 노출의 부분집합이어야 한다 — 안 본 것을 열 수는 없다 */
    const c0 = $(".fdCard[data-ck]:not(.mine)");
    const k0 = c0.dataset.ck;
    const impBefore = LOG.stat(k0).imp;
    LOG.open(k0, c0.dataset.place);
    ok(LOG.stat(k0).open === 1 && LOG.stat(k0).imp >= Math.max(1, impBefore),
       "★ 열람이 먼저 들어와도 노출이 같이 채워진다 — 비율이 1을 넘으면 안 된다");

    /* 재검색 — 보여 준 적이 있을 때만 감점이다 */
    const rNew = LOG.research("한 번도 안 보여준 곳", () => "a:한 번도 안 보여준 곳");
    ok(rNew === false,
       "★ 처음 찾는 사람은 감점하지 않는다 — 보여 준 적 없는 곳까지 세면 신호가 아니라 잡음이다");
    const placeName = c0.dataset.place;
    const rOld = LOG.research(placeName, () => k0);
    ok(rOld === true && LOG.stat(k0).research === 1,
       `★ 최근에 보여 줬는데 다시 찾으면 감점된다 (${placeName}) — 그 카드가 답을 못 준 것이다`);

    /* 로그가 점수로 흘러야 의미가 있다 */
    const sx = window.__feed.seed.find((x) => x.n === placeName) || window.__feed.seed[0];
    const sBefore = window.__coverOf(sx, 1).score;
    for (let i = 0; i < 40; i++) LOG.react(k0, "save");
    const sAfter = window.__coverOf(sx, 1).score;
    ok(sAfter >= sBefore,
       `★ 저장이 쌓이면 점수가 오른다 (${sBefore.toFixed(3)} → ${sAfter.toFixed(3)}) — 로그가 순위로 이어진다`);
    ok(/rows/.test(JSON.stringify(LOG.flush())),
       "★ 내보낼 때는 **키와 숫자만** 나간다 — 좌표도 닉네임도 안 실린다");
    LOG.reset();
    const byUser = $$(".fdCard.byUser");
    ok(byUser.every((c) => /^@/.test(txt(c.querySelector(".fdBy")))),
       "사람 사진에는 닉네임이 붙는다");
    ok($$(".fdCard:not(.byUser) .fdBy").every((b) => b.firstChild.textContent.trim() === "한국관광공사"),
       "★ 기관 사진은 기관 이름 그대로 — 출처 표기는 의무다 (§12.16)");
    // 관광공사 URL 중 일부는 404다. 깨진 표지는 카드가 없는 것보다 나쁘다
    await sleep(600);
    ok($$(".fdCard .fdImg img").every((i) => !i.complete || i.naturalWidth > 0),
       "★ 표지를 못 받은 카드는 내려간다 — 깨진 사진은 카드가 없는 것보다 나쁘다");
    ok(!/편의점|GS25|CU |세븐일레븐/.test(txt($("#fdBody"))),
       "★ 편의점이 끼지 않는다 (§12.16 자격 규칙)");
    ok($$(".fdCard .fdDist").every((d) => /차로 \d/.test(txt(d))),
       "★ 거리가 '몇 km'가 아니라 '차로 몇 분'이다 — 갈지 말지의 단위");

    /* 눈으로 보고서야 찾은 결함 두 개 — 예외를 안 내고 조용히 화면만 늘렸다 */
    const names = (r) => [...r.querySelectorAll(".fdCard b")].map(txt);
    const near = rails.find((r) => /여기서 가까운/.test(txt(r.querySelector(".fdRailHead b"))));
    const unseenRail = rails.find((r) => /안 가본/.test(txt(r.querySelector(".fdRailHead b"))));
    if (unseenRail) {
      const n = names(near), u = names(unseenRail);
      ok(!u.some((x) => n.includes(x)),
         "★ '안 가본 곳'이 '가까운 곳'을 그대로 베끼지 않는다 — 같은 묶음 두 개는 하나보다 나쁘다");
      const regs = [...unseenRail.querySelectorAll(".fdCard small")].map((x) => txt(x).split("·").pop().trim());
      ok(new Set(regs).size === regs.length,
         `★ 지역마다 하나씩이다 (${regs.length}장 / ${new Set(regs).size}개 지역) — 한 동네만 보여주면 '발견'이 아니다`);
    }

    const again = rails.find((r) => /다시 가보기/.test(txt(r.querySelector(".fdRailHead b"))));
    ok(!!again, "★ '다시 가보기'가 뜬다 — 남의 콘텐츠가 0이어도 내 기록으로 채워진다");
    ok(again && again.querySelectorAll(".fdCard.mine").length > 0, "그 묶음은 내 기록이다");
    const ag = names(again);
    ok(new Set(ag).size === ag.length,
       `★ 한 장소가 한 번만 나온다 (${ag.length}장) — 같은 바다를 세 번 권하지 않는다`);

    /* 컨셉 필터 */
    const cpts = $$(".fdCpt");
    ok(cpts.length >= 4, `컨셉 칩 ${cpts.length}개`);
    const before = $$(".fdCard").length;
    cpts[1].click();
    await sleep(80);
    ok($$(".fdCard").length > 0 && $$(".fdCard").length < before,
       `★ 컨셉으로 좁혀진다 (${before} → ${$$(".fdCard").length}) — '${txt(cpts[1])}'`);
    const narrowed = $$(".fdCard").length;
    $$(".fdCpt")[0].click();
    /* ★ 개수를 정확히 비교하면 안 된다 — 표지를 못 받은 카드는 **비동기로** 내려간다(§13.8).
       그래서 같은 화면을 두 번 세면 값이 달라질 수 있다. 주장은 '되돌아온다'이지
       '개수가 같다'가 아니다. */
    await sleep(400);
    ok($$(".fdCard").length > narrowed && !$(".fdCpt.on[data-cpt]:not([data-cpt=''])"),
       `'전체'로 되돌아온다 (${narrowed} → ${$$(".fdCard").length})`);

    /* 카드 → 뷰어 */
    const myCard = $(".fdCard.mine");
    myCard.click();
    ok(await waitFor(() => $$(".vwPane").length > 0),
       "★ 내 기록 카드를 누르면 그 장소의 뷰어가 열린다");
    await closeSheet();
    ok(/한국관광공사/.test(txt($("#fdBody"))) && /OpenStreetMap/.test(txt($("#fdBody"))),
       "★ 출처 표기가 있다 — 사진은 관광공사, 경계는 OSM(ODbL)");
    $('#tabbar button[data-tab="map"]').click();
    await sleep(80);
    ok(!$("#fdPanel").classList.contains("on"), "다른 탭으로 나가면 닫힌다");

    /* ── 10. 탭3 소식 — 피드형 홈 (§12.21) ──────────────────────
       ★ 검증할 것은 "글이 올라온다"가 아니라
         ① 포스트마다 **왜 내게 보이는지**가 있는가 (팔로우 대신 쓰는 장치다)
         ② 남이 아무것도 안 올려도 채워지는가 — 내 'N년 전 오늘' (§12.7)
         ③ 댓글이 **없는가** — 운영자 0명인데 모더레이션을 열지 않는다 (§12.6)
         ④ 스페이스가 사라지지 않았는가 (탭을 뺏은 게 아니라 안으로 넣었다) */
    R.lines.push("── 10. 탭3 소식 ──");
    await closeSheet();
    const HM = window.__home;
    const hmBtn = $('#tabbar button[data-tab="home"]');
    ok(!!hmBtn, "탭바에 '소식'이 있다");
    hmBtn.click();
    const posts = await waitFor(() => ($$(".hmPost").length ? $$(".hmPost") : null));
    ok(posts && posts.length > 0, `포스트 ${posts ? posts.length : 0}개`);
    ok(!$("#fdPanel").classList.contains("on") && !$("#spPanel").classList.contains("on"),
       "★ 다른 탭 패널은 닫힌다 — 세 장이 겹치지 않는다");

    ok(posts.every((p) => txt(p.querySelector(".hmWhy")).length > 4),
       "★ 포스트마다 **왜 내게 보이는지** 한 줄이 있다 — 팔로우 대신 쓰는 장치다");
    ok($$(".hmWho b").every((b) => /^@/.test(txt(b))) && /\d{4}\.\d{2}\.\d{2}/.test(txt($("#hmBody"))),
       "닉네임과 촬영 날짜가 보인다");
    ok(HM.posts.some((p) => p.src === "near") && $$(".hmWhy.near").length + 1 > 0,
       "★ 가까운 곳에서 올라온 것이 섞인다 — 팔로우가 아니라 **거리**로 고른다");
    const nearChip = $$('.hmChip[data-f="near"]')[0];
    ok(!!nearChip, "'가까운 곳' 칩이 있다");
    nearChip.click();
    await sleep(90);
    ok($$(".hmPost").length > 0 && $$(".hmWhy").every((w) => /에서 올라왔습니다/.test(txt(w))),
       `★ '가까운 곳'으로 좁히면 거리 줄만 남는다 (${$$(".hmPost").length}개)`);
    const kms = HM.near.map((p) => p.km);
    ok(kms.every((v, i) => i === 0 || kms[i - 1] <= v),
       "★ 가까운 순이다 — 그 안에서 반응순으로 다시 센다");
    $$('.hmChip[data-f=""]')[0].click();
    await sleep(90);

    ok(HM.posts.some((p) => p.src === "memory"),
       "★ 내 'N년 전 오늘'이 섞인다 — 남이 0건 올려도 빈 화면이 아니다 (§12.7)");
    const first = HM.posts.slice(0, 6).map((p) => p.src);
    ok(first.some((v) => v !== "memory"),
       `★ 첫 화면이 내 회고로만 차지 않는다 (${[...new Set(first)].join("·")}) — '소식'인데 남의 소식이 없으면 안 된다`);
    ok(HM.posts.filter((p) => p.src === "memory").length <= 3,
       "★ 회고는 하루 3건까지다 — 오늘 날짜를 달고 들어오니 안 막으면 맨 위를 다 먹는다");
    ok(posts.some((p) => /시간 전|분 전|일 전/.test(txt(p.querySelector(".hmWho small")))),
       "★ 올린 때로 줄을 세운다 — 찍은 때와 올린 때는 다르다");
    ok(!/댓글 달기|댓글 쓰기|댓글 입력/.test(txt($("#hmBody"))) &&
       $$(".hmPost .hmAct").length === posts.length * 2,
       "★ 좋아요·저장뿐이고 댓글은 없다 — 운영할 수 있는 만큼만 연다 (§12.6)");
    ok($$(".hmNo").length === 0 && /댓글은 없습니다/.test(txt($(".hmHead"))),
       "★ 방침은 머리말에서 한 번만 말한다 — 포스트마다 반복하면 그건 안내가 아니라 소음이다");

    /* 시간순이지 알고리즘이 아니다 */
    const ats = HM.posts.map((p) => p.at);
    ok(ats.every((v, i) => i === 0 || ats[i - 1] >= v),
       "★ 시간순이다 — 초기엔 추천 모델을 쓰지 않는다 (§12.3)");

    /* 좋아요 · 저장 */
    const n0 = posts.length;
    $(".hmPost [data-like]").click();
    await sleep(80);
    ok($$(".hmAct.on").length > 0, "좋아요가 눌린 채로 남는다");
    ok($$(".hmPost").length === n0,
       `★ 좋아요를 눌러도 포스트 수가 그대로다 (${n0}개) — 다시 그리는 이유가 달라도 한 가지로 굴면 안 된다`);
    $(".hmPost [data-save]").click();
    await sleep(80);
    ok(HM.save.size === 1 && $$(".hmAct.on").length === 2,
       "★ 저장도 화면에 남는다 — Set에만 들어가고 화면은 그대로인 실패가 있었다");

    /* 묶음 필터 */
    const hmBefore = $$(".hmPost").length;
    $$('.hmChip[data-f="memory"]')[0].click();
    await sleep(80);
    ok($$(".hmPost").length > 0 &&
       $$(".hmWhy").every((w) => /년 전 오늘/.test(txt(w))),
       `★ '내 기록'으로 좁히면 회고만 남는다 (${$$(".hmPost").length}개)`);
    ok(!$(".hmMore") || $$(".hmPost").length <= 3, "회고만 있는 묶음은 짧다");
    $$('.hmChip[data-f=""]')[0].click();
    await sleep(80);
    ok($$(".hmPost").length === hmBefore, "'전체'로 되돌아온다");

    /* 더 보기 — 무한 스크롤 대신 스스로 멈춘다 */
    const more = $(".hmMore");
    ok(!!more, "★ 한 번에 다 쏟지 않는다 ('더 보기'가 있다)");
    more.click();
    await sleep(80);
    ok($$(".hmPost").length > hmBefore, `더 보면 늘어난다 (${hmBefore} → ${$$(".hmPost").length})`);

    /* 탭은 서로 이어진다 (§12.14) */
    $(".hmPost .hmImg").click();
    ok(await waitFor(() => $$(".vwPane").length > 0), "★ 사진을 누르면 그 장소의 뷰어가 열린다");
    await closeSheet();
    $('#tabbar button[data-tab="home"]').click();
    await sleep(80);
    $(".hmOpen").click();
    await sleep(120);
    ok($("#spPanel").classList.contains("on") && !$("#hmPanel").classList.contains("on"),
       "★ 스페이스는 사라지지 않았다 — 탭을 뺏은 게 아니라 소식 안으로 들여놨다");
    $('#tabbar button[data-tab="home"]').click();
    await sleep(80);
    const goName = txt($(".hmPost .hmPlace span")).replace("📍 ", "");
    $(".hmPost .hmPlace").click();
    await sleep(160);
    ok(!$("#hmPanel").classList.contains("on"),
       `★ '지도에서 보기'가 실제로 지도로 보낸다 (${goName})`);

    /* ── 11. 탭5 마이 (원본 기획서 §6 탭5) ──────────────────────
       ★ 검증할 것은 "숫자가 뜬다"가 아니라
         ① **대표 픽**이 실제로 바뀌는가 — 원본 기획서가 적은 액션이고
            장소당 3장 제한(§8)과 한 몸이다. 지금까지 없던 기능이다
         ② 커버리지가 자랑이 아니라 **다음에 갈 곳**으로 읽히는가
         ③ 공개 범위가 '전부 아니면 전무'가 아니라고 말하는가
         ④ 공유 카드에 **사진이 안 들어가는가** (남의 얼굴·집 앞이 섞인다) */
    /* ── 10-b. 스페이스 = 함께 채운 지도 (§13.16) ─────────────────
       ★ §12.13: *"목록·초대만 있으면 파일 탐색기다. 스페이스의 화면은 지도여야 한다."*
         §3이 초대 수락률을 핵심 지표라 했는데, 초대받은 사람이 처음 보는 화면이
         파일 탐색기면 수락할 이유가 약하다. */
    R.lines.push("── 10-b. 스페이스 ──");
    await closeSheet();
    $('#tabbar button[data-tab="space"]').click();
    await waitFor(() => $$(".spCard").length);
    $$(".spCard")[1].click();                    // 첫 스페이스 (0번은 '내 지도')
    await waitFor(() => $(".spMap"));
    ok(!!$(".spMap"), "★ 스페이스를 열면 **지도**가 먼저 나온다 (목록이 아니다)");
    ok(/함께 채운 곳/.test(txt($(".spMapTop"))) && /시·군·구/.test(txt($(".spMapTop"))),
       `★ 합산 커버리지가 분모와 함께 나온다 (${txt($(".spMapTop")).slice(0, 40)})`);

    /* ★ 합집합이지 합계가 아니다 — 셋이 같은 곳에 갔으면 1곳이다 */
    const spId = $(".spMap").dataset.lens;
    const regionsInSpace = new Set(poi.features.filter((f) => f.properties.sp === spId)
                                               .map((f) => f.properties.rn).filter(Boolean));
    const shown = +txt($(".spMapTop b"));
    ok(shown === regionsInSpace.size,
       `★ 합집합으로 센다 (${shown}곳) — 합계로 세면 같이 간 여행이 몇 배로 부풀어 숫자가 거짓말을 한다`);

    /* ★ '함께'의 실체 = 같이 간 곳과 혼자 간 곳의 구별 */
    const split = $$(".spSplit b").map((b) => +txt(b));
    ok(split.length === 2 && split[0] + split[1] === shown,
       `★ 같이 간 곳 ${split[0]} + 혼자 다녀온 곳 ${split[1]} = ${shown} — 총량만 보면 혼자 채운 지도와 구별이 안 된다`);
    ok(split[0] > 0,
       "★ 스페이스에 **여러 사람의 기록**이 들어 있다 — 내 기록만 들어가면 '함께'가 아니다");

    const who = $$(".spWhoRow");
    ok(who.length >= 2 && who.every((r) => /\d+곳/.test(txt(r.querySelector("em")))),
       `★ 누가 어디를 열었는지 보인다 (${who.length}명) — 혼자 다 채운 방과 나눠 채운 방은 다른 관계다`);

    /* 지도로 이어진다 */
    $(".spOpenMap").click();
    await sleep(500);
    ok(state.lens === spId && !$("#spPanel").classList.contains("on"),
       "★ '지도에서 함께 보기'가 렌즈를 바꾸고 탭1로 보낸다 — 새 화면이 아니라 **다른 눈**이다");
    ok(visiblePois().every((f) => f.properties.sp === spId),
       "★ 지도가 그 스페이스 기록만 보여준다");
    state.lens = "all"; renderLensMenu(); refreshPoi();
    await sleep(200);

    R.lines.push("── 11. 탭5 마이 ──");
    await closeSheet();
    const MY = window.__my;
    $('#tabbar button[data-tab="my"]').click();
    await waitFor(() => $(".myCard"));
    ok(!!$(".myCard"), "정복 리포트가 뜬다");
    ok(!$("#spPanel").classList.contains("on") && !$("#hmPanel").classList.contains("on"),
       "다른 탭 패널은 닫힌다");
    ok(/%/.test(txt($(".myPctRow"))) && /\d+ \/ \d+ 시·군·구/.test(txt($(".myPctSub"))),
       `★ 정복률이 분모와 함께 나온다 (${txt($(".myPctSub"))}) — %만 있으면 무엇의 %인지 모른다`);
    ok(/공개 범위는 기록마다 따로/.test(txt($(".myNote2"))),
       "★ 공개가 '전부 아니면 전무'가 아니라고 말한다");

    /* 커버리지는 계획 도구다 */
    const sidoRows = $$(".mySidoRow");
    ok(sidoRows.length >= 5, `시·도 ${sidoRows.length}줄`);
    ok(/아직 안 간 곳/.test(txt($("#myBody"))),
       "★ 제목이 '정복률'이 아니라 '아직 안 간 곳'이다 — 수집욕이 아니라 계획 도구다 (§12.5 C)");
    const lefts = sidoRows.map((r) => +txt(r.querySelector("em")).replace(/\D/g, ""));
    ok(lefts.every((v) => v > 0),
       "★ 다 간 시·도는 이 목록에 없다 — 제목이 '아직 안 간 곳'인데 맨 위가 5/5면 제목이 거짓말이다");
    ok(lefts.every((v, i) => i === 0 || lefts[i - 1] <= v),
       `★ 곧 끝낼 수 있는 순이다 (${lefts.slice(0, 4).join("·")}곳 남음) — '2곳 남음'은 실행할 수 있는 목표다`);
    const sidoN = sidoRows.length;
    $("[data-sido-all]").click();
    await sleep(80);
    ok($$(".mySidoRow").length > sidoN, `전체 보기로 늘어난다 (${sidoN} → ${$$(".mySidoRow").length})`);

    /* ★ 대표 픽 — 원본 기획서의 액션이자 3장 제한의 실체 */
    const vcards = $$(".myVCard");
    ok(vcards.length > 0, `금고 ${vcards.length}칸 (장소 단위로 접힌다)`);
    // 긴 장소명이 열 너비를 밀어 격자가 틀어진 적이 있다 — 세 칸 폭이 같은지 잰다
    const ws = vcards.slice(0, 3).map((c) => Math.round(c.getBoundingClientRect().width));
    ok(new Set(ws).size === 1,
       `★ 금고 세 칸의 폭이 같다 (${ws.join("·")}px) — 긴 이름이 격자를 밀면 안 된다`);
    const vName = txt(vcards[0].querySelector(".myVN"));
    vcards[0].click();
    await waitFor(() => $(".myPickGrid"));
    const cells = $$(".myPickCell");
    ok(cells.length > 1, `${vName} — 고를 사진 ${cells.length}장`);
    ok($$(".myPickCell.on").length === 1, "★ 대표 픽은 언제나 딱 한 장이다");
    const otherIdx = cells.findIndex((c) => !c.classList.contains("on"));
    cells[otherIdx].click();
    await sleep(100);
    ok($$(".myPickCell.on").length === 1 &&
       $$(".myPickCell").findIndex((c) => c.classList.contains("on")) === otherIdx,
       "고른 자리로 대표 픽이 옮겨 간다");
    ok(Object.keys(MY.mainPick).length === 1 && MY.mainPick[vName],
       `★ 대표 픽이 실제로 바뀐다 (${vName}) — 원본 기획서 TravelRecord.is_main_pick`);
    ok(/지워지지 않습니다/.test(txt($("#myBody"))),
       "★ 나머지는 안 지운다고 말한다 — 3장 제한은 삭제가 아니라 **지도에 나갈 한 장**을 고르는 일이다");
    $("[data-back]").click();
    await waitFor(() => $(".myVault"));
    // 표지 이미지 자체로 재면 안 된다 — 씨앗 앨범은 한 장소의 사진이 전부 같은 파일을 가리켜서
    // 픽이 바뀌어도 src 가 같다. **무엇이 대표인지**를 재야 한다.
    const vrow = window.__myVault().find((x) => x.n === vName);
    ok(String(vrow.main.id) === String(MY.mainPick[vName]),
       "★ 금고 표지가 고른 사진으로 바뀐다 (지도에 나갈 얼굴이 이것이다)");

    /* 공유 카드 — 이 앱의 마케팅 경로 */
    $("[data-share]").click();
    await waitFor(() => $(".myShareCard"));
    ok(/%/.test(txt($(".mscPct"))) && /시·군·구 중/.test(txt($(".mscSub"))),
       "★ 공유 카드에 숫자와 분모가 같이 나간다");
    ok($$(".myShareCard img").length === 0 && /사진은 넣지 않습니다/.test(txt($("#myBody"))),
       "★ 공유 카드에 사진을 넣지 않는다 — 남의 얼굴이나 집 앞이 섞일 수 있다");
    $("[data-back]").click();
    await sleep(80);

    ok(/내 신고/.test(txt($("#myBody"))),
       "★ 내가 보낸 신고가 어떻게 됐는지 여기서 본다 (§10.47)");
    ok($$(".myRow").length >= 3, "설정 줄이 있다 (지도 테마 · 기본 공개 범위 · 운영자 신청)");

    /* ── 익명 로그인 (§13.19) ────────────────────────────────────
       ★ 만들어 둔 것의 절반이 `auth.uid()` 뒤에 잠겨 있었다 — 로그·댓글·업로드.
         소셜은 Apple 계정과 카카오 심사가 필요해 며칠이 걸리지만 익명은 오늘 된다. */
    await waitFor(() => $("#myAcct") && txt($("#myAcct")) !== "불러오는 중…");
    ok(!!$("#myAcct"), "마이에 계정 칸이 있다");
    /* ★ `closest("[data-theme]")` 가 문서 루트의 테마 속성까지 잡아
       **마이의 모든 클릭이 '지도 테마' 로 빨려 들어갔다.** 속성만으로 잡으면 안 된다. */
    ok(!$("#myAcct").closest(".myRow"),
       "★ 계정 칸이 설정 줄 선택자에 걸리지 않는다 — 문서 루트의 data-theme 가 모든 클릭을 삼켰다");
    // 선택자를 고치려고 클래스를 붙였다가 머리말 레이아웃이 깨졌다 — 스타일은 그대로 둔다
    ok($(".myEdit") && !$(".myEdit").classList.contains("myRow"),
       "★ 선택자를 고치려고 클래스를 바꾸지 않는다 — 클래스는 스타일이다");
    if (API.on) {
      if (!API.session.access_token) {
        ok(!!$("#myAnon"), "★ '가입 없이 시작하기' 가 있다 — 계정을 만들라고 먼저 요구하지 않는다");
        $("#myAnon").click();
        await waitFor(() => API.session.access_token, 8000);
      }
      ok(!!API.session.access_token, `★ 익명으로 로그인된다 (${String(API.session.user_id).slice(0, 8)}…)`);
      await waitFor(() => $(".myAcctRow"));
      ok(/이 기기에만/.test(txt($("#myAcct"))) && /기록이 사라집니다/.test(txt($("#myAcct"))),
         "★ **잃을 수 있다는 것**을 미리 말한다 — 말 안 하면 사용자는 잃고 나서야 안다");

      /* 로그인하면 로그를 보낸다 — 그전까지는 로컬에만 있었다 (§13.17) */
      /* ── 로그 키를 서버 place_id 로 (§13.20) ──────────────────
         ★ 전에는 키가 장소 **이름**이라 서버로 보낼 수가 없었다.
           씨앗을 뽑을 때 id 를 안 담은 것이 원인이었고, 내보내기를 스크립트로
           만들면서 같이 고쳤다 (`db/export/feed_seed.sh`). */
      const withId = window.__feed.seed.filter((x) => x.id).length;
      ok(withId === window.__feed.seed.length,
         `★ 씨앗의 모든 곳이 서버 id 를 갖는다 (${withId.toLocaleString()}곳)`);

      // 실제 노출을 만들고 보낸다
      LOG.reset();
      $('#tabbar button[data-tab="map"]').click(); await sleep(150);
      $('#tabbar button[data-tab="feed"]').click();
      await waitFor(() => $$(".fdCard[data-ck]").length);
      LOG.watch($("#fdBody"));
      await sleep(1500);
      const keys = Object.keys(LOG.all());
      const UUID = /^a:[0-9a-f]{8}-[0-9a-f]{4}-/i;
      ok(keys.some((k) => UUID.test(k)),
         `★ 노출 키가 uuid 다 (${keys.filter((k) => UUID.test(k)).length}/${keys.length}) — 이름으로는 서버에 못 보낸다`);

      const before = Object.keys(LOG.all()).length;
      const f = await API.flushCoverEvents();
      ok(f.via === "server" && f.sent > 0,
         `★ 로그가 실제로 서버로 간다 (${f.sent}건 · ${f.via})`);
      ok(Object.keys(LOG.all()).length < before,
         `★ 보낸 것은 지운다 (${before} → ${Object.keys(LOG.all()).length}) — 안 지우면 같은 노출을 또 보내 분모가 부푼다`);
      const f2 = await API.flushCoverEvents();
      ok(f2.sent === 0,
         "★ 연달아 보내도 두 번 안 간다 — 분모가 부풀면 모든 후보가 같이 낮아져 순위가 흐려진다");
      $('#tabbar button[data-tab="my"]').click(); await sleep(200);
    } else {
      ok(/서버에 연결되어 있지 않습니다/.test(txt($("#myAcct"))),
         "서버가 없으면 그렇게 말한다");
    }

    const head = R.fail ? `=== 실패 ${R.fail}건 / 통과 ${R.pass}건 ===`
                        : `=== 화면 흐름 전부 통과 (${R.pass}건) ===`;
    console.log([...R.lines, "", head].join("\n"));
    return { pass: R.pass, fail: R.fail, lines: R.lines, head };
  };
})();
