/**
 * 탭3 소식 · 탭4 스페이스 · 탭5 마이 — 웹 home.js / spaces.js / my.js 이식
 *
 * 셋 다 **서버에서 읽은 기록**으로 채운다. 웹판이 씨앗으로 채우던 자리를
 * 여기서는 실제 `pins` 로 채운다 — 이식하면서 씨앗을 같이 들고 올 이유가 없다.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View,
} from "react-native";
import * as API from "../api";
import { C, CAT } from "../theme";
import { DayCourse } from "../DayCourse";
import { openSocial } from "../oauth";
import { isAvailable as appleAvailable, signInWithApple } from "../appleAuth";
import { Alert } from "react-native";

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
/* ★ 카카오톡으로 보내는 데 **카카오 SDK 도 로그인도 필요 없다**(§13.43).
   코어 `Share` 가 OS 공유 시트를 열고, 카카오톡은 거기 이미 들어 있다.
   ★ 받는 사람이 열 주소는 **웹**이어야 한다 — 앱을 안 깐 사람도 열어야 초대가 초대다. */
const INVITE_BASE = "http://localhost:3012/index.html";   // 배포되면 실제 주소로 바꾼다

export async function shareInvite(spaceId: string) {
  const r = await API.inviteLink(spaceId, INVITE_BASE);
  if (!r.ok) return { ok: false, why: r.why };
  try {
    await Share.share({ message: `${r.title} — 같이 채운 지도를 보내 드립니다.\n${r.url}`,
                        url: r.url });
    return { ok: true };            // 어디로 보냈는지는 우리가 알 필요 없다
  } catch (e: any) {
    return { ok: false, why: String(e?.message ?? e) };
  }
}

export function SpaceTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
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
      {/* ★ `card` 는 다른 탭도 쓴다 — 거기에 flexDirection 을 넣으면 남의 화면이
          같이 바뀐다. 줄 배치는 `spaceRow` 로 **여기서만** 한다. */}
      {rows.map((sp) => (
        <View key={sp.id} style={[s.card, s.spaceRow]}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardT}>{sp.title}</Text>
            <Text style={s.cardS}>{sp.type === "shared" ? "함께 쓰는 방" : "나만 보는 기록"}</Text>
          </View>
          {/* ★ 개인 공간에는 초대가 없다 — 부를 사람이 없는 방이다 */}
          {sp.type === "shared" && (
            <Pressable style={s.invite} onPress={async () => {
              const r = await shareInvite(sp.id);
              if (!r.ok) setMsg(r.why ?? "보내지 못했습니다");
            }}>
              <Text style={s.inviteT}>초대</Text>
            </Pressable>
          )}
        </View>
      ))}
      {!!msg && <Text style={s.warn}>{msg}</Text>}
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
  const [course, setCourse] = useState(false);
  /* ★ 켜져 있는 것만 보여 준다 — 꺼져 있는데 버튼을 두면 누른 사람이
     `Unsupported provider` 를 본다 (§13.41). */
  const [socials, setSocials] = useState<API.Social[]>([]);
  const [kakaoMsg, setKakaoMsg] = useState<string | null>(null);
  const [appleNative, setAppleNative] = useState(false);
  useEffect(() => {
    void API.providers().then((p) => setSocials(API.SOCIALS.filter((k) => p[k])));
    /* ★ 애플은 **기기가 되는지**도 본다. provider 가 켜져 있어도 이 기기에서
       안 되면(안드로이드·구형 iOS) 버튼을 두면 안 된다. */
    void appleAvailable().then(setAppleNative).catch(() => setAppleNative(false));
  }, []);

  /* ★ 네이티브 애플은 계정을 **얹지 못하고 바꾼다**(§13.45). 그래서 §13.39 의
     경고와 §13.40 의 합치기가 여기 붙는다 — 말없이 두고 가면 안 된다. */
  const askSwitch = (what: { pins: number; photos: number; spaces: number }) =>
    new Promise<"merge" | "leave" | "cancel">((resolve) => {
      const line = `기록 ${what.pins}곳 · 사진 ${what.photos}장`
        + (what.spaces ? ` · 스페이스 ${what.spaces}곳` : "");
      Alert.alert("이 기기의 임시 계정", `${line}이 있습니다.`, [
        { text: "함께 옮기기", onPress: () => resolve("merge") },
        { text: "두고 가기", style: "destructive", onPress: () => resolve("leave") },
        { text: "그만두기", style: "cancel", onPress: () => resolve("cancel") },
      ], { cancelable: false });
    });

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

      {/* ★ 하루 코스는 **내 기록에서 복원**된다 — 그래서 '갈 곳'이 아니라 '마이'에 있다.
          추천이면 탭2 가 맞지만, 이건 있었던 일이다. */}
      <Pressable style={s.box} onPress={() => setCourse(true)}>
        <Text style={s.boxT}>내 하루</Text>
        <Text style={s.boxV}>사진에서 복원한 그날의 순서 · 체류 · 이동 ›</Text>
      </Pressable>
      {course && <DayCourse onClose={() => setCourse(false)} />}

      {/* 카카오로 이어 두기 — 계정 id 가 그대로라 아무것도 옮기지 않는다(§13.41) */}
      {!!socials.length && uid && (
        <View style={s.box}>
          <Text style={s.boxT}>계정 이어 두기</Text>
          <Text style={s.boxV}>
            지금 계정에 얹습니다. 기록은 그대로 있고, 다른 기기에서 같은 곳으로
            들어오시면 됩니다.
          </Text>
          {/* ★ provider 마다 칸을 복사하지 않는다 — 하나 늘 때마다 문구가 갈라진다 */}
          {socials.map((k) => (
            <Pressable key={k} style={s.cta} onPress={async () => {
              setKakaoMsg(`${API.provName(k)}로 이동합니다…`);
              const r = await openSocial(k, "link");
              if (!r.ok) setKakaoMsg(r.why ?? "열지 못했습니다");
            }}>
              <Text style={s.ctaT}>{API.provName(k)}로 이어 두기</Text>
            </Pressable>
          ))}
          {!!kakaoMsg && <Text style={s.warn}>{kakaoMsg}</Text>}
        </View>
      )}

      {/* ★ 네이티브 애플 — 6개월 키 갱신이 없는 쪽(§13.45). provider 가 켜져 있고
          **이 기기가 지원할 때만** 보인다. */}
      {socials.includes("apple") && appleNative && (
        <View style={s.box}>
          <Text style={s.boxT}>애플로 들어가기</Text>
          <Text style={s.boxV}>
            이 기기의 애플 계정으로 들어갑니다. 다른 기기에서도 같은 기록이 보입니다.
          </Text>
          <Pressable style={s.cta} onPress={async () => {
            setKakaoMsg(null);
            const r = await signInWithApple(askSwitch);
            if ((r as any).cancelled) return;
            if (!r.ok) return setKakaoMsg(r.why ?? "들어가지 못했습니다");
            const mv: any = (r as any).moved;
            setKakaoMsg("들어왔습니다."
              + (mv?.failed ? ` 다만 옮기지 못했습니다 — ${mv.failed}`
                 : mv ? ` 기록 ${mv.pins}곳을 함께 옮겼습니다.` : ""));
            setUid(API.SESSION.user_id);
            void load();
          }}>
            <Text style={s.ctaT}>애플로 들어가기</Text>
          </Pressable>
        </View>
      )}

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
  badgeLive: { color: C.visited, borderColor: C.visited },
  memo: { color: C.text, fontSize: 13, lineHeight: 21, paddingHorizontal: 18, paddingTop: 6 },
  card: { marginHorizontal: 18, marginTop: 8, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  spaceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  invite: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10,
           backgroundColor: "rgba(255,255,255,0.10)" },
  inviteT: { color: C.text, fontSize: 12.5, fontWeight: "700" },
  cardT: { color: C.text, fontSize: 13.5, fontWeight: "650" as any },
  cardS: { color: C.muted, fontSize: 11, marginTop: 3 },
  box: { marginHorizontal: 18, marginTop: 10, padding: 15, borderRadius: 16, borderWidth: 1,
         borderColor: C.line, backgroundColor: "rgba(255,255,255,0.03)" },
  boxT: { color: C.muted, fontSize: 11.5 },
  boxV: { color: C.text, fontSize: 13, marginTop: 5 },
  big: { color: C.visited, fontSize: 32, fontWeight: "800", marginTop: 4 },
  bigU: { fontSize: 15, fontWeight: "700" },
  warn: { color: C.warn, fontSize: 11, lineHeight: 18, marginTop: 8 },
  cta: { marginTop: 10, padding: 13, borderRadius: 13, backgroundColor: C.accent, alignItems: "center" },
  ctaT: { color: C.onAccent, fontSize: 13.5, fontWeight: "700" },
  ctaS: { color: "rgba(4,35,58,0.75)", fontSize: 11, marginTop: 3 },
  rowItem: { flexDirection: "row", gap: 11, alignItems: "center", marginHorizontal: 18, marginTop: 8,
             padding: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  thumb: { width: 54, height: 54, borderRadius: 11 },
});
