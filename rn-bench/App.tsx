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
import { UploadPill } from "./src/UploadPill";
import * as Q from "./src/uploadQueue";
import { listenForAuth } from "./src/oauth";
import * as API from "./src/api";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./src/config";
import { C } from "./src/theme";

export default function App() {
  const [tab, setTab] = useState<Tab>("map");
  const [ready, setReady] = useState(false);
  const [reg, setReg] = useState(false);
  /* 핀 상세 시트가 떠 있는 동안은 (+) 를 감춘다 — 시트의 닫기 버튼을 덮는다 */
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    API.setConfig(SUPABASE_URL, SUPABASE_ANON_KEY);
    void API.loadSession().then(async () => {
      setReady(true);
      /* ★ 지난번에 다 못 올린 사진부터 이어서 올린다. 앱을 열 때마다 확인한다 —
         "다음에 여시면 이어서 올립니다"라고 말했으면 그렇게 되어야 한다. */
      await API.ensureSession();
      await Q.load();
      void Q.start();
    });
  }, []);

  /* ★ 소셜 로그인에서 돌아오는 길. **두 경로를 다 받는다** — 앱이 떠 있으면
     `url` 이벤트로, 꺼져 있었으면 그 링크가 앱을 깨우면서 온다(§13.42).
     하나만 받으면 "카카오 눌렀는데 아무 일도 안 일어난다"가 절반의 경우에 생긴다. */
  useEffect(() => listenForAuth((r) => {
    if (r.ok) void API.loadSession();
  }), []);

  /* 지도 중심 — 탭2 가 이걸 물려받는다. §12.14: 탭마다 지역을 다시 묻지 않는다. */
  const center = { lat: 36.3, lng: 127.8 };

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      {/* 탭을 갈아 끼우지 않고 **감춘다** — 지도를 다시 만들면 아틀라스를 다시 굽는다 */}
      <View style={[s.page, tab !== "map" && s.hidden]} pointerEvents={tab === "map" ? "auto" : "none"}>
        <MapTab onSheet={setSheet} />
      </View>
      {ready && tab === "feed" && <FeedTab center={center} />}
      {ready && tab === "news" && <NewsTab />}
      {ready && tab === "space" && <SpaceTab />}
      {ready && tab === "my" && <MyTab />}
      {/* ★ (+) 는 지도 위에 둔다 — §12.27: 등록은 별도 탭이 아니라
          "보고 있는 지도에 한 점을 더하는 일"이다. 탭을 새로 만들면 탭1과 겹친다. */}
      {tab === "map" && !sheet && (
        <Pressable style={s.fab} onPress={() => setReg(true)}>
          <Text style={s.fabT}>＋</Text>
        </Pressable>
      )}
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
    position: "absolute", right: 18, bottom: 104, width: 54, height: 54,
    borderRadius: 27, alignItems: "center", justifyContent: "center",
    backgroundColor: C.accent, shadowColor: "#000", shadowOpacity: 0.4,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  fabT: { color: C.onAccent, fontSize: 26, fontWeight: "300", marginTop: -2 },
});
