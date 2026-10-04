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
import { installErrorLog, logError } from "./src/errorLog";
import { MapTab } from "./src/tabs/MapTab";
import { FeedTab } from "./src/tabs/FeedTab";
import { NewsTab, MyTab } from "./src/tabs/RecordTabs";
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
import { readPending, type Pending } from "./src/pending";
import { newPhotosSince } from "./src/album";
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
  /* ★ `jumpSpace` 를 **걷어냈다**(§13.114). 스페이스 탭이 없어져 세우는 쪽이
     사라졌고, 방을 고르면 **고르는 창이 그 자리로 날아간다** — 같은 일을 두 길로
     하지 않는다(§13.37). */
  /* ★ 남은 일 배지 (§12.27 · §13.93). **RN 에는 배지가 아예 없었다** — 웹은
     §12.27·§13.83 에서 두 번이나 고쳤는데 이쪽은 한 번도 붙은 적이 없어서,
     앱이 찾아 놓은 일을 알 길이 `+` 를 눌러 들어가 보는 것과 주 1회 알림뿐이었다.
     §12.27 이 `정리함` 탭을 접으며 *"그래도 하나 건졌다"* 고 남긴 것이 이것이다.
     ★ 탭을 새로 만들지 않는다 — §12.27 이 세 번째로 같은 실수를 하고 접은 자리다. */
  const [pending, setPending] = useState<Pending | null>(null);
  const [more, setMore] = useState(0);        // 마지막으로 잰 뒤에 새로 찍힌 사진 수
  /* ★ `갈 곳` 을 **한 번 연 적이 있는가**(§13.111). 그 뒤로는 감추기만 하고
     안 지운다. 열기 전에는 안 만든다 — 위 주석 참고. */
  const [feedBorn, setFeedBorn] = useState(false);
  useEffect(() => { if (tab === "feed") setFeedBorn(true); }, [tab]);

  useEffect(() => {
    /* ★ **제일 먼저 건다**(§13.120). 뒤에 걸면 켜는 중에 난 오류를 놓치는데,
       켜는 중에 터지는 것이 **사용자가 가장 못 넘기는 것**이다. */
    installErrorLog();
    API.setConfig(SUPABASE_URL, SUPABASE_ANON_KEY);
    void API.loadSession().then(async () => {
      /* ★ `ready` 는 **`ensureSession` 뒤에** 올린다. 앞에 올리면 지도가 토큰이
         서기 전에 읽어 RLS 가 아무것도 주지 않는다 — 핀은 `onRegionDidChange` 가
         다시 불러 살아나지만 **집계는 재시도가 없어 영영 빈 채로 남는다.**
         §13.47 에서 `ready` 를 붙일 때 이 순서를 놓쳤고, 토큰이 살아 있는 동안은
         드러나지 않다가 **만료된 세션으로 앱을 열자 바로 나왔다**(§13.54).
         ★ `ensureSession` 은 망이 끊겨도 돌아온다(그대로 쓴다고 답한다) —
           여기서 기다려도 영영 안 뜨는 일은 없다. */
      const ses = await API.ensureSession();
      /* ★ 세션이 안 서면 **그 뒤 전부가 조용히 빈다**(RLS 가 아무것도 안 준다).
         화면에는 "기록이 없습니다"로 보여서 테스터는 오류인 줄도 모른다. */
      if (!ses.ok) void logError("boot", `세션이 안 섰다: ${ses.why ?? "이유 없음"}`);
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

  /* ★ **앨범을 다시 읽지 않는다.** 배지 하나 때문에 켤 때마다 1,200장의 EXIF 를
     읽을 수는 없다. 기기에 적어 둔 마지막 셈을 읽고, *"그 뒤에 새 사진이 있는가"* 만
     싸게 묻는다(개수만, 권한을 묻지 않는다 — 허락이 없으면 0이다).
     ★ 정리 화면을 닫을 때 다시 읽는다 — 그 안에서 등록했으면 숫자가 줄어 있다. */
  useEffect(() => {
    if (reg) return;                          // 열려 있는 동안은 읽을 이유가 없다
    let live = true;
    void readPending().then(async (p) => {
      if (!live) return;
      setPending(p);
      setMore(await newPhotosSince(p.at));
    });
    return () => { live = false; };
  }, [reg]);

  /* ★ 배지가 **무엇을 말하는가**:
       · `3`  — 정리 화면에 카드 3장이 기다린다 (미등록 여행 + 낱장 묶음)
       · `3+` — 3장은 확실하고, 그 뒤에 찍은 사진이 더 있다. **몇 개가 될지는 모른다**
       · `•`  — 다 정리했는데 그 뒤에 새 사진이 있다. 숫자를 지어내지 않는다
     모르는 것을 아는 척하면 §12.27 이 웹에서 찾은 거짓말이 그대로 되살아난다. */
  const badge = !pending ? null
    : pending.cards > 0 ? `${pending.cards}${more ? "+" : ""}`
    : more ? "•" : null;

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {/* 탭을 갈아 끼우지 않고 **감춘다** — 지도를 다시 만들면 아틀라스를 다시 굽는다 */}
      <View style={[s.page, tab !== "map" && s.hidden]} pointerEvents={tab === "map" ? "auto" : "none"}>
        <MapTab ready={ready} onSheet={setSheet} onAdd={() => setAdd(true)}
                onSheetHeight={setSheetH}
                onCenter={setCenter}
                jumpTo={jumpTo} onJumpedTo={() => setJumpTo(null)} />
      </View>
      {/* ★ `갈 곳` 도 **감춘다**(§13.111). 예전에는 조건부 렌더라 탭을 떠나면
          언마운트됐고, 돌아올 때마다 **처음부터 다시 받았다** — §13.109 에서
          열 번 드나들어 열 번 다 요청이 나가는 것을 쟀다. 평소 250ms 라 티가
          안 나지만 서버가 식으면 **그때마다** 2초 빈 화면이고, 보던 자리(스크롤)도
          매번 잃는다.
          ★ 다만 지도와 **다른 점이 하나** 있다: **처음 열기 전까지는 아예 안 만든다.**
            앱을 켜자마자 만들어 두면 사용자가 **한 번도 안 본 화면**이 묶음을 받고,
            그 표지들이 노출로 세어진다 — §13.9 가 못 박은 *"노출은 '그려졌다'가
            아니라 '보였다'다"* 를 정면으로 어긴다. 한 번 열고 나서야 산다. */}
      {ready && (tab === "feed" || feedBorn) && (
        <View style={[s.page, tab !== "feed" && s.hidden]}
              pointerEvents={tab === "feed" ? "auto" : "none"}>
          <FeedTab center={center} visible={tab === "feed"}
                   onOpenMap={(p) => { setJumpTo(p); setTab("map"); }} />
        </View>
      )}
      {/* ★ 소식도 **지도에서 보던 자리**를 받는다(§13.115) — 거리를 적으려면
          기준점이 필요하고, 그 기준은 `갈 곳` 과 **같은 것**이어야 한다.
          둘이 다른 자리를 기준 삼으면 같은 곳을 다르게 말한다(§13.34). */}
      {ready && tab === "news" && <NewsTab center={center} />}
      {ready && tab === "my" && <MyTab authTick={authTick} />}
      {/* ★ (+) 는 지도 위에 둔다 — §12.27: 등록은 별도 탭이 아니라
          "보고 있는 지도에 한 점을 더하는 일"이다. 탭을 새로 만들면 탭1과 겹친다. */}
      {/* ★ 시트를 끝까지 올리면 (+) 를 **감춘다.** 그 상태는 지도를 덮은 몰입형
          목록이라 등록할 지도가 없고, 따라 올라간 버튼은 상단 칩과 겹친다
          (실제로 겹쳤다 — §13.66). */}
      {tab === "map" && !sheet && sheetH < SHEET_HALF + 40 && (
        <Pressable style={[s.fab, { bottom: SHEET_BOTTOM + Math.min(sheetH, SHEET_HALF) + 12 }]} onPress={() => setAdd(true)}>
          <Text style={s.fabT}>＋</Text>
          {badge ? (
            <View style={s.fabBadge}>
              <Text style={s.fabBadgeT}>{badge}</Text>
            </View>
          ) : null}
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
  /* ★ 파랑 버튼 위에 **파랑 배지**를 올리면 안 보인다. 경고색을 쓰되 빨강은
     *"잘못됐다"* 로 읽히므로 §13.4 의 `warn` 을 쓴다 — 이건 할 일이지 오류가 아니다. */
  fabBadge: {
    position: "absolute", top: -3, right: -3, minWidth: 21, height: 21,
    borderRadius: 11, paddingHorizontal: 5,
    backgroundColor: C.warn, alignItems: "center", justifyContent: "center",
    /* 버튼과 배지가 같은 덩어리로 보이지 않게 바탕색으로 테를 두른다 */
    borderWidth: 2, borderColor: C.bg,
  },
  fabBadgeT: { color: "#1a1206", fontSize: 11, fontWeight: "800" },
});
