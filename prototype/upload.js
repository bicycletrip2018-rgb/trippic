/* =====================================================================
   업로드 플로우 — PLAN.md §6.5
   대전제: 사용자가 반드시 해야 하는 일은 "사진 ↔ 장소" 연결 하나뿐이다.
          카테고리·날짜·공개범위는 전부 자동으로 채우고, 틀린 것만 고치게 한다.

   진입점 3개
     A 사진에서 (앨범)   여행 후·대량 소급  ★주력
     B 장소에서 (검색)   EXIF 없는 사진
     C 지금 여기 (카메라) 현장 · live 인증
   ===================================================================== */

(function () {
  const $ = (s) => document.querySelector(s);
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  const UP = {
    // ★ 화면을 거치며 채워지던 값들을 여기서 초기화한다.
    //   "지금 여기"는 업로드 플로우를 거치지 않고 바로 후보를 뽑는다.
    //   순서에 기대면 그런 경로에서 터진다 (실제로 터졌다).
    placeOf: {}, tripPicks: {}, crop: {},
    album: [],      // 가짜 앨범 (사진 + EXIF)
    trips: [],      // 클러스터링으로 발견된 여행
    trip: null,     // 지금 등록 중인 여행
    picks: {},      // placeKey -> 선택된 사진 index 배열
    registered: new Set(),
    dayRule: {},    // 날짜 -> 'trip' | 'daily' — 사용자가 직접 고친 판정 (§10.27)
    stopRegion: {}, // 정거장 -> 지역명. 지역은 여행이 아니라 정거장이 갖는다 (§10.30)
    /* ★ 정거장 -> 한 줄. **여행 한 줄(fNote)과 다르다** —
       여행에 한 줄만 두면 정거장 8곳이 같은 문장을 공유한다.
       뷰어(.vwMemo)는 진작부터 pins.memo 를 읽고 있었는데 **쓰는 곳이 없었다.** */
    stopMemo: {},
    /* ★ 댓글 — **스페이스 안에서만** 연다 (§12.6 수정).
       §12.6이 댓글을 접은 이유는 모더레이션 비용이었고, 운영자가 0명인 것은 지금도 같다.
       그런데 그 이유는 **공개 기록에만** 해당한다 — 스페이스는 서로 아는 사람들의
       닫힌 방이라 모르는 사람이 들어와 쓸 수가 없다. 신고·운영자를 부를 일이 안 생긴다.
       그리고 여기서 댓글이 되면 **초대할 이유**가 생긴다(§3 핵심 지표). */
    comments: {},   // recordId -> [{who, text, ts}]
    /* 여행 -> 스페이스. 전부 공유하지는 않는다 — 혼자 간 여행도 있다. */
    tripSpace: {},
    moveSel: new Set(),  // 옮기려고 고른 사진
    reports: [],    // 이 세션에서 보낸 신고 (실제 앱은 reports 테이블)
  };
  window.UP = UP;

  // 남의 공개 기록 (실제로는 서버에서 온다). 내 앨범과 섞지 않는다.
  const PUBLIC_ALBUM = [];

  /* ── 가짜 앨범 생성 ────────────────────────────────────────────
     실제 앱은 온디바이스 EXIF 스캔. 여기서는 POI에서 역으로 만든다.
     일부러 여행 경계를 섞어서, 클러스터링이 그걸 되찾아내는지 본다. */
  /* ── 합성 앨범 ───────────────────────────────────────────────
     ★ 앞선 버전은 장소의 **정확한 좌표**를 그대로 사진 좌표로 썼고,
       한 여행의 장소를 같은 카테고리에서만 뽑았다. 너무 착한 데이터라
       클러스터링이 실패할 방법이 없었다. 실제와 맞추기 위해 셋을 넣는다:

       ① GPS 오차 — 도심 σ=15m, 가끔 30m (§10 실측)
       ② 카테고리 혼합 — 한 여행에 관광·맛집·카페·해변이 섞인다
       ③ 옆 가게 — 80m 거리의 다른 장소를 연달아 방문 (병합 오류 유발)
       ④ EXIF 없는 사진 — 카톡으로 받았거나 편집된 것 (공개 자격 없음, §009)

     각 사진은 `gps`(사진이 들고 있는 좌표)와 `truth`(실제 장소)를 따로 갖는다.
     클러스터링은 gps만 보고, 채점은 truth로 한다. */
  function gauss(sigma) {
    return sigma * Math.sqrt(-2 * Math.log(Math.random() || 1e-12)) * Math.cos(2 * Math.PI * Math.random());
  }
  function jitter(p, sigma) {
    return { lat: p.lat + gauss(sigma) / 111320,
             lng: p.lng + gauss(sigma) / (111320 * Math.cos(p.lat * Math.PI / 180)) };
  }
  // 기준점에서 m미터 떨어진 점 (옆 가게를 만들 때 쓴다)
  function offsetM(p, dx, dy) {
    return { lat: p.lat + dy / 111320,
             lng: p.lng + dx / (111320 * Math.cos(p.lat * Math.PI / 180)) };
  }

  function makeAlbum() {
    const byRegion = {};
    for (const f of poi.features) {
      const r = f.properties.rn;
      if (!r) continue;
      (byRegion[r] ||= []).push(f);
    }
    const SEEDS = [
      ["해운대구", "2026-05-11", 3], ["강릉시", "2024-09-21", 2], ["제주시", "2023-07-14", 4],
      ["경주시", "2022-10-08", 2], ["종로구", "2021-04-03", 1], ["여수시", "2019-08-16", 3],
    ].filter(([r]) => byRegion[r]);

    /* ★ 번화가 좌표 — 실측 밀도를 프로토타입에서 그대로 겪어 보려고 넣는다.
       데모 POI 좌표는 한산한 자리가 많아 후보가 2~4개밖에 안 뜬다.
       실제 상권은 반경 105m에 100~355곳이다 (§10 실측):
         종로 익선동  50m 52곳 / 105m 200곳 / 150m 385곳
         제주 칠성로  50m 29곳 / 105m 355곳 / 150m 500곳
         해운대 구남로 50m 20곳 / 105m 104곳 */
    const BUSY = {
      "해운대구": [129.1620, 35.1600],
      "제주시":   [126.5245, 33.5127],
      "종로구":   [126.9900, 37.5740],
    };

    const album = [];
    let pid = 0;
    SEEDS.forEach(([region, start, days], si) => {
      const pool = byRegion[region];
      const t0 = new Date(start + "T09:00:00+09:00").getTime();
      // ② 카테고리를 섞어 뽑는다 — 한 여행은 관광만 하지 않는다
      const want = ["sight", "food", "cafe", "beach", "food", "sight"];
      const places = [];
      want.forEach((c) => {
        const cand = pool.filter((f) => f.properties.c === c && !places.includes(f));
        if (cand.length) places.push(cand[(si * 7 + places.length * 13) % cand.length]);
      });
      if (places.length < 3) places.push(...pool.slice(0, 3 - places.length));

      places.forEach((f, pi) => {
        const day = pi % days;
        const n = 2 + ((si + pi) % 5);
        // 번화가가 정의된 지역이면 그 근처로 옮긴다 (장소마다 60m씩 벌려 배치)
        const b0 = BUSY[region];
        const base = b0
          ? offsetM({ lat: b0[1], lng: b0[0] }, (pi - 1) * 60, ((pi % 2) - 0.5) * 60)
          : ll(f);
        const sigma = (si + pi) % 4 === 0 ? 30 : 15;      // ① 가끔 협곡 오차
        for (let k = 0; k < n; k++) {
          // 품질도 섞는다 — 전부 통과하는 데이터로는 화면을 검증할 수 없다
          const q = (si + pi + k) % 9;
          album.push({
            id: pid++, img: f.properties.imgi, poi: f, truth: f.properties.n,
            gps: jitter(base, sigma), acc: sigma,
            w: q === 5 ? 640 : 1280, h: q === 5 ? 480 : 960,
            focus: q === 2 ? 62 : 900 + ((si * 37 + pi * 13 + k * 7) % 3000),
            contrast: q === 7 ? 9 : 40 + ((pi + k) % 40),
            faceRatio: q === 4 ? 0.42 : 0.05,
            ts: t0 + day * 864e5 + pi * 2 * 36e5 + k * 7 * 6e4,
          });
        }
        // ③ 옆 가게 — 80m 떨어진 다른 장소를 20분 뒤에 방문한다
        if (pi === 1) {
          const nb = pool.find((x) => x.properties.c === "cafe" && x !== f) || pool[0];
          const nbBase = offsetM(base, 80, 0);
          for (let k = 0; k < 3; k++) {
            album.push({
              id: pid++, img: nb.properties.imgi, poi: nb, truth: nb.properties.n + "(옆)",
              gps: jitter(nbBase, 15), acc: 15,
              ts: t0 + day * 864e5 + pi * 2 * 36e5 + 20 * 6e4 + k * 5 * 6e4,
            });
          }
        }
      });

      // ④ EXIF 없는 사진 2장 — 카톡으로 받은 것
      const f0 = places[0];
      for (let k = 0; k < 2; k++) {
        album.push({ id: pid++, img: f0.properties.imgi, poi: f0, truth: f0.properties.n,
                     gps: null, noGps: true,
                     ts: t0 + 30 * 6e4 + k * 9 * 6e4 });
      }
    });

    for (let i = 0; i < 6; i++) {
      const f = poi.features[i * 37];
      album.push({ id: pid++, img: f.properties.imgi, poi: f, truth: f.properties.n,
                   gps: jitter(ll(f), 15), acc: 15, ts: Date.now() - i * 40 * 864e5 });
    }
    /* ⑤ '한동안 빠졌던 카페' — 두 달 동안 여덟 번 갔다.
       빈도로 보면 일상이지만 일상이 아니다. 그때의 기록이다.
       휴리스틱으로는 이 둘을 가를 수 없다 → §10.27의 사용자 수정이 필요한 바로 그 경우.
       데모에 이 상황이 없으면 '고칠 수 있다'를 화면에서 검증할 수 없다. */
    const favPool = (byRegion["성동구"] || []).filter((f) => f.properties.c === "cafe");
    const fav = favPool[0] || poi.features[11];
    const favT = new Date("2025-03-04T14:00:00+09:00").getTime();
    for (let v = 0; v < 8; v++) {
      for (let k = 0; k < 2 + (v % 2); k++) {
        album.push({ id: pid++, img: fav.properties.imgi, poi: fav, truth: fav.properties.n,
                     gps: jitter(ll(fav), 15), acc: 15,
                     w: 1280, h: 960, focus: 1500, contrast: 45, faceRatio: 0.05,
                     ts: favT + v * 7 * 864e5 + k * 11 * 6e4 });
      }
    }

    /* ⑥ 뷰어(§12.2)를 화면으로 검증하려면 **메모와 남의 기록**이 있어야 한다.
       뷰어의 핵심이 닉네임·날짜·본문인데 그게 비어 있으면 무엇을 검증하는지 알 수 없다.
       ★ 남의 기록은 실제로는 서버에서 온다. 여기서는 그 모양만 만든다. */
    const MEMOS = [
      "비 온 뒤라 사람이 없어서 좋았다", "여기 노을이 진짜다", "줄 서서 20분",
      "다음엔 아침에 와야지", "생각보다 작았는데 조용해서 좋음", "주차가 어렵다",
    ];
    album.forEach((x, i) => {
      if (i % 3 === 0) x.memo = MEMOS[i % MEMOS.length];
      x.who = "minji";
      x.verification = x.gps ? (i % 7 === 0 ? "live" : "exif") : "manual";
    });

    /* ★ 남의 공개 기록은 **내 앨범이 아니다.** 따로 둔다.
       처음에 album에 섞었다가 여행 클러스터링이 흔들렸다 —
       남의 사진이 내 여행 판정에 끼어들면 안 된다. 실제 앱에서도 출처가 다르다
       (내 것은 기기 앨범 스캔, 남의 것은 서버). */
    const OTHERS = ["jiwon", "sujin", "taeho", "hyerin"];
    const cnt = {};
    album.forEach((x) => { if (x.poi && x.gps) cnt[x.poi.properties.n] = (cnt[x.poi.properties.n] || 0) + 1; });
    PUBLIC_ALBUM.length = 0;
    Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([n], k) => {
      const base = album.find((x) => x.poi && x.poi.properties.n === n && x.gps);
      for (let j = 0; j < 3; j++) {
        PUBLIC_ALBUM.push({ ...base, id: "pub" + (k * 3 + j),
          who: OTHERS[(k + j) % OTHERS.length],
          memo: MEMOS[(k + j) % MEMOS.length],
          verification: j === 0 ? "live" : "exif",
          ts: base.ts - (j + 1) * 400 * 864e5 });   // 1~3년 전 — 연도별 보기가 의미를 갖는다
      }
    });

    album.sort((a, b) => a.ts - b.ts);
    return album;
  }

  /* ── 정거장(stop) 클러스터링 ──────────────────────────────────
     PLAN §6.5. 30장을 30번 묻지 않기 위한 장치다.

     ★ 이 프로토타입의 앞선 버전은 `poi.properties.n`(장소 이름)으로 묶었다.
       데모 데이터가 이미 답을 알고 있었던 셈이다. 실제 사진에는 좌표와 시각뿐이다.
       그래서 여기서는 **좌표와 시각만으로** 묶는다.

     규칙: 시간순으로 훑다가
       · 직전 묶음 중심에서 R(150m)보다 멀어지면  → 새 정거장
       · 같은 자리인데 T(3시간)보다 오래 비면      → 새 정거장 (숙소 밤/아침)

     R을 정하는 실측 근거 (§10):
       · GPS 오차 σ=15~30m  → R이 50m면 같은 가게 안에서도 쪼개진다
       · 50m 안에 장소 중앙값 12곳 → R이 150m면 옆 가게와 합쳐진다
     둘을 동시에 만족하는 R은 없다. 그래서 **넉넉히 잡아 탭 수를 줄이고,
     잘못된 병합은 한 손짓으로 쪼갤 수 있게** 한다.

     결과: 정거장 하나 = 핀 하나 = 사진 여러 장.
     (핀을 사진마다 만들면 place_stats.pin_count가 뻥튀기되어 인기도가 왜곡된다) */
  /* ★ R은 상수가 아니다 — 사진이 들고 온 GPS 정확도에서 계산한다.
     후보 반경(candidate_radius)에서 같은 결론을 이미 실측했다:
     고정값은 어느 값을 골라도 한쪽을 희생한다.

     합성 데이터 채점 (사진 114장 · 실제 장소 28곳):
       R= 50m  탭 45  병합 0  분할 8
       R=150m  탭 23  병합 5  분할 0     ← 5건 중 4건은 카테고리 섞임으로 자동 감지
     두 오류의 비용이 다르다. 분할은 같은 장소를 한 번 더 고르면 끝이고
     ("한 여행 안에서 이미 고른 장소 1순위" 규칙이 이걸 거의 공짜로 만든다),
     병합은 쪼개지 않으면 **틀린 데이터가 남는다.** 그래서 병합 쪽을 더 무겁게 본다.

     2.5σ면 2D 정규오차의 약 96%를 덮는다. 아래로 60m, 위로 200m에서 자른다. */
  const STOP_T = 3 * 36e5;   // 3시간 — 같은 자리에 다시 왔을 때만 쓰는 보조 신호
  function stopRadius(accM) {
    return Math.min(200, Math.max(60, 2.5 * (accM || 15)));
  }

  /* ── 공개 자격 판정 (009·010·011을 화면에서 그대로) ───────────────
     ★ 판정만 하고 말하지 않으면 사용자는 이렇게 겪는다:
       사진을 올렸다 → "공개"로 뒀다 → 지도에 안 뜬다 → 이유를 모른다.
     그래서 **업로드 화면에서, 올리기 전에** 말한다. 이유는 하나만 준다 —
     여러 개를 나열하면 무엇부터 고쳐야 할지 모른다. */
  const REASON = {
    portrait:   { k: "인물 사진", why: "얼굴이 크게 나온 사진은 모두의 지도에 올리지 않습니다" },
    blurry:     { k: "흔들림",   why: "초점이 맞지 않아 모두의 지도에서는 빠집니다" },
    dark:       { k: "너무 어두움", why: "밝기 차이가 거의 없어 모두의 지도에서는 빠집니다" },
    small:      { k: "해상도 부족", why: "긴 변 800px 미만이라 모두의 지도에서는 빠집니다" },
    unmeasured: { k: "위치 미확인", why: "EXIF가 없어 위치를 확인할 수 없습니다" },
  };
  function excludeReason(x) {
    if (!x.gps) return "unmeasured";          // EXIF 없음 → 공개 자격 없음 (009)
    if (x.faceRatio > 0.25) return "portrait";
    const L = Math.max(x.w || 1280, x.h || 960);
    if (L < 800) return "small";
    if ((x.contrast ?? 60) < 18) return "dark";
    if ((x.focus ?? 2000) < 200) return "blurry";
    return null;
  }

  function clusterStops(items, R = null, T = STOP_T) {
    const out = [];
    let cur = null;
    // ④ EXIF가 없는 사진은 좌표로 묶을 수 없다. 먼저 빼고, 나중에 시간으로 붙인다.
    const withGps = items.filter((x) => x.gps);
    const noGps   = items.filter((x) => !x.gps);
    for (const it of withGps.slice().sort((a, b) => a.ts - b.ts)) {
      const p = it.gps;
      // 사진마다 정확도가 다르다. 두 사진 중 **나쁜 쪽**에 맞춘다 — 정확한 사진이
      // 부정확한 사진을 밀어내지 않게 한다.
      const r = R !== null ? R
              : Math.max(stopRadius(it.acc), stopRadius(cur ? cur.worstAcc : 15));
      if (cur) {
        const far = distM(cur.c, p) > r;
        const stale = it.ts - cur.end > T;
        if (!far && !stale) {
          cur.items.push(it); cur.end = it.ts;
          cur.worstAcc = Math.max(cur.worstAcc || 15, it.acc || 15);
          // 중심을 누적 평균으로 갱신 (GPS 오차를 평균이 흡수한다)
          const n = cur.items.length;
          cur.c = { lat: cur.c.lat + (p.lat - cur.c.lat) / n,
                    lng: cur.c.lng + (p.lng - cur.c.lng) / n };
          continue;
        }
      }
      cur = { items: [it], c: { ...p }, start: it.ts, end: it.ts, worstAcc: it.acc || 15 };
      out.push(cur);
    }
    // 시간이 가장 가까운 정거장에 붙인다 (§6.5 4단계). 공개 자격은 없다.
    for (const it of noGps) {
      let best = null, bd = Infinity;
      for (const st of out) {
        const d = Math.min(Math.abs(it.ts - st.start), Math.abs(it.ts - st.end));
        if (d < bd) { bd = d; best = st; }
      }
      if (best) best.items.push(it);
    }
    return out.map((s, i) => ({
      ...s, id: "s" + i,
      items: s.items.slice().sort((a, b) => a.ts - b.ts),
      noGpsCount: s.items.filter((x) => x.noGps).length,
    }));
  }

  /* ── 채점 ─────────────────────────────────────────────────────
     정거장이 실제 장소와 얼마나 맞는가. truth는 합성 데이터만 갖고 있다.
       · 병합 오류(merge) — 한 정거장에 서로 다른 장소가 섞였다 (옆 가게를 삼킴)
       · 분할 오류(split) — 한 장소가 여러 정거장으로 쪼개졌다 (GPS 튐)
     탭 수를 줄이는 것과 정확도는 반대 방향이라, 이 둘을 같이 봐야 R을 정할 수 있다. */
  window.scoreStops = function (items, R, T) {
    const stops = clusterStops(items, R, T);
    const truths = new Set(items.filter((x) => x.gps).map((x) => x.truth));
    let merge = 0;
    const seen = {};
    stops.forEach((st) => {
      const ts = new Set(st.items.filter((x) => x.gps).map((x) => x.truth));
      if (ts.size > 1) merge++;
      ts.forEach((t) => { (seen[t] ||= new Set()).add(st.id); });
    });
    const split = Object.values(seen).filter((v) => v.size > 1).length;
    return { R, T: T / 36e5, stops: stops.length, 실제장소: truths.size,
             병합오류: merge, 분할오류: split,
             탭: stops.length };
  };

  /* 정거장 안에서 카테고리가 갈리면 잘못 합쳐졌을 가능성이 높다.
     막지 않고 **쪼개기를 제안**한다 — 병합 오류는 막는 것보다 고치기 싸게 만든다. */
  function stopMixed(stop) {
    const cats = new Set(stop.items.map((x) => x.poi.properties.c));
    return cats.size > 1 ? [...cats] : null;
  }

  /* 정거장을 둘로 쪼갠다 (가장 큰 시간 간격에서 자른다) */
  function splitStop(stops, id) {
    const i = stops.findIndex((s) => s.id === id);
    const s = stops[i];
    if (!s || s.items.length < 2) return stops;
    let cut = 1, best = -1;
    for (let k = 1; k < s.items.length; k++) {
      const gap = s.items[k].ts - s.items[k - 1].ts;
      if (gap > best) { best = gap; cut = k; }
    }
    const a = clusterStops(s.items.slice(0, cut), 1e9, 1e15)[0];
    const b = clusterStops(s.items.slice(cut), 1e9, 1e15)[0];
    return [...stops.slice(0, i), { ...a, id: id + "a" }, { ...b, id: id + "b" }, ...stops.slice(i + 1)];
  }

  /* ── 여행 클러스터링 (PLAN §6.5 A-2) ─────────────────────────
     같은 날 ±2일 연속 + 거주지에서 30km 이상 → 하나의 여행 */
  /* ★ 거주지 좌표를 쓰지 않는다 (앞선 버전은 거주지에서 30km 밖만 여행으로 봤다).
       갈라야 하는 것은 "집이냐"가 아니라 **"늘 가던 곳이냐"**다.
       거리로 가르면 친구가 놀러 와서 같이 간 종로 나들이가 여행에서 빠진다 —
       실측(6,061장): 근거리 나들이 5건을 **5건 전부** 놓쳤다.

       그래서 빈도로 가른다. 2km 격자로 뭉개고, 격자마다 **끊어진 방문 횟수**를 센다.
       같은 창 안에서 3번 이상 따로 들렀으면 일상, 아니면 나간 날이다.
         · '날 수'가 아니라 '방문 횟수'인 이유 — 4일 연속 체류는 1회다.
           날 수로 세면 같은 여행지를 90일 안에 두 번 간 사람의 여행이 일상이 된다
           (실측에서 먼 여행 2건이 그렇게 사라졌다).
         · 이사해도 새 동네가 저절로 일상이 된다. 조정할 상수가 없다.
         · ★ 앱이 사용자의 집을 알 필요가 없어진다 (§2 최소 수집).

       규칙별 실측 (같은 앨범 6,061장 · 진짜 여행 39건)
         A 거주지 30km    찾은 것 34건 · 근거리 나들이 5/5 유실
         B 규칙 없음      찾은 것 39건 · 검출 206건, 전부 일상 오염, 56일짜리 덩어리
         C2 늘 가던 곳    찾은 것 38건 · 검출 37건 · 오염 4건                ← 채택 */
  /* ★ 상수가 아니라 설정이다. 이 값들은 합성 앨범에서 고른 것이라
     실제 앨범으로 흔들어 보며 **평지에 서 있는지 벼랑에 서 있는지** 확인해야 한다.
     const로 박아 두면 그 측정 자체가 불가능하다. */
  const TUNE = {
    CELL_DEG: 0.02,           // ≈2km 격자
    ROUTINE_WIN: 90,          // ±90일 안에서 본다
    ROUTINE_RUNS: 3,          // 끊어진 방문 3회 이상이면 일상
    RUN_GAP: 2,               // 이틀 넘게 비면 다른 '방문'
    TRIP_GAP: 2 * 864e5,      // 이틀 이상 비면 다른 여행
    TRIP_MIN: 2,              // 사진 2장이면 여행이다
  };
  const DAY_MS = 864e5, KST = 9 * 36e5;
  const cellOf = (p) => Math.round(p.lat / TUNE.CELL_DEG) + ":" + Math.round(p.lng / TUNE.CELL_DEG);
  const dayOf = (ts) => Math.floor((ts + KST) / DAY_MS);
  let ROUTINE = null;           // clusterTrips가 만들고 findOrphans가 다시 쓴다

  /* ── 사용자가 고칠 수 있게 한다 (§10.27) ──────────────────────
     빈도는 **"한동안 자주 갔다"와 "일상"을 못 가른다.**
     두 달 동안 매주 간 카페는 일상이 아니라 그때의 기록이다. 반대로 매일
     지나치는 회사 앞은 몇 번을 찍어도 일상이다. 사진만 보고는 이 둘을 가를 수 없다 —
     기준을 더 정교하게 만드는 대신, **틀렸을 때 고칠 수 있게** 한다.

     단위는 **날**이다. 판정이 날 단위로 이뤄지므로 고치는 단위도 같아야
     "왜 이게 바뀌었지"가 설명된다.

     ★ 저장 위치 — 기기다. 이 판정은 아직 등록되지 않은 사진에만 쓰인다.
       사용자가 "여행으로" 바꾸고 등록하면 그 순간 `trips` 행이 생기므로
       결과는 서버에 남는다. 고친 값 자체는 제안 단계의 재료일 뿐이다. */
  const DAY_RULE_KEY = "trippic.dayRule";
  function loadDayRule() {
    try { return JSON.parse(localStorage.getItem(DAY_RULE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function setDayRule(days, v) {
    days.forEach((d) => { if (v) UP.dayRule[d] = v; else delete UP.dayRule[d]; });
    try { localStorage.setItem(DAY_RULE_KEY, JSON.stringify(UP.dayRule)); } catch (e) {}
    recluster();
  }
  function recluster() {
    UP.trips = clusterTrips(UP.album);
    UP.orphans = findOrphans(UP.album, UP.trips);
    // 여행 중 일부만 스페이스에 공유돼 있다 (씨앗). 실제 앱은 사용자가 고른다.
    UP.trips.forEach((t, i) => {
      if (UP.tripSpace[t.id] !== undefined) return;
      UP.tripSpace[t.id] = i % 3 === 0 ? "sp1" : i % 3 === 1 ? "sp2" : null;
    });
  }
  // 그 여행이 걸쳐 있는 날짜들 (강등할 때 이 날들을 통째로 '일상'으로 표시한다)
  const daysOfTrip = (t) => [...new Set(t.items.filter((x) => x.gps).map((x) => dayOf(x.ts)))];

  function buildRoutine(album) {
    const cellDays = new Map(), byDay = new Map();
    for (const x of album) {
      if (!x.gps) continue;
      const c = cellOf(x.gps), d = dayOf(x.ts);
      if (!cellDays.has(c)) cellDays.set(c, new Set());
      cellDays.get(c).add(d);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(x);
    }
    // 격자마다 '끊어진 방문'의 시작일 (이틀 넘게 비면 다른 방문으로 친다)
    const runs = new Map();
    for (const [c, set] of cellDays) {
      const ds = [...set].sort((a, b) => a - b), r = [];
      for (let i = 0; i < ds.length; i++) if (i === 0 || ds[i] - ds[i - 1] > TUNE.RUN_GAP) r.push(ds[i]);
      runs.set(c, r);
    }
    const isRoutine = (c, d) => {
      let n = 0;
      for (const s0 of runs.get(c) || []) if (Math.abs(s0 - d) <= TUNE.ROUTINE_WIN && ++n >= TUNE.ROUTINE_RUNS) return true;
      return false;
    };
    return {
      // 이 사진이 찍힌 자리가 그 무렵 '늘 가던 곳'이었는가
      usual: (x) => (x.gps ? isRoutine(cellOf(x.gps), dayOf(x.ts)) : true),
      /* 나간 날의 사진들. 하루의 **주된** 격자가 일상이면 그 날은 통째로 일상이고,
         아니면 그 날 안에서도 일상 격자에 있는 사진은 뺀다 (출발 전 집앞 사진 등). */
      travelPhotos() {
        const ids = new Set();
        for (const [d, photos] of byDay) {
          // ★ 사용자가 고친 날은 추정을 건너뛴다. 사람이 기준보다 우선이다.
          const fixed = (UP.dayRule || {})[d];
          if (fixed === "daily") continue;
          if (fixed === "trip") { photos.forEach((x) => ids.add(x.id)); continue; }
          const cnt = {};
          photos.forEach((x) => { const c = cellOf(x.gps); cnt[c] = (cnt[c] || 0) + 1; });
          const main = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
          if (isRoutine(main, d)) continue;
          photos.forEach((x) => { if (!isRoutine(cellOf(x.gps), d)) ids.add(x.id); });
        }
        return ids;
      },
    };
  }

  const DEMO_CENTER = { lat: 37.5, lng: 127.03 }; // 지도 중심 폴백(데모). 거주지가 아니다.
  /* ★ 최소 3장 → 2장. 사진 두 장짜리 당일치기도 여행이다.
     실측에서 2장짜리 3건이 전부 낱개로 밀려났다. 3장을 요구할 이유가 없다 —
     오검출은 "집에서 30km 밖 + 이틀 안" 조건이 이미 막는다. */
  const R = 6371000;
  function distM(a, b) {
    const t = Math.PI / 180;
    const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const ll = (f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });

  /* 여행에 묶이지 않은 사진.
     ㉠ 늘 가던 곳 (동네 카페·회사 앞 — 일상이라 여행으로 묶지 않는다)
     ㉡ 늘 가던 곳이 아닌데 사진이 적어 클러스터에서 탈락 (한 장짜리 기록)
     둘 다 등록할 수 있어야 한다. PLAN §6.5 "낱개 기록도 허용한다" */
  function findOrphans(album, trips) {
    const used = new Set(trips.flatMap((t) => t.items.map((x) => x.id)));
    const rest = album.filter((a) => !used.has(a.id));
    const places = {};
    rest.forEach((x) => { (places[(x.poi && x.poi.properties.n) || "위치 없음"] ||= []).push(x); });
    Object.keys(places).forEach((k) => {
      const f0 = places[k][0];
      if (!f0.poi) { places[k].usual = true; return; }   // 좌표도 장소도 없는 사진
      places[k].usual = ROUTINE ? ROUTINE.usual(f0) : true;   // ㉠ 여부
    });
    return {
      id: "orphans", isOrphan: true, title: "여행에 묶이지 않은 사진",
      items: rest, places, placeCount: Object.keys(places).length,
      start: rest.length ? rest[0].ts : Date.now(),
      end: rest.length ? rest[rest.length - 1].ts : Date.now(),
      region: "여러 곳",
    };
  }

  function clusterTrips(album) {
    const out = [];
    let cur = null;
    /* ★ 정렬 — 앨범 스캔 결과가 시간순이라는 보장은 없다.
       정렬하지 않으면 서로 다른 여행이 한 덩어리로 뭉친다.
       실측(6,061장·7년): 진짜 34건 → 검출 9건, 그중 9건 전부가 여러 여행의 혼합. */
    const sorted = album.slice().sort((a, b) => a.ts - b.ts);
    /* ★ 좌표는 사진의 EXIF(gps)에서 온다. poi를 읽던 앞선 버전은 데모 데이터가
       답을 미리 알고 있던 흔적이다 — 실제 사진에는 장소가 달려 있지 않다.
       실측: 카톡·스크린샷이 섞인 실제 앨범에서 그 자리에서 터졌다. */
    ROUTINE = buildRoutine(sorted);
    const travel = ROUTINE.travelPhotos();
    for (const it of sorted) {
      if (!it.gps) continue;
      /* ★ 일상 사진을 만나도 진행 중인 여행을 끊지 않는다 — 건너뛰기만 한다.
         끊으면 여행 기간에 시각이 겹친 일상 사진 한 장이 여행을 두 동강 낸다.
         실측: 그런 사진 112장이 여행 31건을 73조각으로 쪼갰다.
         여행끼리의 분리는 아래 2일 간격 규칙이 이미 하고 있다. */
      if (!travel.has(it.id)) continue;
      if (cur && it.ts - cur.end <= TUNE.TRIP_GAP) {
        cur.items.push(it); cur.end = it.ts;
      } else {
        cur = { items: [it], start: it.ts, end: it.ts };
        out.push(cur);
      }
    }
    /* 좌표 없는 사진은 시간으로 여행에 붙인다 (clusterStops와 같은 규칙).
       여행에는 들어가되 공개 자격은 없다 (§009 verification). */
    for (const it of sorted) {
      if (it.gps) continue;
      const t = out.find((x) => it.ts >= x.start && it.ts <= x.end);
      if (t) t.items.push(it);
    }
    return out
      .filter((t) => t.items.filter((x) => x.gps).length >= TUNE.TRIP_MIN)
      .map((t, i) => {
        const regions = {};
        // poi가 없는 사진(카톡·스크린샷)은 지역을 모른다. 집계에서 뺀다.
        t.items.forEach((x) => { const r = x.poi && x.poi.properties.rn; if (r) regions[r] = (regions[r] || 0) + 1; });
        const main = Object.entries(regions).sort((a, b) => b[1] - a[1])[0]?.[0] || "여러 곳";
        // ★ 장소 이름이 아니라 좌표·시각으로 묶는다
        const stops = clusterStops(t.items);
        const d = new Date(t.start);
        return {
          // ★ 순번이 아니라 시작 시각. 사용자가 판정을 고쳐 다시 묶으면
          //   순번은 밀리고, 이미 등록한 여행이 목록에 되살아난다.
          id: "t" + t.start,
          title: `${main} ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`,
          region: main, start: t.start, end: t.end,
          items: t.items, stops,
          placeCount: stops.length,
        };
      })
      .sort((a, b) => b.start - a.start);
  }

  const fmtRange = (a, b) => {
    const f = (t) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; };
    return a === b || new Date(a).toDateString() === new Date(b).toDateString() ? f(a) : `${f(a)}–${f(b).slice(-2)}`;
  };

  /* ── 화면 ──────────────────────────────────────────────────── */
  function open(html) {
    close();
    const o = el(`<div id="upWrap"><div id="upSheet" class="glass">${html}</div></div>`);
    document.body.appendChild(o);
    o.addEventListener("click", (e) => { if (e.target.id === "upWrap") close(); });
    return o;
  }
  function close() { const o = $("#upWrap"); if (o) o.remove(); }

  /* S1 — 진입점 선택 */
  function screenEntry() {
    open(`
      <div class="upHead"><b>기록 추가</b><span class="upX">✕</span></div>
      <div class="entryList">
        <button class="entry" data-go="album">
          <i>🖼️</i><div><b>사진에서</b><small>앨범을 스캔해 여행 단위로 한 번에 — 소급 등록</small></div><em>›</em>
        </button>
        <button class="entry" data-go="place">
          <i>📍</i><div><b>장소에서</b><small>검색해서 그 장소에 사진 붙이기</small></div><em>›</em>
        </button>
        <button class="entry" data-go="live">
          <i>📷</i><div><b>지금 여기</b><small>현장 촬영 · 실방문 인증 뱃지</small></div><em>›</em>
        </button>
      </div>`);
    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-e='live']") ||
          (e.target.closest(".entry") && /지금 여기/.test(e.target.closest(".entry").textContent)))
        return screenLive();
      if (e.target.closest(".upX")) return close();
      const b = e.target.closest(".entry"); if (!b) return;
      if (b.dataset.go === "album") screenTrips();
      else if (b.dataset.go === "place") screenPlaceFirst();
      else screenLive();
    });
  }

  /* S2 — 앨범 스캔 결과 = 여행 목록 */
  function screenTrips() {
    const todo = UP.trips.filter((t) => !UP.registered.has(t.id));
    open(`
      <div class="upHead"><b>아직 지도에 없는 여행 ${todo.length}개</b><span class="upX">✕</span></div>
      <div class="upNote">앨범 ${UP.album.length}장을 시간·위치로 묶었습니다. 여행 하나가 통째로 올라갑니다.</div>
      <div class="tripList">
        ${todo.map((t) => `
          <button class="tripRow" data-t="${t.id}">
            <img src="${PHOTOS[t.items[0].img]}" alt="">
            <div>
              <b>${esc(t.title)}</b>
              <small>${fmtRange(t.start, t.end)} · 사진 ${t.items.length}장 · ${t.placeCount}곳</small>
            </div><em>›</em>
          </button>`).join("") || `<div class="upNote">여행은 모두 등록했습니다 🎉</div>`}
        ${orphanSection()}
      </div>`);
    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      const pr = e.target.closest("[data-promote]");
      if (pr) { setDayRule([+pr.dataset.promote], "trip"); return screenTrips(); }
      if (e.target.closest("#orGo")) return screenTripDetail(UP.orphans);
      const r = e.target.closest(".tripRow"); if (!r) return;
      screenTripDetail(UP.trips.find((t) => t.id === r.dataset.t));
    });
  }

  /* 낱개 섹션 — 여행 목록 아래에 붙는다 */
  function orphanSection() {
    const o = UP.orphans;
    if (!o || UP.registered.has("orphans") || !o.items.length) return "";
    const rows = Object.entries(o.places).slice(0, 4).map(([name, arr]) => {
      const p = arr[0].poi.properties;
      return `<div class="orRow"><img src="${PHOTOS[arr[0].img]}" alt="">
        <div><b>${esc(name)}</b><small>${esc(p.rn)} · ${arr.length}장${arr.usual ? "" : " · <i class='orFar'>여행지</i>"}</small></div></div>`;
    }).join("");
    const more = o.placeCount > 4 ? `<div class="orMore">외 ${o.placeCount - 4}곳</div>` : "";

    /* ★ 판정을 고칠 수 있게 한다 — 사진이 여러 장 있는 날만 보여준다.
       "한동안 자주 가서 일상으로 분류된 곳"이 여기로 떨어진다. */
    const byDay = {};
    o.items.forEach((x) => { if (x.gps) (byDay[dayOf(x.ts)] ||= []).push(x); });
    const fixRows = Object.entries(byDay)
      .filter(([d, arr]) => arr.length >= 2 && UP.dayRule[d] !== "daily")
      .sort((a, b) => b[1].length - a[1].length).slice(0, 3)
      .map(([d, arr]) => {
        const nm = arr[0].poi ? arr[0].poi.properties.n : "위치 없음";
        return `<div class="orFixRow">
          <div><b>${fmtRange(arr[0].ts, arr[arr.length - 1].ts)}</b>
            <small>${esc(nm)} 외 · ${arr.length}장</small></div>
          <button class="orFixBtn" data-promote="${d}">여행으로</button></div>`;
      }).join("");

    return `
      <div class="orBox">
        <div class="orHead">여행에 묶이지 않은 사진 ${o.items.length}장
          <small>늘 가던 곳이거나, 사진이 적어 여행으로 묶이지 않은 것들입니다.</small></div>
        ${rows}${more}
        ${fixRows ? `<div class="orFixBox">
          <div class="orFixHead">이 날은 여행이었나요?
            <small>자주 가던 곳이어도 그때의 기록일 수 있습니다. 바꾸면 여행으로 올라갑니다.</small></div>
          ${fixRows}</div>` : ""}
        <button class="orCta" id="orGo">낱개로 등록하기</button>
      </div>`;
  }

  /* ── 지역과 사진 이동 (§10.30) ────────────────────────────────
     ★ 지역은 여행이 아니라 **정거장**이 갖는다.
       날짜로 묶으면 한 여행 안에 여러 지역이 들어온다 —
       "12/5 서울에서 출발해서 12/6 강릉" 은 한 여행이지만 지역이 둘이다.
       여행에 지역을 하나만 달면 절반이 틀린 채로 등록된다.
       그래서 기본값만 여행에서 물려받고, 정거장마다 바꿀 수 있게 한다. */
  /* ★ 지역 키는 **법정동코드 시군구 5자리**다 (26350 = 부산광역시 해운대구).
     짧은 이름('중구')은 여러 시도에 있어 충돌하고, 주소의 시도 표기도 들쭉날쭉하다.
     코드가 둘 다 없앤다. 목록은 dict/regions.json 한 장(246개)에서 온다. */
  const RG = { list: [], byCode: new Map(), byName: new Map(), _p: null };
  function loadRegions() {
    if (RG.list.length) return Promise.resolve(RG);
    if (RG._p) return RG._p;
    RG._p = (async () => {
      const j = await (await fetch("dict/regions.json")).json();
      RG.list = j || [];
      RG.list.forEach((r) => {
        RG.byCode.set(r.c, r);
        const a2 = RG.byName.get(r.n);
        if (a2) a2.push(r); else RG.byName.set(r.n, [r]);
      });
      RG._p = null;
      return RG;
    })();
    RG._p.catch(() => { RG._p = null; });
    return RG._p;
  }
  const regionFull = (code) => {
    const r = RG.byCode.get(code);
    return r ? `${r.s} ${r.n}` : (code || "지역 미지정");
  };
  const regionShort = (code) => (RG.byCode.get(code) || {}).n || (code ? code : "지역 미지정");

  /* 정거장의 지역 **코드**. 사용자가 고른 게 있으면 그것,
     없으면 사진의 데모 POI가 가진 짧은 이름에서 찾는다.
     ★ 짧은 이름이 여러 시도에 있으면 첫 번째를 쓴다 — 데모 데이터의 한계다.
       실제 앱은 좌표로 시군구를 판정한다(경계 폴리곤). */
  function stopRegion(st) {
    if (UP.stopRegion[st.id]) return UP.stopRegion[st.id];
    const f = st.items.find((x) => x.poi);
    const nm = f && f.poi.properties.rn;
    const cand = nm ? RG.byName.get(nm) : null;
    return cand && cand.length ? cand[0].c : null;
  }

  /* 사진을 다른 정거장으로 옮긴다.
     ★ 옮긴 뒤에 시각·순서를 다시 계산하고 빈 정거장을 지운다.
       안 하면 "사진 0장짜리 정거장"이 남아 장소를 고르라고 조른다. */
  function applyMove(ids, target) {
    const set = new Set(ids);
    const moved = [];
    UP.stops.forEach((s) => {
      const keep = [];
      s.items.forEach((x) => (set.has(x.id) ? moved : keep).push(x));
      s.items = keep;
    });
    if (!moved.length) return false;
    let dest = target;
    if (target === "new") {
      dest = "s" + Date.now().toString(36);
      UP.stops.push({ id: dest, items: moved,
        c: moved[0].gps || { lat: 0, lng: 0 }, worstAcc: 15,
        noGpsCount: moved.filter((x) => !x.gps).length });
    } else {
      const st = UP.stops.find((s) => s.id === target);
      if (!st) return false;
      st.items.push(...moved);
    }
    UP.stops = UP.stops.filter((s) => s.items.length);
    UP.stops.forEach((s) => {
      s.items.sort((a, b) => a.ts - b.ts);
      s.start = s.items[0].ts; s.end = s.items[s.items.length - 1].ts;
    });
    UP.stops.sort((a, b) => a.start - b.start);
    // 사라진 정거장에 매달려 있던 선택을 정리한다
    Object.keys(UP.placeOf).forEach((k) => {
      if (!UP.stops.some((s) => s.id === k)) delete UP.placeOf[k];
    });
    Object.keys(UP.stopRegion).forEach((k) => {
      if (!UP.stops.some((s) => s.id === k)) delete UP.stopRegion[k];
    });
    UP.moveSel.clear();
    return dest;
  }

  /* 선택 순서가 곧 역할이다. PLAN §8
       0번 = 대표(폴리곤 커버)  ·  1~2번 = 노출(핀·피드)  ·  3번 이상 = 저장만 */
  function roleOf(i) {
    if (i < 0) return null;
    if (i === 0) return { k: "main", t: "대표" };
    if (i < 3) return { k: "show", t: "노출" };
    return { k: "keep", t: "저장" };
  }
  function photoCell(place, x) {
    const _ex = excludeReason(x);
    const i = UP.picks[place].indexOf(x.id);
    const r = roleOf(i);
    return `<div class="pgCell${_ex ? " excluded" : ""}">
      <button class="pgPhoto${r ? " on r-" + r.k : ""}" data-place="${esc(place)}" data-id="${x.id}"
              ${_ex ? `title="${esc(REASON[_ex].why)}"` : ""}>
        <img src="${PHOTOS[x.img]}" alt="">
        ${r ? `<span class="tag ${r.k}">${r.t}</span>` : `<span class="tag add">+</span>`}
        ${_ex ? `<span class="exBadge">${REASON[_ex].k}</span>` : ""}
      </button>
      ${r && r.k !== "main" ? `<button class="mainBtn" data-place="${esc(place)}" data-main="${x.id}" title="대표로">★</button>` : ""}
      ${/* ★ 업로드 경로에 크롭 버튼을 두지 않는다.
            목적은 내 여행 사진을 저장하는 것이고, 30장 올리며 30번 조절할 수는 없다.
            기본값(가운데)으로 충분하고, 다듬고 싶으면 **대표 사진만** 나중에 손본다. */ ""}
    </div>`;
  }

  /* S3 — 장소별로 이미 묶인 화면. 대표 사진만 고른다 */


  /* 장소 선택 화면 */
  const CK_CSS = `
  .ckChip{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:5px 10px;
    border:1px solid var(--line,#2a2f3a);border-radius:99px;background:transparent;
    color:var(--text-muted,#8b93a3);font-size:11.5px;cursor:pointer}
  .ckChip.done{border-color:transparent;background:rgba(127,168,196,.16);color:var(--text-primary,#e8ecf3);font-weight:600}
  .ckChip i{font-style:normal;opacity:.6;font-size:10.5px}
  .ckChip em{font-style:normal;opacity:.55;font-size:10.5px;margin-left:2px}
  .ckList{flex:1;overflow:auto;padding:0 14px}
  .ckRow{display:flex;align-items:center;gap:10px;width:100%;padding:11px 12px;margin-bottom:6px;
    border:1px solid var(--line,#242833);border-radius:12px;background:transparent;
    color:var(--text-primary,#e8ecf3);text-align:left;cursor:pointer}
  .ckRow.top{border-color:rgba(127,168,196,.55);background:rgba(127,168,196,.08)}
  .ckDot{width:8px;height:8px;border-radius:99px;flex:none}
  .ckMain{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
  .ckMain b{font-size:13px;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ckMain small{font-size:11px;color:var(--text-muted,#8b93a3)}
  .ckAgain{font-style:normal;font-size:10px;color:#7FA8C4;white-space:nowrap}
  .ckRow.sm{padding:8px 10px;margin-bottom:4px}
  .ckRow.far{opacity:.5;cursor:not-allowed}
  .ckFar{font-style:normal;font-size:10px;color:#C98A6E;white-space:nowrap}
  .ckNone{padding:10px 2px;font-size:11.5px;color:var(--text-muted,#8b93a3)}
  #ckHits{max-height:168px;overflow:auto;margin-top:8px}
  .liveWrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:10px;padding:24px 20px;text-align:center}
  .liveWrap b{font-size:14px}
  .liveWrap p{font-size:11.5px;color:var(--text-muted,#8b93a3);line-height:1.7;margin:0}
  .liveSpin{width:26px;height:26px;border-radius:99px;border:2px solid rgba(255,255,255,.14);
    border-top-color:#7FA8C4;animation:liveSpin .8s linear infinite}
  @keyframes liveSpin{to{transform:rotate(360deg)}}
  .liveWrap.err b{color:#C98A6E}
  .liveWrap .upCta{width:100%;margin-top:4px}
  .upCta.ghost{background:transparent;border:1px solid var(--line,#2a2f3a);color:var(--text-muted,#8b93a3)}
  .liveOk{color:#6FB5B3;font-weight:650}
  .liveBad{color:#C98A6E;font-weight:650}
  .liveTags{display:flex;gap:8px;font-size:11px;flex-wrap:wrap;justify-content:center}
  .liveTags span{padding:3px 9px;border-radius:99px;background:rgba(255,255,255,.06)}
  .liveHint{max-width:280px}
  .fmElig{margin:10px 0 2px;display:flex;flex-direction:column;gap:6px}
  .eOk,.eWarn{padding:9px 11px;border-radius:9px;font-size:11.5px;line-height:1.6}
  .eOk{background:rgba(111,181,179,.13);border:1px solid rgba(111,181,179,.28)}
  .eWarn{background:rgba(201,138,110,.13);border:1px solid rgba(201,138,110,.3)}
  .eOk b,.eWarn b{font-weight:700}
  .eOk small,.eWarn small{display:block;margin-top:3px;font-size:10.5px;color:var(--text-muted,#8b93a3)}
  .doneWrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:8px;padding:22px 20px;text-align:center}
  .doneBig{font-size:34px;font-weight:750;letter-spacing:-.02em}
  .doneSub{font-size:12px;color:var(--text-muted,#8b93a3)}
  /* 서버 전송 결과 — 실패를 숨기지 않는다 (§13.23) */
  .doneSync{width:100%;margin-top:10px;padding:10px 12px;border-radius:12px;font-size:11.5px;
    line-height:1.6;color:var(--text-muted);text-align:left}
  .doneSync:not(:empty){border:1px solid var(--surface-line)}
  .doneSync b{color:var(--accent)}
  .doneSync b.bad{color:#e0a94a}
  .doneSync small{display:block;font-size:10.5px;opacity:.85;margin-top:3px}
  .doneRows{width:100%;display:flex;flex-direction:column;gap:6px;margin-top:12px}
  .doneRows>div{display:grid;grid-template-columns:78px 1fr;gap:2px 10px;text-align:left;
    padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.04)}
  .doneRows i{font-style:normal;font-size:11px;color:var(--text-muted,#8b93a3)}
  .doneRows b{font-size:13px;font-weight:650}
  .doneRows small{grid-column:2;font-size:10.5px;color:var(--text-muted,#8b93a3)}
  .doneRows .ok{background:rgba(111,181,179,.12)}
  .doneRows .off{background:rgba(255,255,255,.03);opacity:.75}
  .doneHint{max-width:290px;font-size:11px;color:var(--text-muted,#8b93a3);line-height:1.7;margin:10px 0 0}
  .ckEmpty{padding:24px 4px;color:var(--text-muted,#8b93a3);font-size:12.5px;text-align:center}
  .ckMake{padding:12px 14px 16px;border-top:1px solid var(--line,#242833)}
  .ckMake input{width:100%;padding:10px 12px;border:1px solid var(--line,#242833);border-radius:10px;
    background:transparent;color:var(--text-primary,#e8ecf3);font-size:13px}
  .ckMake button{width:100%;margin-top:8px;padding:11px;border:0;border-radius:10px;
    background:rgba(127,168,196,.2);color:var(--text-primary,#e8ecf3);font-size:13px;font-weight:600;cursor:pointer}
  .cropWrap{flex:1;display:flex;align-items:center;justify-content:center;padding:4px 18px}
  .cropBox{position:relative;width:min(62vw,240px);aspect-ratio:4/5;overflow:hidden;
    border-radius:12px;background:#000;cursor:grab;touch-action:none}
  .cropBox:active{cursor:grabbing}
  .cropBox img{position:absolute;max-width:none;user-select:none;-webkit-user-drag:none}
  .cropGrid{position:absolute;inset:0;pointer-events:none}
  .cropGrid i{position:absolute;background:rgba(255,255,255,.34)}
  .cropGrid i:nth-child(1){left:33.33%;top:0;bottom:0;width:1px}
  .cropGrid i:nth-child(2){left:66.66%;top:0;bottom:0;width:1px}
  .cropGrid i:nth-child(3){top:33.33%;left:0;right:0;height:1px}
  .cropGrid i:nth-child(4){top:66.66%;left:0;right:0;height:1px}
  .cropZoom{display:flex;align-items:center;gap:10px;padding:10px 18px 4px;font-size:11.5px;
    color:var(--text-muted,#8b93a3)}
  .cropZoom input{flex:1}
  .cropBtn{margin-top:6px;padding:4px 9px;border:1px solid var(--line,#2a2f3a);
    border-radius:99px;background:transparent;color:var(--text-muted,#8b93a3);
    font-size:10.5px;cursor:pointer}
  .pgCell{position:relative}
  .pubWarn{margin-top:7px;padding:8px 10px;border-radius:9px;
    background:rgba(201,138,110,.13);border:1px solid rgba(201,138,110,.3);
    font-size:11.5px;color:var(--text-primary,#e8ecf3);line-height:1.6}
  .pubWarn b{color:#C98A6E}
  .pubWarn small{display:block;margin-top:3px;font-size:10.5px;color:var(--text-muted,#8b93a3)}
  .pgCell.excluded img{filter:grayscale(1) brightness(.55)}
  .exBadge{position:absolute;left:3px;bottom:3px;padding:1px 5px;border-radius:5px;
    background:rgba(0,0,0,.78);color:#E8B9A4;font-size:9px;font-weight:600;white-space:nowrap}
  .ckMake small{display:block;margin-top:8px;font-size:10.5px;color:var(--text-muted,#8b93a3);line-height:1.6}`;


  /* ── 4:5 크롭 편집기 (012) ────────────────────────────────────────
     실측: 실제 여행 사진 131장이 **전부 가로**였다. 세로만 받으면 다 버린다.
     그래서 촬영은 열어두고 **표시를 4:5로 고정**하되, 어디를 자를지는 사용자가 정한다.

     저장하는 값은 중심(crop_x, crop_y)과 배율(crop_scale)뿐이다.
     실제 사각형은 media_crop_rect()가 계산한다 — 앱·웹·썸네일이 갈라지지 않게. */
  const CARD_RATIO = 0.8;            // 4:5 (가로/세로)

  function cropRect(w, h, cx = .5, cy = .5, scale = 1, ratio = CARD_RATIO) {
    const fw = (w / h < ratio) ? w : Math.round(h * ratio);
    const fh = (w / h < ratio) ? Math.round(w / ratio) : h;
    const bw = Math.max(Math.round(fw / Math.max(scale, 1)), 1);
    const bh = Math.max(Math.round(fh / Math.max(scale, 1)), 1);
    return { x: Math.min(Math.max(Math.round(w * cx - bw / 2), 0), w - bw),
             y: Math.min(Math.max(Math.round(h * cy - bh / 2), 0), h - bh), w: bw, h: bh };
  }

  function screenCrop(stop, x) {
    const W = x.w || 1280, H = x.h || 960;
    UP.crop = UP.crop || {};
    const c = UP.crop[x.id] || { cx: .5, cy: .5, scale: 1 };
    open(`
      <div class="upHead"><span class="upBack">‹</span><b>보일 영역 정하기</b><span class="upX">✕</span></div>
      <div class="upNote"><b>원본은 잘리지 않습니다.</b> 저장되는 건 "어디를 보여줄지"뿐입니다
        (숫자 세 개). 내 기록에서는 늘 원본 비율로 보이고,
        모두의 지도 목록에서만 이 영역이 쓰입니다. 안 건드려도 가운데로 잡힙니다.</div>
      <div class="cropWrap"><div class="cropBox" id="cropBox">
        <img id="cropImg" src="${PHOTOS[x.img]}" alt="" draggable="false">
        <div class="cropGrid"><i></i><i></i><i></i><i></i></div>
      </div></div>
      <div class="cropZoom">
        <label>확대</label>
        <input type="range" id="cropScale" min="1" max="3" step="0.05" value="${c.scale}">
        <span id="cropScaleV">${c.scale.toFixed(2)}×</span>
      </div>
      <button class="upCta" id="cropDone">이 영역으로</button>`);

    const img = $("#cropImg");
    // 4:5 창을 꽉 채우도록 확대하고, 중심을 이동시킨다
    const paint = () => {
      const box = $("#cropBox").getBoundingClientRect();
      if (!box.width) return false;                    // 아직 배치 전이면 다음에 다시
      // ★ 실제 이미지 크기를 쓴다. 메타데이터와 실물이 다를 수 있다
      //   (합성 데이터는 1280x960인데 실제 파일은 1280x819였다).
      const w = img.naturalWidth || W, h = img.naturalHeight || H;
      const r = cropRect(w, h, c.cx, c.cy, c.scale);
      const k = box.width / r.w;                       // 잘린 영역을 창 너비에 맞춘다
      img.style.width = (w * k) + "px";
      img.style.height = (h * k) + "px";
      img.style.left = (-r.x * k) + "px";
      img.style.top = (-r.y * k) + "px";
      return true;
    };
    // 이미지 로드·배치 시점이 제각각이라 여러 번 시도한다 (한 번만 걸면 놓친다)
    img.addEventListener("load", paint);
    if (img.complete) requestAnimationFrame(paint);
    let tries = 0;
    const kick = setInterval(() => { if (paint() || ++tries > 20) clearInterval(kick); }, 50);

    let drag = null;
    const down = (e) => { const p = e.touches ? e.touches[0] : e; drag = { px: p.clientX, py: p.clientY }; };
    const move = (e) => {
      if (!drag) return;
      const p = e.touches ? e.touches[0] : e;
      const box = $("#cropBox").getBoundingClientRect();
      const w = img.naturalWidth || W, h = img.naturalHeight || H;
      const r = cropRect(w, h, c.cx, c.cy, c.scale);
      const k = box.width / r.w;
      c.cx = Math.min(Math.max(c.cx - (p.clientX - drag.px) / (w * k), 0), 1);
      c.cy = Math.min(Math.max(c.cy - (p.clientY - drag.py) / (h * k), 0), 1);
      drag = { px: p.clientX, py: p.clientY };
      paint(); e.preventDefault();
    };
    const up = () => { drag = null; };
    const bx = $("#cropBox");
    bx.addEventListener("mousedown", down); bx.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("mousemove", move); bx.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", up); bx.addEventListener("touchend", up);

    $("#cropScale").addEventListener("input", (e) => {
      c.scale = +e.target.value; $("#cropScaleV").textContent = c.scale.toFixed(2) + "×"; paint();
    });
    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack") || e.target.closest("#cropDone")) {
        UP.crop[x.id] = c;
        clearInterval(kick);
        window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
        return screenTripDetail(UP.trip);
      }
    });
  }

  /* ── 정거장 → 장소 확정 ───────────────────────────────────────
     007(api_place_candidates)을 화면에서 그대로 흉내낸다. 같은 점수식을 쓴다:
       거리 2.5 · 카테고리 3.0 · 1층 0.6 · 선택이력 2.0 · 인기도 0.3
     · 반경은 GPS 정확도에서 계산한다 (candidate_radius = clamp(3.5σ, 50, 300))
     · 10개까지 보여준다 — 실측으로 top5 78.8% → top10 86.9% (+8.1pp §10.11)
     · **한 여행 안에서 이미 고른 장소는 1순위**로 올린다.
       숙소를 밤·아침 두 번 묻지 않기 위한 장치다 (place_picks의 여행 범위판). */
  function candRadius(accM) { return Math.min(300, Math.max(50, 3.5 * (accM || 15))); }

  /* ★ 후보는 **실제 장소 DB**에서 찾는다.
     지도에 뜨는 poi.features(7,561곳 · 사진이 붙은 데모용)와는 다른 물건이다.
     실제 앱에서도 그렇다 — 지도는 핀을 그리고, 후보는 장소 사전에서 온다.
     places-real.json: 해운대구·제주시·종로구 49,670곳 (Supabase에서 추출).
     격자로 색인해 둔다. 반경 300m를 훑는데 5만 곳을 전수 스캔할 수는 없다. */
  const PL = { rows: [], grid: new Map(), cell: 0.005 };   // 0.005° ≈ 500m
  function plKey(lng, lat) {
    return Math.floor(lng / PL.cell) + ":" + Math.floor(lat / PL.cell);
  }
  async function loadPlaces() {
    try {
      const j = await (await fetch("places-real.json")).json();
      PL.rows = j.rows;
      j.rows.forEach((r, i) => {
        const k = plKey(r[2], r[3]);
        (PL.grid.get(k) || PL.grid.set(k, []).get(k)).push(i);
      });
      console.log("[upload] 실제 장소", PL.rows.length.toLocaleString(), "곳 로드");
    } catch (e) { console.warn("[upload] places-real.json 없음 — 데모 POI로 대체", e); }
  }
  function nearbyPlaces(c, rad) {
    if (!PL.rows.length) return null;
    const span = Math.ceil(rad / 400);
    const gx = Math.floor(c.lng / PL.cell), gy = Math.floor(c.lat / PL.cell);
    const out = [];
    for (let x = gx - span; x <= gx + span; x++)
      for (let y = gy - span; y <= gy + span; y++) {
        const ids = PL.grid.get(x + ":" + y); if (!ids) continue;
        for (const i of ids) {
          const r = PL.rows[i];
          const d = distM(c, { lng: r[2], lat: r[3] });
          if (d <= rad) out.push({ r, d });
        }
      }
    return out;
  }

  function candidatesFor(stop) {
    const c = stop.c;
    const acc = stop.worstAcc || 15;
    const rad = candRadius(acc);
    const guess = stop.items[0].poi.properties.c;      // 사진 카테고리 추정 (지금은 합성값)
    const conf = 0.7;
    const near = nearbyPlaces(c, rad);
    const out = [];
    if (near) {
      for (const { r, d } of near) {
        const [n, cat, , , ground, , pins] = r;
        const picked = UP.tripPicks[n] || 0;
        out.push({ n, cat, d, ground: !!ground, score:
            2.5 * (1 / (1 + d / 50))
          + 3.0 * (cat === guess ? conf : 0)
          + 0.6 * (ground ? 1 : 0)                     // ★ 1층 우선 (§10 실측)
          + 2.0 * Math.log(1 + picked)
          + 0.3 * Math.log(1 + pins) });
      }
    } else {                                           // 실데이터가 없으면 데모 POI로
      for (const f of poi.features) {
        const p = ll(f), d = distM(c, p);
        if (d > rad) continue;
        const pr = f.properties;
        out.push({ n: pr.n, cat: pr.c, d, ground: true, score:
            2.5 * (1 / (1 + d / 50)) + 3.0 * (pr.c === guess ? conf : 0) + 0.6
          + 2.0 * Math.log(1 + (UP.tripPicks[pr.n] || 0))
          + 0.3 * Math.log(1 + (pr.likes || 0) / 10) });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return { rad, total: out.length, list: out.slice(0, 10) };
  }


  /* ── "지금 여기" — 현장 촬영 (016) ────────────────────────────────
     앞의 두 경로와 **기준 좌표가 다르다**:
       앨범 소급 등록 → 사진 EXIF        verification='exif'
       지금 여기      → **현재 GPS**      verification='live'   ← 여기
       지도에서 찍기  → 사용자 지정       verification='manual' (공개 불가)

     live는 셋 중 신뢰도가 가장 높다. 그래서 DB가 두 가지를 강제한다(016):
       · 찍은 때와 등록 때가 하루 이상 벌어지면 live가 아니다
       · 정확도 150m 초과면 live가 아니다 — 그 정도면 장소를 특정할 수 없다 */
  const LIVE_MAX_ACC = 150;

  function getPosition(timeout = 8000) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({ err: "unsupported" });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude,
                         acc: p.coords.accuracy }),
        (e) => resolve({ err: e.code === 1 ? "denied" : e.code === 3 ? "timeout" : "unavailable" }),
        { enableHighAccuracy: true, timeout, maximumAge: 0 });
    });
  }

  function screenLive() {
    open(`
      <div class="upHead"><span class="upBack">‹</span><b>지금 여기</b><span class="upX">✕</span></div>
      <div class="upNote">현재 위치를 확인하는 중입니다 —
        <b>기기 GPS</b>를 씁니다 (사진 EXIF가 아니라).</div>
      <div class="liveWrap"><div class="liveSpin"></div><div id="liveMsg">위치 확인 중…</div></div>`);
    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenEntry();
      if (e.target.closest("#liveRetry")) return screenLive();
      if (e.target.closest("#liveManual")) {
        alert("지도에서 직접 찍는 경로입니다.\n" +
              "위치를 확인할 수 없으므로 verification='manual'이 되고,\n" +
              "내 기록·스페이스 공유까지만 가능합니다 (모두의 지도 ✕).");
        return;
      }
      const b = e.target.closest("[data-pick]");
      if (b && UP.live) {
        UP.live.place = b.dataset.pick;
        return screenLiveDone();
      }
    });

    getPosition().then((pos) => {
      if (pos.err) {
        const msg = { denied: "위치 권한이 꺼져 있습니다",
                      timeout: "위치를 잡지 못했습니다 (실내·지하일 수 있습니다)",
                      unavailable: "기기가 위치를 알 수 없습니다",
                      unsupported: "이 브라우저는 위치를 지원하지 않습니다" }[pos.err];
        $("#upSheet .liveWrap").outerHTML = `
          <div class="liveWrap err">
            <b>${msg}</b>
            <p>현장 인증(live)은 기기 GPS가 있어야 합니다.<br>
               대신 <b>앨범에서</b> 올리거나 <b>지도에서 직접</b> 찍을 수 있습니다 —
               다만 지도에서 찍으면 <b>모두의 지도에는 올라가지 않습니다.</b></p>
            <button class="upCta" id="liveRetry">다시 시도</button>
            <button class="upCta ghost" id="liveManual">지도에서 직접 찍기</button>
          </div>`;
        return;
      }
      UP.live = { lat: pos.lat, lng: pos.lng, acc: pos.acc };
      const ok = pos.acc <= LIVE_MAX_ACC;
      const stop = { c: { lat: pos.lat, lng: pos.lng }, worstAcc: pos.acc,
                     items: [{ poi: { properties: { c: "cafe" } } }] };
      const { rad, total, list } = candidatesFor(stop);
      UP.live.stop = stop;
      $("#upSheet .liveWrap").outerHTML = `
        <div class="upNote">
          정확도 <b>±${Math.round(pos.acc)}m</b> → 반경 <b>${Math.round(rad)}m</b> 안에 ${total}곳.
          ${ok ? `<br>현장 인증 <b class="liveOk">live</b>로 저장됩니다.`
               : `<br><b class="liveBad">정확도가 ${LIVE_MAX_ACC}m를 넘어 현장 인증이 안 됩니다.</b>
                  그 정도면 장소를 특정할 수 없습니다 — 그대로 올리면 위치 미검증으로 남습니다.`}
        </div>
        <div class="ckList">${list.length
          ? list.map((x, i) => { const cat = CAT[x.cat] || CAT.etc;
              return `<button class="ckRow${i === 0 ? " top" : ""}" data-pick="${esc(x.n)}">
                <span class="ckDot" style="background:${cat.c}"></span>
                <span class="ckMain"><b>${esc(x.n)}</b><small>${cat.k} · ${Math.round(x.d)}m</small></span>
              </button>`; }).join("")
          : `<div class="ckEmpty">반경 안에 아는 장소가 없습니다.</div>`}</div>`;
    });
  }

  function screenLiveDone() {
    const L = UP.live, ok = L.acc <= LIVE_MAX_ACC;
    open(`
      <div class="upHead"><span class="upBack">‹</span><b>지금 여기</b><span class="upX">✕</span></div>
      <div class="liveWrap done">
        <b>${esc(L.place)}</b>
        <p>좌표 ${L.lat.toFixed(5)}, ${L.lng.toFixed(5)} · 정확도 ±${Math.round(L.acc)}m</p>
        <div class="liveTags">
          <span class="${ok ? "liveOk" : "liveBad"}">${ok ? "live · 현장 인증" : "위치 미검증"}</span>
          <span>${ok ? "모두의 지도 가능" : "내 기록·스페이스만"}</span>
        </div>
        <p class="liveHint">여기서 사진을 찍으면 <b>지금 시각</b>으로 기록됩니다.
          앨범에서 올리는 것과 달리 위치를 기기가 직접 확인합니다.</p>
        <button class="upCta" id="liveShoot">사진 찍기</button>
      </div>`);
    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenLive();
      if (e.target.closest("#liveShoot"))
        alert(`"${L.place}"에 현장 기록을 남깁니다.\n\n` +
              `verification = ${ok ? "live" : "manual"}\n` +
              `gps_accuracy_m = ${Math.round(L.acc)}\n` +
              `visited_at = 지금\n\n` +
              (ok ? "모두의 지도에 올릴 수 있습니다." : "모두의 지도에는 올라가지 않습니다."));
    });
  }


  /* ── "장소에서" 진입점 (§6.5 B) ───────────────────────────────────
     앞의 둘과 **출발점이 반대**다:
       앨범에서 · 지금 여기 → 사진(좌표)에서 출발해 장소를 찾는다
       장소에서            → **장소에서 출발해 사진을 찾는다**

     ★ 그래도 사진의 EXIF 좌표가 그 장소 근처여야 한다.
       안 그러면 "제주도에 30장 몰아넣기"가 이 경로로 되살아난다.
       009의 부착 거리 제약(500m)이 DB에서 막지만, **화면이 먼저 걸러야** 한다 —
       고를 수 없는 것을 보여주고 나서 거절하는 건 나쁜 설계다.

     검색 기준점: 지금 보고 있는 지도 중심 (§6.6의 기준점 개념을 그대로 쓴다).
     사용자는 보통 가려는/갔던 지역을 띄워 놓고 찾는다. */
  const ATTACH_MAX_M = 500;

  function anchorPoint() {
    if (window.state && state.anchor) return { lat: state.anchor.lat, lng: state.anchor.lng };
    if (window.map && map.getCenter) { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; }
    return DEMO_CENTER;
  }

  function screenPlaceFirst() {
    const a = anchorPoint();
    UP.pf = { anchor: a, place: null };
    open(`
      <div class="upHead"><span class="upBack">‹</span><b>장소에서</b><span class="upX">✕</span></div>
      <div class="upNote">지금 보고 있는 지도 근처에서 찾습니다.
        고른 장소 <b>${ATTACH_MAX_M}m 안</b>에서 찍은 사진만 붙일 수 있습니다 —
        사진의 EXIF 좌표가 기준입니다.</div>
      <div class="ckMake" style="border:0;padding:0 14px">
        <input id="pfQ" placeholder="장소 이름 — 예: 협재, 익선동">
      </div>
      <div class="ckList" id="pfHits"><div class="ckEmpty">이름을 입력하세요.</div></div>`);

    const draw = () => {
      const q = $("#pfQ").value.trim();
      const stop = { c: UP.pf.anchor, worstAcc: 15,
                     items: [{ poi: { properties: { c: "sight" } } }] };
      const hits = q ? searchPlaces(stop, q) : [];
      $("#pfHits").innerHTML = !q
        ? `<div class="ckEmpty">이름을 입력하세요.</div>`
        : hits.length
          ? hits.map((h) => { const cat = CAT[h.cat] || CAT.etc;
              return `<button class="ckRow" data-pf="${esc(h.n)}"
                        data-lat="${h.lat ?? ""}" data-lng="${h.lng ?? ""}">
                <span class="ckDot" style="background:${cat.c}"></span>
                <span class="ckMain"><b>${esc(h.n)}</b><small>${cat.k} ·
                  ${h.d < 1000 ? Math.round(h.d) + "m" : (h.d / 1000).toFixed(1) + "km"}</small></span>
              </button>`; }).join("")
          : `<div class="ckEmpty">"${esc(q)}" 근처에 없습니다. 지도를 그 지역으로 옮겨 보세요.</div>`;
    };
    $("#pfQ").addEventListener("input", draw);

    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenEntry();
      const b = e.target.closest("[data-pf]");
      if (b) {
        const hits = searchPlaces({ c: UP.pf.anchor, worstAcc: 15,
          items: [{ poi: { properties: { c: "sight" } } }] }, $("#pfQ").value.trim());
        const h = hits.find((x) => x.n === b.dataset.pf) || { n: b.dataset.pf };
        return screenPlacePhotos(h);
      }
    });
  }

  /* 고른 장소 근처에서 찍은 사진만 보여준다 */
  function screenPlacePhotos(place) {
    // 장소 좌표: 검색 결과에 실려 온 것, 없으면 기준점
    const pc = (place.lng != null && place.lat != null)
      ? { lng: place.lng, lat: place.lat } : UP.pf.anchor;
    const near = [], far = [], noGps = [];
    for (const x of UP.album) {
      if (!x.gps) { noGps.push(x); continue; }
      (distM(pc, x.gps) <= ATTACH_MAX_M ? near : far).push(x);
    }
    UP.pf.place = place; UP.pf.near = near;
    UP.pf.sel = new Set(near.slice(0, 3).map((x) => x.id));

    open(`
      <div class="upHead"><span class="upBack">‹</span><b>${esc(place.n)}</b><span class="upX">✕</span></div>
      <div class="upNote">이 장소 <b>${ATTACH_MAX_M}m 안</b>에서 찍은 사진 <b>${near.length}장</b>.
        ${far.length ? `<br>앨범의 나머지 ${far.length}장은 다른 곳에서 찍혔습니다 —
          <b>붙일 수 없습니다.</b> 사진은 찍힌 자리에 남아야 합니다.` : ""}
        ${noGps.length ? `<br>EXIF 없는 ${noGps.length}장은 위치를 확인할 수 없어 제외됩니다.` : ""}
      </div>
      <button class="rpEnter" id="pfView">📷 이 장소의 기록 보기</button>
      <button class="rpEnter" id="pfReport">⚑ 이 장소 정보가 잘못됐나요?</button>
      <div class="pgRow" id="pfPhotos" style="padding:0 14px;flex-wrap:wrap">
        ${near.length ? near.map((x) => `
          <div class="pgCell${excludeReason(x) ? " excluded" : ""}">
            <button class="pgPhoto${UP.pf.sel.has(x.id) ? " on r-main" : ""}" data-pf-photo="${x.id}">
              <img src="${PHOTOS[x.img]}" alt="">
              ${excludeReason(x) ? `<span class="exBadge">${REASON[excludeReason(x)].k}</span>` : ""}
            </button>
          </div>`).join("")
          : `<div class="ckEmpty">이 장소 근처에서 찍은 사진이 앨범에 없습니다.<br>
               현장이라면 <b>지금 여기</b>로 찍어 남기세요.</div>`}
      </div>
      ${near.length ? `<button class="upCta" id="pfDone">선택한 사진 붙이기</button>` : ""}`);

    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenPlaceFirst();
      const p = e.target.closest("[data-pf-photo]");
      if (p) {
        const id = +p.dataset.pfPhoto;
        UP.pf.sel.has(id) ? UP.pf.sel.delete(id) : UP.pf.sel.add(id);
        p.classList.toggle("on"); p.classList.toggle("r-main");
        return;
      }
      if (e.target.closest("#pfView"))
        return screenViewer(place.n, { back: () => screenPlacePhotos(place) });
      if (e.target.closest("#pfReport"))
        return screenReport({ type: "place", id: place.n, label: place.n },
                            () => screenPlacePhotos(place));
      if (e.target.closest("#pfDone")) {
        const sel = [...UP.pf.sel];
        const ok = sel.filter((id) => !excludeReason(UP.album.find((x) => x.id === id)));
        alert(`"${place.n}"에 ${sel.length}장을 붙입니다.\n\n` +
              `모두의 지도: ${ok.length}장\n` +
              `내 기록에만: ${sel.length - ok.length}장\n\n` +
              `verification = exif (사진 EXIF 좌표 기준)`);
        close();
      }
    });
  }

  /* ── 검색 폴백 (015) ──────────────────────────────────────────────
     실측: 후보 10개 안에 정답이 있는 비율 86.9% → **업로드의 약 13%가 여기로 온다.**

     ★ 전역 이름 검색이 아니다. "스타벅스"는 전국에 872곳이다.
       사용자는 **자기가 있던 자리**의 가게를 찾는다. 검색도 좌표에 묶인다.
       (DB에서도 공간 인덱스로 먼저 좁힌다 — 전역 ilike는 2글자 한글에 564ms다) */
  function searchPlaces(stop, q) {
    q = (q || "").trim();
    if (!q) return [];
    const c = stop.c, rad = 2000;
    const near = nearbyPlaces(c, rad);
    const norm = (t) => t.replace(/\s/g, "");
    const nq = norm(q);
    const guess = stop.items[0].poi.properties.c;
    const out = [];
    const src = near || poi.features.map((f) => ({ r: [f.properties.n, f.properties.c,
      ll(f).lng, ll(f).lat, 1, 0, f.properties.likes || 0], d: distM(c, ll(f)) }));
    for (const { r, d } of src) {
      const [n, cat] = r;
      const nn = norm(n);
      if (!nn.includes(nq) && !nq.split("").every((ch) => nn.includes(ch))) continue;
      out.push({ n, cat, d, lng: r[2], lat: r[3], attachable: d <= 500,
        score: 3.0 * (nn.includes(nq) ? nq.length / Math.max(nn.length, 1) : 0)
             + 1.5 * (nn.startsWith(nq) ? 1 : 0)
             + 2.0 * (1 / (1 + d / 1000))
             + 1.0 * (cat === guess ? 1 : 0) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 12);
  }

  /* 후보 목록 시트 */
  /* ── 간판 OCR 경로 (§10.30) ────────────────────────────────
     좌표가 없을 때 **이름이 좌표를 대신한다.** 좌표는 지워져도 간판은 사진에 남는다.

     ★ 프로토타입에서 흉내내는 것은 "글자를 읽는 것"뿐이다.
       실제 앱은 온디바이스 OCR(ML Kit / Vision)이 (글자, 박스)를 준다.
       **고르고 걸러내는 부분은 진짜로 돈다** — places-real.json 49,020곳에 실제로 조회한다.
       거기가 이 화면에서 검증할 값어치가 있는 곳이다. */

  // 지역의 대략 중심. 시군구 경계 대신 그 지역 POI의 무게중심을 쓴다.
  // 지역 중심 — regions.json이 들고 있다(시군구 bbox 중심)
  function regionCenter(code) {
    const r = RG.byCode.get(code);
    return r && r.lat != null ? { lat: r.lat, lng: r.lng } : null;
  }

  const OCR_REGION_M = 8000;   // 시군구 한 개쯤

  /* ── 지역 사전 온디바이스 (§10.33) ──────────────────────────
     ★ 조회를 서버로 보내지 않는다. 이유가 둘인데 **같은 방향**을 가리킨다.

       ① 비용 — 사진 5,000장 앨범이면 읽은 줄이 약 4,167개다.
         전부 서버에 물으면 사용자 한 명당 4,167회, 1만 명이면 4,167만 회다.
       ② 프라이버시 — OCR은 간판만 읽지 않는다. 영수증의 카드번호 뒷자리,
         처방전, 아이 이름표, 택배 송장까지 읽는다. **그 글자를 서버로 보내면
         "사진은 안 보냅니다"가 무의미해진다.**

     전국 사전은 51MB라 못 내린다. 그런데 **여행은 지역이 한두 개다.**
     시군구 하나는 TSV로 raw 355~1,166KB(gzip 110~378KB)다 — 실측(§10.33).
     지역을 정하는 순간 그 사전만 받으면 조회가 기기에서 끝난다.
     덤으로 비행기·지하철에서도 된다. */
  const DICT = { code: null, rows: [], byName: new Map(), bytes: 0, ms: 0, fetches: 0, _p: null };
  let DICTS = [];                                   // 준비된 사전 목록 (dict/index.json)
  function loadDictIndex() {
    if (DICTS.length) return Promise.resolve(DICTS);
    return fetch("dict/index.json").then((r) => r.json())
      .then((j) => (DICTS = j || [])).catch(() => (DICTS = []));
  }

  async function loadRegionDict(code) {
    if (!code) throw new Error("지역이 정해지지 않았습니다");
    if (DICT.code === code) return DICT;              // 이미 있으면 네트워크를 안 탄다
    if (DICT._p && DICT._p.code === code) return DICT._p.p;
    const p = (async () => {
      const t0 = (window.performance || Date).now();
      const res = await fetch(`dict/${encodeURIComponent(code)}.tsv`);
      if (!res.ok) throw new Error("사전 없음: " + regionFull(code));
      const text = await res.text();
      const rows = [], byName = new Map();
      for (const line of text.split("\n")) {
        if (!line) continue;
        const [n, c, lng, lat] = line.split("\t");
        const rec = { n, c, lng: +lng, lat: +lat };
        rows.push(rec);
        const a = byName.get(n);
        if (a) a.push(rec); else byName.set(n, [rec]);
      }
      DICT.code = code; DICT.rows = rows; DICT.byName = byName;
      DICT.bytes = +(res.headers.get("content-length") || 0) || text.length;
      DICT.ms = Math.round((window.performance || Date).now() - t0);
      DICT.fetches++;
      DICT._p = null;
      return DICT;
    })();
    DICT._p = { code, p };
    p.catch(() => { DICT._p = null; });
    return p;
  }

  /* 사전 안에서 찾는다. 네트워크를 타지 않는다. */
  function dictLookup(line) {
    const out = (DICT.byName.get(line) || []).slice();
    if (line.length >= OCR_PREFIX_MIN) {
      for (const r of DICT.rows) {
        if (r.n !== line && r.n.startsWith(line)) {
          out.push(r);
          if (out.length > 50) break;               // 너무 많으면 어차피 버린다
        }
      }
    }
    return out;
  }
  /* ★ 화면에 붙이고 나서 알게 된 것 — 접두 일치는 짧은 단어에서 무너진다.
     "커피"로 접두 조회하니 **해운대구 안에서만 17곳**이 걸렸다("커피…"로 시작하는 상호).
     §10.30 규칙 3("정확 또는 접두 일치")은 긴 상호를 염두에 둔 것이었는데,
     메뉴판의 짧은 단어에는 그대로 독이 된다. 두 가지를 더 건다. */
  const OCR_PREFIX_MIN = 4;    // 접두 일치는 4글자 이상일 때만
  const OCR_MAX_HITS = 3;      // 후보가 이보다 많으면 '좁혀지지 않음'으로 본다

  /* 한 줄을 장소 사전에 조회한다.
     ★ 정확·접두 일치만 쓴다. 부분포함을 허용하면 "커피"가 전국 33,888곳에 걸린다(§10.30).
     ★ 지역 제약이 잡음의 대부분을 걸러낸다 — 그래서 지역이 먼저다. */
  function ocrLookup(line, code) {
    // ★ 그 지역 사전이 기기에 있으면 여기서 끝난다 — 서버로 안 간다.
    if (DICT.code === code) {
      const hits = dictLookup(line).map((r) => ({ n: r.n, cat: r.c, lng: r.lng, lat: r.lat, d: 0 }));
      return { inRegion: hits, nationwide: hits, onDevice: true };
    }
    const c = regionCenter(code);
    const inRegion = [], nationwide = [];
    for (const r of PL.rows) {
      const n = r[0];
      const exact = n === line;
      const pre = line.length >= OCR_PREFIX_MIN && n.startsWith(line);
      if (!exact && !pre) continue;
      const d = c ? distM(c, { lat: r[3], lng: r[2] }) : 0;
      const hit = { n, cat: r[1], lng: r[2], lat: r[3], d };
      nationwide.push(hit);
      if (!c || d <= OCR_REGION_M) inRegion.push(hit);
    }
    inRegion.sort((a, b) => a.d - b.d);
    return { inRegion, nationwide, onDevice: false };
  }

  /* OCR 출력 흉내 — 글자와 **크기**를 같이 준다.
     간판은 크고 높이 있고, 메뉴는 작다. 그래서 크기가 곧 우선순위다(§10.30 규칙 4). */
  const OCR_NOISE = [
    ["아메리카노", 0.30], ["카페라떼", 0.27], ["커피", 0.33], ["테이크아웃", 0.24],
    ["영업시간 10:00-22:00", 0.21], ["주차 가능", 0.19], ["감사합니다", 0.17],
    ["포장 됩니다", 0.18], ["현금영수증", 0.16],
  ];
  function fakeOcr(stop) {
    const code = stopRegion(stop);
    const c = regionCenter(code);
    // 그 지역의 실제 상호 하나를 "간판"으로 삼는다. 데모 POI 이름(영문)을 쓰면
    // 사전에 없어서 조회가 무조건 실패하고, 화면이 거짓말을 하게 된다.
    let sign = null;
    let h0 = 0; for (const ch of stop.id) h0 = (h0 * 31 + ch.charCodeAt(0)) >>> 0;
    if (DICT.code === code && DICT.rows.length) {
      sign = DICT.rows[h0 % DICT.rows.length].n;          // 기기 사전에서
    } else if (c && PL.rows.length) {
      const pool = PL.rows.filter((r) => distM(c, { lat: r[3], lng: r[2] }) < 2500);
      if (pool.length) sign = pool[h0 % pool.length][0];
    }
    const lines = [];
    if (sign) lines.push({ t: sign, size: 1.0 });
    let h = 0; for (const ch of stop.id) h = (h * 17 + ch.charCodeAt(0)) >>> 0;
    for (let k = 0; k < 4; k++) {
      const [t, size] = OCR_NOISE[(h + k * 3) % OCR_NOISE.length];
      if (!lines.some((l) => l.t === t)) lines.push({ t, size });
    }
    return lines.sort((a, b) => b.size - a.size);
  }

  async function screenOcr(stop, trip) {
    await loadRegions().catch(() => {});
    await loadDictIndex();
    const code = stopRegion(stop);
    const rn = regionFull(code);

    /* ★ 사전부터 받는다. 조회할 데가 없으면 화면이 거짓말을 한다 —
       "맞는 게 없다"와 "맞춰 볼 데가 없다"는 전혀 다른 말이다. */
    let dictErr = null;
    if (DICT.code !== code) {
      open(`
        <div class="upHead"><span class="upBack">‹</span><b>사진 속 간판에서 찾기</b><span class="upX">✕</span></div>
        <div class="upNote"><b>${esc(rn)} 장소 사전을 내려받는 중…</b><br>
          한 번 받아 두면 이후 조회는 <b>기기에서</b> 끝납니다 — 서버로 글자를 보내지 않습니다.</div>`);
      try { await loadRegionDict(code); } catch (e) { dictErr = e; }
    }

    const lines = fakeOcr(stop);
    const judged = lines.map((l) => {
      const { inRegion, nationwide } = ocrLookup(l.t, code);
      let verdict, why;
      if (inRegion.length > OCR_MAX_HITS) {
        // 후보가 너무 많으면 고르게 해도 사용자가 못 고른다. 걸러내고 이유를 말한다.
        verdict = "broad"; why = `${esc(rn)}에 ${inRegion.length}곳 — 이 글자로는 좁혀지지 않음`;
      } else if (inRegion.length) {
        verdict = "hit"; why = `${esc(rn)}에 ${inRegion.length}곳`;
      } else if (nationwide.length) {
        verdict = "out"; why = `이 지역에 없음 — 다른 지역 ${nationwide.length}곳`;
      } else { verdict = "none"; why = "장소 이름이 아님"; }
      return { ...l, verdict, why, inRegion };
    });
    const hits = judged.filter((j) => j.verdict === "hit");
    /* ★ 사전에 그 지역이 없으면 "안 맞는 것"과 "볼 데가 없는 것"이 구분되지 않는다.
       실제 앱은 전국 사전을 갖지만, 이 프로토타입의 places-real.json은
       해운대·제주·종로만 담고 있다. 그 차이를 숨기면 화면이 거짓말을 한다. */
    const onDevice = DICT.code === code;
    const c0 = regionCenter(code);
    const covered = onDevice
      || !!(c0 && PL.rows.some((r) => distM(c0, { lat: r[3], lng: r[2] }) < OCR_REGION_M));
    const kb = (n) => (n / 1024).toFixed(0);

    const o = open(`
      <div class="upHead"><span class="upBack">‹</span><b>사진 속 간판에서 찾기</b><span class="upX">✕</span></div>
      <div class="upNote">
        사진에서 읽은 글자를 <b>${esc(rn)}</b>의 장소 사전에 맞춰 봅니다.
        <b>지역이 먼저입니다</b> — 지역 없이 이름만으로 찾으면 메뉴판 글자가 상호명에 걸립니다.
      </div>
      ${onDevice ? `<div class="ocrDict">
        <b>📶 기기에서 조회 · 서버 0회</b>
        <small>${esc(rn)} <code>${esc(code || "")}</code> 사전 ${DICT.rows.length.toLocaleString()}곳 · ${kb(DICT.bytes)}KB ·
          ${DICT.ms}ms에 받음. 읽은 글자는 <b>기기를 떠나지 않습니다.</b>
          전국 사전은 51MB라 못 내리지만, 여행은 지역이 한두 개입니다.</small>
      </div>` : `<div class="ocrDict off">
        <b>이 지역 사전이 기기에 없습니다</b>
        <small>${dictErr ? esc(String(dictErr.message)) : "내려받지 못했습니다"} —
          데모에 준비된 사전: ${DICTS.map((d) => esc(d.full)).join(" · ") || "없음"}.</small>
      </div>`}
      <div class="ocrList">
        ${judged.map((j) => `
          <div class="ocrLine ${j.verdict}">
            <span class="ocrT" style="font-size:${(11 + j.size * 7).toFixed(1)}px">${esc(j.t)}</span>
            <span class="ocrWhy">${j.why}</span>
            ${j.verdict === "hit"
              ? `<button class="ocrGo" data-ocr="${esc(j.inRegion[0].n)}">이 장소로 ›</button>`
              : `<span class="ocrX">걸러짐</span>`}
          </div>`).join("")}
      </div>
      ${covered ? "" : `<div class="ocrFoot" style="border-style:solid">
        <b style="color:var(--warn,#c98a6e)">이 프로토타입에는 ${esc(rn)}의 장소 사전이 없습니다.</b><br>
        places-real.json은 해운대구·제주시·종로구만 담고 있습니다 —
        맞는 게 없는 것이 아니라 <b>맞춰 볼 데가 없는</b> 것입니다.</div>`}
      <div class="ocrFoot">
        <b>글자가 큰 것부터 봅니다.</b> 간판은 크고 높이 있고, 메뉴는 작습니다.<br>
        ${!covered ? "실제 앱은 전국 1,635,152곳을 봅니다."
          : hits.length
          ? `간판에서 찾은 위치는 <b>검증되지 않습니다</b> — 내 기록에는 저장되고
             <b>모두의 지도에는 올라가지 않습니다</b> (§009).`
          : `읽은 글자 중 이 지역의 장소와 맞는 것이 없습니다. 이름으로 직접 찾아 보세요.`}
      </div>`);

    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return void screenPick(stop);
      const b = e.target.closest("[data-ocr]");
      if (!b) return;
      UP.placeOf[stop.id] = { name: b.dataset.ocr, source: "ocr" };
      screenTripDetail(trip || UP.trip);
    });
  }

  /* ── 신고 (§10.43) ────────────────────────────────────────────
     `reports` 테이블은 이미 있다(target_type enum에 'pin','place').
     없는 것은 **사용자가 신고를 넣는 경로**였다.

     ★ 사유를 정해진 항목에서 고르게 한다. 자유 서술만 받으면
       분류가 안 되고 처리 우선순위를 못 매긴다 — 사유마다 다음 행동이 다르다
       (위치 이상 → geom_offset_m 확인 / 폐업 → 확인 후 숨김 / 중복 → 병합).
     ★ 자세히는 **선택**이다. 필수로 하면 신고를 안 한다.
     ★ "바로 지워지지 않는다"를 **보내기 전에** 말한다. §8.5의 상업화 방어와 같은 이유 —
       신고가 경쟁 업소를 내리는 무기가 되면 안 된다.
     ★ 같은 대상을 여러 번 신고해도 1건이다. */
  const REPORT_REASONS = {
    place: [
      ["wrong_geo",   "위치가 다릅니다",        "지도에 엉뚱한 곳으로 표시됩니다"],
      ["closed",      "없어진 곳입니다",        "폐업했거나 사라졌습니다"],
      ["wrong_name",  "이름이 다릅니다",        "상호가 바뀌었거나 잘못됐습니다"],
      ["duplicate",   "같은 곳이 중복입니다",   "이미 같은 장소가 따로 있습니다"],
      ["etc",         "그 밖의 문제",           ""],
    ],
    pin: [
      ["not_here",    "이 장소가 아닙니다",     "다른 곳에서 찍은 사진으로 보입니다"],
      ["privacy",     "개인정보가 보입니다",    "얼굴·차번호·문서 등"],
      ["inappropriate", "부적절한 사진",        ""],
      ["etc",         "그 밖의 문제",           ""],
    ],
  };

  /* 앱이 이미 알고 있는 문제. 실제로는 places.geom_offset_m(018)이 답한다 —
     주소 시군구에서 1km 넘게 벗어난 장소는 이미 후보에서 빠져 있다(019).
     ★ 이미 아는 문제를 다시 신고받으면 사용자 시간만 쓴다. */
  const KNOWN_BAD_GEO = new Set(["진교장 (3, 8일)", "옥종장 (3, 8일)", "카페코인 2호"]);

  function reportKey(t) { return t.type + ":" + (t.id || t.label); }

  function screenReport(target, back) {
    const kinds = REPORT_REASONS[target.type] || REPORT_REASONS.place;
    const already = UP.reports.find((r) => reportKey(r.target) === reportKey(target));
    const known = target.type === "place" && KNOWN_BAD_GEO.has(target.label);

    const o = open(`
      <div class="upHead"><span class="upBack">‹</span><b>신고하기</b><span class="upX">✕</span></div>
      <div class="upNote"><b>${esc(target.label)}</b>
        <br>${target.type === "place" ? "장소 정보" : "올라온 사진"}에 문제가 있나요?</div>
      ${already ? `<div class="rpDone">이미 신고하셨습니다 — <b>${esc(already.reasonLabel)}</b>
        <small>같은 대상은 한 번만 접수됩니다. 확인 중입니다.</small></div>` : `
      ${known ? `<div class="rpKnown">이 장소의 <b>위치 문제는 이미 확인됐습니다.</b>
        <small>후보 목록에서 빼 두었고 수정 중입니다. 다른 문제라면 아래에서 골라 주세요.</small></div>` : ""}
      <div class="rpList">
        ${kinds.map(([k, t, d]) => `
          <button class="rpRow" data-reason="${k}" data-label="${esc(t)}">
            <b>${esc(t)}</b>${d ? `<small>${esc(d)}</small>` : ""}</button>`).join("")}
      </div>
      <textarea id="rpNote" class="upInput" rows="2"
        placeholder="자세히 알려주시면 더 빨리 고칩니다 (선택)"></textarea>
      <div class="rpFoot">신고하면 <b>바로 지워지지 않습니다.</b>
        확인한 뒤에 고치거나 내립니다 — 신고가 누군가를 내리는 수단이 되지 않도록.</div>`}`);

    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return back();
      const b = e.target.closest("[data-reason]");
      if (!b) return;
      const note = (o.querySelector("#rpNote") || {}).value || "";
      UP.reports.push({ target, reason: b.dataset.reason, reasonLabel: b.dataset.label,
                        note: note.trim(), at: Date.now() });
      screenReportDone(target, b.dataset.label, note.trim(), back);
    });
  }

  function screenReportDone(target, label, note, back) {
    const o = open(`
      <div class="upHead"><b>접수했습니다</b><span class="upX">✕</span></div>
      <div class="doneBox">
        <div class="doneTitle">${esc(target.label)}</div>
        <div class="doneSub">${esc(label)}${note ? " · 메모 있음" : ""}</div>
      </div>
      <div class="upNote">확인 후 처리합니다. <b>바로 지워지지 않습니다.</b>
        <br>같은 대상을 다시 신고해도 1건으로 봅니다.</div>
      <div class="rpWrote"><b>기록되는 값</b>
        <small>reports.target_type = <code>${target.type}</code>
          · reason = <code>${esc(label)}</code>
          · status = <code>open</code></small></div>
      <button class="upCta" id="rpBack">돌아가기</button>`);
    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest("#rpBack")) return back();
    });
  }

  /* ── 운영자 신고함 (§10.45) ────────────────────────────────
     실제로는 api_report_queue()가 준다(020). 여기서는 그 모양을 그대로 흉내낸다.

     ★ 이 화면이 지키려는 것: **판단에 필요한 것을 다시 찾게 하지 않는다.**
       "위치가 다릅니다"가 들어왔을 때 geom_offset_m이 옆에 없으면
       운영자는 지도를 열고 주소를 찾아봐야 한다. 그러면 처리가 밀린다.
     ★ 같은 대상·같은 사유는 **묶는다.** 10명이 신고한 것과 1명이 신고한 것은 다르다.
     ★ **반려도 일급 동작이다.** 신고가 무기가 되지 않으려면 반려가 쉬워야 한다 —
       처리만 쉽고 반려가 어려우면 운영자는 일단 내리게 된다.
     ★ 진입은 `#ops`다. 실제 권한은 서버(is_operator)가 정한다 —
       화면을 숨기는 것은 권한이 아니다. */
  const OPS_SEED = [
    { target_type: "place", label: "진교장 (3, 8일)", reason: "wrong_geo",
      reasonLabel: "위치가 다릅니다", reporters: 3, days: 4,
      address: "경상남도 하동군 진교면 진교리", geom_offset_m: 254517,
      region: "경상남도 하동군", hidden: true, dup: 0 },
    { target_type: "place", label: "옛골토성", reason: "closed",
      reasonLabel: "없어진 곳입니다", reporters: 1, days: 1,
      address: "서울특별시 서초구 원지동", geom_offset_m: 0,
      region: "서울특별시 서초구", hidden: false, dup: 0 },
    { target_type: "place", label: "스타벅스 해운대점", reason: "duplicate",
      reasonLabel: "같은 곳이 중복입니다", reporters: 2, days: 9,
      address: "부산광역시 해운대구 구남로", geom_offset_m: 0,
      region: "부산광역시 해운대구", hidden: false, dup: 2 },
    { target_type: "pin", label: "사진 1장", reason: "privacy",
      reasonLabel: "개인정보가 보입니다", reporters: 1, days: 0,
      address: null, geom_offset_m: null, region: null, hidden: false, dup: 0 },
  ];
  let OPS = null;
  /* 운영자 명단 — 실제로는 api_operator_list()/api_operator_log()가 준다(021·022) */
  let OPS_PEOPLE = null, OPS_LOG = null;
  function opsPeople() {
    if (!OPS_PEOPLE) {
      OPS_PEOPLE = [
        { handle: "minji", nickname: "민지", note: "첫 운영자(손으로)", by: null, self: true },
        { handle: "sujin", nickname: "수진", note: "신고 처리", by: "minji", self: false },
      ];
      OPS_LOG = [{ action: "grant", actor: "minji", target: "sujin", note: "신고 처리" }];
    }
    return OPS_PEOPLE;
  }

  function opsQueue() {
    if (!OPS) {
      OPS = OPS_SEED.map((x, i) => ({ ...x, id: "q" + i, status: "open", note: "" }));
      // 이 세션에서 사용자가 보낸 신고도 같이 올린다
      UP.reports.forEach((r, i) => OPS.push({
        id: "u" + i, target_type: r.target.type, label: r.target.label,
        reason: r.reason, reasonLabel: r.reasonLabel, reporters: 1, days: 0,
        address: null, geom_offset_m: null, region: null,
        hidden: KNOWN_BAD_GEO.has(r.target.label), dup: 0, status: "open", note: r.note }));
    }
    return OPS;
  }

  function opsEvidence(q) {
    if (q.target_type !== "place") return "";
    const bits = [];
    if (q.address) bits.push(`<i>주소</i> ${esc(q.address)}`);
    if (q.geom_offset_m != null) {
      const km = q.geom_offset_m / 1000;
      bits.push(q.geom_offset_m > 1000
        ? `<i>좌표</i> <b class="opsBad">주소 지역에서 ${km.toFixed(0)}km 밖</b>`
        : `<i>좌표</i> 주소 지역 안 (어긋남 ${Math.round(q.geom_offset_m)}m)`);
    }
    if (q.dup) bits.push(`<i>중복</i> <b>반경 200m에 같은 이름 ${q.dup}곳</b>`);
    if (q.hidden) bits.push(`<i>조치</i> 이미 후보 목록에서 제외됨 (019)`);
    return `<div class="opsEv">${bits.join("<br>")}</div>`;
  }

  /* 일어난 일을 줄로 보여준다 (실제로는 api_report_history가 준다 · 023) */
  const ACT_KO = { resolve: "처리함", reject: "반려", reopen: "다시 엶", note: "메모" };
  function opsHistory(x) {
    if (!x.actions || !x.actions.length) return "";
    return `<div class="opsHist">${x.actions.slice().reverse().map((a) =>
      `<small><em>${ACT_KO[a.action] || a.action}</em> @${esc(a.actor)}${a.note ? " · " + esc(a.note) : ""}</small>`
    ).join("")}</div>`;
  }

  function screenOps() {
    const q = opsQueue().filter((x) => x.status === "open");
    const done = opsQueue().filter((x) => x.status !== "open");
    const o = open(`
      <div class="upHead"><b>신고함 · 열림 ${q.length}건</b><span class="upX">✕</span></div>
      <div class="upNote">같은 대상·같은 사유는 <b>묶어서</b> 보여줍니다.
        판단에 필요한 값은 <b>같이 실려 옵니다</b> — 다시 찾지 않도록.
        <br>실제 권한은 서버가 정합니다 (<code>is_operator()</code>) — 화면을 숨기는 건 권한이 아닙니다.</div>
      ${q.length ? q.map((x) => `
        <div class="opsCard" data-q="${x.id}">
          <div class="opsTop">
            <b>${esc(x.label)}</b>
            <span class="opsTag ${x.target_type}">${x.target_type === "place" ? "장소" : "사진"}</span>
            <small>신고 ${x.reporters}명 · ${x.days === 0 ? "오늘" : x.days + "일 전"}</small>
          </div>
          <div class="opsReason">${esc(x.reasonLabel)}</div>
          ${opsEvidence(x)}
          ${x.note ? `<div class="opsNote">“${esc(x.note)}”</div>` : ""}
          ${opsHistory(x)}
          <div class="opsAct">
            <button class="opsBtn ok" data-do="resolved" data-q="${x.id}">처리함</button>
            <button class="opsBtn no" data-do="rejected" data-q="${x.id}">반려</button>
          </div>
        </div>`).join("") : `<div class="upNote">열린 신고가 없습니다 🎉</div>`}
      ${done.length ? `<div class="opsClosed"><b>닫은 것 ${done.length}건</b>
        ${done.map((x) => `
          <div class="opsCard closed">
            <div class="opsTop"><b>${esc(x.label)}</b>
              <span class="opsTag ${x.status === "resolved" ? "ok" : "no"}">${x.status === "resolved" ? "처리함" : "반려"}</span>
              <small>${esc(x.reasonLabel)}</small></div>
            ${opsHistory(x)}
            <div class="opsAct">
              <input id="why-${x.id}" class="upInput" style="margin:0;flex:1"
                     placeholder="되돌리는 이유 (필수)">
              <button class="opsBtn no" data-reopen="${x.id}">되돌리기</button>
            </div>
          </div>`).join("")}
        <small class="opsLogWhy">반려를 쉽게 만든 이상 <b>잘못 반려하는 일도 쉬워집니다.</b>
          되돌릴 길이 없으면 운영자는 반려를 망설이고, 그러면 다시 “일단 내리기”로 돌아갑니다.</small>
        </div>` : ""}

      <div class="opsPeople">
        <div class="opsPeopleHead">운영자 ${opsPeople().length}명
          <small>추가·해제는 <code>api_operator_grant / revoke</code>가 합니다.
            첫 운영자만 DB에 직접 넣습니다 — 부트스트랩을 함수로 열면
            <b>아무도 운영자가 아닐 때 누구나 운영자가 됩니다.</b></small></div>
        ${opsPeople().map((u) => `
          <div class="opsPerson">
            <b>@${esc(u.handle)}</b><span>${esc(u.nickname)}</span>
            <small>${esc(u.note || "")}${u.by ? ` · @${esc(u.by)}가 추가` : ""}</small>
            <button class="opsBtn no" data-revoke="${esc(u.handle)}"
              ${opsPeople().length <= 1 ? "disabled title='마지막 운영자는 해제할 수 없습니다'" : ""}>해제</button>
          </div>`).join("")}
        <div class="opsAddRow">
          <input id="opsAdd" class="upInput" style="margin:0" placeholder="핸들로 추가 — 예: jiwon">
          <button class="opsBtn ok" id="opsGrant">추가</button>
        </div>
        ${OPS_LOG && OPS_LOG.length ? `<div class="opsLog"><b>기록</b>
          ${OPS_LOG.slice(-4).map((l) => `<small>@${esc(l.actor)} → @${esc(l.target)}
            <em>${l.action === "grant" ? "추가" : "해제"}</em>${l.note ? " · " + esc(l.note) : ""}</small>`).join("")}
          <small class="opsLogWhy">해제해도 이 기록은 남습니다 — 되돌릴 근거가 됩니다.</small></div>` : ""}
      </div>`);

    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      const rv = e.target.closest("[data-revoke]");
      if (rv) {
        // 실제로는 api_operator_revoke(user_id) — 마지막 한 명은 서버가 막는다
        if (OPS_PEOPLE.length <= 1) return;
        const h = rv.dataset.revoke;
        OPS_LOG.push({ action: "revoke", actor: "minji", target: h, note: "" });
        OPS_PEOPLE = OPS_PEOPLE.filter((u) => u.handle !== h);
        return screenOps();
      }
      if (e.target.closest("#opsGrant")) {
        const h = (o.querySelector("#opsAdd").value || "").trim().replace(/^@/, "");
        if (!h) return;
        if (!OPS_PEOPLE.some((u) => u.handle === h)) {   // 여러 번 눌러도 한 번
          OPS_PEOPLE.push({ handle: h, nickname: h, note: "", by: "minji", self: false });
          OPS_LOG.push({ action: "grant", actor: "minji", target: h, note: "" });
        }
        return screenOps();
      }
      // 되돌리기 — ★ 이유 없이는 안 된다 (서버 api_report_reopen도 같은 규칙)
      const ro = e.target.closest("[data-reopen]");
      if (ro) {
        const box = o.querySelector(`#why-${ro.dataset.reopen}`);
        const why = (box && box.value || "").trim();
        if (!why) { if (box) { box.classList.add("opsNeed"); box.focus(); } return; }
        const row = opsQueue().find((x) => x.id === ro.dataset.reopen);
        if (row) {
          row.status = "open";
          (row.actions ||= []).push({ action: "reopen", actor: "minji", note: why });
        }
        return screenOps();
      }
      const b = e.target.closest("[data-do]");
      if (!b) return;
      const row = opsQueue().find((x) => x.id === b.dataset.q);
      if (row) {
        row.status = b.dataset.do;            // 실제로는 api_report_resolve(ids, status)
        (row.actions ||= []).push({
          action: b.dataset.do === "resolved" ? "resolve" : "reject", actor: "minji", note: "" });
      }
      screenOps();
    });
  }
  window.screenOps = screenOps;

  /* ── 사진 뷰어 (§12.2) ────────────────────────────────────────
     ★ 이것은 **탭이 아니라 모달**이다. 항상 "무엇에 대한 것"이라
       탭바에서 누르면 *"무슨 사진?"*에 답할 수 없다. 지도·피드·프로필이 전부 이걸 연다.

     ★ 세로 스크롤은 **그 장소에서 멈춘다.** 다른 장소로 자동 전환하면
       사용자가 "여기가 어디지"를 잃는다. 끝에서 다음 장소를 **제안**만 한다.

     ★ 인스타와 다른 것 둘:
       ① **연도별 보기** — 같은 자리의 10년. taken_at + place_id면 된다.
       ② **인증 뱃지** — 현장(live)/EXIF(§009). "12명이 현장에서 찍었다"는 별점보다 강하다. */
  const VERIF = { live: ["현장", "그 자리에서 찍고 바로 올렸습니다"],
                  exif: ["EXIF", "사진에 남은 좌표로 확인했습니다"],
                  manual: ["직접 지정", "위치를 사람이 골랐습니다 — 확인되지 않았습니다"] };

  /* 그 장소의 기록들 = **내 것 + 남의 공개 기록**.
     실제로는 api_place_media(place, orientation, limit, offset)가 준다(§013). */
  function viewerItems(placeName) {
    const mine = UP.album.filter((x) => x.poi && x.poi.properties.n === placeName && x.gps);
    const theirs = PUBLIC_ALBUM.filter((x) => x.poi && x.poi.properties.n === placeName);
    return mine.concat(theirs).sort((a, b) => b.ts - a.ts);
  }

  function viewerCard(x, i, n) {
    const d = new Date(x.ts);
    const v = VERIF[x.verification || (x.gps ? "exif" : "manual")];
    const ex = excludeReason(x);
    return `
      <section class="vwPane" data-i="${i}">
        <div class="vwImg"><img src="${PHOTOS[x.img]}" alt=""
          style="object-fit:${(x.h || 0) > (x.w || 0) ? "cover" : "contain"}"></div>
        <div class="vwMeta">
          <div class="vwWho"><b>@${esc(x.who || "minji")}</b>
            <time>${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}</time>
            <span class="vwBadge ${x.verification || "exif"}" title="${esc(v[1])}">${v[0]}</span>
          </div>
          ${x.memo ? `<p class="vwMemo">${esc(x.memo)}</p>` : ""}
          ${ex ? `<p class="vwWarn">${esc(REASON[ex].k)} — 모두의 지도에는 올라가지 않습니다</p>` : ""}
          ${commentBlock(x)}
          <div class="vwNav">${i + 1} / ${n}</div>
        </div>
      </section>`;
  }

  /* 댓글 칸 — 스페이스 기록에만 붙는다. 공개 기록에는 **왜 없는지**를 적는다.
     아무 말 없이 빠져 있으면 고장 난 것처럼 보인다. */
  function commentBlock(x) {
    const sp = spaceOf(x);
    const id = String(x.id);
    if (!sp) {
      /* ★ "공개 기록에는 댓글이 없습니다" 라고 적었다가 고쳤다 —
         이 자리에는 **내 나만 보기 기록**도 온다. 그걸 '공개'라고 부르면 거짓말이다.
         기준은 공개 여부가 아니라 **스페이스에 올렸는가**다. */
      return `<p class="vwNoC">스페이스에 올린 기록에만 댓글이 붙습니다
        <small>아는 사람끼리 있는 방에서만 이야기합니다</small></p>`;
    }
    const list = UP.comments[id] || [];
    return `
      <div class="vwC" data-c="${esc(id)}">
        <div class="vwCHead">${esc(SPACE_NAME[sp])} 안에서만 보입니다
          ${list.length ? `<em>${list.length}</em>` : ""}</div>
        ${list.map((c) => `<div class="vwCRow"><b>@${esc(c.who)}</b><span>${esc(c.text)}</span></div>`).join("")}
        <div class="vwCNew">
          <input class="vwCIn" data-cin="${esc(id)}" maxlength="80" placeholder="한 줄 남기기">
          <button class="vwCGo" data-cgo="${esc(id)}">올리기</button>
        </div>
      </div>`;
  }

  function screenViewer(placeName, opts) {
    const all = viewerItems(placeName);
    const byYear = {};
    all.forEach((x) => { (byYear[new Date(x.ts).getFullYear()] ||= []).push(x); });
    const years = Object.keys(byYear).sort((a, b) => b - a);
    const year = (opts && opts.year) || null;
    const items = year ? byYear[year] : all;

    const o = open(`
      <div class="upHead"><span class="upBack">‹</span><b>${esc(placeName)}</b><span class="upX">✕</span></div>
      <div class="vwYears">
        <button class="vwYear${year ? "" : " on"}" data-year="">전체 ${all.length}</button>
        ${years.map((y) => `<button class="vwYear${String(year) === y ? " on" : ""}" data-year="${y}">${y} · ${byYear[y].length}</button>`).join("")}
      </div>
      <div class="vwScroll" id="vwScroll">
        ${items.length ? items.map((x, i) => viewerCard(x, i, items.length)).join("")
          : `<div class="upNote">이 장소에 올라온 기록이 없습니다.</div>`}
        <section class="vwEnd">
          <b>${esc(placeName)}의 기록을 다 보셨습니다</b>
          <small>여기서 멈춥니다 — 다른 장소로 넘어가면 지금 보던 곳이 어디였는지 잃습니다.</small>
          <button class="vwNext" id="vwNext">같은 지역 다른 장소 보기</button>
        </section>
      </div>`);

    /* 댓글 한 줄을 올린다. ★ 화면 전체를 다시 그리지 않는다 —
       다시 그리면 스크롤이 맨 위로 튀어서, 열 장짜리 뷰어에서 쓴 자리를 잃는다. */
    async function postComment(id) {
      const inp = o.querySelector(`[data-cin="${CSS.escape(id)}"]`);
      const text = (inp.value || "").trim();
      if (!text) { inp.focus(); return; }
      (UP.comments[id] ||= []).push({ who: "minji", text, ts: Date.now() });
      const box = o.querySelector(`[data-c="${CSS.escape(id)}"]`);
      const row = document.createElement("div");
      row.className = "vwCRow";
      row.innerHTML = `<b>@minji</b><span>${esc(text)}</span>`;
      box.insertBefore(row, box.querySelector(".vwCNew"));
      const n = UP.comments[id].length;
      let em = box.querySelector(".vwCHead em");
      if (!em) { em = document.createElement("em"); box.querySelector(".vwCHead").appendChild(em); }
      em.textContent = n;
      inp.value = "";

      /* ★ 서버로도 보낸다. **화면은 먼저 그린다** — 네트워크를 기다리게 하면
         한 줄 쓰는 일이 느려지고, 그러면 아무도 안 쓴다.
         실패하면 줄에 표시해 준다. 조용히 사라지는 것이 가장 나쁘다. */
      if (window.API && API.on && API.session.access_token) {
        const rec = viewerItems(placeName).find((x) => String(x.id) === String(id));
        const sp = rec && spaceOf(rec);
        if (rec && sp) {
          const r = await API.addComment(rec, sp, SPACE_NAME[sp] || sp, text);
          if (!r.ok) {
            row.classList.add("vwCFail");
            row.insertAdjacentHTML("beforeend",
              `<i title="${esc(r.why || "")}">보내지 못함</i>`);
          } else {
            row.dataset.sid = r.id;
          }
        }
      }
    }

    o.querySelector("#upSheet").addEventListener("keydown", (e) => {
      const i = e.target.closest("[data-cin]");
      if (i && e.key === "Enter") { e.preventDefault(); postComment(i.dataset.cin); }
    });

    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return (opts && opts.back) ? opts.back() : close();
      const g = e.target.closest("[data-cgo]");
      if (g) return postComment(g.dataset.cgo);
      const y = e.target.closest("[data-year]");
      if (y) return screenViewer(placeName, { ...opts, year: y.dataset.year || null });
      if (e.target.closest("#vwNext")) return (opts && opts.next) ? opts.next() : close();
    });
    return o;
  }
  /* ★ 누가 어느 스페이스 사람인지는 **한 곳에만** 적는다.
     home.js 가 따로 들고 있으면 둘이 갈라진다. */
  const WHO_SPACE = { jiwon: "sp1", sujin: "sp1", taeho: "sp2" };
  const SPACE_NAME = { sp1: "대학 동기들", sp2: "가족" };
  const MY_SPACES = ["sp1", "sp2"];          // 내가 속한 스페이스
  window.WHO_SPACE = WHO_SPACE;
  window.SPACE_NAME = SPACE_NAME;

  /* 이 기록이 내 스페이스의 것인가.
     남의 기록이면 작성자의 스페이스, 내 기록이면 그 장소가 묶인 스페이스를 본다. */
  window.spaceOf = function (x) {
    if (x.who && x.who !== "minji") {
      const sp = WHO_SPACE[x.who];
      return sp && MY_SPACES.includes(sp) ? sp : null;
    }
    /* ★ 내 기록의 스페이스 소속은 **장소가 아니라 여행**이 정한다.
       `x.poi.properties.sp`(장소 단위)로 봤더니 한 장소의 기록이 전부 같은 값이라
       "전부 공유" 아니면 "전부 비공유"가 됐다 — 댓글이 모든 기록에 붙어 버렸다.
       실제 스키마도 `trip_spaces`(여행 단위)·`pin_spaces`(기록 단위)다. */
    const t = (UP.trips || []).find((tr) => tr.items.some((it) => it.id === x.id));
    const sp = t && UP.tripSpace[t.id];
    return sp && MY_SPACES.includes(sp) ? sp : null;
  };

  window.screenViewer = screenViewer;
  // 탭3 소식이 남의 공개 기록을 읽는다. 배열 자체를 넘기면 밖에서 밀어 넣을 수 있으니 복사본만 준다.
  window.PUBLIC_ALBUM_VIEW = () => PUBLIC_ALBUM.slice();
  // 소식·피드에서 "지도에서 보기"로 날아간다 (§12.14 — 탭은 서로 이어져야 한다)
  window.flyToPlace = (name) => {
    const f = poi.features.find((x) => x.properties.n === name);
    if (f && window.map) map.flyTo({ center: f.geometry.coordinates, zoom: 14 });
    return !!f;
  };

  /* ★ 후보 랭킹 공식이 **두 벌**이다 — 여기(2.5/3.0/0.6/2.0/0.3)와 007의 SQL.
     지금은 값이 같지만 한쪽만 고치는 날 프로토타입과 앱이 다른 순서를 보여준다.
     그때 어느 쪽이 맞는지 알 방법이 없다.
     → 서버가 살아 있으면 **서버 것을 쓴다.** 로컬 공식은 폴백으로만 남긴다.
       속도(46만 곳 GiST)보다 이게 더 중요한 이유다. */
  async function candidatesRemote(stop) {
    if (!(window.API && API.on)) return null;
    const guess = stop.items[0].poi && stop.items[0].poi.properties.c;
    const r = await API.candidates(stop.c.lat, stop.c.lng,
                                   stop.worstAcc || 15, guess, 0.7, 10);
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) return null;
    return {
      rad: candRadius(stop.worstAcc || 15),
      total: r.data.length,
      via: "server",
      list: r.data.map((x) => ({ n: x.name, cat: x.category, d: x.dist_m,
                                 ground: true, score: x.score, addr: x.address })),
    };
  }

  async function screenPick(stop) {
    const { rad, total, list, via } = (await candidatesRemote(stop)) || candidatesFor(stop);
    const noGps = !stop.items.some((x) => x.gps);
    const row = (x, i) => {
      const cat = CAT[x.cat] || CAT.etc;
      return `<button class="ckRow${i === 0 ? " top" : ""}" data-pick="${esc(x.n)}">
        <span class="ckDot" style="background:${cat.c}"></span>
        <span class="ckMain"><b>${esc(x.n)}</b><small>${cat.k} · ${Math.round(x.d)}m${
          x.ground ? "" : " · 상층"}${x.addr ? " · " + esc(x.addr.split(" ").slice(1, 4).join(" ")) : ""}</small></span>
        ${UP.tripPicks[x.n] ? `<em class="ckAgain">이 여행에서 고름</em>` : ""}
      </button>`;
    };
    open(`
      <div class="upHead"><span class="upBack">‹</span><b>이 정거장의 장소</b><span class="upX">✕</span></div>
      <div class="upNote">
        사진 ${stop.items.length}장 · GPS 정확도 ±${Math.round(stop.worstAcc || 15)}m →
        반경 <b>${Math.round(rad)}m</b> 안에 <b>${total}곳</b> — 상위 ${Math.min(10, total)}개.
        <span class="ckVia${via === "server" ? " on" : ""}">${via === "server"
          ? "전국 46만 곳에서 서버가 골랐습니다" : "로컬 목록에서 골랐습니다 · 5만 곳뿐"}</span>
        ${noGps ? `<br><b style="color:var(--warn,#c98a6e)">EXIF 위치가 없어 후보를 못 찾습니다.</b>
          지도에서 직접 찍을 수 있지만 <b>모두의 지도에는 올라가지 않습니다.</b>` : ""}
      </div>
      <div class="ckList">
        ${list.length ? list.map(row).join("")
          : `<div class="ckEmpty">반경 안에 아는 장소가 없습니다.</div>`}
      </div>
      <button class="ocrEnter" id="ocrEnter">🔤 사진 속 간판에서 찾기
        <small>좌표가 없거나 후보에 없을 때 — 이름이 좌표를 대신합니다</small></button>
      <div class="ckMake">
        <input id="ckName" placeholder="여기 없으면 이름으로 찾기 — 예: 협재">
        <div id="ckHits"></div>
        <button id="ckAdd">"…"를 새 장소로 만들기</button>
        <small>가까운 곳부터 찾습니다. 지역 이름(제주도·부산 등)은 장소가 될 수 없습니다.</small>
      </div>`);

    // 타자마다 찾는다 — 좌표로 먼저 좁히므로 빠르다
    const nameIn = $("#ckName");
    const redrawHits = () => {
      const q = nameIn.value.trim();
      $("#ckAdd").textContent = q ? `"${q}"를 새 장소로 만들기` : "새 장소로 만들기";
      const hits = searchPlaces(stop, q);
      $("#ckHits").innerHTML = !q ? "" : (hits.length
        ? hits.map((h) => {
            const cat = CAT[h.cat] || CAT.etc;
            return `<button class="ckRow sm${h.attachable ? "" : " far"}"
                      ${h.attachable ? `data-pick="${esc(h.n)}"` : ""}>
              <span class="ckDot" style="background:${cat.c}"></span>
              <span class="ckMain"><b>${esc(h.n)}</b><small>${cat.k} ·
                ${h.d < 1000 ? Math.round(h.d) + "m" : (h.d / 1000).toFixed(1) + "km"}</small></span>
              ${h.attachable ? "" : `<em class="ckFar">너무 멀어요</em>`}
            </button>`; }).join("")
        : `<div class="ckNone">"${esc(q)}" 근처에 없습니다 — 아래에서 새로 만드세요</div>`);
    };
    nameIn.addEventListener("input", redrawHits);

    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenTripDetail(UP.trip);
      if (e.target.closest("#ocrEnter")) return screenOcr(stop, UP.trip);
      const b = e.target.closest("[data-pick]");
      if (b) {
        const n = b.dataset.pick;
        UP.tripPicks[n] = (UP.tripPicks[n] || 0) + 1;     // 여행 범위 학습
        UP.placeOf[stop.id] = { name: n, source: "db" };
        return screenTripDetail(UP.trip);
      }
      if (e.target.closest("#ckAdd")) {
        const v = ($("#ckName").value || "").trim();
        if (!v) return;
        // 지역명은 장소가 아니다 (§10.9 — "제주도" 버킷 방지)
        const REGIONS = new Set(feats.map((f) => f.properties.name));
        const SIDO = ["제주도","제주특별자치도","서울","서울특별시","부산","부산광역시","강원도","경기도"];
        if (REGIONS.has(v) || SIDO.includes(v)) {
          return alert(`"${v}"는 지역 이름입니다. 장소로 쓸 수 없습니다.\n` +
                       `사진이 찍힌 그 자리의 이름을 적어 주세요 — 모르면 "협재해변 그 바위"처럼 적어도 됩니다.`);
        }
        UP.placeOf[stop.id] = { name: v, source: "user" };
        return screenTripDetail(UP.trip);
      }
    });
  }

  /* ── 사진 옮기기 화면 ────────────────────────────────────────
     ★ 왜 전용 화면인가 — 등록 화면에서 사진을 탭하면 "공개 선택"이다.
       같은 제스처에 의미를 둘 씩 얹으면 둘 다 못 쓴다.

     ★ 왜 드래그**만**으로는 안 되는가 (이게 이 화면의 핵심 판단이다)
       사진 80장짜리 여행에서 3번 정거장의 사진을 11번으로 옮기려면
       드래그를 붙잡은 채 자동 스크롤을 기다려야 한다. 손가락으로는 최악이다.
       그래서 **두 가지를 같이** 둔다:
         · 드래그 — 눈에 보이는 이웃 정거장으로 (짧은 거리, 직관적)
         · 탭 선택 → "옮기기" → 목록에서 고르기 (먼 거리, 여러 장)
       한 화면에서 둘 다 되고, 탭과 드래그는 8px 이동으로 가른다. */
  /* focus: 방금 사진이 들어간 정거장.
     ★ 정거장은 시각순으로 다시 정렬된다. 9시 사진을 11시 정거장에 넣으면
       그 정거장의 시작 시각이 당겨져 **목록에서 위로 뛴다.**
       그러면 사용자 눈에는 "내가 끈 카드가 아니라 딴 카드가 움직인" 것으로 보인다.
       순서를 시각순으로 두는 건 맞으니, 대신 **어디로 갔는지 보여준다.** */
  function screenMove(trip, focus) {
    const sel = UP.moveSel;
    const body = UP.stops.map((st, i) => `
      <div class="mvStop${st.id === focus ? " just" : ""}" data-stop="${st.id}">
        <div class="mvHead">
          <b>정거장 ${i + 1}</b>
          <button class="mvRegion" data-region="${st.id}">${esc(regionShort(stopRegion(st)))} <em>바꾸기</em></button>
          <small>${fmtRange(st.start, st.end)} · ${st.items.length}장</small>
        </div>
        <div class="mvRow">
          ${st.items.map((x) => `
            <button class="mvPhoto${sel.has(x.id) ? " on" : ""}" data-id="${x.id}" data-stop="${st.id}">
              <img src="${PHOTOS[x.img]}" alt="" draggable="false">
              ${sel.has(x.id) ? "<i>✓</i>" : ""}
            </button>`).join("")}
        </div>
      </div>`).join("");

    const o = open(`
      <div class="upHead"><span class="upBack">‹</span><b>사진 옮기기</b><span class="upX">✕</span></div>
      <div class="upNote">사진을 <b>끌어서</b> 다른 정거장에 놓거나,
        <b>눌러서 고른 뒤</b> 아래에서 옮길 곳을 고르세요.
        정거장마다 지역을 따로 정할 수 있습니다 — 한 여행에 여러 지역이 섞일 수 있습니다.</div>
      <div class="mvList">${body}</div>
      <div class="mvBar${sel.size ? " on" : ""}">
        <span>${sel.size}장 선택</span>
        <button id="mvGo" ${sel.size ? "" : "disabled"}>옮길 곳 고르기 ›</button>
      </div>`);

    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenTripDetail(trip);
      const rg = e.target.closest("[data-region]");
      if (rg) return screenRegionPick(rg.dataset.region, trip);
      if (e.target.closest("#mvGo")) return screenMoveTarget(trip);
    });
    wireDrag(o.querySelector("#upSheet"), trip);
    if (focus) {
      const n = o.querySelector(`.mvStop[data-stop="${focus}"]`);
      if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" });
    }
  }

  /* 끌어서 옮기기 — 포인터 이벤트 하나로 마우스·손가락을 같이 받는다.
     8px 안에서 뗐으면 탭(선택), 넘어갔으면 드래그로 본다. */
  function wireDrag(root, trip) {
    let d = null;
    root.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest(".mvPhoto");
      if (!cell) return;
      d = { id: +cell.dataset.id, from: cell.dataset.stop, cell,
            x0: e.clientX, y0: e.clientY, moved: false, ghost: null, over: null };
      try { cell.setPointerCapture(e.pointerId); } catch (err) {}
    });
    root.addEventListener("pointermove", (e) => {
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return;
      if (!d.moved) {
        d.moved = true;
        d.ghost = d.cell.cloneNode(true);
        d.ghost.className = "mvGhost";
        document.body.appendChild(d.ghost);
        d.cell.classList.add("dragging");
      }
      d.ghost.style.left = (e.clientX - 27) + "px";
      d.ghost.style.top = (e.clientY - 27) + "px";
      d.ghost.style.display = "none";                 // 고스트 자신이 잡히지 않게
      const under = document.elementFromPoint(e.clientX, e.clientY);
      d.ghost.style.display = "";
      const tgt = under && under.closest(".mvStop");
      root.querySelectorAll(".mvStop.over").forEach((n) => n.classList.remove("over"));
      d.over = tgt && tgt.dataset.stop !== d.from ? tgt.dataset.stop : null;
      if (d.over) tgt.classList.add("over");
      e.preventDefault();
    });
    const end = () => {
      if (!d) return;
      const x = d; d = null;
      if (x.ghost) x.ghost.remove();
      x.cell.classList.remove("dragging");
      root.querySelectorAll(".mvStop.over").forEach((n) => n.classList.remove("over"));
      if (!x.moved) {                                  // 탭 = 선택 토글
        if (UP.moveSel.has(x.id)) UP.moveSel.delete(x.id); else UP.moveSel.add(x.id);
        return screenMove(trip);
      }
      const dest = x.over && applyMove([x.id], x.over);
      if (dest) screenMove(trip, dest);
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
  }

  /* 먼 거리 이동 — 목록에서 고른다. 드래그로는 닿지 않는 곳이 있다. */
  function screenMoveTarget(trip) {
    const ids = [...UP.moveSel];
    const o = open(`
      <div class="upHead"><span class="upBack">‹</span><b>${ids.length}장을 어디로</b><span class="upX">✕</span></div>
      <div class="tripList">
        ${UP.stops.map((st, i) => `
          <button class="tripRow" data-to="${st.id}">
            <img src="${PHOTOS[st.items[0].img]}" alt="">
            <div><b>정거장 ${i + 1} · ${esc(regionShort(stopRegion(st)))}</b>
              <small>${fmtRange(st.start, st.end)} · 사진 ${st.items.length}장</small></div><em>›</em>
          </button>`).join("")}
        <button class="tripRow" data-to="new">
          <div style="width:54px;height:54px;border-radius:11px;display:grid;place-items:center;
            border:1px dashed var(--surface-line);font-size:22px;flex:none">＋</div>
          <div><b>새 정거장으로 분리</b><small>여기 있던 사진들만 따로 묶습니다</small></div><em>›</em>
        </button>
      </div>`);
    o.querySelector("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenMove(trip);
      const b = e.target.closest("[data-to]");
      if (b) screenMove(trip, applyMove(ids, b.dataset.to) || undefined);
    });
  }

  /* 지역 고르기 — 목록이 길어 검색이 필요하다.
     ★ "이 여행 전체에 적용"을 같이 둔다. 대부분의 여행은 지역이 하나이고,
       그럴 때 정거장마다 고르게 하면 그게 더 고역이다. */
  async function screenRegionPick(stopId, trip) {
    await loadRegions().catch(() => {});
    const has = new Set(DICTS.map((d) => d.c));   // 사전이 준비된 지역
    const draw = (q) => {
      const list = RG.list
        .filter((r) => !q || r.n.includes(q) || r.s.includes(q) || r.c.startsWith(q))
        .slice(0, 60);
      // ★ 시도까지 보여준다. '중구'만 보여주면 어느 중구인지 알 수 없다 — 코드를 쓰는 이유 그대로다.
      return list.map((r) => `<button class="rgRow${has.has(r.c) ? " ready" : ""}" data-rg="${r.c}">
          <b>${esc(r.n)}</b><small>${esc(r.s)} · ${r.c}</small></button>`).join("")
        || `<div class="upNote">"${esc(q)}"에 맞는 지역이 없습니다.</div>`;
    };
    const o = open(`
      <div class="upHead"><span class="upBack">‹</span><b>지역 고르기</b><span class="upX">✕</span></div>
      <input id="rgQ" class="upInput" placeholder="지역 이름·시도·코드 (예: 해운대 / 부산 / 26350)" autocomplete="off">
      <label class="rgAll"><input type="checkbox" id="rgAllChk"> 이 여행의 모든 정거장에 적용</label>
      <div class="rgList" id="rgList">${draw("")}</div>`);
    const sheet = o.querySelector("#upSheet");
    sheet.querySelector("#rgQ").addEventListener("input", (e) => {
      sheet.querySelector("#rgList").innerHTML = draw(e.target.value.trim());
    });
    sheet.addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenMove(trip);
      const b = e.target.closest("[data-rg]");
      if (!b) return;
      const r = b.dataset.rg;   // 법정동코드
      if (sheet.querySelector("#rgAllChk").checked) UP.stops.forEach((st) => { UP.stopRegion[st.id] = r; });
      else UP.stopRegion[stopId] = r;
      // 지역이 정해지는 순간이 사전을 받기 가장 좋은 때다. 기다리지 않는다.
      loadRegionDict(r).catch(() => {});
      screenMove(trip);
    });
  }

  function screenTripDetail(trip) {
    UP.trip = trip;
    UP.stops = (UP.stopsFor === trip.id && UP.stops) ? UP.stops : trip.stops;
    if (UP.stopsFor !== trip.id) { UP.placeOf = {}; UP.tripPicks = {}; }
    UP.stopsFor = trip.id;
    UP.picks = {};
    UP.stops.forEach((st) => {
      UP.picks[st.id] = st.items.slice(0, Math.min(3, st.items.length)).map((x) => x.id);
    });

    const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
    const body = UP.stops.map((st, i) => {
      // 후보 1순위를 '이미 고른 장소'로 흉내낸다 — 한 여행 안에서 숙소를 두 번 묻지 않기 위해
      const p = st.items[0].poi.properties;
      const cat = CAT[p.c] || CAT.sight;
      const mixed = stopMixed(st);
      const d = new Date(st.start);
      return `
        <div class="pg" data-place="${st.id}">
          <div class="pgHead">
            <b>정거장 ${i + 1}</b>
            ${(() => { const main = st.items.find((v) => UP.picks[st.id]?.[0] === v.id);
               return main && !excludeReason(main)
                 ? `<button class="cropBtn" data-crop="${main.id}" data-stop="${st.id}"
                      title="목록에 보일 영역">⌗ 대표 사진 영역</button>` : ""; })()}
            ${(() => { const pk = UP.placeOf[st.id];
               return pk
                 ? `<button class="rpFlag" data-report="${esc(pk.name)}" title="이 장소 신고">⚑</button>
                    <button class="ckChip done" data-stop="${st.id}">${esc(pk.name)}
                      ${pk.source === "user" ? "<i>직접 추가</i>"
                        : pk.source === "ocr" ? "<i>간판에서</i>" : ""} <em>바꾸기</em></button>`
                 : `<button class="ckChip" data-stop="${st.id}">장소 고르기 ›</button>`; })()}
            <small><em style="background:${cat.c}"></em>${cat.k} · ${esc(regionShort(stopRegion(st)))} ·
              ${d.getMonth() + 1}/${d.getDate()} ${hhmm(st.start)}~${hhmm(st.end)} ·
              사진 ${st.items.length}장</small>
            ${(() => {
               const bad = st.items.map(excludeReason).filter(Boolean);
               if (!bad.length) return "";
               const cnt = {}; bad.forEach((r) => (cnt[r] = (cnt[r] || 0) + 1));
               const txt = Object.entries(cnt)
                 .map(([r, n]) => `${n}장 ${REASON[r].k}`).join(" · ");
               return `<div class="pubWarn">사진 ${st.items.length}장 중
                 <b>${st.items.length - bad.length}장</b>만 모두의 지도에 올라갑니다
                 <small>${txt} — 내 기록과 스페이스에는 그대로 저장됩니다</small></div>`;
             })()}
            ${mixed ? `<button class="stopSplit" data-stop="${st.id}">
                 이 묶음, 카테고리가 섞였습니다 — 쪼개기</button>` : ""}
            ${(() => {
               /* ★ clusterTrips 2차 통과가 **EXIF 없는 사진을 시각으로 여행에 끼워 넣고**,
                  clusterStops 가 다시 시각으로 정거장에 붙인다. 이미 돌고 있는데
                  화면이 한 마디도 안 했다 — 사용자는 위치 없는 사진이 왜 여기 있는지 모른다.
                  추론은 **측정이 아니므로 공개 자격을 주지 않는다**(§009).
                  그 규칙은 verdictOf() 한 곳에만 있고 여기서는 말만 한다. */
               const n = st.items.filter((x) => !x.gps).length;
               if (!n) return "";
               return `<div class="inferNote">위치 없는 사진 <b>${n}장</b>을
                 앞뒤 사진의 시각으로 여기에 놓았습니다
                 <small>찍힌 자리를 잰 게 아니라 **짐작한** 것이라, 모두의 지도에는 안 올라갑니다</small></div>`;
             })()}
          </div>
          <div class="pgRow">
            ${st.items.map((x) => photoCell(st.id, x)).join("")}
          </div>
          <input class="pgMemo" data-memo="${st.id}" maxlength="60"
                 value="${esc(UP.stopMemo[st.id] || "")}"
                 placeholder="한 줄 남기기 — 예) 창가 자리가 인생샷">
        </div>`;
    }).join("");

    open(`
      <div class="upHead"><span class="upBack">‹</span><b>${esc(trip.title)}</b><span class="upX">✕</span></div>
      ${trip.isOrphan ? `<div class="upNote">여행으로 묶이지 않았을 뿐 <b>기록으로는 똑같이 올라갑니다.</b>
        지도 타일도 열리고 커버리지에도 반영됩니다.</div>` : ""}
      <div class="upNote">사진 <b>${trip.items.length}장</b>을 좌표·시각으로 묶어
        <b>정거장 ${UP.stops.length}개</b>가 됐습니다 —
        장소 확인 <b>${Object.keys(UP.placeOf).filter((k) => UP.stops.some((s) => s.id === k)).length}/${UP.stops.length}</b>.<br>
        올리는 건 제한이 없습니다. 고른 순서가 역할이 됩니다 —
        <b class="lg-main">대표</b> 1장은 지도 타일에, <b class="lg-show">노출</b> 2장은 핀·피드에,
        나머지는 <b class="lg-keep">저장</b>되어 상세에서만 보입니다.</div>
      <button class="mvEnter" id="mvEnter">🗂 사진 옮기기 · 지역 바꾸기</button>
      <div class="pgList">${body}</div>
      ${trip.isOrphan ? "" : `<button class="tripDemote" id="tripDemote">이 날들은 여행이 아니었어요 — 일상으로</button>`}
      <button class="upCta" id="upNext">다음 — 공개 범위 정하기</button>`);

    // 한 줄은 다시 그리지 않고 그 자리에서 담는다 — 타이핑 중에 화면이 바뀌면 안 된다
    $("#upSheet").addEventListener("input", (e) => {
      const m = e.target.closest("[data-memo]");
      if (m) UP.stopMemo[m.dataset.memo] = m.value;
    });

    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenTrips();
      const cb = e.target.closest(".cropBtn");
      if (cb) {
        const st = UP.stops.find((v) => v.id === cb.dataset.stop);
        return screenCrop(st, st.items.find((v) => v.id === +cb.dataset.crop));
      }
      const ck = e.target.closest(".ckChip");
      if (ck) return void screenPick(UP.stops.find((x) => x.id === ck.dataset.stop));
      const sp = e.target.closest(".stopSplit");
      if (sp) {                                   // 잘못 합쳐진 정거장을 쪼갠다
        UP.stops = splitStop(UP.stops, sp.dataset.stop);
        return screenTripDetail(trip);
      }
      const mb = e.target.closest(".mainBtn");
      if (mb) {                                   // ★ → 대표로 승격
        const place = mb.dataset.place, id = +mb.dataset.main;
        const arr = UP.picks[place];
        const i = arr.indexOf(id);
        if (i > 0) { arr.splice(i, 1); arr.unshift(id); redrawGroup(place); }
        return;
      }
      const ph = e.target.closest(".pgPhoto");
      if (ph) {
        const place = ph.dataset.place, id = +ph.dataset.id;
        const arr = UP.picks[place];
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1); else arr.push(id);
        redrawGroup(place);
        return;
      }
      const rf = e.target.closest("[data-report]");
      if (rf) return screenReport({ type: "place", id: rf.dataset.report, label: rf.dataset.report },
                                  () => screenTripDetail(trip));
      if (e.target.closest("#mvEnter")) { UP.moveSel.clear(); return screenMove(trip); }
      if (e.target.closest("#tripDemote")) {
        setDayRule(daysOfTrip(trip), "daily");
        return screenTrips();
      }
      if (e.target.closest("#upNext")) screenForm(trip);
    });
  }

  function redrawGroup(place) {
    const g = [...document.querySelectorAll(".pg")].find((e) => e.dataset.place === place);
    if (!g || !UP.trip) return;
    const items = (UP.stops.find((s) => s.id === place) || { items: [] }).items;
    g.querySelector(".pgRow").innerHTML = items.map((x) => photoCell(place, x)).join("");
  }

  /* S4 — 등록 폼. 필수 입력이 하나도 없다 */

  /* ── 등록 요약 — 세 축이 여기서 만난다 ───────────────────────────
     ① 소유    내 기록                      (항상)
     ② 공유범위 나만 / 스페이스 / 전체 공개   ← 사용자가 고른다
     ③ 공개자격 EXIF·화질·인물·장소           ← 판정된다, 고를 수 없다

     ②에서 "전체 공개"를 골라도 ③을 통과 못 한 사진은 모두의 지도에 안 올라간다.
     **그걸 등록 전에 말한다.** 올린 뒤에 "왜 안 보이지"를 겪게 두면 안 된다. */
  function commitSummary(trip) {
    const stops = UP.stops || [];
    const out = { photos: 0, public: 0, reasons: {}, noPlace: [], stops: stops.length };
    for (const st of stops) {
      const picked = (UP.picks[st.id] || []);
      if (!picked.length) continue;
      const place = UP.placeOf[st.id];
      if (!place) out.noPlace.push(st);
      for (const id of picked) {
        const x = st.items.find((v) => v.id === id);
        if (!x) continue;
        out.photos++;
        const r = excludeReason(x);
        if (r) out.reasons[r] = (out.reasons[r] || 0) + 1;
        else if (place) out.public++;          // 장소가 없으면 공개 대상이 아니다
        else out.reasons.noplace = (out.reasons.noplace || 0) + 1;
      }
    }
    return out;
  }

  function screenForm(trip) {
    const sum = commitSummary(trip);
    const total = sum.photos;
    open(`
      <div class="upHead"><span class="upBack">‹</span><b>등록</b><span class="upX">✕</span></div>
      <div class="fm">
        ${trip.isOrphan ? `
        <div class="fmHint" style="margin:4px 0 0">낱개 기록은 여행에 묶이지 않습니다(<code>trip_id = null</code>).
          장소별 한 줄은 각 기록 상세에서 따로 쓸 수 있습니다.</div>
        ` : `
        <label>여행 이름</label>
        <input id="fTitle" value="${esc(trip.title)}">
        <label>이 여행은 어땠나요 <span class="opt">선택</span></label>
        <input id="fNote" placeholder="예) 퇴사하고 혼자 떠난 3박 4일">
        <div class="fmHint">한 번 쓰면 이 여행의 사진 전부에 맥락이 붙습니다 — 글 중 효율이 가장 좋습니다.</div>
        `}

        <label>공개 범위 <span class="opt">하나만</span></label>
        <div class="vis" id="visRow">
          <button class="vb on" data-v="me">나만</button>
          <button class="vb" data-v="pub">전체 공개</button>
        </div>
        <div class="fmHint">기본값은 <b>나만</b>입니다. 공개는 언제나 명시적 선택입니다.</div>

        <label>스페이스에 공유 <span class="opt">복수 · 공개 범위와 무관</span></label>
        <div class="vis" id="spRow">
          ${SPACES.map((sp) => `<button class="sb" data-sp="${sp.id}">${esc(sp.name)}</button>`).join("")}
        </div>
        <div class="fmHint"><b>비공개인 채로 스페이스에만 공유할 수 있습니다.</b>
          그게 오히려 기본 사용 패턴입니다 — 둘은 서로 다른 축입니다.</div>

        <div class="fmElig" id="fmElig"></div>

        <div class="fmSum">
          <div><i>정거장</i><b>${UP.stops.length}곳</b></div>
          <div><i>사진</i><b>${total}장</b></div>
          <div><i>${trip.isOrphan ? "여행" : "날짜"}</i><b>${trip.isOrphan ? "묶지 않음" : fmtRange(trip.start, trip.end)}</b></div>
          <div><i>모두의 지도</i><b>${sum.public}장</b></div>
        </div>
      </div>
      <button class="upCta" id="upDone">${total}장 등록하기</button>`);

    const drawElig = () => {
      const pub = $('#visRow .vb[data-v="pub"]')?.classList.contains("on");
      const box = $("#fmElig");
      if (!pub) {
        box.innerHTML = `<div class="eOk">전부 <b>내 기록</b>으로만 저장됩니다 —
          ${sum.photos}장 모두, 자격 판정과 무관하게 원본 그대로.</div>`;
        return;
      }
      const blocked = sum.photos - sum.public;
      const txt = Object.entries(sum.reasons)
        .map(([r, n]) => `${n}장 ${r === "noplace" ? "장소 미지정" : REASON[r].k}`).join(" · ");
      box.innerHTML = `
        <div class="${blocked ? "eWarn" : "eOk"}">
          <b>${sum.public}장</b>이 모두의 지도에 올라갑니다
          ${blocked ? `<span>· ${blocked}장은 내 기록에만</span>` : ""}
          ${blocked ? `<small>${txt} — 기록은 전부 그대로 남습니다</small>` : ""}
        </div>
        ${sum.noPlace.length ? `<div class="eWarn"><b>정거장 ${sum.noPlace.length}곳</b>의
          장소를 아직 안 골랐습니다 <small>장소가 없으면 모두의 지도에 올라갈 수 없습니다</small></div>` : ""}`;
    };
    drawElig();

    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX")) return close();
      if (e.target.closest(".upBack")) return screenTripDetail(trip);
      const v = e.target.closest(".vb");          // 공개 범위 — 배타
      if (v) {
        document.querySelectorAll("#visRow .vb").forEach((b) => b.classList.toggle("on", b === v));
        drawElig();
        return;
      }
      const sp = e.target.closest(".sb");          // 스페이스 공유 — 복수, 위와 독립
      if (sp) { sp.classList.toggle("on"); return; }
      if (e.target.closest("#upDone")) commit(trip);
    });
  }

  /* 등록 — 지도에 실제로 반영한다 */
  function commit(trip) {
    const pub = $('#visRow .vb[data-v="pub"]')?.classList.contains("on");
    const spaces = [...document.querySelectorAll("#spRow .sb.on")].map((b) => b.dataset.sp);
    const sum = commitSummary(trip);

    /* ★ 예전 commit은 **옛 장소 이름**으로 사진을 찾고 있었다
         (`trip.items.find(x => x.poi.properties.n === name)`).
         정거장 도입 뒤로 그 키가 사라져 **아무것도 등록되지 않았다.**
         이제 정거장과 확정된 장소를 기준으로 쓴다. */
    let n = 0, pubN = 0;
    for (const st of (UP.stops || [])) {
      const picked = UP.picks[st.id] || [];
      if (!picked.length) continue;
      const place = UP.placeOf[st.id];
      // 지도에 반영할 대표 POI — 정거장에서 가장 가까운 것
      const near = st.items[0] && st.items[0].poi;
      for (const id of picked) {
        const x = st.items.find((v) => v.id === id);
        if (!x) continue;
        n++;
        const eligible = !excludeReason(x) && !!place;
        if (pub && eligible) pubN++;
      }
      if (near) {
        const p = near.properties;
        p.mine = true;
        p.au = "u1";
        // ③ 공개 자격을 통과한 사진이 하나라도 있어야 모두의 지도에 오른다
        p.pub = !!pub && picked.some((id) => {
          const x = st.items.find((v) => v.id === id);
          return x && !excludeReason(x) && !!place;
        });
        if (spaces.length) p.sp = spaces[0];
        p.trip = trip.isOrphan ? null : trip.id;
        if (place) p.n = place.name;
      }
    }
    UP.registered.add(trip.id);
    if (window.syncFabBadge) syncFabBadge();     // 남은 일이 줄면 배지도 줄어야 한다
    // ★ 지도 갱신이 실패해도 **등록 결과는 보여줘야 한다.**
    //   스타일 로딩 전에 render()를 부르면 MapLibre가 던지는데,
    //   그 예외가 screenDone까지 삼켜서 사용자는 아무 확인도 못 받았다.
    try { refreshPoi(); render(); }
    catch (e) { console.warn("[upload] 지도 갱신 실패 (등록은 완료됨)", e); }
    screenDone(trip, { n, pubN, pub, spaces, sum });

    /* ★ 서버로는 **완료 화면을 보여준 뒤에** 올린다.
       업로드를 기다리게 하면 등록이 느려지고, 느리면 다음부터 안 한다.
       실패해도 로컬 등록을 되돌리지 않는다 — 사용자는 이미 '완료'를 봤고,
       되돌리면 화면이 거짓말을 한 게 된다. 대신 **무엇이 안 갔는지 적는다.** */
    if (window.API && API.on && API.session.access_token) {
      const box = document.getElementById("doneSync");
      if (box) box.textContent = "서버로 올리는 중…";
      API.pushTrip(trip, UP.stops || [], {
        picks: UP.picks, placeOf: UP.placeOf, memos: UP.stopMemo,
        isPublic: !!pub, spaces,
        spaceNames: Object.fromEntries(SPACES.map((s) => [s.id, s.name])),
        srcOf: (rec) => { try { return PHOTOS[rec.img]; } catch (e) { return null; } },
      }).then((r) => {
        UP.pushed = r;
        if (!box) return;
        const kb = Math.round((r.bytes || 0) / 1024).toLocaleString();
        box.innerHTML = r.ok
          ? `<b>서버에 올라갔습니다</b> 정거장 ${r.pins}곳 · 사진 ${r.media}장 · ${kb}KB
             <small>정거장마다 대표 1장만 먼저 올립니다 — 나머지는 내 기기에 그대로 있습니다</small>`
          : `<b class="bad">일부가 안 갔습니다</b> 올라간 것 ${r.pins}곳 · ${r.media}장 /
             못 간 것 ${r.failed.length}건
             <small>${esc((r.failed[0] || {}).why || "")}</small>`;
      });
    }
  }

  /* 등록 결과 — 무엇이 어디로 갔는지 그 자리에서 보여준다 */
  function screenDone(trip, r) {
    const priv = r.n - r.pubN;
    const spNames = r.spaces.map((id) => (SPACES.find((s) => s.id === id) || {}).name).filter(Boolean);
    open(`
      <div class="upHead"><b>등록 완료</b><span class="upX">✕</span></div>
      <div class="doneWrap">
        <div class="doneBig">${r.n}장</div>
        <div class="doneSub">${esc(trip.isOrphan ? "낱개 기록" : trip.title)} ·
          정거장 ${r.sum.stops}곳</div>

        <div class="doneRows">
          <div><i>내 기록</i><b>${r.n}장</b><small>원본 그대로 · 언제든 꺼내 볼 수 있습니다</small></div>
          ${spNames.length ? `<div><i>스페이스</i><b>${esc(spNames.join(", "))}</b>
            <small>공개 여부와 무관하게 함께 간 사람이 봅니다</small></div>` : ""}
          <div class="${r.pubN ? "ok" : "off"}"><i>모두의 지도</i><b>${r.pubN}장</b>
            <small>${!r.pub ? "공개를 선택하지 않았습니다"
              : priv ? `${priv}장은 자격 미달로 내 기록에만 남습니다`
              : "전부 올라갔습니다"}</small></div>
        </div>
        <div class="doneSync" id="doneSync"></div>

        <p class="doneHint">모두의 지도에서 빠진 사진도 <b>지워지지 않습니다.</b>
          나중에 기준이 바뀌거나 사진을 다시 고르면 그때 올라갑니다.</p>
        <button class="upCta" id="doneOk">지도에서 보기</button>
      </div>`);
    $("#upSheet").addEventListener("click", (e) => {
      if (e.target.closest(".upX") || e.target.closest("#doneOk")) {
        close();
        toast(trip.isOrphan
          ? `${r.n}장 등록 완료 · 낱개 기록`
          : `${r.n}장 등록 완료 · ${trip.region} 타일이 열렸습니다`);
      }
    });
  }

  function toast(msg) {
    const t = el(`<div id="upToast" class="glass">${esc(msg)}</div>`);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("on"));
    setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, 3200);
  }

  /* ── 초기화 ─────────────────────────────────────────────────── */
  /* ── 테스트 시임 ────────────────────────────────────────────
     앨범 일괄 투입(수천 장·수년치)을 브라우저 없이 node에서 재기 위해
     내부 함수를 그대로 노출한다. 복사본을 검사하면 원본과 갈라진다.
     ★ 선언이 전부 끝난 뒤에 둔다 — const는 호이스팅되지 않아 위에 두면 TDZ로 터진다. */
  window.__albumInternals = { clusterTrips, findOrphans, clusterStops, makeAlbum,
                              excludeReason, setDayRule, recluster, daysOfTrip, TUNE,
                              screenReport, REPORT_REASONS, KNOWN_BAD_GEO, screenOps, opsQueue, opsPeople, screenViewer, viewerItems, PUBLIC_ALBUM,
                              applyMove, stopRegion,
                              ocrLookup, fakeOcr, regionCenter,
                              DICT, loadRegionDict, dictLookup, RG, loadRegions,
                              regionFull, regionShort, loadDictIndex };

  window.initUpload = function () {
    loadPlaces();
    /* ★ **이 함수는 다시 불린다**(§13.83). `uismoke.js:51` 이 부르고, 화면을 다시
       세울 때도 부른다. 그런데 아래가 전부 *"만들어 붙인다"* 뿐이라, 두 번째 호출이
       **같은 것을 하나 더** 만들었다. 붙이기 전에 **있던 것을 치운다.** */
    document.getElementById("ckStyle")?.remove();
    document.head.appendChild(Object.assign(document.createElement("style"),
      { id: "ckStyle", textContent: CK_CSS }));
    UP.album = makeAlbum();
    UP.dayRule = loadDayRule();   // 지난번에 고친 판정을 그대로 이어간다
    // 지역 목록(246개·코드 포함)을 먼저 받아 둔다 — 정거장 지역을 코드로 물려받으려면 필요하다
    loadRegions().then(() => loadDictIndex()).then(() => {
      if (UP.trips.length) UP.trips = UP.trips;     // 이름 표시가 코드에서 오므로 다시 그릴 필요는 없다
    }).catch(() => {});
    recluster();
    /* ★ 여기가 배지가 거짓말하던 자리다(§13.83).
       두 번 불리면 `#fab` 이 **둘**이 되고, `syncFabBadge` 는 마지막 클로저의
       `fab` 에만 쓴다. 화면이 보여 주는 것(= `document.querySelector` 가 찾는 첫 번째)은
       **첫 호출 때의 낡은 배지**라 등록해도 숫자가 안 줄었다.
       숫자가 틀린 게 아니라 **틀린 요소에 쓰고 있었다.** */
    document.getElementById("fab")?.remove();
    const fab = el(`<button id="fab" title="기록 추가">+</button>`);
    document.body.appendChild(fab);
    fab.addEventListener("click", screenEntry);
    /* 배지 = **아직 안 한 일**의 수. 발견된 여행 수가 아니다.
       `UP.trips.length` 를 달아 놨더니 전부 등록한 뒤에도 6이 남았다 —
       배지가 여는 화면의 제목은 `아직 지도에 없는 여행 N개` 인데 숫자가 서로 달랐다.
       배지는 누르면 나오는 것과 같은 것을 세야 한다. */
    window.syncFabBadge = () => {
      const todo = UP.trips.filter((t) => !UP.registered.has(t.id)).length
                 + (UP.orphans && UP.orphans.items.length ? 1 : 0);
      let b = fab.querySelector("#fabBadge");
      if (!todo) { b && b.remove(); return 0; }
      if (!b) { b = el(`<span id="fabBadge"></span>`); fab.appendChild(b); }
      b.textContent = todo;
      return todo;
    };
    syncFabBadge();
    // ★ 운영자 화면 진입. 화면을 숨기는 것은 권한이 아니다 — 서버가 is_operator()로 막는다.
    const openOps = () => { if (location.hash === "#ops") screenOps(); };
    window.addEventListener("hashchange", openOps);
    setTimeout(openOps, 300);
    console.log("[upload] 앨범", UP.album.length, "장 →", UP.trips.length, "개 여행 +",
                UP.orphans.items.length, "장 낱개");
  };
})();
