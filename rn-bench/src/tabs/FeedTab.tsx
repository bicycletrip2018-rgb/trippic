/**
 * 탭2 `갈 곳` — **서버가 답한다** (§12.10 · §13.81)
 *
 * ★ 단위는 사진이 아니라 **장소**다. 사진이 0장이어도 카드가 남는다 —
 *   그래서 첫날에도 화면이 찬다.
 * ★ 무한 피드가 아니라 **이유가 붙은 묶음**이다. 묶음마다 왜 떴는지 한 줄을 적는다.
 *
 * ★ **씨앗 파일을 걷어냈다**(§13.81). 예전에는 `http://localhost:5173/feed-seed.json`
 *   을 받아 그려서, **개발 서버가 없으면 이 탭이 통째로 빈 화면**이었다.
 *   출시하면 안 도는 화면을 고도화하고 있었던 셈이다.
 *   이제 `api_feed_rails` 가 답한다 — 장소도 9,696곳에서 **465,914곳**으로 늘었다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { C, CAT } from "../theme";
import { driveText as courseDriveText } from "../course";
import * as API from "../api";
import { sawCover, openedCover, flushCovers } from "../coverLog";

/* ★ 카드 치수를 상수로 올린다 — 아래 `Rail` 이 **무엇이 보이는지** 계산하는 데
   쓴다. 스타일에만 적어 두면 둘이 조용히 어긋난다. */
const CARD_W = 158, CARD_GAP = 10, RAIL_PAD = 18;
const STRIDE = CARD_W + CARD_GAP;

/* ★ 시간 예산 (§12.25-C) — 사람이 실제로 묻는 것은 "근처 어디"가 아니라
   **"지금 3시간 비는데 어디 갈까"** 다. 왕복 이동과 머무는 시간을 빼야 답이 된다.
   ★ 체류 시간은 §13.32 에서 서버에 남겼다 — 남들은 이 값을 모른다. */
const BUDGETS: [number, string][] = [[120, "2시간"], [240, "반나절"], [480, "하루"]];
const THIS_MONTH = new Date().getMonth() + 1;

const RAILS: { k: API.FeedRow["rail"]; t: string; why: string }[] = [
  { k: "live",   t: "지금 하는 행사", why: "오늘 열려 있는 곳 · 가까운 순" },
  { k: "soon",   t: "곧 시작합니다", why: "날짜가 잡힌 행사" },
  { k: "near",   t: "여기서 가까운", why: "지도에서 보던 자리 기준 · 가까운 순" },
  /* ★ 이제 **진짜로** 안 가본 곳이다 — 서버가 내 핀을 빼고 준다(§13.81).
     씨앗판은 어디를 가 봤는지 모른 채 이 이름을 달고 있었다. */
  { k: "unseen", t: "아직 안 가본 곳", why: "기록이 없는 곳 · 지역마다 하나씩" },
];

export function FeedTab(
  { center, onOpenMap }: {
    center: { lat: number; lng: number };
    /** 카드를 누르면 **지도로 보낸다**(§13.74). 여는 곳이 없으면 누를 이유도 없다 */
    onOpenMap?: (p: { lng: number; lat: number; name: string }) => void;
  },
) {
  const [rows, setRows] = useState<API.FeedRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [budgetRows, setBudgetRows] = useState<API.BudgetPlace[] | null>(null);
  const [season, setSeason] = useState(false);
  const [seasonRows, setSeasonRows] = useState<API.MonthPlace[] | null>(null);

  /* ★ 보던 자리가 바뀌면 다시 묻는다. `center` 는 지도의 실제 중심이다(§13.74). */
  useEffect(() => {
    let live = true;
    setRows(null); setErr(null);
    void API.feedRails(center.lat, center.lng).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data ?? []);
      else setErr(r.error ?? "불러오지 못했습니다");
    });
    return () => { live = false; };
  }, [center.lat, center.lng]);

  const rails = useMemo(() => {
    if (!rows) return [];
    return RAILS
      .map((r) => ({ ...r, items: rows.filter((x) => x.rail === r.k) }))
      .filter((r) => r.items.length);
  }, [rows]);

  /* ── 표지 (§12.25-A) ─────────────────────────────────────────────
     029 가 고른 표지를 **읽어 온다.** 여기서 다시 고르지 않는다. */
  const shownIds = useMemo(
    () => [...new Set(rails.flatMap((r) => r.items.map((x) => x.place_id)))], [rails]);

  const [covers, setCovers] = useState<Record<string, API.PlaceCover>>({});
  useEffect(() => {
    if (!shownIds.length) return;
    let live = true;
    void API.placeCovers(shownIds).then((r) => {
      if (!live || !r.ok) return;
      setCovers((m) => {
        const next = { ...m };
        for (const c of r.data ?? []) next[c.place_id] = c;
        return next;
      });
    });
    return () => { live = false; };
  }, [shownIds.join(",")]);

  /* 쌓인 노출을 내보낸다. 화면을 떠날 때 한 번 — §13.69 와 같은 장치다. */
  useEffect(() => () => { void flushCovers(); }, []);

  /* 예산을 고르면 **서버가** 답한다 — 체류 시간은 서버에만 있다. */
  useEffect(() => {
    if (budget == null) { setBudgetRows(null); return; }
    let live = true;
    setBudgetRows(null);
    void API.placesInBudget(center.lat, center.lng, budget, { limit: 24 })
      .then((r) => { if (live) setBudgetRows(r.data ?? []); });
    return () => { live = false; };
  }, [budget, center.lat, center.lng]);

  useEffect(() => {
    if (!season) { setSeasonRows(null); return; }
    let live = true;
    setSeasonRows(null);
    void API.placesByMonth(center.lat, center.lng, THIS_MONTH, { limit: 24 })
      .then((r) => { if (live) setSeasonRows(r.data ?? []); });
    return () => { live = false; };
  }, [season, center.lat, center.lng]);

  if (err) return <View style={s.center}><Text style={s.dim}>{err}</Text></View>;
  if (!rows) return <View style={s.center}><ActivityIndicator color={C.accent} /></View>;

  return (
    <ScrollView style={s.wrap} contentContainerStyle={{ paddingBottom: 110 }}>
      <Text style={s.h1}>갈 곳</Text>
      <Text style={s.sub}>왜 떴는지 묶음마다 적어 둡니다 — 우리 추천은 설명할 수 있어야 합니다.</Text>

      {/* ★ **컨셉 칩을 뺐다**(§13.81). §12.25-A 가 실측해 둔 대로 태그가 붙은 곳이
          3%뿐이라(서버에서는 465,914곳 중 431곳 = 0.09%) 누르는 순간 전국에
          수십 곳만 남고 *"여기서 가까운"* 이 뜻을 잃는다.
          §12.25-C 가 *"시간 예산으로 대체한다"* 고 이미 정해 뒀던 것을 이제 지킨다.
          ★ 다시 누르면 꺼진다 — 되돌릴 수 없는 토글은 만들지 않는다. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {BUDGETS.map(([m, label]) => (
          <Chip key={m} label={label} on={budget === m}
                onPress={() => setBudget(budget === m ? null : m)} />
        ))}
        <Chip label={`${THIS_MONTH}월에 찍힌 사진`} on={season} onPress={() => setSeason(!season)} />
      </ScrollView>

      {budget != null && <BudgetRail budget={budget} rows={budgetRows} />}
      {season && <SeasonRail rows={seasonRows} />}

      {!rails.length && (
        <Text style={s.dim}>
          이 자리 둘레에는 보여 드릴 곳을 찾지 못했습니다. 지도를 옮겨 보십시오.
        </Text>
      )}
      {rails.map((r) => (
        <Rail key={r.k} title={r.t} why={r.why} items={r.items}
              covers={covers} onOpenMap={onOpenMap} />
      ))}
      <Text style={s.credit}>장소·사진 출처 한국관광공사 · 경계 © OpenStreetMap contributors</Text>
    </ScrollView>
  );
}

/* ── 묶음 하나 ────────────────────────────────────────────────────
   ★ **노출은 '그려졌다'가 아니라 '보였다'다**(§13.9). 가로 묶음은 화면 밖
     카드까지 전부 그린다. 그걸 다 세면 분모가 부풀어 **모든 점수가 0으로
     수렴하고 순위가 뒤집힌다.** 실측: 그린 카드 48장 → 센 노출 8장.
   ★ 지도(§13.69)에서는 이 계산이 필요 없었다 — 거기서는 화면 안의 카드만 추려
     그리기 때문이다. 같은 `coverLog` 를 쓰되 **무엇이 보이는가는 화면마다 다르게**
     판정해야 한다. */
const DWELL_MS = 500;

function Rail(
  { title, why, items, covers, onOpenMap }: {
    title: string; why: string; items: API.FeedRow[];
    covers: Record<string, API.PlaceCover>;
    onOpenMap?: (p: { lng: number; lat: number; name: string }) => void;
  },
) {
  const x = useRef(0);
  const w = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 지금 화면에 걸쳐 있는 칸을 그대로 센다. 반 이상 보이는 것만 —
     가장자리에 살짝 걸친 카드는 본 것이 아니다. */
  function markSeen() {
    if (!w.current) return;
    const left = x.current, right = left + w.current;
    for (let i = 0; i < items.length; i++) {
      const a = RAIL_PAD + i * STRIDE, b = a + CARD_W;
      const vis = Math.min(b, right) - Math.max(a, left);
      if (vis >= CARD_W / 2) sawCover(items[i].place_id);
    }
  }
  const settle = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(markSeen, DWELL_MS);
  };
  useEffect(() => { settle(); return () => { if (timer.current) clearTimeout(timer.current); };
  }, [items.map((i) => i.place_id).join(",")]);

  return (
    <View style={s.rail}>
      <Text style={s.railT}>{title}</Text>
      <Text style={s.railWhy}>{why}</Text>
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}
        scrollEventThrottle={64}
        onLayout={(e) => { w.current = e.nativeEvent.layout.width; settle(); }}
        onScroll={(e) => { x.current = e.nativeEvent.contentOffset.x; settle(); }}>
        {items.map((it) => (
          <Card key={`${it.rail}-${it.place_id}`} x={it}
                cover={covers[it.place_id]} onOpenMap={onOpenMap} />
        ))}
      </ScrollView>
    </View>
  );
}

const ymd = (d: string) => d.slice(5).replace("-", ".");

function Card(
  { x, cover, onOpenMap }: {
    x: API.FeedRow;
    cover?: API.PlaceCover;
    onOpenMap?: (p: { lng: number; lat: number; name: string }) => void;
  },
) {
  /* ★ 기관 사진 URL 중 일부는 **404** 다(§13.8 곁가지). 깨진 표지는 회색 칸으로
     남는데, 그게 카드 하나를 통째로 못 쓰게 만든다. 못 받으면 사진 없이 그린다 —
     이름과 거리만으로도 카드는 제 일을 한다. */
  const [broken, setBroken] = useState(false);
  const uri = cover?.thumb_url || x.thumb_url || x.image_url || undefined;
  const mine = !!cover?.author;

  return (
    <Pressable
      style={s.card}
      onPress={() => {
        /* **열었다**는 것은 노출의 부분집합이다(§13.9 규칙 2). */
        openedCover(x.place_id);
        onOpenMap?.({ lng: x.lng, lat: x.lat, name: x.name });
      }}>
      {!uri || broken
        ? <View style={[s.img, s.imgBroken]}><Text style={s.dim}>사진 없음</Text></View>
        : <Image source={{ uri }} style={s.img} onError={() => setBroken(true)} />}
      <Text style={s.name} numberOfLines={1}>{x.name}</Text>
      <Text style={s.meta} numberOfLines={1}>
        {(CAT[x.category] ?? CAT.etc).k}
        {x.region_name ? ` · ${x.region_name}` : ""}
      </Text>
      {/* ★ 거리는 **서버가 준 것**을 쓴다. 앱에서 다시 재면 같은 곳을 두 화면이
          다르게 말한다(§13.34 에서 합쳐 놓은 것을 되돌리지 않는다). */}
      <Text style={s.dist}>{courseDriveText(x.dist_m)}</Text>
      {/* ★ 출처를 적는 것이 §12.25-A 의 **절반**이다. */}
      {mine
        ? <Text style={s.byUser}>@{cover!.author}의 사진</Text>
        : x.event_start
          ? <Text style={s.unknownWhen}>
              {ymd(x.event_start)}
              {x.event_end && x.event_end !== x.event_start ? `–${ymd(x.event_end)}` : ""}
              {" · 한국관광공사"}
            </Text>
          : <Text style={s.unknownWhen}>촬영 시기 미상 · 한국관광공사</Text>}
    </Pressable>
  );
}

const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable style={[s.chip, on && s.chipOn]} onPress={onPress}>
    <Text style={[s.chipT, on && s.chipTOn]}>{label}</Text>
  </Pressable>
);

/* ★ 계절 축 (§12.25-D) — 관광공사 사진은 대개 **성수기 최상 조건**이다.
   11월에 벚꽃 사진을 보고 가면 실망한다. 그런데 그 사진들에는 촬영 시각이 없다.
   → 사용자 사진의 달만 셀 수 있고, 기관 사진에 대해서는 **모른다고 적는다.**
     정직함이 차별점이 되는 드문 자리다. */
function SeasonRail({ rows }: { rows: API.MonthPlace[] | null }) {
  return (
    <View style={s.rail}>
      <Text style={s.railT}>{THIS_MONTH}월에 찍힌 사진이 있는 곳</Text>
      <Text style={s.railWhy}>
        {rows == null ? "찾는 중…"
          : rows.length ? `사람들이 이 달에 직접 찍은 사진이 있는 곳 ${rows.length}곳`
                        : "아직 없습니다"}
      </Text>
      {rows != null && !rows.length && (
        <Text style={s.dim}>
          카드의 사진은 한국관광공사 제공이고 촬영 시기를 알 수 없습니다 —
          지금 가면 저 모습인지 보장하지 못합니다.
        </Text>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {(rows ?? []).map((r) => (
          <View key={r.place_id} style={[s.card, s.cardFlat]}>
            <Text style={s.name} numberOfLines={2}>{r.name}</Text>
            <Text style={s.meta} numberOfLines={1}>{(CAT[r.category] ?? CAT.etc).k}</Text>
            <Text style={s.stayOn}>{THIS_MONTH}월 사진 {r.photos}장 · {r.parties}팀</Text>
            <Text style={s.dist}>{courseDriveText(r.dist_m)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

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
  chipTOn: { color: C.onAccent },
  rail: { marginTop: 18 },
  railT: { color: C.text, fontSize: 15, fontWeight: "700", paddingHorizontal: 18 },
  railWhy: { color: C.muted, fontSize: 11, paddingHorizontal: 18, marginTop: 3, marginBottom: 9 },
  row: { paddingHorizontal: 18, gap: 10 },
  cardFlat: { justifyContent: "flex-start", gap: 3, paddingTop: 10 },
  unknownWhen: { color: C.muted, fontSize: 9.5, marginTop: 1, paddingHorizontal: 10, paddingBottom: 8 },
  byUser: { color: C.accent, fontSize: 9.5, marginTop: 1, paddingHorizontal: 10, paddingBottom: 8 },
  imgBroken: { alignItems: "center", justifyContent: "center" },
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
