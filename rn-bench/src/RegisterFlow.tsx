/**
 * 등록 플로우 (§6) — 앨범 → 여행 → 정거장 → 장소 → 올리기
 *
 * ★ 웹판(upload.js 2,710줄) 중 **판정과 경로만** 옮겼다. 드래그 이동·크롭·OCR 은
 *   화면에 붙은 코드라 이식이 아니라 재작성이다 — 지금 필요한 건 §6 의
 *   **끝에서 끝까지가 RN 에서 도는가** 이고, 그 답에 저 셋은 필요 없다.
 *
 * ★ 화면 수를 웹의 절반으로 줄였다. 웹은 마우스라 한 화면에 많이 놓을 수 있지만,
 *   폰에서는 목록 하나에 한 가지만 물어야 한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { C, CAT } from "./theme";
import * as API from "./api";
import * as Q from "./uploadQueue";
import { ensurePermission, scanAlbum, SCAN_MAX, UNKNOWN_ACC_M } from "./album";

/* ★ 이보다 멀면 **자동으로 안 붙인다**(§13.70). 기획 §8 이 말한 50m 를 기준으로
   삼되, 앨범 사진은 EXIF 정확도를 들고 오지 않아 조금 넉넉히 본다.
   틀린 장소가 조용히 들어가는 것은 **안 붙이는 것보다 나쁘다.** */
const AUTO_MATCH_M = 80;
import {
  clusterTrips, findOrphans, findNoGps, splitStop, fmtRange,
  type Photo, type Trip, type Stop,
} from "./cluster";

type Step = "intro" | "trips" | "stops" | "place" | "done";

export function RegisterFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [busy, setBusy] = useState<string | null>(null);
  const [album, setAlbum] = useState<Photo[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [placeOf, setPlaceOf] = useState<Record<string, any>>({});
  const [pickFor, setPickFor] = useState<Stop | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [result, setResult] = useState<any>(null);

  const uriOf = useCallback(
    (id: string) => album.find((p) => p.id === id)?.uri, [album]);

  async function scan() {
    const perm = await ensurePermission();
    if (!perm.granted && perm.status !== "granted") {
      setBusy(null);
      setResult({ ok: false, why: "사진 접근이 허용되지 않았습니다" });
      return setStep("done");
    }
    setBusy("앨범을 읽는 중…");
    const a = await scanAlbum((d, t) => setBusy(`사진 ${d} / ${t}`));
    const ts = clusterTrips(a);
    const orph = findOrphans(a, ts);
    /* ★ 좌표 없는 사진은 **따로** 낸다(§13.72). 섞으면 스크린샷이 낱개 기록을
       덮는다. 없으면 줄도 만들지 않는다 — 빈 줄은 길을 늘리기만 한다. */
    const ng = findNoGps(a, ts);
    setAlbum(a);
    setTrips([...ts,
      ...(orph.stops.length ? [orph] : []),
      ...(ng.stops.length ? [ng] : [])]);
    setBusy(null);
    setStep("trips");
  }

  function openTrip(t: Trip) {
    setTrip(t);
    setStops(t.stops);
    /* ★ 기본은 **정거장마다 첫 사진 한 장**. 전부 켜 두면 첫 등록에 수십 장이
       올라가고, 다 꺼 두면 아무것도 안 올라간다. 대표 1장이 §6 의 약속이다. */
    const p: Record<string, string[]> = {};
    t.stops.forEach((st) => { if (st.items[0]) p[st.id] = [st.items[0].id]; });
    setPicks(p); setMemos({}); setPlaceOf({});
    setStep("stops");
    void autoMatch(t.stops);          // ★ 아래 — 기획은 **자동이 기본**이다
  }

  /* ── 자동 매칭 (§13.70) ───────────────────────────────────────────
     ★ 원본 기획 §4-B: *"앱이 EXIF 위치값으로 … **자동 매칭한다**"*
       §8: *"자동 매칭되지 않을 경우 … 수동 검색 팝업을 **제공**한다"*
     → **자동이 기본이고 수동이 대비책**인데, 우리는 수동만 만들어 놨다.
       그래서 사람들이 장소를 안 골랐고, `place_id` 가 null 인 핀이 쌓였다.
       그 하나가 `place_stats`·표지 로그·`모두의 지도` 공개를 **동시에** 막고 있었다.

     ★ **가까운 것만** 고른다. 기획이 말한 50m 를 기준으로 삼되, 앨범 사진은
       정확도를 모르므로(UNKNOWN_ACC_M) 조금 넉넉히 본다. 멀리 있는 후보를
       자동으로 붙이면 **틀린 장소가 조용히 들어간다** — 그건 안 붙이는 것보다 나쁘다.
     ★ 자동으로 고른 것은 **표시한다.** 사용자가 *"내가 고른 것"* 과 구별할 수
       있어야 고칠 마음이 생긴다. */
  async function autoMatch(list: Stop[]) {
    for (const st of list) {
      if (!st.c) continue;
      const r = await API.candidates(st.c.lat, st.c.lng, UNKNOWN_ACC_M, null, 0, 3);
      const top = r.ok ? (r.data ?? [])[0] : null;
      if (!top || (top.dist_m ?? 9999) > AUTO_MATCH_M) continue;
      setPlaceOf((m) => (m[st.id] ? m : {
        ...m,
        [st.id]: { placeId: top.place_id, name: top.name,
                   category: top.category, auto: true },
      }));
    }
  }

  async function commit() {
    setBusy("올리는 중…");
    await API.ensureSession();   // 지워진 계정을 들고 있으면 여기서 다시 든다
    const r = await API.pushTrip(trip, stops, {
      picks, placeOf, memos, uriOf, isPublic,
      onStep: (d, t) => setBusy(`올리는 중 ${d} / ${t}`),
      queue: Q.enqueue,
    });
    setBusy(null); setResult(r); setStep("done");
    /* ★ '완료'를 그린 **뒤에** 큐를 민다. 먼저 밀면 이 화면이 그 앞에서 기다린다 —
       나누어 올리는 이유가 사라진다. */
    void Q.start();
  }

  /* ★ 셈은 **올라갈 것만** 센다. 좌표도 없고 장소도 안 고른 정거장은 서버에 못
     넣는다 — 세어 놓고 실패시키면 *"3곳 등록"* 을 누른 사람이 완료 화면에서
     2곳을 받는다. 숫자가 틀리는 것이 버튼이 굼뜬 것보다 나쁘다(§13.72). */
  const chosen = useMemo(
    () => stops.filter((st) =>
      (picks[st.id] || []).length && (st.c || placeOf[st.id]?.lat != null)),
    [stops, picks, placeOf]);
  /* 대표를 뺀 장수 — 이만큼이 뒤에서 올라간다 */
  const extra = useMemo(
    () => chosen.reduce((n, st) => n + Math.max(0, (picks[st.id] || []).length - 1), 0),
    [chosen, picks]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.head}>
          <Pressable onPress={step === "stops" ? () => setStep("trips") : onClose} hitSlop={12}>
            <Text style={s.headBtn}>{step === "stops" ? "‹ 여행" : "✕"}</Text>
          </Pressable>
          <Text style={s.headTitle}>
            {step === "intro" ? "기록 추가" : step === "trips" ? "찾은 여행"
              : step === "stops" ? (trip?.title ?? "") : "완료"}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {busy ? (
          <View style={s.center}>
            <ActivityIndicator color={C.accent} />
            <Text style={s.busy}>{busy}</Text>
            <Text style={s.hint}>
              사진은 기기 안에서만 읽습니다. 올릴 사진은 직접 고른 것뿐입니다.
            </Text>
          </View>
        ) : step === "intro" ? (
          <Intro onScan={scan} />
        ) : step === "trips" ? (
          <TripList trips={trips} onOpen={openTrip} />
        ) : step === "stops" ? (
          <StopList
            stops={stops} picks={picks} memos={memos} placeOf={placeOf}
            isPublic={isPublic} uriOf={uriOf} count={chosen.length} extra={extra}
            onToggle={(st, id) => setPicks((p) => {
              const cur = p[st.id] || [];
              return { ...p, [st.id]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
            })}
            onAll={(st) => setPicks((p) => ({
              ...p,
              /* 다 켜져 있으면 대표만 남긴다. 되돌릴 수 없는 토글은 만들지 않는다. */
              [st.id]: (p[st.id] || []).length >= st.items.length
                ? st.items.slice(0, 1).map((i) => i.id)
                : st.items.map((i) => i.id),
            }))}
            onSplit={(id) => setStops((ss) => splitStop(ss, id))}
            onMemo={(id, v) => setMemos((m) => ({ ...m, [id]: v }))}
            onPickPlace={setPickFor}
            onPublic={setIsPublic}
            onCommit={commit}
          />
        ) : (
          <Done result={result} onClose={onClose} />
        )}

        {pickFor && (
          <PlacePicker
            stop={pickFor}
            onClose={() => setPickFor(null)}
            onPick={(pl) => {
              /* 사람이 고른 것은 **자동 표시를 뗀다** — 그게 확정이다 */
              setPlaceOf((m) => ({ ...m, [pickFor.id]: { ...pl, auto: false } }));
              setPickFor(null);
            }}
          />
        )}
      </View>
    </Modal>
  );
}

/* ── S1 진입 ─────────────────────────────────────────────────── */
function Intro({ onScan }: { onScan: () => void }) {
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Pressable style={s.entry} onPress={onScan}>
        <Text style={s.entryIcon}>🖼️</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.entryT}>사진에서</Text>
          <Text style={s.entryS}>앨범을 스캔해 여행 단위로 한 번에 — 소급 등록</Text>
        </View>
        <Text style={s.entryArrow}>›</Text>
      </Pressable>
      <View style={s.note}>
        <Text style={s.noteT}>무엇을 읽습니까</Text>
        <Text style={s.noteB}>
          촬영 시각과 좌표, 두 가지뿐입니다. 파일 이름·얼굴·앨범 이름은 읽지 않습니다.{"\n"}
          최근 {SCAN_MAX}장까지 살펴 여행을 묶고, 그중 직접 고르신 사진만 올라갑니다.
        </Text>
      </View>
    </ScrollView>
  );
}

/* ── S2 여행 목록 ────────────────────────────────────────────── */
function TripList({ trips, onOpen }: { trips: Trip[]; onOpen: (t: Trip) => void }) {
  if (!trips.length)
    return (
      <View style={s.center}>
        <Text style={s.empty}>여행으로 묶을 사진을 찾지 못했습니다</Text>
        <Text style={s.hint}>
          좌표가 있는 사진이 이틀 안에 두 장 이상이어야 한 여행이 됩니다.
        </Text>
      </View>
    );
  return (
    <ScrollView contentContainerStyle={s.body}>
      {trips.map((t) => (
        <Pressable key={t.id} style={s.card} onPress={() => onOpen(t)}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardT}>{t.title}</Text>
            <Text style={s.cardS}>
              {t.id === "nogps"
                ? `사진 ${t.items.length}장 · 위치를 직접 지정하면 등록됩니다`
                : `${fmtRange(t.start, t.end)} · 정거장 ${t.stops.length}곳 · 사진 ${t.items.length}장`}
            </Text>
          </View>
          <Text style={s.entryArrow}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/* ── S3 정거장 ───────────────────────────────────────────────── */
function StopList(p: {
  stops: Stop[]; picks: Record<string, string[]>; memos: Record<string, string>;
  placeOf: Record<string, any>; isPublic: boolean; count: number; extra: number;
  uriOf: (id: string) => string | undefined;
  onToggle: (st: Stop, id: string) => void; onSplit: (id: string) => void;
  onAll: (st: Stop) => void;
  onMemo: (id: string, v: string) => void; onPickPlace: (st: Stop) => void;
  onPublic: (v: boolean) => void; onCommit: () => void;
}) {
  return (
    <>
      <ScrollView contentContainerStyle={[s.body, { paddingBottom: 120 }]}>
        {p.stops.map((st, i) => {
          const sel = p.picks[st.id] || [];
          const pl = p.placeOf[st.id];
          return (
            <View key={st.id} style={s.stop}>
              <View style={s.stopHead}>
                <Text style={s.stopN}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardT}>
                    {pl ? pl.name : "장소를 고르지 않았습니다"}
                  </Text>
                  <Text style={s.cardS}>
                    {new Date(st.start).toLocaleString("ko-KR", {
                      month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {" · 사진 "}{st.items.length}장
                    {st.noGpsCount ? ` · 좌표 없음 ${st.noGpsCount}장` : ""}
                  </Text>
                </View>
                {st.items.length > 1 && (
                  <>
                    {/* 대표만 먼저 올라가고 나머지는 뒤에서 올라간다 — 여기서 고른다 */}
                    <Pressable onPress={() => p.onAll(st)} hitSlop={8}>
                      <Text style={s.split}>
                        {sel.length >= st.items.length ? "대표만" : "전부"}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => p.onSplit(st.id)} hitSlop={8}>
                      <Text style={s.split}>쪼개기</Text>
                    </Pressable>
                  </>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                          contentContainerStyle={s.strip}>
                {st.items.slice(0, 20).map((it) => {
                  const on = sel.includes(it.id);
                  return (
                    <Pressable key={it.id} onPress={() => p.onToggle(st, it.id)}>
                      <Image source={{ uri: it.uri }} style={[s.thumb, on && s.thumbOn]} />
                      {on && <Text style={s.tick}>
                        {sel[0] === it.id ? "대표" : "✓"}
                      </Text>}
                      {!it.gps && <Text style={s.noGps}>위치 없음</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Pressable style={s.row} onPress={() => p.onPickPlace(st)}>
                {/* ★ 좌표가 없는 정거장에서 '장소'는 **선택이 아니라 위치 지정**이다.
                    같은 칸이 상황에 따라 다른 무게를 가지므로 말도 달라야 한다 —
                    그냥 "고르기" 라고만 두면 건너뛰어도 되는 줄로 읽힌다. */}
                <Text style={s.rowK}>{st.c ? "장소" : "위치"}</Text>
                <Text style={[s.rowV, !pl && { color: C.warn }]}>
                  {pl ? `${pl.name}${pl.auto ? " (자동) ›" : " ›"}`
                      : st.c ? "고르기 ›" : "장소를 골라 지정 ›"}
                </Text>
              </Pressable>
              {!st.c && (
                <Text style={s.hint}>
                  {pl
                    /* ★ 서버 제약(pins_public_needs_verified_geo)을 **말로 옮긴다.**
                       손으로 정한 자리는 '거기 있었다'는 근거가 없어 모두의 지도에
                       올라가지 않는다. 안 적으면 등록해 놓고 *"왜 안 뜨지"* 를 겪는다
                       — 실제로는 등록 자체가 400 으로 실패했다(§13.75). */
                    ? "손으로 정한 위치라 내 지도에만 남습니다 — 모두의 지도에는 올라가지 않습니다."
                    : "위치 정보가 없는 사진입니다. 장소를 고르셔야 지도에 올라갑니다."}
                </Text>
              )}
              <TextInput
                style={s.memo} placeholder="한 줄 메모 (선택)" placeholderTextColor={C.muted}
                value={p.memos[st.id] || ""} onChangeText={(v) => p.onMemo(st.id, v)}
              />
            </View>
          );
        })}
      </ScrollView>

      <View style={s.foot}>
        <Pressable style={s.pubRow} onPress={() => p.onPublic(!p.isPublic)}>
          <Text style={[s.box, p.isPublic && s.boxOn]}>{p.isPublic ? "✓" : ""}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowK}>모두의 지도에 올립니다</Text>
            {/* ★ 판정만 하고 말하지 않으면 "왜 안 뜨지"를 겪는다 — 올리기 전에 말한다 */}
            <Text style={s.hint}>
              장소를 고른 정거장만 지도에 뜹니다 · 손으로 정한 위치는 제외됩니다
            </Text>
          </View>
        </Pressable>
        <Pressable
          style={[s.cta, !p.count && s.ctaOff]} disabled={!p.count} onPress={p.onCommit}>
          <Text style={s.ctaT}>
            {p.count}곳 등록{p.extra ? ` · 사진 ${p.count + p.extra}장` : ""}
          </Text>
        </Pressable>
      </View>
    </>
  );
}

/* ── 장소 고르기 — 서버가 순서를 정한다 (§13.20) ───────────────── */
function PlacePicker(
  { stop, onPick, onClose }: { stop: Stop; onPick: (p: any) => void; onClose: () => void },
) {
  const [list, setList] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  /* ★ **좌표가 없는 정거장**(§13.72)에는 후보를 물어볼 수 없다 — `api_place_candidates`
     는 *"이 좌표 근처"* 를 묻는 함수라 좌표가 입력이다. 그래서 여기서는
     **검색이 유일한 길**이고, 고른 장소의 좌표가 곧 이 정거장의 좌표가 된다. */
  const noGeo = !stop.c;

  useMemo(() => {
    if (noGeo) { setList([]); return; }      // 빈 목록 + 아래 안내문
    (async () => {
      /* ★ `stop.worstAcc` 가 아니라 UNKNOWN_ACC_M 이다 — 앨범 사진은 정확도를
         안 들고 온다(album.ts 의 실측 주석). 정거장 반경과는 다른 숫자다. */
      const r = await API.candidates(stop.c!.lat, stop.c!.lng, UNKNOWN_ACC_M, null, 0, 12);
      if (r.ok) setList(r.data || []);
      else { setList([]); setErr(r.error || "서버에 닿지 못했습니다"); }
    })();
  }, [stop.id]);

  /* ★ **한 글자마다 보내지 않는다.** 한글은 조합 중에도 `onChangeText` 가 계속
     오므로 "해운대"를 치면 열 번 가까이 불린다. 마지막 입력만 보낸다(220ms).
     ★ 좌표를 **같이 보낸다** — 그 사진을 찍은 자리 근처만 찾으면 빠르고(§13.71)
       결과도 더 맞는다. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  function doSearch(text: string) {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    const t = text.trim();
    if (t.length < API.SEARCH_MIN) return;      // 1글자는 느리고 결과도 쓸모없다
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      const r = await API.search(t, 14, stop.c);
      /* 늦게 온 답이 새 답을 덮지 않게 — §13.55 에서 겪은 것과 같은 형태다 */
      if (r.ok && mine === seq.current) setList(r.data || []);
    }, 220);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.head}>
          <Pressable onPress={onClose} hitSlop={12}><Text style={s.headBtn}>✕</Text></Pressable>
          <Text style={s.headTitle}>장소 고르기</Text>
          <View style={{ width: 44 }} />
        </View>
        <TextInput
          style={s.search} value={q} onChangeText={doSearch}
          placeholder={`이름으로 찾기 (${API.SEARCH_MIN}자 이상)`}
          placeholderTextColor={C.muted} />
        {list === null ? (
          <View style={s.center}><ActivityIndicator color={C.accent} /></View>
        ) : (
          <ScrollView contentContainerStyle={s.body}>
            {err && <Text style={s.err}>{err}</Text>}
            {noGeo && !list.length && !q && (
              <Text style={s.empty}>
                이 사진들에는 위치 정보가 없습니다.{"\n"}
                장소를 찾아서 고르시면 그 자리로 기록됩니다.
              </Text>
            )}
            {!!(list.length === 0 && (q || !noGeo)) && (
              <Text style={s.empty}>후보가 없습니다</Text>
            )}
            {/* ★ 검색 결과에는 **지역**(`kind:'region'`)이 섞여 있다(053). 지역에는
                `place_id` 가 없어 `c.id` 인 지역코드가 대신 들어가는데, 그건 uuid 가
                아니라 `pins.place_id` 에 넣는 순간 **등록이 통째로 실패한다.**
                지금까지는 좌표가 있는 정거장에서 후보 목록이 먼저 떠 있어 잘 안 눌렸지만,
                좌표 없는 정거장에서는 **검색이 유일한 길**이라 반드시 마주친다. */}
            {list.filter((c: any) => c.kind !== "region").map((c: any) => (
              <Pressable
                key={c.place_id ?? c.id}
                style={s.card}
                onPress={() => onPick({
                  placeId: c.place_id ?? c.id, name: c.name, category: c.category,
                  /* ★ 검색은 좌표를 준다(053). 좌표 없는 정거장은 **이 값으로** 자리를
                     얻는다 — 서버가 이미 보내 주는 것을 버려서 기능이 막히는 일이
                     이번이 네 번째다(§13.52·§13.60·§13.69). */
                  lng: c.lng ?? null, lat: c.lat ?? null,
                })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardT}>{c.name}</Text>
                  <Text style={s.cardS}>
                    {(CAT[c.category]?.k) || c.category || c.sub || "기타"}
                    {c.dist_m != null ? ` · ${Math.round(c.dist_m)}m` : ""}
                    {c.region_name ? ` · ${c.region_name}` : ""}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/* ── 완료 — 못 올린 것을 **숨기지 않는다** ─────────────────────── */
function Done({ result, onClose }: { result: any; onClose: () => void }) {
  const failed = result?.failed || [];
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={s.doneT}>
        {result?.why ? result.why
          : `기록 ${result?.pins ?? 0}곳 · 사진 ${result?.media ?? 0}장을 올렸습니다`}
      </Text>
      {!!result?.bytes && (
        <Text style={s.hint}>올린 용량 {(result.bytes / 1024 / 1024).toFixed(2)}MB</Text>
      )}
      {!!result?.queued && (
        <View style={s.note}>
          <Text style={s.noteT}>나머지 {result.queued}장은 뒤에서 올립니다</Text>
          <Text style={s.noteB}>
            앱을 쓰시는 동안 한 장씩 올라갑니다. 지금 닫으셔도 됩니다 —
            다음에 여시면 남은 것부터 이어서 올립니다.
          </Text>
        </View>
      )}
      {!!failed.length && (
        <View style={s.note}>
          <Text style={s.noteT}>올리지 못한 것 {failed.length}건</Text>
          {failed.map((f: any, i: number) => (
            <Text key={i} style={s.noteB}>· {f.what} — {String(f.why).slice(0, 120)}</Text>
          ))}
        </View>
      )}
      <Pressable style={s.cta} onPress={onClose}><Text style={s.ctaT}>닫기</Text></Pressable>
    </ScrollView>
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
  body: { padding: 14, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  busy: { color: C.text, fontSize: 14 },
  hint: { color: C.muted, fontSize: 12, lineHeight: 18 },
  empty: { color: C.muted, fontSize: 14, textAlign: "center" },
  err: { color: C.warn, fontSize: 12 },

  entry: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 16,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line,
  },
  entryIcon: { fontSize: 24 },
  entryT: { color: C.text, fontSize: 15, fontWeight: "700" },
  entryS: { color: C.muted, fontSize: 12, marginTop: 2 },
  entryArrow: { color: C.muted, fontSize: 20 },

  note: { backgroundColor: C.surface, borderRadius: 12, padding: 14, gap: 6 },
  noteT: { color: C.text, fontSize: 13, fontWeight: "700" },
  noteB: { color: C.muted, fontSize: 12, lineHeight: 19 },

  card: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 14,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.line,
  },
  cardT: { color: C.text, fontSize: 14, fontWeight: "600" },
  cardS: { color: C.muted, fontSize: 12, marginTop: 3 },

  stop: {
    backgroundColor: C.surface, borderRadius: 14, padding: 12, gap: 10,
    borderWidth: 1, borderColor: C.line,
  },
  stopHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  stopN: {
    width: 24, height: 24, borderRadius: 12, textAlign: "center", lineHeight: 24,
    backgroundColor: "rgba(255,255,255,0.10)", color: C.text, fontSize: 12, fontWeight: "700",
  },
  split: { color: C.warn, fontSize: 12, fontWeight: "600" },
  strip: { gap: 8 },
  thumb: { width: 74, height: 74, borderRadius: 10, backgroundColor: "#222" },
  thumbOn: { borderWidth: 2, borderColor: C.accent },
  tick: {
    position: "absolute", right: 4, bottom: 4, color: C.onAccent, fontSize: 10,
    fontWeight: "700", backgroundColor: C.accent, paddingHorizontal: 5,
    paddingVertical: 1, borderRadius: 6, overflow: "hidden",
  },
  noGps: {
    position: "absolute", left: 4, top: 4, color: C.bg, fontSize: 9, fontWeight: "700",
    backgroundColor: C.warn, paddingHorizontal: 4, borderRadius: 5, overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowK: { color: C.text, fontSize: 13, fontWeight: "600" },
  rowV: { color: C.muted, fontSize: 13 },
  memo: {
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 10, color: C.text, fontSize: 13,
  },
  search: {
    margin: 14, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, color: C.text, fontSize: 14, borderWidth: 1, borderColor: C.line,
  },

  foot: {
    position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, gap: 10,
    backgroundColor: "rgba(14,15,19,0.96)", borderTopWidth: 1, borderTopColor: C.line,
  },
  pubRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.line,
    textAlign: "center", lineHeight: 22, color: C.onAccent, fontSize: 13,
  },
  boxOn: { backgroundColor: C.accent, borderColor: C.accent },
  cta: { backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: "center" },
  ctaOff: { opacity: 0.4 },
  ctaT: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  doneT: { color: C.text, fontSize: 16, fontWeight: "700", lineHeight: 24 },
});
