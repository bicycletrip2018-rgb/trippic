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
import React, { useEffect, useRef, useState } from "react";
import { useTopPad } from "./safeArea";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as API from "./api";
import { capture, isFail, LIVE_ACCURACY_M, VIDEO_MAX_SEC, type Shot } from "./live";
import { C, CAT } from "./theme";

type Phase = "intro" | "shooting" | "detail" | "saving" | "done";

export function LiveCapture({ onClose }: { onClose: (saved?: boolean) => void }) {
  const topPad = useTopPad(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [shot, setShot] = useState<Shot | null>(null);
  const [place, setPlace] = useState<any | null>(null);
  const [cands, setCands] = useState<any[] | null>(null);
  const [memo, setMemo] = useState("");
  /* ★ **후보에 없는 자리를 부를 이름**(090). 먹자골목·공터·전망대 — 상호 표에
     없는 곳은 많다. 이게 없던 동안 사용자는 «한 줄 남기기» 에 이름을 적었고,
     그건 메모라서 지도가 줌에 따라 상호와 번갈아 보여 주었다. */
  const [label, setLabel] = useState("");
  const [labelOn, setLabelOn] = useState(false);
  /* ★ **적는 동안 찾아 준다**(§13.169). 사용자: *"텍스트로 장소 쓸 때 해당
     위치가 위 목록에 있으면 자동으로 같은 검색어로 보이게 만드는 게 편하지
     않을까."* 더 나아가 **목록에 없어도** 찾는다 — 「북한산」처럼 서 있는
     자리에서 몇 km 떨어진 곳은 후보 반경에 애초에 안 들어온다. */
  const [found, setFound] = useState<any[] | null>(null);
  const seq = useRef(0);
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
    /* ★ **1등이라는 사실에 뜻이 있을 때만** 고른다(§13.166).
       예전 규칙은 *"정확도 안에 들면 1등을 고른다"* 였다. 먹자골목 한복판에서는
       16m 안에 가게가 **열 곳**이다 — 그중 1등은 GPS 오차가 뽑은 제비일 뿐인데,
       말없이 골라 두니 사용자 기록에 **가 본 적 없는 가게**가 붙었다.
       사용자: *"나는 전화방 같은 곳을 가본 적도 없는데 이렇게 오류가 생겼어."*
       → 2등이 1등과 **구별이 안 되게 가까우면**(15m 안) 고르지 않는다.
         기계가 모르는 것을 아는 척하지 않는 것이 맞다. 대신 아래 버튼이
         *"장소 없이 저장하기"* 라고 **적어서** 사용자가 알고 넘어가게 한다. */
    const top = list[0], second = list[1];
    const near = top && (top.dist_m ?? 9999) <= Math.max(30, Math.min(r.accuracyM, 80));
    const tied = second && (second.dist_m ?? 9999) <= (top?.dist_m ?? 0) + 15;
    if (near && !tied) setPlace(top);
  }

  /* 적는 대로 찾는다. ★ **마지막 요청만** 쓴다 — 빨리 치면 앞선 응답이 나중에
     와서 «세 글자 결과» 가 «다섯 글자 결과» 를 덮는다(§13.72 와 같은 자리). */
  useEffect(() => {
    const q = label.trim();
    if (!labelOn || q.length < API.SEARCH_MIN || !shot) { setFound(null); return; }
    const my = ++seq.current;
    const keep = (rows: any[]) =>
      /* 지역(읍·면·리)과 시군구는 뺀다 — 여기서 고르는 것은 **장소**다 */
      rows.filter((h: any) => h.kind === "place" && !h.is_area);
    const t = setTimeout(() => {
      void (async () => {
        const near = await API.search(q, 8, { lat: shot.lat, lng: shot.lng });
        let rows = near.ok ? keep(near.data ?? []) : [];
        /* ★ **가까이서 못 찾으면 전국에서 찾는다.** 「북한산」을 적는 사람이
           늘 북한산 1.5km 안에 있지는 않다 — 산·공원은 점 하나가 수 km 를
           대표한다. 멀면 거리를 **적어서** 보여 주고 판단은 사람이 한다. */
        if (!rows.length) {
          const far = await API.search(q, 8, null);
          rows = far.ok ? keep(far.data ?? []) : [];
        }
        if (my !== seq.current) return;
        setFound(rows);
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [label, labelOn, shot]);

  async function save() {
    if (!shot) return;
    setPhase("saving"); setErr(null);
    const r: any = await API.pushLive(shot, {
      placeId: place?.place_id ?? place?.id ?? null,
      category: place?.category ?? null,
      memo: memo.trim() || null,
      placeLabel: labelOn ? (label.trim() || null) : null,
      isPublic: pub,
    });
    setResult(r);
    if (!r.ok && !r.pinId) { setErr(r.why || "저장하지 못했습니다"); setPhase("detail"); return; }
    setPhase("done");
  }

  /* 지금 이 기록이 **무엇으로 불릴지.** 직접 적은 이름이 먼저다(090 과 같은 순서) */
  const chosen = (labelOn ? label.trim() : "") || place?.name || "";

  return (
    <Modal visible animationType="slide" onRequestClose={() => onClose(false)}>
      {/* ★ **키보드가 입력란을 통째로 가렸다**(§13.166). 사용자가 «한 줄 남기기» 를
          누르자 키보드가 올라오면서 **적고 있는 칸이 그 아래로 들어갔다** —
          무엇을 치는지 보이지 않는 채로 적어야 했다.
          ★ 안드로이드의 `adjustResize` 는 **`Modal` 안에서는 안 듣는다** —
            모달이 제 창을 따로 들기 때문이다. 그래서 직접 비켜 준다. */}
      <KeyboardAvoidingView style={s.root}
                            behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[s.head, { paddingTop: topPad }]}>
          <Pressable onPress={() => onClose(phase === "done")} hitSlop={12}>
            <Text style={s.headBtn}>✕</Text>
          </Pressable>
          <Text style={s.headTitle}>지금 여기</Text>
          <View style={{ width: 44 }} />
        </View>

        {phase === "intro" && (
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
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
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
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
              장소{chosen ? "" : cands?.length ? " — 골라 주십시오" : ""}
            </Text>
            <Text style={s.hint}>여기가 어디인지. 아래에서 고르거나 직접 적습니다.</Text>
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
                             onPress={() => {
                               setPlace(on ? null : c); setLabelOn(false);
                               if (on) setPub(false);   // 장소가 빠지면 공개도 빠진다
                             }}>
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

            {/* ★ **후보에 없는 자리**를 부를 길(090). 목록 맨 뒤에 둔다 —
                위에 두면 고를 수 있는 것이 있는데도 직접 적게 만든다. */}
            <Pressable style={[s.card, labelOn && s.cardOn]}
                       onPress={() => {
                         setLabelOn(!labelOn);
                         if (!labelOn) { setPlace(null); setPub(false); }
                       }}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardT}>여기 없음 — 이름을 직접 적겠습니다</Text>
                <Text style={s.cardS}>먹자골목·공터·전망대처럼 상호가 없는 자리</Text>
              </View>
            </Pressable>
            {labelOn && (
              <TextInput
                style={s.name} value={label} onChangeText={setLabel} maxLength={60}
                placeholder="이 자리의 이름 — 예: 방이동 먹자골목"
                placeholderTextColor={C.muted} />
            )}
            {/* ★ 적는 동안 찾아 준다. **고르면 진짜 장소**가 되어 「모두의 지도」에도
                올릴 수 있다 — 직접 적은 이름으로는 못 올린다(009). */}
            {labelOn && found !== null && (
              found.length ? (
                <>
                  <Text style={s.hint}>이 이름으로 찾았습니다 — 맞으면 고르십시오</Text>
                  {found.map((h: any) => (
                    <Pressable key={h.id} style={s.card}
                               onPress={() => {
                                 setPlace({ place_id: h.id, id: h.id, name: h.name,
                                            category: h.category });
                                 setLabelOn(false); setPub(false);
                               }}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cardT}>{h.name}</Text>
                        <Text style={s.cardS}>
                          {(CAT[h.category]?.k) || h.category || "기타"}
                          {h.dist_m != null ? ` · ${h.dist_m >= 1000
                            ? `${(h.dist_m / 1000).toFixed(1)}km` : `${Math.round(h.dist_m)}m`}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : (
                <Text style={s.hint}>
                  찾은 장소가 없습니다 — 적으신 이름 그대로 남깁니다.
                </Text>
              )
            )}

            {/* ★ **이름 칸과 메모 칸이 구별이 안 됐다**(§13.168). 사용자:
                *"한 줄 남기기는 장소를 선택하고도 쓸 수 있는 간단한 메모 느낌인가?
                  위치 이름을 적는 건지 내 추억을 적는 건지 헷갈려할 사람이 많을 것 같아."*
                맞는 지적이다 — 둘 다 «한 줄 적는 칸» 으로 생겼고, 안내 문구가 없었다.
                애초에 사용자가 장소 이름을 **메모에 적었던** 것도 이 때문이다.
                → 메모에도 **제목과 한 줄 설명**을 준다. 장소 칸과 같은 모양으로
                  세워 두면 *"이건 다른 질문이구나"* 가 보인다. */}
            <Text style={s.rowK}>이 순간 한 줄</Text>
            <Text style={s.hint}>
              장소 이름이 아니라, 그때 어땠는지 적는 곳입니다. 비워 두셔도 됩니다.
            </Text>
            <TextInput
              style={s.memo} value={memo} onChangeText={setMemo} multiline
              placeholder="예: 노을 질 때 갔더니 사람이 없었다"
              placeholderTextColor={C.muted} />

            {/* ★ 장소를 안 고르면 공개할 수 없다(009) — 버튼을 막고 **이유를 적는다.** */}
            <Pressable style={s.pubRow} onPress={() => place && setPub(!pub)}>
              <View style={[s.box, pub && s.boxOn, !place && s.boxOff]} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowK}>모두의 지도에 올리기</Text>
                <Text style={s.hint}>
                  {place ? "이 장소를 찾는 사람에게 보입니다."
                   /* ★ 직접 적은 이름으로는 못 올린다(090·009). **왜인지 적는다** —
                      "안 됩니다"만 쓰면 버그로 읽힌다. */
                   : labelOn
                     ? "직접 적으신 이름은 올릴 수 없습니다 — 그 자리가 맞는지 확인할 길이 없습니다. 내 지도에는 남습니다."
                     : "장소를 고르셔야 올릴 수 있습니다 — 좌표만으로는 어디인지 말할 수 없습니다."}
                </Text>
              </View>
            </Pressable>

            {!!err && <Text style={s.err}>{err}</Text>}
            {/* ★ **버튼이 무엇을 할지 적는다**(§13.166). 고른 장소는 목록 맨 위에
                있어서, 스크롤을 내린 사용자는 **무엇이 골라졌는지 볼 수조차 없었다.**
                요약을 또 하나 얹는 대신 **누를 것 자체가 말하게** 한다 —
                여기는 반드시 지나가는 자리다. */}
            <Pressable style={s.cta} onPress={save}>
              <Text style={s.ctaT} numberOfLines={1}>
                {chosen ? `${chosen}에 저장하기` : "장소 없이 저장하기"}
              </Text>
            </Pressable>
            {!chosen && (
              <Text style={s.hint}>
                좌표만 남습니다 — 지도에는 보이지만 «어디였는지» 는 적히지 않습니다.
              </Text>
            )}
          </ScrollView>
        )}

        {phase === "done" && (
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
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
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  head: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line,
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
  /* 이름은 **한 줄**이다 — 여러 줄 칸을 주면 메모와 구분이 안 간다 */
  name: {
    backgroundColor: C.surface, borderRadius: 12, padding: 13, color: C.text,
    fontSize: 14, borderWidth: 1, borderColor: C.accent,
  },
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
