/**
 * 계정 지우기 (§13.138)
 *
 * ★ App Store **5.1.1(v)**: 계정을 만들 수 있는 앱은 **앱 안에서 계정 삭제**도
 *   제공해야 한다. 우리는 첫 실행에 익명 계정을 자동으로 만든다 — 해당된다.
 *
 * ★ **되돌릴 수 없는 일에는 되돌릴 수 없다고 적는다.** 그리고 **한 번 더 묻는다** —
 *   다만 "정말요?" 를 두 번 띄우는 것은 묻는 게 아니라 **귀찮게 하는 것**이다.
 *   무엇이 사라지는지를 **세어서 보여 주고** 확인을 받는다.
 *
 * ★ 지우는 중에는 **끄지 말라고 말한다.** 파일을 하나씩 지우므로 중간에 끄면
 *   사진 일부가 남는다. 다시 눌러 주시면 이어서 지워진다 — 그것도 적는다.
 */
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "./theme";
import * as API from "./api";

export function DangerZone(
  { counts, onDone }: { counts: { places: number; photos: number }; onDone: () => void },
) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(false);

  async function go() {
    setBusy(true); setFail(false);
    const ok = await API.deleteAccount();
    setBusy(false);
    if (!ok) { setFail(true); return; }
    setOpen(false);
    onDone();
  }

  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 26 }}>
      <Pressable onPress={() => setOpen(true)} hitSlop={8}>
        <Text style={s.link}>계정 지우기</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade"
             onRequestClose={() => { if (!busy) setOpen(false); }}>
        <View style={s.dim}>
          <View style={s.box}>
            <Text style={s.h}>계정을 지웁니다</Text>
            {/* ★ **무엇이 사라지는지 센다.** "모든 데이터"라고만 적으면
                사용자는 자기가 무엇을 잃는지 모른 채 누른다. */}
            <Text style={s.p}>
              기록 <Text style={s.b}>{counts.places}곳</Text> ·
              사진 <Text style={s.b}>{counts.photos}장</Text>과 계정이 함께 사라집니다.
              {"\n"}<Text style={s.warn}>되돌릴 수 없습니다.</Text>
            </Text>
            <Text style={s.small}>
              다른 분과 함께 채운 지도에서도 내 기록이 빠집니다.
              {"\n"}지우는 동안 앱을 끄지 말아 주십시오 — 끄시면 사진 일부가 남고,
              다시 누르시면 이어서 지워집니다.
            </Text>
            {fail && (
              <Text style={s.err}>
                지우지 못했습니다. 망을 확인하고 다시 눌러 주십시오.
                계속 안 되면 bicycletrip2018@gmail.com 으로 말씀해 주십시오.
              </Text>
            )}

            {busy ? (
              <View style={s.busy}>
                <ActivityIndicator color={C.accent} />
                <Text style={s.small}>지우는 중입니다…</Text>
              </View>
            ) : (
              <>
                <Pressable style={s.danger} onPress={() => void go()}>
                  <Text style={s.dangerT}>지웁니다</Text>
                </Pressable>
                <Pressable style={s.cancel} onPress={() => setOpen(false)}>
                  <Text style={s.cancelT}>그만두기</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  link: { color: C.warn, fontSize: 12.5, textDecorationLine: "underline" },
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  box: { backgroundColor: C.surface, borderRadius: 16, padding: 20 },
  h: { color: C.text, fontSize: 18, fontWeight: "700" },
  p: { color: C.muted, fontSize: 14.5, lineHeight: 22, marginTop: 10 },
  b: { color: C.text, fontWeight: "700" },
  warn: { color: C.warn, fontWeight: "700" },
  small: { color: C.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
  err: { color: C.warn, fontSize: 12.5, lineHeight: 19, marginTop: 12 },
  busy: { alignItems: "center", gap: 8, paddingVertical: 18 },
  danger: {
    marginTop: 18, borderRadius: 12, paddingVertical: 13, alignItems: "center",
    borderWidth: 1.5, borderColor: C.warn,
  },
  dangerT: { color: C.warn, fontSize: 15, fontWeight: "700" },
  cancel: { paddingVertical: 12, alignItems: "center" },
  cancelT: { color: C.text, fontSize: 15, fontWeight: "600" },
});
