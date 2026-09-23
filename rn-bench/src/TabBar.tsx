import { Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "./theme";

export type Tab = "map" | "feed" | "news" | "space" | "my";
const TABS: [Tab, string, string][] = [
  ["map", "🗺️", "지도"], ["feed", "🧭", "갈 곳"], ["news", "📰", "소식"],
  ["space", "👥", "스페이스"], ["my", "👤", "마이"],
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
