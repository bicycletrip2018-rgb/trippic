/**
 * 지도 바텀시트 — **3단** (§13.66)
 *
 * ★ 기획 명세의 마지막 조각이다. 지금까지 하단에 있던 것은 **요약 한 줄**뿐이라
 *   (`st.foot`) 화면에 보이는 기록을 **목록으로 볼 길이 없었다.** 지도에서
 *   점과 카드를 눈으로 훑는 것 말고는 방법이 없다.
 *
 * ★ **하단이 이미 붐빈다.** 네이버 지도에는 탭바가 없어 시트가 바닥을 독차지하지만
 *   우리는 5탭 + (+) + 시트가 같은 자리를 다툰다(§13.55 에서 짚었다).
 *   → **A안**: (+) 를 시트 **위에** 얹어 같이 올라가게 한다. 숨기지 않는다 —
 *     (+) 는 지도를 보는 내내 닿아야 하는 버튼이다.
 *
 * ★ `Animated` 로 쓴다. `reanimated` 가 깔려 있지만 여기서 필요한 것은
 *   **값 하나를 끄는 일**뿐이라, 새 개념을 들일 이유가 없다.
 */
import React, { useMemo, useRef, useState } from "react";
import {
  Animated, Dimensions, Image, PanResponder, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { C, CAT } from "./theme";

/** 시트가 설 수 있는 세 자리. 화면 바닥에서의 높이(pt). */
export type Snap = "peek" | "half" | "full";

const H = Dimensions.get("window").height;
/* ★ 시트를 **탭바 위에 얹는다.** 탭바는 `bottom:26` 에 약 52pt 를 차지하는
   떠 있는 알약이다(TabBar.tsx). 시트를 바닥(0)에 붙였더니 **요약 문구가 탭바에
   그대로 가렸다** — §13.55 에서 *"하단이 이미 붐빈다"* 고 짚어 놓고도 숫자를
   틀렸다. 겹칠 수 있는 것은 겹치지 않게 **쌓는다.**
   ★ 가려서 안 보이면 *"시트가 안 열렸다"* 로 읽힌다. 열렸는데 안 보이는 것이
     안 열린 것보다 나쁘다 — 사용자는 다시 끌어 본다. */
export const SHEET_BOTTOM = 86;          // 탭바(26 + 52) 위로 8pt

const SNAP: Record<Snap, number> = {
  peek: 96,
  half: Math.round(H * 0.42),
  /* `full` 도 화면을 다 덮지 않는다 — 위에 칩과 지도가 한 뼘 남아야
     *"지도를 보다가 목록을 연 것"* 이지 *"다른 화면으로 넘어온 것"* 이 아니다. */
  full: Math.round(H * 0.72),
};
const ORDER: Snap[] = ["peek", "half", "full"];

export type SheetItem = {
  id: string;
  thumb: string | null;
  memo: string | null;
  category: string | null;
  visited_at: string | null;
  source: string | null;
};

export function MapSheet(
  { snap, onSnap, onHeight, summary, items, onPick }: {
    snap: Snap;
    onSnap: (s: Snap) => void;
    /** (+) 가 시트 위에 앉으려면 App 이 지금 높이를 알아야 한다. */
    onHeight: (h: number) => void;
    summary: string;
    items: SheetItem[];
    onPick: (id: string) => void;
  },
) {
  const h = useRef(new Animated.Value(SNAP[snap])).current;
  const at = useRef(SNAP[snap]);
  const [live, setLive] = useState(SNAP[snap]);

  /* 높이가 바뀌는 동안 계속 알려 준다 — (+) 가 시트와 **같이** 움직여야
     한다. 끝나고 한 번만 알리면 (+) 가 뒤늦게 튄다. */
  useMemo(() => {
    const id = h.addListener(({ value }) => { setLive(value); onHeight(value); });
    return () => h.removeListener(id);
  }, []);

  const settle = (to: Snap) => {
    at.current = SNAP[to];
    onSnap(to);
    Animated.spring(h, {
      toValue: SNAP[to], useNativeDriver: false,
      bounciness: 2, speed: 14,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      /* ★ 손잡이를 **잡은 뒤**에만 반응한다. 바로 responder 를 잡으면
         시트 안의 스크롤과 탭이 전부 먹힌다. */
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        const next = Math.max(SNAP.peek, Math.min(SNAP.full, at.current - g.dy));
        h.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const cur = Math.max(SNAP.peek, Math.min(SNAP.full, at.current - g.dy));
        /* ★ **빠르게 튕기면 방향을 따른다.** 느리게 끌면 가장 가까운 자리로.
           속도를 안 보면 살짝 올렸다 놓을 때 늘 제자리로 돌아가 답답하다. */
        let to: Snap;
        if (Math.abs(g.vy) > 0.6) {
          const i = ORDER.indexOf(nearest(cur));
          to = ORDER[Math.max(0, Math.min(ORDER.length - 1, i + (g.vy < 0 ? 1 : -1)))];
        } else {
          to = nearest(cur);
        }
        settle(to);
      },
    }),
  ).current;

  const open = live > SNAP.peek + 24;
  /* ★ `full` 에서는 **칸을 키운다**(3열 → 2열). 안 그러면 `full` 이
     *"격자가 더 많이 보이는 것"* 뿐이라 3단을 둘 이유가 약하다.
     명세의 *"몰입형"* 은 **사진을 크게** 보자는 뜻인데, 인스타처럼 1열로 가면
     한 번에 하나밖에 못 봐 *"이 화면에 뭐가 있나"* 에 답을 못 한다 —
     그 질문이 **지도에 붙은 시트의 일**이다. 하나씩 음미하는 것은 핀 상세가 한다.
     → 2열이 둘을 다 지키는 자리다. */
  const wide = live > (SNAP.half + SNAP.full) / 2;

  return (
    <Animated.View style={[st.sheet, { height: h }]}>
      {/* 손잡이 — 끄는 것은 여기서만 받는다 */}
      <View {...pan.panHandlers} style={st.grabArea}>
        <View style={st.grab} />
        <Pressable
          onPress={() => settle(snap === "peek" ? "half" : "peek")}
          style={st.sumRow}>
          <Text style={st.sum} numberOfLines={1}>{summary}</Text>
          <Text style={st.chev}>{open ? "⌄" : "⌃"}</Text>
        </Pressable>
      </View>

      {/* ★ 펼쳤을 때만 목록을 만든다. 접힌 채로도 그리면 화면 밖 썸네일 수십 장을
          내려받는다 — 보이지도 않는 것에 통신을 쓸 이유가 없다. */}
      {open && (
        <ScrollView contentContainerStyle={st.grid}>
          {!items.length && (
            <Text style={st.empty}>이 화면에는 아직 기록이 없습니다</Text>
          )}
          {items.map((it) => (
            <Pressable key={it.id} style={[st.cell, wide && st.cellWide]}
                       onPress={() => onPick(it.id)}>
              {it.thumb
                ? <Image source={{ uri: it.thumb }}
                         style={[st.cellImg, wide && st.cellImgWide]} />
                : <View style={[st.cellImg, st.cellBlank]}>
                    <View style={[st.dot, { backgroundColor: CAT[it.category ?? "etc"]?.c }]} />
                  </View>}
              <Text style={st.cellT} numberOfLines={1}>
                {it.memo || CAT[it.category ?? "etc"]?.k || "기록"}
              </Text>
              <Text style={st.cellS} numberOfLines={1}>
                {it.visited_at ? it.visited_at.slice(0, 10).replace(/-/g, ".") : ""}
                {it.source === "shared" ? " · 함께" : it.source === "other" ? " · 남" : ""}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Animated.View>
  );
}

function nearest(v: number): Snap {
  let best: Snap = "peek", d = Infinity;
  for (const s of ORDER) {
    const dd = Math.abs(SNAP[s] - v);
    if (dd < d) { d = dd; best = s; }
  }
  return best;
}

export const SHEET_PEEK = SNAP.peek;
/* ★ (+) 와 위치 버튼이 시트를 따라 올라가되 **여기까지만** 올라간다(§13.66).
   끝까지 따라가면 상단 칩 줄과 겹친다 — 실제로 겹쳤다. 그리고 `full` 은
   지도를 덮는 몰입형 목록이라, 그때는 지도 위 버튼이 있을 이유가 없다. */
export const SHEET_HALF = SNAP.half;

const st = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: SHEET_BOTTOM,
    backgroundColor: "rgba(16,18,24,0.98)",
    borderRadius: 18,
    borderWidth: 1, borderColor: C.line,
    marginHorizontal: 8, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
  },
  grabArea: { paddingTop: 8, paddingHorizontal: 14, paddingBottom: 6 },
  grab: {
    width: 38, height: 4, borderRadius: 2,
    backgroundColor: C.line, alignSelf: "center", marginBottom: 8,
  },
  sumRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sum: { flex: 1, color: C.text, fontSize: 13 },
  chev: { color: C.muted, fontSize: 14, width: 16, textAlign: "center" },
  grid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
    paddingHorizontal: 14, paddingTop: 6, paddingBottom: 24,
  },
  empty: { color: C.muted, fontSize: 13, textAlign: "center", width: "100%", paddingVertical: 24 },
  cell: { width: "31%" },
  cellWide: { width: "48%" },
  /* 넓을 때는 **세로로 조금 긴** 비율 — 풍경도 인물도 덜 잘린다 */
  cellImgWide: { aspectRatio: 0.86 },
  cellImg: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: "#1c1f27" },
  cellBlank: { alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cellT: { color: C.text, fontSize: 12.5, marginTop: 5 },
  cellS: { color: C.muted, fontSize: 10.5, marginTop: 1 },
});
