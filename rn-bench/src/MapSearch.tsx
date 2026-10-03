/**
 * 지도에서 찾기 (§13.97 ③ · §13.101)
 *
 * ★ `api_search` 는 **처음부터 있었다.** 입구가 없었을 뿐이다 — 46만 곳을 들고
 *   있으면서 *"저기 어디였더라"* 에 답할 길이 없었다. §13.100 에서 그 함수가
 *   매번 타임아웃이던 것을 고쳤고, 이제 문을 낸다.
 *
 * ★ **두 글자부터** 찾는다(`SEARCH_MIN`). 한 글자는 느리고 결과도 쓸모없다
 *   (`카` → 이카·카세·퀸카). 서버 주석이 재 둔 값을 그대로 쓴다.
 *
 * ★ **보고 있는 자리를 같이 보낸다.** 좌표가 있으면 서버가 반경 안만 보므로
 *   훨씬 빠르고(§13.100), *"근처의 그것"* 을 먼저 준다. 다만 **가까운 것이 없을
 *   수도 있으므로**, 반경 안이 비면 좌표 없이 한 번 더 묻는다 —
 *   *"전주한옥마을"* 을 부산에서 찾는 일이 실제로 있다.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { C, CAT } from "./theme";
import * as API from "./api";

export type Hit = {
  kind: "region" | "place";
  id: string; name: string; sub: string | null;
  lng: number; lat: number;
};

/** 타이핑이 멎기를 기다리는 시간. 글자마다 부르면 한 단어에 대여섯 번 간다 */
const DEBOUNCE_MS = 220;

/* ★ 서버는 `지역 · 카테고리` 를 주는데 카테고리가 **enum 원문**(`food`)이다.
   화면에 그대로 뿌리면 *"기장군 · food"* 가 된다 — 한국어 화면에 영어 토큰이
   섞이는 것은 번역을 안 한 것이지 간결한 것이 아니다. `CAT` 이 이미 한국어를 안다. */
const catKey = (h: Hit) => (h.sub ?? "").split(" · ")[1]?.trim() ?? "";
const catOf = (h: Hit) => CAT[catKey(h)] ?? CAT.etc;
const subText = (h: Hit) => {
  if (h.kind === "region" || !h.sub) return h.sub ?? "";
  const k = catKey(h);
  return k ? h.sub.replace(` · ${k}`, ` · ${catOf(h).k}`) : h.sub;
};

export function MapSearch(
  { at, onPick, onOpen }: {
    /** 보고 있는 자리 — 서버가 반경 안을 먼저 본다 */
    at: { lng: number; lat: number } | null;
    onPick: (h: Hit) => void;
    /** 펼쳐졌는가 — 지도 쪽이 다른 것을 감출 수 있게 알린다 */
    onOpen?: (open: boolean) => void;
  },
) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(false);
  const seq = useRef(0);

  useEffect(() => { onOpen?.(focus || !!rows?.length); }, [focus, rows?.length]);

  useEffect(() => {
    const s = q.trim();
    if (s.length < API.SEARCH_MIN) { setRows(null); setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      let r = await API.search(s, 14, at);
      /* ★ 반경 안에 **장소가** 없으면 전국으로 한 번 더. 안 그러면 *"여기 없다"* 가
         *"어디에도 없다"* 로 읽힌다 — 실제로는 서버가 1.5km 만 본 것이다.
         ★ 처음엔 *"결과가 통째로 비면"* 으로 썼다가 실기기에서 걸렸다:
           `해운대` 를 치면 **지역 한 줄이 맞아서** 결과가 비지 않고, 그 바람에
           폴백이 안 돌아 **장소가 하나도 없는 목록**이 떴다. 지역은 반경과 무관하게
           늘 맞으므로 **장소만 보고 판단해야 한다.** */
      const noPlace = (rows: any[]) => !rows.some((x) => x.kind === "place");
      if (r.ok && at && noPlace(r.data ?? [])) {
        const wide = await API.search(s, 14, null);
        /* 넓혀서 장소를 찾았으면 그것을 쓴다. 못 찾았으면 **처음 답을 지키다** —
           지역 줄까지 잃으면 사용자가 보던 것이 사라진다. */
        if (wide.ok && !noPlace(wide.data ?? [])) r = wide;
      }
      /* ★ 늦게 온 답이 **먼저 온 답을 덮지 않게** 한다. 타이핑이 빠르면 순서가 뒤집힌다 */
      if (mine !== seq.current) return;
      setBusy(false);
      setRows(r.ok ? ((r.data ?? []) as Hit[]) : []);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, at?.lng, at?.lat]);

  const clear = () => { setQ(""); setRows(null); Keyboard.dismiss(); };

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        <Text style={s.glass}>⌕</Text>
        <TextInput
          style={s.input}
          value={q} onChangeText={setQ}
          placeholder="장소나 지역을 찾습니다"
          placeholderTextColor={C.muted}
          returnKeyType="search"
          autoCorrect={false} autoCapitalize="none"
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)} />
        {busy ? <ActivityIndicator size="small" color={C.muted} /> : null}
        {q ? (
          <Pressable onPress={clear} hitSlop={10}>
            <Text style={s.x}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {rows && (
        <View style={s.panel}>
          {!rows.length ? (
            <Text style={s.none}>
              {q.trim().length < API.SEARCH_MIN
                ? `${API.SEARCH_MIN}글자부터 찾습니다`
                : "찾지 못했습니다"}
            </Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              {rows.map((h) => (
                <Pressable key={`${h.kind}-${h.id}`} style={s.row}
                           onPress={() => { Keyboard.dismiss(); onPick(h); clear(); }}>
                  {/* 지역인지 장소인지 **한눈에** — 누르면 가는 곳이 다르다 */}
                  <View style={[s.dot, {
                    backgroundColor: h.kind === "region" ? C.muted : catOf(h).c,
                  }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{h.name}</Text>
                    {h.sub ? <Text style={s.sub} numberOfLines={1}>{subText(h)}</Text> : null}
                  </View>
                  <Text style={s.kind}>{h.kind === "region" ? "지역" : "장소"}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 6 },
  bar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(22,24,31,0.96)",
    borderRadius: 12, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: 12, height: 40,
  },
  glass: { color: C.muted, fontSize: 16, marginTop: -1 },
  input: { flex: 1, color: C.text, fontSize: 14, padding: 0 },
  x: { color: C.muted, fontSize: 14 },
  panel: {
    marginTop: 6, maxHeight: 300,
    backgroundColor: "rgba(16,18,24,0.98)",
    borderRadius: 12, borderWidth: 1, borderColor: C.line,
    overflow: "hidden",
  },
  none: { color: C.muted, fontSize: 12.5, padding: 14, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { color: C.text, fontSize: 13.5 },
  sub: { color: C.muted, fontSize: 11, marginTop: 1 },
  kind: { color: C.muted, fontSize: 10.5 },
});
