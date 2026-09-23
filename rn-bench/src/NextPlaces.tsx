/**
 * "여기 간 사람들이 다음에 간 곳" (§13.33) — **못 보여줄 때 할 말이 있는 화면**
 *
 * ★ 이 조각의 값어치는 보여주는 데 있지 않고 **안 보여주는 데** 있다.
 *   근거가 모자랄 때 그럴듯한 다음 코스를 내놓으면 그건 우리가 지어낸 것이고,
 *   사용자는 그걸 믿고 일정을 짠다.
 * ★ 대신 **얼마나 모였는지**를 말한다. "아직 2팀입니다"는 지금 할 수 있는
 *   유일한 정직한 말이고, 동시에 "몇 명 쌓이면 되냐"에 대한 답이기도 하다.
 */
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as API from "./api";
import { C, CAT } from "./theme";

export function NextPlaces({ placeId }: { placeId: string }) {
  const [d, setD] = useState<API.NextPlaces | null>(null);
  useEffect(() => { void API.nextPlaces(placeId).then(setD); }, [placeId]);
  if (!d) return null;

  if (!d.ready || !d.rows.length) {
    return (
      <View style={s.wrap}>
        <Text style={s.t}>여기 다음에 어디로 갔는지</Text>
        {/* ★ 숫자를 그대로 보여준다 — "준비 중입니다"는 아무것도 말하지 않는다 */}
        <Text style={s.hint}>
          아직 {d.base}팀의 기록뿐입니다. {d.need}팀이 모이면 보여드립니다.{"\n"}
          같이 간 일행은 한 팀으로 셉니다.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.t}>여기 간 사람들이 다음에 간 곳</Text>
      {d.rows.map((r) => (
        <View key={r.place_id} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{r.name}</Text>
            <Text style={s.meta}>
              {CAT[r.category]?.k ?? r.category}
              {r.gap_min ? ` · 보통 ${r.gap_min}분 뒤` : ""}
            </Text>
          </View>
          {/* ★ 근거를 카드에 적는다 — 어디서 나온 순서인지 모르면 믿을 수도 의심할 수도 없다 */}
          <Text style={s.why}>{d.base}팀 중 {r.parties}팀</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 6,
  },
  t: { color: C.text, fontSize: 12.5, fontWeight: "700" },
  hint: { color: C.muted, fontSize: 11.5, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  name: { color: C.text, fontSize: 13, fontWeight: "600" },
  meta: { color: C.muted, fontSize: 11, marginTop: 1 },
  why: { color: C.warn, fontSize: 11, fontWeight: "600" },
});
