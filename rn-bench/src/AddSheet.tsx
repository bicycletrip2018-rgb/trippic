/**
 * (+) — **두 갈래로 가른다** (§13.53)
 *
 * ★ 이 둘은 편의상 나뉜 것이 아니라 **기준 좌표가 다르다**(§6.5):
 *     지금 찍기   → 기기 GPS  → `live`   (현장 인증이 붙는 **유일한** 길)
 *     앨범 정리   → 사진 EXIF → `exif`
 *   한 버튼 뒤에 숨기면 사용자는 왜 어떤 기록에만 뱃지가 붙는지 알 수 없다.
 *   **화면에서 갈라야 규칙이 보인다.**
 */
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "./theme";

export function AddSheet(
  { onClose, onLive, onAlbum }:
  { onClose: () => void; onLive: () => void; onAlbum: () => void },
) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.dim} onPress={onClose}>
        {/* 시트 안쪽 탭이 닫기로 새지 않게 막는다 */}
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.grip} />
          <Text style={s.title}>여행 추억 남기기</Text>

          <Pressable style={s.entry} onPress={onLive}>
            <Text style={s.icon}>📷</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.t}>지금 여기서 찍기</Text>
              <Text style={s.sub}>
                이 자리에서 찍고 지금 위치를 함께 남깁니다 —
                {" "}<Text style={s.em}>현장 인증이 붙습니다</Text>
              </Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </Pressable>

          <Pressable style={s.entry} onPress={onAlbum}>
            <Text style={s.icon}>🗂</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.t}>앨범에서 정리하기</Text>
              <Text style={s.sub}>
                찍어 두신 사진의 날짜와 위치로 지난 여행을 묶어 드립니다
              </Text>
            </View>
            <Text style={s.arrow}>›</Text>
          </Pressable>

          <Pressable style={s.cancel} onPress={onClose}>
            <Text style={s.cancelT}>그만두기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 34, gap: 10,
  },
  grip: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: C.line,
    alignSelf: "center", marginBottom: 6,
  },
  title: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 2 },
  entry: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
  },
  icon: { fontSize: 24 },
  t: { color: C.text, fontSize: 15, fontWeight: "700" },
  sub: { color: C.muted, fontSize: 12, marginTop: 3, lineHeight: 18 },
  em: { color: C.accent, fontWeight: "700" },
  arrow: { color: C.muted, fontSize: 20 },
  cancel: { alignItems: "center", paddingVertical: 13 },
  cancelT: { color: C.muted, fontSize: 14 },
});
