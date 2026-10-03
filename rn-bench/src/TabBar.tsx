import { Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "./theme";

/* ★ `space` 를 **내렸다**(§13.114). 보는 일은 탭1 의 `공유 스페이스` 칩이 이미
   하고 있었고, 방 관리(초대·이름·숫자)는 그 칩의 고르는 창으로 옮겼다. */
export type Tab = "map" | "feed" | "news" | "my";
const TABS: [Tab, string, string][] = [
  ["map", "🗺️", "지도"], ["feed", "🧭", "갈 곳"],
  ["news", "📰", "소식"], ["my", "👤", "마이"],
];

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={s.bar}>
      {TABS.map(([id, icon, label]) => (
        <Pressable key={id} style={[s.btn, tab === id && s.on]} onPress={() => onChange(id)}>
          <Text style={s.icon}>{icon}</Text>
          <Text style={[s.label, tab === id && s.labelOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    position: "absolute", left: 14, right: 14, bottom: 26, flexDirection: "row",
    padding: 6, borderRadius: 18, gap: 4,
    backgroundColor: "rgba(22,24,31,0.92)", borderWidth: 1, borderColor: C.line,
  },
  btn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 13, gap: 3 },
  on: { backgroundColor: "rgba(255,255,255,0.13)" },
  icon: { fontSize: 16 },
  label: { fontSize: 10.5, fontWeight: "600", color: C.muted },
  labelOn: { color: C.text },
});
