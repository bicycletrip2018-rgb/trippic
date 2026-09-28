/**
 * 화질 기준 재측정 도구 — **개발용** (§13.77)
 *
 * ★ 왜 앱 안에서 도는가: 어긋남의 원인이 **계산식이 아니라 줄이는 방식**이기
 *   때문이다(§13.76). 계산식은 파이썬과 Δ=0 으로 같음을 이미 확인했다. 다른 것은
 *   `sips` 와 `expo-image-manipulator`+Skia 가 320px 로 줄이는 결과다.
 *   → 그러니 **앱이 실제로 쓰는 그 경로**로 재지 않으면 의미가 없다.
 *     맥에서 Skia 를 흉내 내는 것도, 시뮬레이터와 실기기를 나누는 것도 소용없다 —
 *     둘은 같은 Skia 를 쓴다. 중요한 것은 **어느 코드가 재느냐**다.
 *
 * ★ 이 화면은 **출시 경로에 없다.** `App.tsx` 의 `CALIB` 가 꺼져 있으면 그려지지
 *   않는다. 010 이 측정 도구(`image_quality.py`)를 남겨 둔 것과 같은 이유로 남긴다 —
 *   기준은 반드시 또 바뀐다.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { measurePhoto } from "../photoQuality";
import { C } from "../theme";

const HOST = "http://localhost:5173";     // prototype/ 를 서빙하는 서버
const SINK = "http://localhost:5199";     // db/analysis/collect.py

export function QualityCalib() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const say = (s: string) => setLog((l) => [...l.slice(-14), s]);

  async function run() {
    setBusy(true); setLog([]);
    try {
      const man: { k: string; f: string }[] =
        await fetch(`${HOST}/calib.json`).then((r) => r.json());
      say(`표본 ${man.length}장`);
      const out: any[] = [];
      for (let i = 0; i < man.length; i++) {
        const m = man[i];
        /* ★ **내려받아서** 잰다. 원격 URL 을 바로 넘기면 라이브러리가 자기 방식으로
           받아 와 캐시하는데, 그 경로가 실제 앱(기기 파일)과 같다는 보장이 없다. */
        const to = `${FileSystem.cacheDirectory}calib-${i}.jpg`;
        try {
          /* ★ `sessionType` 을 **여기서도** 명시한다. `downloadAsync` 의 기본값도
             BACKGROUND 이고, 시뮬레이터에는 `nsurlsessiond` 가 없다 — §13.73 에서
             업로드가 죽은 것과 **같은 뿌리**다. 처음엔 262장이 전부
             `ERR_FILESYSTEM_CANNOT_DOWNLOAD` 로 넘어갔다.
             ★ 앱 본체에는 `downloadAsync` 호출이 없어 이 함정이 여기서 처음 드러났다. */
          await FileSystem.downloadAsync(`${HOST}/${m.f}`, to,
            { sessionType: FileSystem.FileSystemSessionType.FOREGROUND });
          const q = await measurePhoto(to);
          if (q) out.push({ k: m.k, f: m.f, focus: q.focus, contrast: q.contrast, w: q.w, h: q.h });
        } catch (e: any) { say(`건너뜀 ${m.f} — ${String(e?.message ?? e).slice(0, 90)}`); }
        finally { try { await FileSystem.deleteAsync(to, { idempotent: true }); } catch {} }
        if ((i + 1) % 20 === 0) say(`${i + 1} / ${man.length}`);
      }
      await fetch(SINK, { method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify(out) });
      say(`보냈다: ${out.length}장`);
    } catch (e: any) {
      say(`실패: ${String(e?.message ?? e)}`);
    }
    setBusy(false);
  }

  return (
    <View style={s.root}>
      <Text style={s.h1}>화질 기준 재측정</Text>
      <Text style={s.sub}>
        앱이 실제로 쓰는 경로(expo-image-manipulator + Skia)로 표본을 잰다.
        결과는 :5199 로 보낸다.
      </Text>
      <Pressable style={[s.btn, busy && s.btnOff]} disabled={busy} onPress={run}>
        <Text style={s.btnT}>{busy ? "재는 중…" : "측정 시작"}</Text>
      </Pressable>
      <ScrollView style={s.logBox}>
        {log.map((l, i) => <Text key={i} style={s.log}>{l}</Text>)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 70, paddingHorizontal: 20 },
  h1: { color: C.text, fontSize: 22, fontWeight: "700" },
  sub: { color: C.muted, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
  btn: { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15, marginTop: 18 },
  btnOff: { opacity: 0.5 },
  btnT: { color: "#04121f", fontSize: 15, fontWeight: "700", textAlign: "center" },
  logBox: { marginTop: 16 },
  log: { color: C.muted, fontSize: 12, fontFamily: "Menlo", marginTop: 3 },
});
