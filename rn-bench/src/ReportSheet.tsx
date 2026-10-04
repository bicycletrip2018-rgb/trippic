/**
 * 신고·차단 시트 (§13.135)
 *
 * ★ App Store 가이드라인 1.2 는 사용자 콘텐츠가 있는 앱에 **신고**와 **차단**을
 *   요구한다. 없으면 반려다. 그런데 그건 심사 때문만은 아니다 — 남의 사진이
 *   보이는 화면을 열어 두고 *"싫으면 안 보면 되죠"* 라고 할 수는 없다.
 *
 * ★ **한 곳에 모아 둔다.** 소식·장소 상세 둘 다 남의 기록을 보여 주는데,
 *   거기에 각각 메뉴를 그리면 문구가 갈라지고 한쪽만 고치게 된다(§13.37).
 *
 * ★ **차단은 조용하다.** 상대에게 안 알리고, 상대는 자기가 막혔는지 모른다
 *   (072 가 `api_blocks` 를 내 줄로만 제한한다). 알 수 있으면 차단이
 *   **괴롭힘의 신호**가 된다.
 *
 * ★ 신고한 뒤 **무슨 일이 일어났는지 안 알린다.** 알리면 신고가 상대를
 *   떠보는 수단이 된다. 받았다는 것까지만 말한다.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { C } from "./theme";
import * as API from "./api";

export type Target = { pinId: string; userId: string | null } | null;

const REASONS = [
  "불쾌하거나 폭력적인 사진",
  "성적인 내용",
  "욕설·괴롭힘",
  "광고·도배",
  "내 사진을 무단으로 올렸습니다",
  "장소와 관계없는 사진",
];

export function ReportSheet(
  { target, onClose, onBlocked }:
  { target: Target; onClose: () => void; onBlocked?: (userId: string) => void },
) {
  const [step, setStep] = useState<"menu" | "reason" | "done">("menu");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!target) return null;
  const close = () => { setStep("menu"); setNote(""); setMsg(null); onClose(); };

  async function send(reason: string) {
    if (!target || busy) return;
    setBusy(true);
    const ok = await API.reportPin(target.pinId, reason);
    setBusy(false);
    /* ★ 실패해도 **왜**를 적는다. "잠시 뒤 다시"만 적으면 사용자는 영영
       다시 누르고, 한 시간에 20건 제한에 걸린 것인지도 모른다. */
    setMsg(ok ? "신고를 받았습니다. 확인 뒤 조치합니다."
              : "지금은 보낼 수 없습니다 — 한 시간에 20건까지 받습니다.");
    setStep("done");
  }

  async function block() {
    if (!target?.userId || busy) return;
    setBusy(true);
    const ok = await API.blockUser(target.userId);
    setBusy(false);
    if (ok) onBlocked?.(target.userId);
    setMsg(ok ? "이제 이 사람의 기록이 보이지 않습니다. 마이에서 풀 수 있습니다."
              : "지금은 차단할 수 없습니다.");
    setStep("done");
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable style={s.dim} onPress={close} />
      <View style={s.sheet}>
        <View style={s.grip} />
        {step === "menu" && (
          <>
            <Text style={s.title}>이 기록</Text>
            <Pressable style={s.row} onPress={() => setStep("reason")}>
              <Text style={s.rowT}>신고하기</Text>
              <Text style={s.rowS}>운영자가 보고 조치합니다</Text>
            </Pressable>
            {!!target.userId && (
              <Pressable style={s.row} onPress={() => void block()}>
                <Text style={s.rowT}>이 사람 차단하기</Text>
                <Text style={s.rowS}>기록이 더 이상 보이지 않습니다 · 상대는 모릅니다</Text>
              </Pressable>
            )}
            <Pressable style={[s.row, s.cancel]} onPress={close}>
              <Text style={s.cancelT}>닫기</Text>
            </Pressable>
          </>
        )}

        {step === "reason" && (
          <>
            <Text style={s.title}>무엇이 문제입니까</Text>
            {REASONS.map((r) => (
              <Pressable key={r} style={s.row} disabled={busy} onPress={() => void send(r)}>
                <Text style={s.rowT}>{r}</Text>
              </Pressable>
            ))}
            <TextInput
              style={s.input} value={note} onChangeText={setNote} maxLength={200}
              placeholder="직접 적기 (선택)" placeholderTextColor={C.muted} />
            {!!note.trim() && (
              <Pressable style={[s.row, s.send]} disabled={busy}
                         onPress={() => void send(note.trim())}>
                <Text style={s.sendT}>{busy ? "보내는 중…" : "적은 내용으로 신고"}</Text>
              </Pressable>
            )}
            <Pressable style={[s.row, s.cancel]} onPress={close}>
              <Text style={s.cancelT}>닫기</Text>
            </Pressable>
          </>
        )}

        {step === "done" && (
          <>
            <Text style={s.title}>{msg}</Text>
            <Pressable style={[s.row, s.send]} onPress={close}>
              <Text style={s.sendT}>확인</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: C.surface, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 34,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
  },
  grip: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: C.line,
    alignSelf: "center", marginBottom: 12,
  },
  title: { color: C.text, fontSize: 16, fontWeight: "700", marginBottom: 10, lineHeight: 23 },
  row: {
    paddingVertical: 13, borderTopWidth: 1, borderTopColor: C.line,
  },
  rowT: { color: C.text, fontSize: 15 },
  rowS: { color: C.muted, fontSize: 12, marginTop: 3 },
  input: {
    marginTop: 12, backgroundColor: C.bg, color: C.text, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14,
    borderWidth: 1, borderColor: C.line,
  },
  send: { alignItems: "center", marginTop: 10, borderTopWidth: 0 },
  sendT: {
    color: C.onAccent, backgroundColor: C.accent, fontSize: 15, fontWeight: "600",
    paddingVertical: 12, borderRadius: 11, textAlign: "center", overflow: "hidden", width: "100%",
  },
  cancel: { alignItems: "center", borderTopWidth: 0, marginTop: 2 },
  cancelT: { color: C.muted, fontSize: 15 },
});
