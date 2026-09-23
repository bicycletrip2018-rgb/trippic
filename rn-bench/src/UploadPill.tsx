/**
 * 뒤에서 올라가는 것을 **보이게 한다** (§13.30)
 *
 * ★ 안 보이면 두 가지가 생긴다: 사용자는 다 올라간 줄 알고, 우리는 막힌 줄 모른다.
 *   '완료'라고 말한 뒤에 조용히 실패하는 것이 이 기능의 유일한 위험이다.
 * ★ 다 올라가면 사라진다. 할 말이 없을 때 자리를 차지하지 않는다.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Q from "./uploadQueue";
import { C } from "./theme";

export function UploadPill() {
  const [st, setSt] = useState(Q.status());
  useEffect(() => Q.subscribe(() => setSt(Q.status())), []);

  const { left, stuck, running } = st;
  if (!left && !stuck) return null;

  return (
    <View style={s.wrap} pointerEvents="box-none">
      {stuck > 0 ? (
        <Pressable style={[s.pill, s.bad]} onPress={() => void Q.retryStuck()}>
          <Text style={s.t}>사진 {stuck}장을 못 올렸습니다 · 다시 시도</Text>
        </Pressable>
      ) : (
        <View style={s.pill}>
          <Text style={s.t}>
            사진 {left}장 올리는 중{running ? "" : " · 잠시 멈춤"}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 96, alignItems: "center" },
  pill: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: "rgba(22,24,31,0.94)", borderWidth: 1, borderColor: C.line,
  },
  bad: { borderColor: C.warn },
  t: { color: C.text, fontSize: 12, fontWeight: "600" },
});
