/**
 * 표지 노출 로그 (§13.9 · §13.69 · 027)
 *
 * ★ §13.8 이 *"표지는 주어지지 않는다. **이긴다**"* 로 정했다. 이기려면 **분모**가
 *   있어야 한다 — 몇 번 보였고 몇 번 열렸나. 그 분모를 만드는 것이 이 파일이다.
 *   서버(`api_log_cover_events`)와 점수식(Wilson 하한)은 027 에 이미 있었고,
 *   **앱이 한 번도 안 보냈다**(§13.67 점검에서 찾았다).
 *
 * ★ **소급이 안 된다.** 무엇을 보고 무엇을 열었는지는 그 순간에만 알 수 있다.
 *   지금 데이터가 없어 효과가 안 보여도 일찍 붙이는 이유가 이것이다.
 *
 * ★ **보낸 것은 지운다.** 안 지우면 다음 전송에서 같은 노출을 또 보내 **분모가
 *   부푼다** — 노출 대비로 재는 점수에서 분모가 부풀면 모든 후보가 같이 낮아지고
 *   순위가 흐려진다(웹이 같은 규칙으로 돈다).
 *
 * ★ **같은 화면에서 같은 것을 두 번 세지 않는다.** 지도를 조금 밀 때마다 같은
 *   카드가 다시 그려지는데 그걸 다 세면 분모가 실제보다 몇 배가 된다.
 *   한 번 센 장소는 `seen` 에 남겨 두고, 전송할 때 같이 비운다.
 */
import * as API from "./api";
import { shouldCountResearch, RESEARCH_WINDOW_MS } from "./researchRule";

type Row = { imp: number; opened: number; research: number };

const BUF: Record<string, Row> = {};
/** 이번 묶음에서 이미 노출로 센 장소 — 화면이 다시 그려져도 또 세지 않는다. */
const seen = new Set<string>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const row = (id: string) => (BUF[id] ??= { imp: 0, opened: 0, research: 0 });

/* ★ 그 장소를 **마지막으로 보여 준 시각**. `BUF` 와 따로 둔다 — 보낸 뒤에도
   남아야 §13.9 의 *"30분 안에 다시 찾았을 때만"* 을 지킬 수 있다. */
const shownAt: Record<string, number> = {};

/** 화면에 **보였다**. 같은 묶음 안에서는 한 번만 센다. */
export function sawCover(placeId: string | null | undefined) {
  if (!placeId || !UUID.test(placeId)) return;
  /* ★ **세는 것과 기억하는 것을 가른다.** 노출은 묶음마다 한 번만 세지만,
     *"언제 보여 줬나"* 는 다시 그릴 때마다 갱신해야 사실이다. */
  shownAt[placeId] = Date.now();
  if (seen.has(placeId)) return;
  seen.add(placeId);
  row(placeId).imp += 1;
}

/** **열었다**(상세를 봤다). 노출과 달리 **누를 때마다** 센다 — 그게 관심이다. */
export function openedCover(placeId: string | null | undefined) {
  if (!placeId || !UUID.test(placeId)) return;
  row(placeId).opened += 1;
}

/**
 * 검색으로 **다시 찾았다**(§13.9 규칙 3 · §13.101).
 *
 * ★ **보여 준 적 있을 때만** 센다. 예전에는 무조건 더했는데, 그때는 RN 에 검색
 *   경로가 없어 아무도 안 불렀다 — 입구를 내면서 규칙도 같이 들여온다.
 *   처음 찾는 사람까지 감점하면 **새 장소가 영원히 못 올라온다.**
 * ★ 판정은 `researchRule.ts` 에 있다. 이 신호는 점수에서 **-2** 라 헛나가면
 *   멀쩡한 표지를 끌어내리는데 화면에는 아무것도 안 보인다.
 */
export function researchedCover(placeId: string | null | undefined) {
  if (!placeId || !UUID.test(placeId)) return;
  if (!shouldCountResearch(shownAt[placeId], Date.now())) return;
  row(placeId).research += 1;
}

/** 오래된 기억은 버린다 — 창을 넘긴 것은 어차피 안 센다 */
export function pruneShown(now = Date.now()) {
  for (const k of Object.keys(shownAt)) {
    if (now - shownAt[k]! > RESEARCH_WINDOW_MS) delete shownAt[k];
  }
}

/**
 * 모아 둔 것을 보낸다.
 *
 * ★ 세션이 없으면 **보내지 않고 그대로 둔다.** 버리면 그 노출은 영영 없다 —
 *   다음 기회에 보내면 된다(서버가 날짜별로 더하므로 하루가 넘어가도 괜찮다).
 * ★ 서버는 한 번에 500줄까지 받는다. 넘으면 나눠 보낸다.
 */
export async function flushCovers(): Promise<{ sent: number; kept: number }> {
  const ids = Object.keys(BUF).filter((k) => {
    const r = BUF[k];
    return r.imp || r.opened || r.research;
  });
  if (!ids.length) return { sent: 0, kept: 0 };
  if (!API.SESSION.access_token) return { sent: 0, kept: ids.length };

  let sent = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const r = await API.logCoverEvents(
      chunk.map((id) => ({ place_id: id, media_id: null, ...BUF[id] })),
    );
    if (!r.ok) break;                       // 실패하면 **남겨 둔다** — 다음에 다시
    for (const id of chunk) { delete BUF[id]; seen.delete(id); }
    sent += chunk.length;
  }
  return { sent, kept: Object.keys(BUF).length };
}

/** 검사용 — 지금 몇 줄이 쌓여 있나. */
export const pendingCovers = () => Object.keys(BUF).length;
