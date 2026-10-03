/**
 * 지도에서 **저장한 곳과 상호를 가르는 규칙** (§13.104)
 *
 * ★ 왜 함수로 떼어 놨나 — 두 규칙이 **서로 맞물려** 있어서다:
 *   ① 저장한 곳은 갈래 칩을 **탄다**
 *   ② 저장한 곳으로 그린 자리는 상호에서 **뺀다**(한 자리에 점 둘이면 테두리가 겹친다)
 *   JSX 안에 두 줄로 흩어 두면 ①을 고칠 때 ②가 따라 틀어지는 것을 아무도 못 본다.
 *   실제로 어긋나는 모양이 있다: 갈래가 `맛집` 일 때 찜해 둔 **산**은 ①로 빠지는데,
 *   그 산이 ②로도 빠져 버리면 **아무 데도 안 그려진다.** 아래 마지막 테스트가 그것이다.
 *
 * ★ 갈래 칩은 타고 **스코프 칩은 안 탄다.** 스코프(`나의 여행`·`모두의 지도`)는
 *   *"누구의 **기록**인가"* 를 고르는 것이고, 저장은 기록이 아니라 **가 보려는 표시**다.
 *   그래서 이 함수는 스코프를 아예 받지 않는다 — 받지 않으면 잘못 쓸 수도 없다.
 */
export type HasId = { id: string; category?: string | null };
export type HasPlace = { place_id: string; category?: string | null };

export function splitMapSaves<P extends HasId, S extends HasPlace>(
  places: P[], saves: S[], cat: string | null,
): { saveShown: S[]; placeShown: P[] } {
  const saveShown = cat ? saves.filter((q) => q.category === cat) : saves;
  const savedIds = new Set(saveShown.map((q) => q.place_id));
  /* ★ **그려진 것만** 뺀다. `saves` 전체로 빼면 갈래에 걸러진 저장이 상호까지
     지워서, 그 자리가 **아무 층에도 없는** 구멍이 된다. */
  return { saveShown, placeShown: places.filter((q) => !savedIds.has(q.id)) };
}
