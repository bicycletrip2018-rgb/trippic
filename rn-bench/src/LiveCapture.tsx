/**
 * 지금 여기서 찍기 — **현장 인증을 얻는 유일한 화면** (§13.53)
 *
 * ★ 이 화면이 없던 동안 `verification='live'` 는 **얻을 수 없는 뱃지**였다.
 *   서버 제약(016)도, 뱃지를 그리는 코드(RecordTabs)도 이미 있었는데
 *   만들어 내는 길만 없었다.
 *
 * ★ **찍기 전에 무엇을 받는지 말한다.** 권한 팝업은 iOS 가 띄우지만, 그건
 *   "카메라를 쓰겠다"까지다. *왜* 위치까지 받는지, 그래서 무엇이 달라지는지는
 *   우리가 말해야 한다 — 안 하면 사용자는 거절하고, 거절하면 이 기능이 없다.
 */
import React, { useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import * as API from "./api";
import { capture, isFail, LIVE_ACCURACY_M, VIDEO_MAX_SEC, type Shot } from "./live";
import { C, CAT } from "./theme";

type Phase = "intro" | "shooting" | "detail" | "saving" | "done";

export function LiveCapture({ onClose }: { onClose: (saved?: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [shot, setShot] = useState<Shot | null>(null);
  const [place, setPlace] = useState<any | null>(null);
  const [cands, setCands] = useState<any[] | null>(null);
  const [memo, setMemo] = useState("");
  const [pub, setPub] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function shoot(kind: "photo" | "video") {
    setErr(null); setPhase("shooting");
    const r = await capture(kind);
    if (isFail(r)) {
      setPhase("intro");
      if (r.why) setErr(r.why);          // 취소는 why 가 빈 문자열 — 조용히 돌아간다
      return;
    }
    setShot(r); setPhase("detail");
    /* 장소 후보는 **찍은 좌표의 정확도로** 묻는다 — 소급 등록과 다른 점이다.
       기기가 15m 라고 하면 15m 짜리 후보를, 120m 라고 하면 그만큼 넓게 본다. */
    const c = await API.candidates(r.lat, r.lng, r.accuracyM, null, 0, 12);
    const list = c.ok ? (c.data || []) : [];
    setCands(list);
    /* ★ **가장 가까운 곳을 미리 골라 둔다**(§13.70). 기획 §4-B 는 자동 매칭이
       기본이라고 적었는데 우리는 매번 사람이 고르게 만들어 놨고, 그래서
       `place_id` 가 빈 핀이 쌓였다.
       ★ 현장 촬영은 **기기 GPS 정확도를 안다.** 그러니 문턱을 그 정확도에
         맞춘다 — 정확도가 20m 면 20m 안의 후보만 믿을 만하고, 120m 면
         무엇을 골라도 찍은 그 집이라는 보장이 없다.
       ★ 그래도 **사람이 바꿀 수 있다.** 미리 고른 것은 제안이지 결정이 아니다. */
    const top = list[0];
    if (top && (top.dist_m ?? 9999) <= Math.max(30, Math.min(r.accuracyM, 80))) {
      setPlace(top);
    }
  }

  async function save() {
    if (!shot) return;
    setPhase("saving"); setErr(null);
    const r: any = await API.pushLive(shot, {
      placeId: place?.place_id ?? place?.id ?? null,
      category: place?.category ?? null,
      memo: memo.trim() || null,
      isPublic: pub,
    });
    setResult(r);
    if (!r.ok && !r.pinId) { setErr(r.why || "저장하지 못했습니다"); setPhase("detail"); return; }
    setPhase("done");
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => onClose(false)}>
      <View style={s.root}>
        <View style={s.head}>
          <Pressable onPress={() => onClose(phase === "done")} hitSlop={12}>
            <Text style={s.headBtn}>✕</Text>
          </Pressable>
          <Text style={s.headTitle}>지금 여기</Text>
          <View style={{ width: 44 }} />
        </View>

        {phase === "intro" && (
          <ScrollView contentContainerStyle={s.body}>
            {/* ★ 고지를 **팝업 뒤로 숨기지 않는다.** 권한 팝업은 거절 버튼이 먼저 눈에
                들어온다 — 무엇을 얻는지 먼저 읽게 해야 허용을 누른다. */}
            <View style={s.note}>
              <Text style={s.noteT}>이 자리에서 찍은 것만 현장 인증이 붙습니다</Text>
              <Text style={s.noteB}>
                카메라를 열어 지금 찍고, 찍은 순간의 위치를 함께 받습니다.
                사진 파일에 적힌 위치는 읽지 않습니다 — 그건 고칠 수 있어서
                실제로 다녀왔다는 근거가 되지 못합니다.{"\n\n"}
                위치 정확도가 {LIVE_ACCURACY_M}m 를 넘으면 기록은 남지만
                현장 인증은 붙지 않습니다. 그 정도면 어느 장소인지 말할 수 없습니다.
              </Text>
            </View>

            <Pressable style={s.entry} onPress={() => shoot("photo")}>
              <Text style={s.entryIcon}>📷</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.entryT}>사진 찍기</Text>
                <Text style={s.entryS}>한 장으로 이 자리를 남깁니다</Text>
              </View>
              <Text style={s.entryArrow}>›</Text>
            </Pressable>

            <Pressable style={s.entry} onPress={() => shoot("video")}>
              <Text style={s.entryIcon}>🎬</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.entryT}>동영상 찍기</Text>
                <Text style={s.entryS}>{VIDEO_MAX_SEC}초까지 — 소리도 함께 담깁니다</Text>
              </View>
              <Text style={s.entryArrow}>›</Text>
            </Pressable>

            {!!err && <Text style={s.err}>{err}</Text>}
            <Text style={s.hint}>
              앨범에 있는 사진으로 지난 여행을 정리하시려면 ✕ 를 누르고
              {" "}‘앨범에서 정리하기’ 로 가십시오.
            </Text>
          </ScrollView>
        )}

        {(phase === "shooting" || phase === "saving") && (
          <View style={s.center}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.busy}>
              {phase === "shooting" ? "카메라를 엽니다…" : "올리는 중입니다…"}
            </Text>
          </View>
        )}

        {phase === "detail" && shot && (
          <ScrollView contentContainerStyle={s.body}>
            {/* ★ 뱃지를 받는지 **먼저** 말한다. 다 적고 나서 "인증 안 됐습니다"는 늦다. */}
            <View style={[s.badge, shot.liveOk ? s.badgeOk : s.badgeNo]}>
              <Text style={s.badgeT}>
                {shot.liveOk ? "현장 인증" : "현장 인증 없음"}
              </Text>
              <Text style={s.badgeS}>
                {shot.liveOk
                  ? `위치 정확도 ${Math.round(shot.accuracyM)}m — 이 기록에 현장 인증이 붙습니다.`
                  : `위치 정확도가 ${Math.round(shot.accuracyM)}m 입니다. 기록은 남지만 `
                    + `현장 인증은 붙지 않습니다 — 하늘이 트인 곳에서 다시 찍으시면 붙습니다.`}
              </Text>
            </View>

            <View style={s.note}>
              <Text style={s.noteT}>
                {shot.type === "video" ? "동영상" : "사진"} 1{shot.type === "video" ? "개" : "장"}
              </Text>
              <Text style={s.noteB}>
                {new Date(shot.takenAt).toLocaleString("ko-KR")}
                {shot.durationSec ? ` · ${shot.durationSec}초` : ""}
              </Text>
            </View>

            <Text style={s.rowK}>
              장소{place ? "" : cands?.length ? " — 골라 주십시오" : ""}
            </Text>
            {cands === null ? (
              <ActivityIndicator color={C.accent} />
            ) : !cands.length ? (
              <Text style={s.empty}>주변에서 찾은 장소가 없습니다 — 좌표만 남깁니다</Text>
            ) : (
              cands.map((c: any) => {
                const on = (place?.place_id ?? place?.id) === (c.place_id ?? c.id);
                return (
                  <Pressable key={c.place_id ?? c.id}
                             style={[s.card, on && s.cardOn]}
                             onPress={() => setPlace(on ? null : c)}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardT}>{c.name}</Text>
                      <Text style={s.cardS}>
                        {(CAT[c.category]?.k) || c.category || "기타"}
                        {c.dist_m != null ? ` · ${Math.round(c.dist_m)}m` : ""}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}

            <TextInput
              style={s.memo} value={memo} onChangeText={setMemo} multiline
              placeholder="한 줄 남기기 (선택)" placeholderTextColor={C.muted} />

            {/* ★ 장소를 안 고르면 공개할 수 없다(009) — 버튼을 막고 **이유를 적는다.** */}
            <Pressable style={s.pubRow} onPress={() => place && setPub(!pub)}>
              <View style={[s.box, pub && s.boxOn, !place && s.boxOff]} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowK}>모두의 지도에 올리기</Text>
                <Text style={s.hint}>
                  {place ? "이 장소를 찾는 사람에게 보입니다."
                         : "장소를 고르셔야 올릴 수 있습니다 — 좌표만으로는 어디인지 말할 수 없습니다."}
                </Text>
              </View>
            </Pressable>

            {!!err && <Text style={s.err}>{err}</Text>}
            <Pressable style={s.cta} onPress={save}>
              <Text style={s.ctaT}>저장하기</Text>
            </Pressable>
          </ScrollView>
        )}

        {phase === "done" && (
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.doneT}>
              {result?.ok ? "남겼습니다." : "기록은 남았습니다."}
            </Text>
            <Text style={s.noteB}>
              {result?.live
                ? "현장 인증이 붙었습니다 — 지도에서 이 기록에만 표시됩니다."
                : "현장 인증은 붙지 않았습니다."}
            </Text>
            {/* ★ 못 올린 것을 숨기지 않는다(§13.23 과 같은 규칙) */}
            {!result?.ok && !!result?.why && (
              <View style={s.note}>
                <Text style={s.noteT}>다만 사진은 올리지 못했습니다</Text>
                <Text style={s.noteB}>{result.why}</Text>
              </View>
            )}
            <Pressable style={s.cta} onPress={() => onClose(true)}>
              <Text style={s.ctaT}>닫기</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12,
    paddingTop: 56, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  headBtn: { color: C.muted, fontSize: 20, width: 44 },
  headTitle: { flex: 1, color: C.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  body: { padding: 14, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  busy: { color: C.text, fontSize: 14 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 18 },
  empty: { color: C.muted, fontSize: 14, textAlign: "center", paddingVertical: 8 },
  err: { color: C.warn, fontSize: 12 },
  note: { backgroundColor: C.surface, borderRadius: 12, padding: 14, gap: 6 },
  noteT: { color: C.text, fontSize: 13, fontWeight: "700" },
  noteB: { color: C.muted, fontSize: 12, lineHeight: 19 },
  entry: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface,
    borderRadius: 14, padding: 16,
  },
  entryIcon: { fontSize: 24 },
  entryT: { color: C.text, fontSize: 15, fontWeight: "700" },
  entryS: { color: C.muted, fontSize: 12, marginTop: 2 },
  entryArrow: { color: C.muted, fontSize: 20 },
  badge: { borderRadius: 12, padding: 14, gap: 4, borderWidth: 1 },
  badgeOk: { backgroundColor: "rgba(52,199,89,0.10)", borderColor: "rgba(52,199,89,0.45)" },
  badgeNo: { backgroundColor: C.surface, borderColor: C.line },
  badgeT: { color: C.text, fontSize: 13, fontWeight: "700" },
  badgeS: { color: C.muted, fontSize: 12, lineHeight: 19 },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.surface,
    borderRadius: 12, padding: 13, borderWidth: 1, borderColor: "transparent",
  },
  cardOn: { borderColor: C.accent },
  cardT: { color: C.text, fontSize: 14, fontWeight: "600" },
  cardS: { color: C.muted, fontSize: 12, marginTop: 3 },
  rowK: { color: C.text, fontSize: 13, fontWeight: "600" },
  memo: {
    backgroundColor: C.surface, borderRadius: 12, padding: 13, color: C.text,
    fontSize: 14, minHeight: 72, textAlignVertical: "top",
  },
  pubRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
    borderColor: C.line, marginTop: 1,
  },
  boxOn: { backgroundColor: C.accent, borderColor: C.accent },
  boxOff: { opacity: 0.4 },
  cta: { backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: "center" },
  ctaT: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  doneT: { color: C.text, fontSize: 16, fontWeight: "700", lineHeight: 24 },
});
