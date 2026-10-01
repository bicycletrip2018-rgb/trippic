/**
 * TRIPPIC — RN 5탭 (§13.28)
 *
 * ★ **네비게이션 라이브러리를 안 쓴다.** 네이티브 의존성을 늘리면 pod install +
 *   재빌드가 붙는다. 탭 5개 전환에 그 값을 치를 이유가 없다 — 상태 하나면 된다.
 *   라우팅이 정말 필요해질 때(딥링크·뒤로가기) 그때 넣는다.
 *
 * ★ 지도는 §13.27 에서 실기기 검증을 통과한 그것을 그대로 쓴다.
 */
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TabBar, type Tab } from "./src/TabBar";
import { MapTab } from "./src/tabs/MapTab";
import { FeedTab } from "./src/tabs/FeedTab";
import { NewsTab, SpaceTab, MyTab } from "./src/tabs/RecordTabs";
import { RegisterFlow } from "./src/RegisterFlow";
import { LiveCapture } from "./src/LiveCapture";
import { SHEET_BOTTOM, SHEET_HALF } from "./src/MapSheet";
import { AddSheet } from "./src/AddSheet";
import { UploadPill } from "./src/UploadPill";
import * as Q from "./src/uploadQueue";
import { listenForAuth } from "./src/oauth";
import * as API from "./src/api";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./src/config";
import * as Notifications from "expo-notifications";
import { TIDY } from "./src/remind";
import { C } from "./src/theme";
import { QualityCalib } from "./src/dev/QualityCalib";

/* ★ 화질 기준 재측정 도구(§13.77). **평소에는 꺼 둔다** — 출시 경로에 없다.
   기준은 반드시 또 바뀌므로 도구는 남긴다(010 이 image_quality.py 를 남긴 것과 같다). */
const CALIB = false;

export default function App() {
  if (CALIB) return <QualityCalib />;
  const [tab, setTab] = useState<Tab>("map");
  const [ready, setReady] = useState(false);
  const [reg, setReg] = useState(false);
  /* ★ (+) 는 이제 **두 갈래다.** 지금 찍기(현장 인증)와 앨범 정리(소급)는
     기준 좌표부터 다르다(§6.5) — 한 버튼에 묶으면 사용자가 그 차이를 모른 채
     들어가고, 왜 뱃지가 안 붙는지도 모른다. */
  const [add, setAdd] = useState(false);
  const [live, setLive] = useState(false);
  /* 핀 상세 시트가 떠 있는 동안은 (+) 를 감춘다 — 시트의 닫기 버튼을 덮는다 */
  const [sheet, setSheet] = useState(false);
  /* 소셜에서 돌아왔다는 신호 — 마이 탭이 이걸 보고 계정 상태를 다시 읽는다 */
  const [authTick, setAuthTick] = useState(0);
  /* ★ (+) 는 시트 **위에** 앉는다(§13.66 A안). 숨기지 않는다 — (+) 는 지도를
     보는 내내 닿아야 하는 버튼이고, 시트를 올렸다고 등록을 못 하면 안 된다. */
  const [sheetH, setSheetH] = useState(104);
  /* ★ 스페이스 탭에서 **지도로 데려간다**(§12.13 · §13.67). 지도를 한 벌 더
     그리지 않고, 탭1 의 `공유 스페이스` 스코프를 그 방으로 맞춰 준다 —
     같은 것을 두 곳에서 그리면 언젠가 둘이 갈라진다(§13.37). */
  const [jumpSpace, setJumpSpace] = useState<string | null>(null);

  useEffect(() => {
    API.setConfig(SUPABASE_URL, SUPABASE_ANON_KEY);
    void API.loadSession().then(async () => {
      /* ★ `ready` 는 **`ensureSession` 뒤에** 올린다. 앞에 올리면 지도가 토큰이
         서기 전에 읽어 RLS 가 아무것도 주지 않는다 — 핀은 `onRegionDidChange` 가
         다시 불러 살아나지만 **집계는 재시도가 없어 영영 빈 채로 남는다.**
         §13.47 에서 `ready` 를 붙일 때 이 순서를 놓쳤고, 토큰이 살아 있는 동안은
         드러나지 않다가 **만료된 세션으로 앱을 열자 바로 나왔다**(§13.54).
         ★ `ensureSession` 은 망이 끊겨도 돌아온다(그대로 쓴다고 답한다) —
           여기서 기다려도 영영 안 뜨는 일은 없다. */
      await API.ensureSession();
      setReady(true);
      /* ★ 지난번에 다 못 올린 사진부터 이어서 올린다. 앱을 열 때마다 확인한다 —
         "다음에 여시면 이어서 올립니다"라고 말했으면 그렇게 되어야 한다. */
      await Q.load();
      void Q.start();
    });
  }, []);

  /* ★ 소셜 로그인에서 돌아오는 길. **두 경로를 다 받는다** — 앱이 떠 있으면
     `url` 이벤트로, 꺼져 있었으면 그 링크가 앱을 깨우면서 온다(§13.42).
     하나만 받으면 "카카오 눌렀는데 아무 일도 안 일어난다"가 절반의 경우에 생긴다. */
  useEffect(() => listenForAuth((r) => {
    /* ★ 세션만 다시 읽으면 **화면은 모른다.** `SESSION` 은 모듈 값이라 바뀌어도
       리렌더가 안 된다 — 서버에는 이어졌는데 마이 탭은 계속 "임시 계정"이라고
       말했다(§13.52). 신호를 하나 올려 그 탭이 다시 읽게 한다. */
    if (r.ok) void API.loadSession().then(() => setAuthTick((t) => t + 1));
  }), []);

  /* 지도 중심 — 탭2 가 이걸 물려받는다. §12.14: 탭마다 지역을 다시 묻지 않는다. */
  /* ★ 첫 값만 전국 중심이다. 지도가 한 번이라도 움직이면 **그 자리**로 바뀐다 —
     `갈 곳` 의 *"여기서 가까운"* 이 이 값을 쓴다(§13.74). 예전에는 이 상수가
     그대로 쓰여, 화면은 *"지도에서 보던 자리 기준"* 이라 적어 놓고 실제로는
     늘 국토 한가운데에서 거리를 재고 있었다. */
  const [center, setCenter] = useState({ lat: 36.3, lng: 127.8 });
  const [jumpTo, setJumpTo] = useState<{ lng: number; lat: number; name: string } | null>(null);

  /* ★ 주간 알림을 누르면 **정리 화면으로 간다**(§13.79).
     이걸 안 달면 *"2분이면 끝납니다"* 라고 불러 놓고 지도에 떨어뜨린다 —
     약속한 일을 어디서 하는지 사용자가 다시 찾아야 한다.
     ★ 앱이 꺼져 있다가 알림으로 열린 경우(`getLastNotificationResponseAsync`)와
       켜져 있는 동안 누른 경우를 **둘 다** 받는다. 하나만 달면 둘 중 한쪽에서만 듣는다. */
  useEffect(() => {
    const go = (r: Notifications.NotificationResponse | null) => {
      if (r?.notification?.request?.content?.data?.to === TIDY) setReg(true);
    };
    void Notifications.getLastNotificationResponseAsync().then(go).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, []);

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {/* 탭을 갈아 끼우지 않고 **감춘다** — 지도를 다시 만들면 아틀라스를 다시 굽는다 */}
      <View style={[s.page, tab !== "map" && s.hidden]} pointerEvents={tab === "map" ? "auto" : "none"}>
        <MapTab ready={ready} onSheet={setSheet} onAdd={() => setAdd(true)}
                onSheetHeight={setSheetH}
                jumpSpace={jumpSpace} onJumped={() => setJumpSpace(null)}
                onCenter={setCenter}
                jumpTo={jumpTo} onJumpedTo={() => setJumpTo(null)} />
      </View>
      {ready && tab === "feed" && (
        <FeedTab center={center}
                 onOpenMap={(p) => { setJumpTo(p); setTab("map"); }} />
      )}
      {ready && tab === "news" && <NewsTab />}
      {ready && tab === "space" && (
        <SpaceTab onOpenMap={(id) => { setJumpSpace(id); setTab("map"); }} />
      )}
      {ready && tab === "my" && <MyTab authTick={authTick} />}
      {/* ★ (+) 는 지도 위에 둔다 — §12.27: 등록은 별도 탭이 아니라
          "보고 있는 지도에 한 점을 더하는 일"이다. 탭을 새로 만들면 탭1과 겹친다. */}
      {/* ★ 시트를 끝까지 올리면 (+) 를 **감춘다.** 그 상태는 지도를 덮은 몰입형
          목록이라 등록할 지도가 없고, 따라 올라간 버튼은 상단 칩과 겹친다
          (실제로 겹쳤다 — §13.66). */}
      {tab === "map" && !sheet && sheetH < SHEET_HALF + 40 && (
        <Pressable style={[s.fab, { bottom: SHEET_BOTTOM + Math.min(sheetH, SHEET_HALF) + 12 }]} onPress={() => setAdd(true)}>
          <Text style={s.fabT}>＋</Text>
        </Pressable>
      )}
      {add && (
        <AddSheet
          onClose={() => setAdd(false)}
          onLive={() => { setAdd(false); setLive(true); }}
          onAlbum={() => { setAdd(false); setReg(true); }} />
      )}
      {live && <LiveCapture onClose={() => setLive(false)} />}
      {reg && <RegisterFlow onClose={() => setReg(false)} />}
      <UploadPill />
      <TabBar tab={tab} onChange={setTab} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  page: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { opacity: 0, zIndex: -1 },
  fab: {
    position: "absolute", right: 18, width: 54, height: 54,
    /* bottom 은 시트 높이를 따라간다 — 위 주석 참고 */
    borderRadius: 27, alignItems: "center", justifyContent: "center",
    backgroundColor: C.accent, shadowColor: "#000", shadowOpacity: 0.4,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabT: { color: C.onAccent, fontSize: 26, fontWeight: "300", marginTop: -2 },
});
