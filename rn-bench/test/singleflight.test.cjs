/** 같은 일을 한 번만 시킨다 (§13.106) */
const { singleFlight } = require("../build-test/singleFlight.js");
let n = 0, bad = 0;
const ok = (c, why) => { n++; if (!c) { bad++; console.log(`  FAIL ${why}`); } };
const eq = (got, want, why) => {
  n++;
  if (got === want) return;
  bad++; console.log(`  FAIL ${why}\n       받음 ${got} / 기대 ${want}`);
};
const tick = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  // ── ★ 동시에 넷이 불러도 **한 번만** 돈다 ──
  {
    let runs = 0;
    const f = singleFlight(async () => { runs++; await tick(); return "표"; });
    const rs = await Promise.all([f(), f(), f(), f()]);
    eq(runs, 1,
       "★ 넷이 동시에 불러도 한 번만 돈다 — 갱신이 두 번 돌면 첫 번째가 둘째의 표를 죽인다");
    ok(rs.every((x) => x === "표"), "넷 다 같은 답을 받는다");
  }

  // ── 끝난 뒤에는 다시 돈다 (캐시가 아니다) ──
  {
    let runs = 0;
    const f = singleFlight(async () => { runs++; await tick(); return runs; });
    eq(await f(), 1, "첫 번째");
    eq(await f(), 2, "★ 끝나고 나면 다시 돈다 — 결과를 들고 있으면 다음 만료 때 영영 갱신을 안 한다");
    eq(runs, 2, "두 번 돌았다");
  }

  // ── ★ 실패해도 잊는다 ──
  {
    let runs = 0;
    const f = singleFlight(async () => {
      runs++; await tick();
      if (runs === 1) throw new Error("첫 번째는 실패");
      return "두 번째는 성공";
    });
    let caught = null;
    try { await f(); } catch (e) { caught = e.message; }
    eq(caught, "첫 번째는 실패", "실패는 그대로 올라온다");
    /* ★ 여기도 **잡아서** 본다. 안 잡으면 빗장이 걸릴 때 테스트가 **터져서**
       `FAIL` 한 줄 없이 죽는다 — 출력만 훑으면 통과한 것처럼 보인다(실제로 그랬다).
       빗장은 **읽히는 실패**로 걸려야 빗장이다. */
    let second = null;
    try { second = await f(); } catch (e) { second = `터짐: ${e.message}`; }
    eq(second, "두 번째는 성공",
       "★ 실패한 뒤에도 다시 해 볼 수 있다 — 성공에서만 지우면 그 실패를 영영 돌려준다");
  }

  // ── 실패도 동시에 온 쪽에 똑같이 간다 ──
  {
    let runs = 0;
    const f = singleFlight(async () => { runs++; await tick(); throw new Error("안 됨"); });
    const rs = await Promise.allSettled([f(), f(), f()]);
    eq(runs, 1, "실패하는 일도 한 번만 돈다");
    ok(rs.every((r) => r.status === "rejected" && r.reason.message === "안 됨"),
       "셋 다 같은 실패를 받는다");
  }

  // ── 거짓 값도 그대로 돌려준다 (갱신 실패는 `false` 다) ──
  {
    const f = singleFlight(async () => { await tick(); return false; });
    eq(await f(), false, "★ `false` 를 그대로 돌려준다 — 갱신 실패가 바로 이 값이다");
  }

  // ── 줄줄이 부르면 각자 돈다 ──
  {
    let runs = 0;
    const f = singleFlight(async () => { runs++; return runs; });
    await f(); await f(); await f();
    eq(runs, 3, "차례로 부르면 합쳐지지 않는다");
  }

  console.log(bad ? `\n실패 ${bad}/${n}` : `\n한 번만 돌기 ${n}건 통과`);
  process.exit(bad ? 1 : 0);
})();
