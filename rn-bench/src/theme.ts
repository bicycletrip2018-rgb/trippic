/** 웹 프로토타입의 색을 그대로 옮긴다 — 두 화면이 달라 보이면 같은 앱이 아니다 */
export const C = {
  bg: "#0E0F13", surface: "#16181F", line: "rgba(255,255,255,0.10)",
  text: "#F2F3F5", muted: "#8b93a3", accent: "#38B6FF", warn: "#e0a94a",
  /* 파랑 위 글씨. 흰색은 대비 2.3:1이라 못 쓴다 */
  onAccent: "#04233A",
};
export const CAT: Record<string, { k: string; c: string }> = {
  nature: { k: "자연", c: "#8FBF9A" }, beach: { k: "해변", c: "#6FB5B3" },
  heritage: { k: "문화재", c: "#A8A2C4" }, activity: { k: "액티비티", c: "#7FA8C4" },
  food: { k: "맛집", c: "#C98A6E" }, cafe: { k: "카페", c: "#BCA07C" },
  bar: { k: "술집", c: "#9D89B5" }, stay: { k: "숙박", c: "#B59D89" },
  shop: { k: "상점", c: "#93A3B5" }, event: { k: "행사", c: "#C4A2A8" },
  etc: { k: "기타", c: "#8b93a3" },
};
