/**
 * 탭3 소식 · 탭4 스페이스 · 탭5 마이 — 웹 home.js / spaces.js / my.js 이식
 *
 * 셋 다 **서버에서 읽은 기록**으로 채운다. 웹판이 씨앗으로 채우던 자리를
 * 여기서는 실제 `pins` 로 채운다 — 이식하면서 씨앗을 같이 들고 올 이유가 없다.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import * as API from "../api";
import { C, CAT } from "../theme";
import { DayCourse } from "../DayCourse";
import { openSocial } from "../oauth";
import { isAvailable as appleAvailable, signInWithApple } from "../appleAuth";
import { Alert } from "react-native";

type Pin = {
  /** PostgREST 가 FK 를 따라 붙여 주는 장소 이름(§13.89). 핀마다 따로 묻지 않는다. */
  places?: { name?: string | null } | null;
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

export function SpaceTab({ onOpenMap }: { onOpenMap?: (spaceId: string) => void } = {}) {
  const [rows, setRows] = useState<API.SpaceRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  /* 이름을 고치는 중인 방. 한 번에 하나만 열린다. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    const r = await API.mySpaces();
    setRows(r.ok ? (r.data ?? []) : []);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rename = async (sp: API.SpaceRow) => {
    const next = draft.trim();
    setEditing(null);
    if (next === sp.title) return;
    const r: any = await API.renameSpace(sp.id, next);
    if (!r?.ok) { setMsg(r?.why ?? "바꾸지 못했습니다"); return; }
    setRows((prev) => prev.map((x) =>
      x.id === sp.id ? { ...x, title: r.title, auto_title: !!r.auto } : x));
  };

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.muted} />}>
      <Text style={s.h1}>스페이스</Text>
      <Text style={s.sub}>스페이스는 <Text style={s.b}>사람</Text>입니다 — 여행마다 새로 만들지 않습니다.</Text>

      {!rows.length && !busy &&
        <Empty text={"아직 만든 스페이스가 없습니다.\n같이 간 사람과 지도를 함께 채워 보세요."} />}

      {/* ★ **목록이 아니라 성적표다**(§12.13). 제목과 초대 버튼만 있으면
          파일 탐색기지 *"함께 채운 지도"* 가 아니다. 그래서 줄마다
          **함께 채운 기록 수와 지역 수**를 적고, 누르면 지도로 데려간다.
          ★ 지도를 여기 한 벌 더 그리지 않는다 — 지도는 탭1 하나뿐이고,
            §13.55 의 `공유 스페이스` 스코프가 이미 그 방만 보여 준다.
            같은 것을 두 곳에서 그리면 언젠가 둘이 갈라진다(§13.37). */}
      {rows.map((sp) => (
        <View key={sp.id} style={s.card}>
          {editing === sp.id ? (
            <View style={s.renameRow}>
              <TextInput
                style={s.renameIn} value={draft} onChangeText={setDraft}
                autoFocus maxLength={40} returnKeyType="done"
                onSubmitEditing={() => { void rename(sp); }}
                placeholder="비우면 멤버 이름으로 돌아갑니다"
                placeholderTextColor={C.muted} />
              <Pressable onPress={() => { void rename(sp); }} style={s.renameOk}>
                <Text style={s.renameOkT}>확인</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={s.spaceRow} onPress={() => onOpenMap?.(sp.id)}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardT}>{sp.title}</Text>
                <Text style={s.cardS}>
                  멤버 {sp.members}명
                  {sp.pins ? ` · 함께 채운 ${sp.pins}곳` : " · 아직 기록 없음"}
                  {sp.regions ? ` · ${sp.regions}개 지역` : ""}
                </Text>
              </View>
              <Text style={s.spaceGo}>지도 ›</Text>
            </Pressable>
          )}

          <View style={s.spaceActs}>
            {/* ★ 이름 바꾸기는 **멤버 누구나**(§13.56). 서버에 문은 있었는데
                여기 손잡이가 없어서 아무도 못 썼다. */}
            <Pressable onPress={() => { setEditing(sp.id); setDraft(sp.auto_title ? "" : sp.title); }}>
              <Text style={s.spaceAct}>이름 바꾸기</Text>
            </Pressable>
            <Pressable onPress={async () => {
              const r = await shareInvite(sp.id);
              if (!r.ok) setMsg(r.why ?? "보내지 못했습니다");
            }}>
              <Text style={s.spaceAct}>초대</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {!!msg && <Text style={s.warn}>{msg}</Text>}
    </ScrollView>
  );
}

/* ── 탭5 마이 ─────────────────────────────────────────────────
   ★ 익명 계정은 **기기에 묶인다.** 그걸 화면이 말해야 한다 —
     말 안 하면 사용자는 **잃고 나서야** 안다. */
export function MyTab({ authTick = 0 }: { authTick?: number }) {
  const { rows, busy, load } = useRecords("mine");
  const [trips, setTrips] = useState<any[]>([]);
  const [signing, setSigning] = useState(false);
  const [uid, setUid] = useState<string | null>(API.SESSION.user_id);
  const [course, setCourse] = useState(false);
  const [cov, setCov] = useState<API.Coverage | null>(null);
  /* ★ 켜져 있는 것만 보여 준다 — 꺼져 있는데 버튼을 두면 누른 사람이
     `Unsupported provider` 를 본다 (§13.41). */
  const [socials, setSocials] = useState<API.Social[]>([]);
  const [kakaoMsg, setKakaoMsg] = useState<string | null>(null);
  const [appleNative, setAppleNative] = useState(false);
  /* ★ 어디에 이어 두었는지. `SESSION` 은 모듈 값이라 바뀌어도 리렌더가 안 된다 —
     돌아온 순간 App 이 `authTick` 을 올려 주면 그때 다시 읽는다. */
  const [linked, setLinked] = useState<string[]>(API.SESSION.linked);
  useEffect(() => {
    setLinked([...API.SESSION.linked]);
    setUid(API.SESSION.user_id);
    if (API.SESSION.linked.length) { setKakaoMsg(null); void load(); }
  }, [authTick]);
  /* 아직 안 이어 둔 것만 버튼으로 낸다 — 이미 된 것을 또 권하지 않는다 */
  const todo = socials.filter((k) => !linked.includes(k));
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
  /* ★ 기록이 늘면 정복률도 바뀐다 — `rows.length` 를 같이 본다. */
  useEffect(() => { void API.coverage().then(setCov); }, [rows.length, uid]);

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

      {/* ★ 정복률 (§13.68). 원본 기획 §1 의 한 줄 정의가 *"공간 정복 쾌감"* 인데
          서버(`api_coverage`)만 있고 **화면이 한 번도 안 불렀다.**
          ★ 맨 위에 둔다 — '마이' 가 답하는 질문이 *"나는?"* 이고(§12.28),
            그 답의 첫 줄이 이 숫자다.
          ★ 0%를 **감추지 않는다.** 아직 안 채운 것도 사실이고, 그 빈칸이
            채우고 싶게 만드는 것이다. 다만 **다음 한 걸음**을 같이 적는다 —
            숫자만 있고 할 일이 없으면 그냥 통보다. */}
      {!!uid && (
        <View style={s.box}>
          <Text style={s.boxT}>국토 정복률</Text>
          {cov ? (
            <>
              <View style={s.covRow}>
                <Text style={s.covPct}>{cov.pct}%</Text>
                <Text style={s.covOf}>{cov.unlocked} / {cov.total}개 시·군·구</Text>
              </View>
              {/* 막대 하나. ★ 0.4% 도 **보이게** 최소 너비를 준다 —
                  안 보이면 "아직 시작도 안 했다"가 아니라 "고장났다"로 읽힌다. */}
              <View style={s.covBar}>
                <View style={[s.covFill, { width: `${Math.max(1.5, cov.pct)}%` }]} />
              </View>
              <Text style={s.boxV}>
                {cov.unlocked === 0
                  ? "사진을 올리면 그 지역이 채워집니다."
                  : `${cov.total - cov.unlocked}곳이 남았습니다.`}
              </Text>
            </>
          ) : (
            <Text style={s.boxV}>불러오는 중…</Text>
          )}
        </View>
      )}

      {/* ★ 하루 코스는 **내 기록에서 복원**된다 — 그래서 '갈 곳'이 아니라 '마이'에 있다.
          추천이면 탭2 가 맞지만, 이건 있었던 일이다. */}
      <Pressable style={s.box} onPress={() => setCourse(true)}>
        <Text style={s.boxT}>내 하루</Text>
        <Text style={s.boxV}>사진에서 복원한 그날의 순서 · 체류 · 이동 ›</Text>
      </Pressable>
      {course && <DayCourse onClose={() => setCourse(false)} />}

      {/* 카카오로 이어 두기 — 계정 id 가 그대로라 아무것도 옮기지 않는다(§13.41)
          ★ **끝난 일을 다시 권하지 않는다.** 이어 둔 뒤에도 같은 버튼이 남아 있으면
            사용자는 실패한 줄 알고 또 누른다 — 실제로 그래서 요청이 두 번 나갔고,
            나중 것이 앞의 것을 무효로 만들어 왕복이 죽었다(§13.52). */}
      {!!socials.length && uid && (
        <View style={s.box}>
          <Text style={s.boxT}>계정 이어 두기</Text>
          {!!linked.length && (
            <Text style={s.boxV}>
              {linked.map(API.provName).join("·")}에 이어 두었습니다. 다른 기기에서
              같은 곳으로 들어오시면 이 기록이 그대로 보입니다.
            </Text>
          )}
          {!!todo.length && (
            <Text style={s.boxV}>
              지금 계정에 얹습니다. 기록은 그대로 있고, 다른 기기에서 같은 곳으로
              들어오시면 됩니다.
            </Text>
          )}
          {/* ★ provider 마다 칸을 복사하지 않는다 — 하나 늘 때마다 문구가 갈라진다 */}
          {todo.map((k) => (
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
            <Text style={s.boxV}>
              {linked.length ? `${linked.map(API.provName).join("·")} 계정` : "임시 계정"}
              {" "}{uid.slice(0, 8)}…
            </Text>
            {/* ★ "준비 중"을 **박아 두지 않는다.** provider 를 켜면 바로 위에 버튼이
                뜨는데 이 줄은 여전히 준비 중이라고 말해 화면이 자기모순이 된다
                (카카오를 켜고 실제로 그랬다). 켜진 것을 보고 말한다.
                ★ 같은 이유로 **이어 둔 뒤에는 경고를 지운다.** 서버에 남는 계정을
                  두고 "지우면 사라집니다"라고 하면 그건 그냥 거짓말이다(§13.52). */}
            {linked.length ? (
              <Text style={s.boxV}>앱을 지워도 남습니다. 같은 계정으로 들어오면 됩니다.</Text>
            ) : (
              <Text style={s.warn}>앱을 지우거나 기기를 바꾸면 기록이 사라집니다.{"\n"}
                {socials.length
                  ? `위에서 ${socials.map(API.provName).join("·")}로 이어 두면 옮길 수 있습니다.`
                  : "나중에 카카오·애플로 이어 두면 옮길 수 있습니다 — 지금은 준비 중입니다."}</Text>
            )}
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
            {/* ★ 이름 → 메모 → 분류(§13.89). *"맛집"* 은 내 기록 목록에서 아무것도
                말해 주지 않는다 — 어느 맛집인지가 빠져 있다. 서버가 장소 이름을
                같이 주기 시작했으니(PIN_COLS) 여기서도 그걸 먼저 쓴다. */}
            <Text style={s.cardT} numberOfLines={1}>
              {p.places?.name || p.memo || (CAT[p.category] ?? CAT.etc).k}
            </Text>
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
  covRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  covPct: { color: C.visited, fontSize: 30, fontWeight: "800" },
  covOf: { color: C.muted, fontSize: 13 },
  covBar: {
    height: 6, borderRadius: 3, marginTop: 10, marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  covFill: { height: "100%", borderRadius: 3, backgroundColor: C.visited },
  spaceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  spaceGo: { color: C.accent, fontSize: 13, fontWeight: "600" },
  /* 부차 동작은 **아래 줄로 내린다** — 카드를 누르는 것(지도로 가기)이
     주 동작이라, 같은 줄에 두면 어느 것이 본론인지 흐려진다. */
  spaceActs: { flexDirection: "row", gap: 16, marginTop: 10,
               borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  spaceAct: { color: C.muted, fontSize: 12.5 },
  renameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  renameIn: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 15,
  },
  renameOk: { paddingHorizontal: 12, paddingVertical: 10 },
  renameOkT: { color: C.accent, fontSize: 14, fontWeight: "700" },
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
