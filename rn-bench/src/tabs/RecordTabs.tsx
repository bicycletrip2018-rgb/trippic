/**
 * 탭3 소식 · 탭4 스페이스 · 탭5 마이 — 웹 home.js / spaces.js / my.js 이식
 *
 * 셋 다 **서버에서 읽은 기록**으로 채운다. 웹판이 씨앗으로 채우던 자리를
 * 여기서는 실제 `pins` 로 채운다 — 이식하면서 씨앗을 같이 들고 올 이유가 없다.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import * as API from "../api";
import { C, CAT } from "../theme";

type Pin = {
  id: string; category: string; visited_at: string; memo: string | null;
  verification: string; is_public: boolean; comment_count: number;
  geom: { coordinates: [number, number] } | null;
  media: { url: string; is_main: boolean; sort_order: number }[];
};
const cover = (p: Pin) =>
  p.media?.slice().sort((a, b) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order)[0]?.url;
const ymd = (s: string) => {
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

function useRecords(which: "public" | "mine") {
  const [rows, setRows] = useState<Pin[]>([]);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setBusy(true);
    const r = which === "mine" ? await API.myRecords(100) : await API.publicRecords(100);
    setRows((r.data as Pin[]) ?? []);
    setBusy(false);
  }, [which]);
  useEffect(() => { void load(); }, [load]);
  return { rows, busy, load };
}

/* ── 탭3 소식 ─────────────────────────────────────────────────
   ★ 포스트마다 **왜 내게 보이는지** 한 줄이 붙는다. 팔로우 그래프를 만들지 않으므로
     *"팔로우해서"* 라고 말할 수 없고, 그게 오히려 규칙이 됐다 —
     한 줄로 설명할 수 없으면 띄우지 않는다. */
export function NewsTab() {
  const { rows, busy, load } = useRecords("public");
  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.muted} />}>
      <Text style={s.h1}>소식</Text>
      <Text style={s.sub}>포스트마다 <Text style={s.b}>왜 내게 보이는지</Text> 적혀 있습니다.
        {" "}댓글은 없습니다 — 운영할 수 있는 만큼만 엽니다.</Text>
      {!rows.length && !busy && <Empty text="아직 공개된 기록이 없습니다." />}
      {rows.map((p) => (
        <View key={p.id} style={s.post}>
          <Text style={s.why}>공개된 기록입니다 · {(CAT[p.category] ?? CAT.etc).k}</Text>
          {cover(p) ? <Image source={{ uri: cover(p) }} style={s.postImg} /> : null}
          <View style={s.postFoot}>
            <Text style={s.date}>{ymd(p.visited_at)}</Text>
            <Text style={[s.badge, p.verification === "live" && s.badgeLive]}>
              {p.verification === "live" ? "현장 인증" : "사진 정보"}
            </Text>
          </View>
          {p.memo ? <Text style={s.memo}>{p.memo}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

/* ── 탭4 스페이스 ──────────────────────────────────────────────
   ★ 목록·초대만 있으면 파일 탐색기다. 스페이스의 화면은 **지도**여야 한다(§12.13).
     RN 에서는 아직 합산 지도를 못 그리므로 **숫자만** 먼저 옮긴다 —
     `함께 채운 N곳`은 합계가 아니라 **합집합**이다. */
export function SpaceTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await API.select<any[]>("spaces", "select=id,title,type&limit=50");
    setRows(r.data ?? []);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.muted} />}>
      <Text style={s.h1}>스페이스</Text>
      <Text style={s.sub}>스페이스는 <Text style={s.b}>사람</Text>입니다 — 여행마다 새로 만들지 않습니다.</Text>
      {!rows.length && !busy &&
        <Empty text={"아직 만든 스페이스가 없습니다.\n같이 간 사람과 지도를 함께 채워 보세요."} />}
      {rows.map((sp) => (
        <View key={sp.id} style={s.card}>
          <Text style={s.cardT}>{sp.title}</Text>
          <Text style={s.cardS}>{sp.type === "shared" ? "함께 쓰는 방" : sp.type}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

/* ── 탭5 마이 ─────────────────────────────────────────────────
   ★ 익명 계정은 **기기에 묶인다.** 그걸 화면이 말해야 한다 —
     말 안 하면 사용자는 **잃고 나서야** 안다. */
export function MyTab() {
  const { rows, busy, load } = useRecords("mine");
  const [trips, setTrips] = useState<any[]>([]);
  const [signing, setSigning] = useState(false);
  const [uid, setUid] = useState<string | null>(API.SESSION.user_id);

  useEffect(() => { void API.myTrips().then((r) => setTrips(r.data ?? [])); }, [rows.length]);

  async function start() {
    setSigning(true);
    const r = await API.signInAnonymously();
    setUid(API.SESSION.user_id);
    setSigning(false);
    if (r.ok) void load();
  }
  const photos = rows.reduce((n, p) => n + (p.media?.length ?? 0), 0);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.muted} />}>
      <Text style={s.h1}>마이</Text>

      <View style={s.box}>
        <Text style={s.boxT}>계정</Text>
        {uid ? (
          <>
            <Text style={s.boxV}>임시 계정 {uid.slice(0, 8)}…</Text>
            <Text style={s.warn}>앱을 지우거나 기기를 바꾸면 기록이 사라집니다.{"\n"}
              나중에 카카오·애플로 이어 두면 옮길 수 있습니다 — 지금은 준비 중입니다.</Text>
          </>
        ) : (
          <Pressable style={s.cta} onPress={start} disabled={signing}>
            <Text style={s.ctaT}>{signing ? "여는 중…" : "시작하기 (가입 없이)"}</Text>
            <Text style={s.ctaS}>계정을 만들지 않고 바로 씁니다</Text>
          </Pressable>
        )}
      </View>

      <View style={s.box}>
        <Text style={s.boxT}>서버에 있는 내 기록</Text>
        <Text style={s.big}>{rows.length.toLocaleString()}<Text style={s.bigU}>곳</Text></Text>
        <Text style={s.boxV}>사진 {photos.toLocaleString()}장 · 여행 {trips.length}개</Text>
        <Text style={s.dim}>{rows.length
          ? "기기를 바꿔도 여기서 다시 불러옵니다."
          : "아직 올라간 기록이 없습니다."}</Text>
      </View>

      {rows.slice(0, 12).map((p) => (
        <View key={p.id} style={s.rowItem}>
          {cover(p)
            ? <Image source={{ uri: cover(p) }} style={s.thumb} />
            : <View style={[s.thumb, { backgroundColor: "#222" }]} />}
          <View style={{ flex: 1 }}>
            <Text style={s.cardT} numberOfLines={1}>{p.memo || (CAT[p.category] ?? CAT.etc).k}</Text>
            <Text style={s.cardS}>{ymd(p.visited_at)} · {p.is_public ? "공개" : "나만 보기"}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const Empty = ({ text }: { text: string }) => (
  <View style={s.empty}><Text style={s.dim}>{text}</Text></View>
);

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  h1: { color: C.text, fontSize: 19, fontWeight: "700", paddingHorizontal: 18, paddingTop: 58 },
  sub: { color: C.muted, fontSize: 11.5, lineHeight: 18, paddingHorizontal: 18, paddingTop: 5, paddingBottom: 8 },
  b: { color: C.text, fontWeight: "700" },
  empty: { padding: 40, alignItems: "center" },
  dim: { color: C.muted, fontSize: 11.5, lineHeight: 18, textAlign: "center" },
  post: { marginTop: 16, borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 14 },
  why: { color: C.accent, fontSize: 11, fontWeight: "700", paddingHorizontal: 18, paddingBottom: 8 },
  postImg: { width: "100%", aspectRatio: 4 / 3, backgroundColor: "#222" },
  postFoot: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  date: { color: C.muted, fontSize: 11 },
  badge: { fontSize: 9.5, fontWeight: "700", color: C.muted, borderWidth: 1, borderColor: C.line,
           borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 },
  badgeLive: { color: C.accent, borderColor: C.accent },
  memo: { color: C.text, fontSize: 13, lineHeight: 21, paddingHorizontal: 18, paddingTop: 6 },
  card: { marginHorizontal: 18, marginTop: 8, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  cardT: { color: C.text, fontSize: 13.5, fontWeight: "650" as any },
  cardS: { color: C.muted, fontSize: 11, marginTop: 3 },
  box: { marginHorizontal: 18, marginTop: 10, padding: 15, borderRadius: 16, borderWidth: 1,
         borderColor: C.line, backgroundColor: "rgba(255,255,255,0.03)" },
  boxT: { color: C.muted, fontSize: 11.5 },
  boxV: { color: C.text, fontSize: 13, marginTop: 5 },
  big: { color: C.text, fontSize: 32, fontWeight: "800", marginTop: 4 },
  bigU: { fontSize: 15, fontWeight: "700" },
  warn: { color: C.warn, fontSize: 11, lineHeight: 18, marginTop: 8 },
  cta: { marginTop: 10, padding: 13, borderRadius: 13, backgroundColor: C.accent, alignItems: "center" },
  ctaT: { color: "#fff", fontSize: 13.5, fontWeight: "700" },
  ctaS: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 3 },
  rowItem: { flexDirection: "row", gap: 11, alignItems: "center", marginHorizontal: 18, marginTop: 8,
             padding: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  thumb: { width: 54, height: 54, borderRadius: 11 },
});
