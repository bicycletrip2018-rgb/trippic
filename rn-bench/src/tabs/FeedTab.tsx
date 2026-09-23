/**
 * 탭2 `갈 곳` — 웹 `feed.js` 이식 (§12.10)
 *
 * ★ 단위는 사진이 아니라 **장소**다. 사진이 0장이어도 카드가 남는다 —
 *   그래서 첫날에도 화면이 찬다.
 * ★ 무한 피드가 아니라 **이유가 붙은 묶음**이다. 묶음마다 왜 떴는지 한 줄을 적는다.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, CAT } from "../theme";
import { driveText as courseDriveText } from "../course";
import * as API from "../api";

const HOST = "http://localhost:5173";     // 씨앗은 개발 서버에서 받는다 (번들 3.4MB 절약)

type Seed = {
  id: string; n: string; c: string; cpt?: string | null;
  img: string; thumb?: string; evs?: string | null; eve?: string | null;
  lng: number; lat: number; rg?: string; rc?: string;
};

const R = 6371;
function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const t = Math.PI / 180;
  const dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/* ★ 거리는 `12km` 가 아니라 `차로 25분` 이다 — 갈지 말지를 정하는 단위는 분이다.
   ★ 공식은 `course.ts` 한 곳에 있다. 여기에 따로 두었더니 60km/h 였고 저쪽은 40km/h 라,
     같은 거리를 두 화면이 다르게 말했다 (§13.34에서 합쳤다). */
const driveText = (km: number) => courseDriveText(km * 1000);

/* ★ 시간 예산 (§12.25-C) — 사람이 실제로 묻는 것은 "근처 어디"가 아니라
   **"지금 3시간 비는데 어디 갈까"** 다. 왕복 이동과 머무는 시간을 빼야 답이 된다.
   ★ 체류 시간은 §13.32 에서 서버에 남겼다 — 남들은 이 값을 모른다. */
const BUDGETS: [number, string][] = [[120, "2시간"], [240, "반나절"], [480, "하루"]];

export function FeedTab({ center }: { center: { lat: number; lng: number } }) {
  const [seed, setSeed] = useState<Seed[]>([]);
  const [cpt, setCpt] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [budgetRows, setBudgetRows] = useState<API.BudgetPlace[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${HOST}/feed-seed.json`).then((r) => r.json()).then(setSeed)
      .catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const rails = useMemo(() => {
    const base = cpt ? seed.filter((x) => x.cpt === cpt) : seed;
    if (!base.length) return [];
    const today = new Date().toISOString().slice(0, 10);
    const near = (a: Seed) => distKm(center, { lat: a.lat, lng: a.lng });
    const live = base.filter((x) => x.evs && x.evs <= today && (x.eve ?? x.evs)! >= today)
      .sort((a, b) => near(a) - near(b));
    const soon = base.filter((x) => x.evs && x.evs > today)
      .sort((a, b) => (a.evs! < b.evs! ? -1 : 1));
    const close = base.slice().sort((a, b) => near(a) - near(b));
    /* ★ '안 가본 곳'을 거리순으로 뽑으면 '가까운 곳'과 **같은 카드**가 나온다.
       같은 묶음 두 개는 하나보다 나쁘다 — 지역마다 하나씩 흩는다. */
    const nearIds = new Set(close.slice(0, 12).map((x) => x.n));
    const seenRg = new Set<string>();
    const unseen = close.filter((x) =>
      !!x.rg && !nearIds.has(x.n) && !seenRg.has(x.rg) && (seenRg.add(x.rg), true));
    const out = [
      live.length ? { k: "live", t: "지금 하는 행사", why: `오늘 열려 있는 곳 ${live.length}곳`, items: live.slice(0, 12) } : null,
      soon.length ? { k: "soon", t: "곧 시작합니다", why: "날짜가 잡힌 행사", items: soon.slice(0, 12) } : null,
      { k: "near", t: "여기서 가까운", why: "지도에서 보던 자리 기준 · 가까운 순", items: close.slice(0, 12) },
      unseen.length ? { k: "unseen", t: "아직 안 가본 곳", why: `지역마다 하나씩 — ${unseen.length}곳 중에서`, items: unseen.slice(0, 12) } : null,
    ];
    return out.filter((x): x is { k: string; t: string; why: string; items: Seed[] } => !!x);
  }, [seed, cpt, center]);

  /* 예산을 고르면 **서버가** 답한다 — 체류 시간은 서버에만 있다.
     씨앗(로컬 파일)에는 체류가 없으므로 이 묶음만 실제 DB 를 본다. */
  useEffect(() => {
    if (budget == null) { setBudgetRows(null); return; }
    let live = true;
    setBudgetRows(null);
    void API.placesInBudget(center.lat, center.lng, budget, { cat: cpt, limit: 24 })
      .then((r) => { if (live) setBudgetRows(r.data ?? []); });
    return () => { live = false; };
  }, [budget, cpt, center.lat, center.lng]);

  const concepts = useMemo(
    () => [...new Set(seed.map((x) => x.cpt).filter(Boolean))] as string[], [seed]);

  if (err) return <View style={s.center}><Text style={s.dim}>씨앗을 못 받았습니다{"\n"}{err}</Text></View>;
  if (!seed.length) return <View style={s.center}><ActivityIndicator color={C.accent} /></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}>
      <Text style={s.h1}>갈 곳</Text>
      <Text style={s.sub}>왜 떴는지 묶음마다 적어 둡니다 — 우리 추천은 설명할 수 있어야 합니다.</Text>

      {/* ★ 시간 예산이 컨셉 칩보다 **앞**이다 — 사람이 먼저 정하는 것은 테마가 아니라
          "몇 시간 쓸 수 있나"다. 다시 누르면 꺼진다 (되돌릴 수 없는 토글은 만들지 않는다). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {BUDGETS.map(([m, label]) => (
          <Chip key={m} label={label} on={budget === m}
                onPress={() => setBudget(budget === m ? null : m)} />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        <Chip label="전체" on={!cpt} onPress={() => setCpt(null)} />
        {concepts.map((k) => <Chip key={k} label={k} on={cpt === k} onPress={() => setCpt(k)} />)}
      </ScrollView>

      {budget != null && <BudgetRail budget={budget} rows={budgetRows} />}

      {rails.map((r) => (
        <View key={r.k} style={s.rail}>
          <Text style={s.railT}>{r.t}</Text>
          <Text style={s.railWhy}>{r.why}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
            {r.items.map((x) => (
              <View key={x.id} style={s.card}>
                <Image source={{ uri: x.thumb || x.img }} style={s.img} />
                <Text style={s.name} numberOfLines={1}>{x.n}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {(CAT[x.c] ?? CAT.etc).k} · {(x.rg ?? "").split(" ").pop()}
                </Text>
                <Text style={s.dist}>{driveText(distKm(center, { lat: x.lat, lng: x.lng }))}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
      <Text style={s.credit}>장소·사진 출처 한국관광공사 · 경계 © OpenStreetMap contributors</Text>
    </ScrollView>
  );
}

const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable style={[s.chip, on && s.chipOn]} onPress={onPress}>
    <Text style={[s.chipT, on && s.chipTOn]}>{label}</Text>
  </Pressable>
);

/* ★ 모르는 것을 모른다고 쓴다. `stay_min` 이 null 이면 "체류 미측정"이라고 적고
   이동만 계산했다고 말한다 — 여기서 그럴듯한 숫자를 채우면 사용자가 못 끝낼
   일정을 짜고, 그 책임은 우리에게 있다. */
function BudgetRail({ budget, rows }: { budget: number; rows: API.BudgetPlace[] | null }) {
  const label = BUDGETS.find(([m]) => m === budget)?.[1] ?? `${budget}분`;
  const measured = rows?.filter((r) => r.stay_min != null).length ?? 0;
  return (
    <View style={s.rail}>
      <Text style={s.railT}>{label} 안에 다녀올 수 있는 곳</Text>
      <Text style={s.railWhy}>
        {rows == null ? "재는 중…"
          : `왕복 이동${measured ? " + 머문 시간" : ""}을 빼고 남는 곳 ${rows.length}곳`
            + (measured ? ` · 그중 ${measured}곳은 머문 시간이 측정됐습니다`
                        : " · 아직 머문 시간이 측정된 곳이 없어 이동만 계산했습니다")}
      </Text>
      {rows != null && !rows.length && (
        <Text style={s.dim}>이 시간 안에 다녀올 수 있는 곳을 못 찾았습니다.</Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {(rows ?? []).map((r) => (
          <View key={r.place_id} style={[s.card, s.cardFlat]}>
            <Text style={s.name} numberOfLines={2}>{r.name}</Text>
            <Text style={s.meta} numberOfLines={1}>{(CAT[r.category] ?? CAT.etc).k}</Text>
            <Text style={s.dist}>편도 {r.drive_min}분</Text>
            <Text style={r.stay_min != null ? s.stayOn : s.stayOff}>
              {r.stay_min != null
                ? `보통 ${r.stay_min}분 머뭅니다 · ${r.stay_parties}팀`
                : "머문 시간 미측정"}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  h1: { color: C.text, fontSize: 19, fontWeight: "700", paddingHorizontal: 18, paddingTop: 58 },
  sub: { color: C.muted, fontSize: 11.5, lineHeight: 18, paddingHorizontal: 18, paddingTop: 5 },
  chips: { paddingHorizontal: 18, paddingVertical: 12, gap: 6 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipT: { color: C.muted, fontSize: 12, fontWeight: "600" },
  chipTOn: { color: "#fff" },
  rail: { marginTop: 18 },
  railT: { color: C.text, fontSize: 15, fontWeight: "700", paddingHorizontal: 18 },
  railWhy: { color: C.muted, fontSize: 11, paddingHorizontal: 18, marginTop: 3, marginBottom: 9 },
  row: { paddingHorizontal: 18, gap: 10 },
  cardFlat: { justifyContent: "flex-start", gap: 3, paddingTop: 10 },
  stayOn: { color: C.accent, fontSize: 10.5, fontWeight: "600" },
  stayOff: { color: C.muted, fontSize: 10.5 },
  card: { width: 158, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: C.line,
          backgroundColor: "rgba(255,255,255,0.03)" },
  img: { width: "100%", height: 108, backgroundColor: "#222" },
  name: { color: C.text, fontSize: 13, fontWeight: "600", paddingHorizontal: 10, paddingTop: 9 },
  meta: { color: C.muted, fontSize: 10.5, paddingHorizontal: 10, paddingTop: 3 },
  dist: { color: C.muted, fontSize: 10.5, paddingHorizontal: 10, paddingVertical: 7, textAlign: "right" },
  credit: { color: C.muted, fontSize: 10, lineHeight: 16, padding: 18, marginTop: 10 },
  dim: { color: C.muted, fontSize: 12, textAlign: "center" },
});
