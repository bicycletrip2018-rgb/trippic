/**
 * 하루 코스 화면 (§12.25-B) — 있었던 일을 읽기 좋게 놓는다
 *
 * ★ 이 화면은 **추천하지 않는다.** 순서를 바꾸지도, 안 간 곳을 끼우지도 않는다.
 *   그래서 제목이 '추천 코스'가 아니라 **'내 하루'** 다.
 *
 * ★ 모르는 것은 모른다고 쓴다. 사진이 한 장인 정거장은 체류를 모르고,
 *   섬을 건넌 구간은 이동 시간을 모른다. **0분·42분 같은 그럴듯한 숫자가
 *   모른다는 말보다 나쁘다** — 사용자가 그걸 믿고 일정을 짜기 때문이다.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import * as API from "./api";
import { buildCourses, dur, hhmm, ymd, type Course, type CoursePin } from "./course";
import { C, CAT } from "./theme";
import { NextPlaces } from "./NextPlaces";

export function DayCourse({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);

  const [land, setLand] = useState(0);   // 표를 받으면 다시 계산한다
  useEffect(() => {
    void (async () => {
      await API.loadLandmass();          // 섬 판정은 서버와 같은 표로 (035)
      setLand((n) => n + 1);
      const r = await API.myRecords(300);
      setRows(r.data ?? []);
    })();
  }, []);

  const courses = useMemo(() => {
    if (!rows) return [];
    const pins: CoursePin[] = rows
      .map((p: any) => {
        const c = p.geom?.coordinates;
        if (!c) return null;
        const m = (p.media || []).slice().sort(
          (a: any, b: any) => Number(b.is_main) - Number(a.is_main) || a.sort_order - b.sort_order)[0];
        return {
          id: p.id, placeId: p.place_id, regionCode: p.region_code,
          visited_at: p.visited_at, stay_sec: p.stay_sec,
          category: p.category, memo: p.memo,
          lng: c[0], lat: c[1], photo: m?.url ?? null,
        } as CoursePin;
      })
      .filter(Boolean) as CoursePin[];
    return buildCourses(pins, 2, API.landmassOf);
  }, [rows, land]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.head}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.headBtn}>✕</Text></Pressable>
          <Text style={s.headTitle}>내 하루</Text>
          <View style={{ width: 44 }} />
        </View>

        {rows === null ? (
          <View style={s.center}><ActivityIndicator color={C.accent} /></View>
        ) : !courses.length ? (
          <View style={s.center}>
            <Text style={s.empty}>아직 코스로 만들 하루가 없습니다</Text>
            <Text style={s.hint}>
              하루에 두 곳 이상 기록된 날이 있어야 코스가 됩니다.{"\n"}
              한 곳만 있는 날은 순서가 없어서 코스가 아닙니다.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.body}>
            {/* ★ 이 화면이 무엇인지 먼저 말한다 — '추천'으로 오해하면 없는 근거를 믿게 된다 */}
            <View style={s.note}>
              <Text style={s.noteT}>사진에서 복원했습니다</Text>
              <Text style={s.noteB}>
                촬영 시각과 위치로 그날의 순서를 되살린 것입니다. 추천이 아니라
                실제로 다니신 길이고, 체류 시간은 사진 기준이라 실제보다 짧을 수 있습니다.
              </Text>
            </View>
            {courses.map((c) => <CourseCard key={c.id} c={c} />)}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function CourseCard({ c }: { c: Course }) {
  const stay = dur(c.staySec), move = dur(c.moveSec), span = dur(c.spanSec);
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.date}>{ymd(c.date)}</Text>
        <Text style={s.sub}>{c.stops.length}곳 · {hhmm(c.startAt)}–{hhmm(c.endAt)}</Text>
      </View>

      {c.stops.map((p, i) => {
        const leg = i > 0 ? c.legs[i - 1] : null;
        const st = dur(p.stay_sec);
        return (
          <View key={p.id}>
            {leg && (
              <View style={s.leg}>
                <View style={s.legLine} />
                <Text style={s.legT}>
                  {leg.crossSea
                    /* ★ 직선×1.4 는 바다 위에서 거짓말이다. 숫자 대신 사실을 쓴다 */
                    ? "육로로 이어지지 않습니다 — 배·비행기"
                    : `${(leg.distM / 1000).toFixed(1)}km · 차로 ${dur(leg.moveSec) ?? "—"}`}
                </Text>
              </View>
            )}
            <View style={s.stop}>
              {p.photo
                ? <Image source={{ uri: p.photo }} style={s.thumb} />
                : <View style={[s.thumb, s.thumbNone]}><Text style={s.thumbX}>사진 없음</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={s.time}>{hhmm(new Date(p.visited_at))}</Text>
                <Text style={s.name} numberOfLines={1}>
                  {p.memo?.trim() || (CAT[p.category || "etc"]?.k ?? "기록")}
                </Text>
                {/* ★ 0분을 쓰지 않는다 — 사진 한 장이면 **모르는** 것이다 */}
                <Text style={s.stay}>{st ? `${st} 머물렀습니다` : "머문 시간은 알 수 없습니다"}</Text>
              </View>
            </View>
            {/* ★ 여기까지는 **내 기록의 복원**이고, 아래 한 조각만 **남들의 집계**다.
                섞이지 않게 제목으로 가른다 — 둘을 구분 못 하면 둘 다 못 믿는다. */}
            {p.placeId && <NextPlaces placeId={p.placeId} />}
          </View>
        );
      })}

      <View style={s.sum}>
        <Text style={s.sumT}>
          {span ? `기록이 덮은 시간 ${span}` : ""}
          {stay ? ` · 머문 시간 ${stay}` : ""}
          {move ? ` · 이동 ${move}` : ""}
        </Text>
        {/* ★ 세 숫자를 나란히 놓으면 합이 안 맞는다. 모르는 시간을 **이름 붙여** 내놓는다 */}
        {!!dur(c.gapSec) && (
          <Text style={s.hint}>
            사진이 없는 {dur(c.gapSec)}은 무엇을 하셨는지 알 수 없습니다.
          </Text>
        )}
        {(c.stayUnknown > 0 || c.crossSea > 0) && (
          <Text style={s.hint}>
            {c.stayUnknown > 0 ? `${c.stayUnknown}곳은 사진이 한 장이라 머문 시간을 세지 못했습니다. ` : ""}
            {c.crossSea > 0 ? `${c.crossSea}구간은 바다를 건너 차 시간을 셀 수 없습니다.` : ""}
          </Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: 54 },
  head: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 14,
    paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  headBtn: { color: C.text, fontSize: 16, width: 44 },
  headTitle: { flex: 1, color: C.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  body: { padding: 14, gap: 12, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  empty: { color: C.text, fontSize: 15, fontWeight: "600", textAlign: "center" },
  hint: { color: C.muted, fontSize: 11.5, lineHeight: 18 },

  note: { backgroundColor: C.surface, borderRadius: 12, padding: 14, gap: 6 },
  noteT: { color: C.text, fontSize: 13, fontWeight: "700" },
  noteB: { color: C.muted, fontSize: 12, lineHeight: 19 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14, gap: 2,
    borderWidth: 1, borderColor: C.line,
  },
  cardHead: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 8 },
  date: { color: C.text, fontSize: 15, fontWeight: "700" },
  sub: { color: C.muted, fontSize: 12 },

  stop: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 4 },
  thumb: { width: 52, height: 52, borderRadius: 9, backgroundColor: "#222" },
  thumbNone: { alignItems: "center", justifyContent: "center" },
  thumbX: { color: C.muted, fontSize: 9 },
  time: { color: C.accent, fontSize: 12, fontWeight: "700" },
  name: { color: C.text, fontSize: 13.5, fontWeight: "600", marginTop: 1 },
  stay: { color: C.muted, fontSize: 11.5, marginTop: 2 },

  leg: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 25, paddingVertical: 2 },
  legLine: { width: 2, height: 18, backgroundColor: C.line, borderRadius: 1 },
  legT: { color: C.muted, fontSize: 11 },

  sum: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, gap: 4 },
  sumT: { color: C.text, fontSize: 12, fontWeight: "600" },
});
