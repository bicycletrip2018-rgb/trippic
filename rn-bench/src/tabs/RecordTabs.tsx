/**
 * 탭3 소식 · 탭4 스페이스 · 탭5 마이 — 웹 home.js / spaces.js / my.js 이식
 *
 * 셋 다 **서버에서 읽은 기록**으로 채운다. 웹판이 씨앗으로 채우던 자리를
 * 여기서는 실제 `pins` 로 채운다 — 이식하면서 씨앗을 같이 들고 올 이유가 없다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTopPad } from "../safeArea";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
  Linking,
} from "react-native";
import * as API from "../api";
import { C, CAT } from "../theme";
import { DayCourse } from "../DayCourse";
import { regionName } from "../regionName";
import { distM } from "../course";
import { useSkeletonPulse, SkelBar, SkelBox } from "../Skeleton";
import { ReportSheet, type Target } from "../ReportSheet";
import { sitePage } from "../siteLinks";
import { DangerZone } from "../DangerZone";
import { INVITE_BASE } from "../config";
import { openSocial } from "../oauth";
import { isAvailable as appleAvailable, signInWithApple } from "../appleAuth";
import { Alert } from "react-native";

type Pin = {
  /** PostgREST 가 FK 를 따라 붙여 주는 장소 이름(§13.89). 핀마다 따로 묻지 않는다. */
  places?: { name?: string | null } | null;
  id: string; category: string; visited_at: string; memo: string | null;
  /* ★ 누가 올린 것인가 — **차단에 필요하다**(§13.135). 질의에는 있는데 타입에
     없어서 컴파일러가 잡았다. 바로 아래 §13.115 가 **같은 일**을 적어 뒀다 —
     `PIN_COLS` 와 이 타입은 **둘이 아니라 하나**로 봐야 한다. */
  user_id: string;
  verification: string; is_public: boolean; comment_count: number;
  /* ★ `PIN_COLS` 가 **처음부터 받아 오던 것**인데 타입에 없어서 아무도 못 썼다
     (§13.115). 소식이 *"어디인지"* 를 못 적던 이유가 여기였다. */
  region_code: string | null;
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
   ★ **먼저 틀린 것을 바로잡는다**(§13.115). 머리글이 *"포스트마다 **왜 내게 보이는지**
     적혀 있습니다"* 라고 약속했는데, 실제로 적힌 것은 `공개된 기록입니다 · 맛집`
     하나였다. 그건 **이유가 아니라 같은 말 반복**이다 — 공개된 기록을 모아 놓고
     "공개된 기록이라서 보입니다"라고 적은 것이다.

   ★ 왜 그랬나 — **이유가 하나뿐이기 때문**이다. 팔로우 그래프가 없으니 고르는
     규칙이 *"전국에서 최근 순"* 하나고, 포스트마다 다른 이유가 있을 수가 없다.
     → **규칙은 머리글에서 한 번 말한다.** 줄마다 같은 말을 반복하면 그 자리가
       아깝고, 무엇보다 **고르고 있다는 착각**을 준다.

   ★ 그 자리에 들어갈 것은 따로 있었다: **어디인지.** `region_code` 와
     `places(name)` 과 `geom` 을 **처음부터 받아 오면서 하나도 안 쓰고 있었다.**
     읽는 사람이 묻는 것은 *"왜 보이나"* 가 아니라 *"어디야, 나한테서 얼마나 머나"* 다. */
export function NewsTab({ center }: { center?: { lat: number; lng: number } }) {
  const topPad = useTopPad(0);
  const { rows, busy, load } = useRecords("public");
  const first = busy && !rows.length;
  /* ★ 남의 기록이 보이는 화면에는 **신고·차단이 있어야 한다**(§13.135).
     심사 조항(1.2) 이기도 하지만, 그 전에 열어 둔 화면에 대한 책임이다. */
  const [target, setTarget] = useState<Target>(null);
  const [gone, setGone] = useState<string[]>([]);   // 차단 직후 **그 자리에서** 치운다

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.muted} />}>
      <Text style={[s.h1, { paddingTop: topPad }]}>소식</Text>
      {/* ★ **고르는 규칙을 그대로 적는다.** 아직 고르지 않는다는 것까지 적는 게
          맞다 — 숨기면 다음에 고르기 시작할 때 사용자는 그 변화를 모른다. */}
      <Text style={s.sub}>
        전국에서 <Text style={s.b}>최근에 공개된 순서</Text>입니다 — 아직 고르지 않습니다.
        {" "}거리는 <Text style={s.b}>지도에서 보던 자리</Text> 기준입니다.
        {" "}댓글은 없습니다 — 운영할 수 있는 만큼만 엽니다.
      </Text>

      {/* 기다리는 동안 — §13.110 과 같은 이유로 동그라미 대신 뼈대 */}
      {first && <><PostSkeleton /><PostSkeleton /></>}

      {!rows.length && !busy && <Empty text="아직 공개된 기록이 없습니다." />}
      {rows.filter((p) => !gone.includes(p.user_id)).map((p) => {
        const place = p.places?.name ?? undefined;
        const rname = regionName(p.region_code);
        const c = p.geom?.coordinates;
        /* ★ 거리는 **둘 다 있을 때만** 적는다. 하나라도 없으면 그 조각을 비운다 —
             `0km` 는 "바로 여기"라는 거짓말이다(§13.32 가 체류에서 정한 것과 같다). */
        const km = center && Array.isArray(c)
          ? distM({ lng: c[0], lat: c[1] }, center) / 1000
          : null;
        /* 어디인지를 **왼쪽부터** 적는다: 장소 · 지역 · 거리. 셋 다 없으면 갈래만. */
        const parts = [
          place,
          rname,
          km == null ? null : km < 1 ? "여기서 1km 안" : `여기서 ${Math.round(km)}km`,
        ].filter(Boolean) as string[];
        return (
          <View key={p.id} style={s.post}>
            <View style={s.whyRow}>
              <Text style={[s.why, { flex: 1 }]}>
                {parts.length ? parts.join(" · ") : (CAT[p.category] ?? CAT.etc).k}
              </Text>
              {/* ★ 내 기록에는 안 보인다 — 자기를 신고·차단할 일은 없다 */}
              {p.user_id !== API.SESSION.user_id && (
                <Pressable hitSlop={12} style={s.more}
                           onPress={() => setTarget({ pinId: p.id, userId: p.user_id })}>
                  <Text style={s.moreT}>⋯</Text>
                </Pressable>
              )}
            </View>
            {cover(p) ? <Image source={{ uri: cover(p) }} style={s.postImg} /> : null}
            <View style={s.postFoot}>
              <Text style={s.date}>{ymd(p.visited_at)} · {(CAT[p.category] ?? CAT.etc).k}</Text>
              <Text style={[s.badge, p.verification === "live" && s.badgeLive]}>
                {p.verification === "live" ? "현장 인증" : "사진 정보"}
              </Text>
            </View>
            {p.memo ? <Text style={s.memo}>{p.memo}</Text> : null}
          </View>
        );
      })}
      <ReportSheet
        target={target} onClose={() => setTarget(null)}
        /* ★ 차단하면 **그 자리에서** 사라져야 한다. 서버는 이미 안 보내지만
           지금 화면에 떠 있는 줄은 다시 받기 전까지 남는다 — 사용자에게는
           "차단했는데 그대로네"로 읽힌다. */
        onBlocked={(uid) => setGone((g) => [...g, uid])} />
    </ScrollView>
  );
}

/* 포스트가 들어올 자리 — 치수는 `s.post`·`s.postImg` 에서 그대로 빌린다 */
function PostSkeleton() {
  const o = useSkeletonPulse();
  return (
    <View style={s.post} pointerEvents="none">
      <SkelBar pulse={o} style={{ width: 170, marginBottom: 10 }} />
      <SkelBox pulse={o} style={{ width: "100%", height: 200, borderRadius: 12 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10 }}>
        <SkelBar pulse={o} style={{ width: 96, height: 9 }} />
        <SkelBar pulse={o} style={{ width: 54, height: 9 }} />
      </View>
    </View>
  );
}

/* ★ **탭4 스페이스는 없어졌다**(§13.114). 보는 일(나 / 지인 공유 / 전체)은 탭1 의
   스코프 칩이 처음부터 하고 있었고, §12.13 이 *"스페이스의 화면은 지도여야 한다"* 고
   적은 그 지도도 탭1 이 그리고 있었다. 남은 것은 **방 관리**(초대·이름·함께 채운 숫자)
   뿐이라 그 칩의 **고르는 창**으로 옮겼다 — 탭 하나를 아꼈고 단계는 안 늘었다.
   초대 보내기는 `src/invite.ts` 로 갔다. */

export function MyTab({ authTick = 0 }: { authTick?: number }) {
  const topPad = useTopPad(0);
  const { rows, busy, load } = useRecords("mine");
  const [trips, setTrips] = useState<any[]>([]);
  const [signing, setSigning] = useState(false);
  const [uid, setUid] = useState<string | null>(API.SESSION.user_id);
  const [course, setCourse] = useState(false);
  const [cov, setCov] = useState<API.Coverage | null>(null);
  /* ★ 운영 조치 알림(§13.147). **맨 위에 둔다** — 기록이 내려갔는데 그 사실이
     스크롤 아래에 있으면 못 보고 지나간다. 못 본 알림은 없는 알림이다. */
  const [notices, setNotices] = useState<API.Notice[]>([]);
  /* 지운 기록은 **그 자리에서** 치운다 — 다시 받기 전까지 남으면 "안 지워졌네"로 읽힌다 */
  const [erased, setErased] = useState<string[]>([]);
  const [erasing, setErasing] = useState<string | null>(null);
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
  /* 알림은 **조용히** 받아 온다 — 실패해도 마이 탭이 멈추면 안 된다 */
  useEffect(() => {
    let live = true;
    API.myNotices().then((r) => { if (live && r.ok) setNotices(r.data ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [uid, authTick]);

  const photos = rows.reduce((n, p) => n + (p.media?.length ?? 0), 0);

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={load} tintColor={C.muted} />}>
      <Text style={[s.h1, { paddingTop: topPad }]}>마이</Text>

      {/* ★ 운영 조치 알림. **읽어도 안 지운다** — 무슨 일이 있었는지는 남아야
          한다. 다만 읽은 뒤에는 **옅게** 둔다. */}
      {notices.map((n) => (
        <Pressable key={n.id} style={[s.notice, !!n.read_at && s.noticeRead]}
          onPress={() => {
            if (!n.read_at) {
              void API.readNotices([n.id]);
              setNotices((v) => v.map((x) => x.id === n.id
                ? { ...x, read_at: new Date().toISOString() } : x));
            }
          }}>
          <Text style={s.noticeT}>{n.title}</Text>
          <Text style={s.noticeB}>{n.body}</Text>
          {!n.read_at && <Text style={s.noticeNew}>눌러서 읽음 표시</Text>}
        </Pressable>
      ))}

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

      {rows.slice(0, 12).filter((p) => !erased.includes(p.id)).map((p) => (
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
          {/* ★ 내 기록은 **내가 지울 수 있어야 한다**(§13.138). 개인정보처리방침이
              그렇게 적고 있고, 그 전에 올린 사람의 것이다. */}
          <Pressable hitSlop={10} disabled={erasing === p.id}
                     onPress={() => {
                       setErasing(p.id);
                       void API.deleteRecord(p.id).then((ok) => {
                         setErasing(null);
                         /* ★ 성공했을 때만 치운다. 실패했는데 치우면 **지워진 줄
                            알고** 넘어가고, 다음에 다시 열면 그대로 있다. */
                         if (ok) setErased((g) => [...g, p.id]);
                       });
                     }}>
            <Text style={s.erase}>{erasing === p.id ? "…" : "지우기"}</Text>
          </Pressable>
        </View>
      ))}

      <BlockedList tick={authTick} />
      <SiteLinks />
      {/* ★ 5.1.1(v) — 계정을 만들 수 있으면 **앱 안에서 지울 수도** 있어야 한다.
          맨 아래에 둔다. 자주 쓰는 것이 아니고, 옆에 두면 잘못 누른다. */}
      {!!uid && (
        <DangerZone
          counts={{ places: rows.length, photos }}
          onDone={() => { setUid(null); void load(); }} />
      )}
    </ScrollView>
  );
}

/**
 * 약관·개인정보·문의 (§13.136)
 *
 * ★ 심사가 요구하는 **공개된 연락처**가 여기다. 그리고 동의한 약관을 **나중에
 *   다시 볼 길**이 있어야 한다 — 처음에 한 번 보이고 영영 못 찾으면 동의가
 *   형식이 된다.
 * ★ 주소를 못 만들면 **안 그린다.** 눌러도 아무 일이 없는 글자는 고장으로 읽힌다.
 */
function SiteLinks() {
  const items: [string, string | null][] = [
    ["이용약관", sitePage(INVITE_BASE, "terms")],
    ["개인정보처리방침", sitePage(INVITE_BASE, "privacy")],
    ["문의", sitePage(INVITE_BASE, "support")],
  ];
  const live = items.filter(([, u]) => !!u) as [string, string][];
  if (!live.length) return null;
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 26, flexDirection: "row", gap: 16 }}>
      {live.map(([t, u]) => (
        <Pressable key={t} onPress={() => void Linking.openURL(u)}>
          <Text style={s.siteLink}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * 차단 푸는 화면 (§13.135)
 *
 * ★ **되돌릴 수 없는 차단은 사고가 된다.** 잘못 눌렀는데 푸는 길이 없으면
 *   그 사람 기록은 영영 안 보인다 — 같이 여행한 사람이면 더 나쁘다.
 * ★ 한 명도 없으면 **아무것도 안 그린다.** 대부분의 사람에게는 평생 빈 칸이고,
 *   빈 칸을 두면 *"차단이 뭐지"* 를 생각하게 만든다.
 */
function BlockedList({ tick }: { tick: number }) {
  const [rows, setRows] = useState<API.Blocked[]>([]);
  const load = useCallback(() => { void API.blockedList().then(setRows); }, []);
  useEffect(load, [load, tick]);
  if (!rows.length) return null;
  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 22 }}>
      <Text style={s.cardT}>차단한 사람</Text>
      <Text style={s.cardS}>이 사람들의 기록은 보이지 않습니다. 상대는 모릅니다.</Text>
      {rows.map((b) => (
        <View key={b.user_id} style={s.blocked}>
          <Text style={s.blockedN}>{b.nickname || "이름 없는 사용자"}</Text>
          <Pressable hitSlop={10}
                     onPress={() => { void API.unblockUser(b.user_id).then(load); }}>
            <Text style={s.unblock}>차단 풀기</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const Empty = ({ text }: { text: string }) => (
  <View style={s.empty}><Text style={s.dim}>{text}</Text></View>
);

const s = StyleSheet.create({
  whyRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  more: { paddingHorizontal: 6, marginTop: -4 },
  moreT: { color: C.muted, fontSize: 18, lineHeight: 20 },
  blocked: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
             paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.line },
  blockedN: { color: C.text, fontSize: 14 },
  unblock: { color: C.accent, fontSize: 13, fontWeight: "600" },
  siteLink: { color: C.muted, fontSize: 12.5, textDecorationLine: "underline" },
  erase: { color: C.muted, fontSize: 12.5, paddingHorizontal: 4 },
  wrap: { flex: 1, backgroundColor: C.bg },
  h1: { color: C.text, fontSize: 19, fontWeight: "700", paddingHorizontal: 18 },
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
  covRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  covPct: { color: C.visited, fontSize: 30, fontWeight: "800" },
  covOf: { color: C.muted, fontSize: 13 },
  covBar: {
    height: 6, borderRadius: 3, marginTop: 10, marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  covFill: { height: "100%", borderRadius: 3, backgroundColor: C.visited },
  /* 함께 간 것은 **보조색**으로 — '다녀온 것'에 쓰는 색이다(theme.ts) */
  /* 부차 동작은 **아래 줄로 내린다** — 카드를 누르는 것(지도로 가기)이
     주 동작이라, 같은 줄에 두면 어느 것이 본론인지 흐려진다. */
  cardT: { color: C.text, fontSize: 13.5, fontWeight: "650" as any },
  cardS: { color: C.muted, fontSize: 11, marginTop: 3 },
  notice: { marginHorizontal: 18, marginTop: 10, padding: 15, borderRadius: 16,
            borderWidth: 1, borderColor: C.warn, backgroundColor: "rgba(245,158,11,0.10)" },
  noticeRead: { borderColor: C.line, backgroundColor: "rgba(255,255,255,0.03)" },
  noticeT: { color: C.text, fontSize: 14, fontWeight: "700" },
  noticeB: { color: C.muted, fontSize: 12.5, lineHeight: 19, marginTop: 5 },
  noticeNew: { color: C.warn, fontSize: 11, marginTop: 8 },
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
