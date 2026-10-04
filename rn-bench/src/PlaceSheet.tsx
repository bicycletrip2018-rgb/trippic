/**
 * 장소 상세 — **자리 하나**를 묻는 화면 (§13.91 · 058)
 *
 * ★ 왜 생겼나. `갈 곳` 카드를 누르면 지금까지 **지도로 날아갔다**(§13.74).
 *   거기 내 핀이 없으면 **열 것이 없었다** — 누른 사람이 원한 것은 *"저기 뭐가 있나"*
 *   인데 받은 것은 아무것도 없는 지도였다. 웹 시안도 같은 자리에
 *   `alert("실제 앱에서는 장소 상세가 열립니다")` 를 두고 비워 놨다.
 *
 * ★ **핀 상세(`PinSheet`)와 다른 것**이다. 핀 상세는 *기록 하나* — 사진 한 장,
 *   메모, 머문 시간. 이것은 *자리 하나* — 이름·주소·행사일·그 자리의 사진 여러 장·
 *   내가 가 봤는지. 하나로 묶으면 *"이 사진의 메모"* 와 *"이 장소의 사진들"* 이
 *   한 시트에서 자리를 다툰다.
 *
 * ★ **바텀시트가 아니라 전면이다.** 지도에는 이미 3단 시트가 있고(`MapSheet`),
 *   거기에 또 하나를 얹으면 둘이 같은 바닥을 다툰다(§13.66 에서 겪었다).
 *   그리고 표지 사진 + 사진 격자는 시트 높이에 들어가지 않는다.
 *
 * ★ **`저장` 이 생겼다**(§13.102). §13.91 에서 *"담을 표가 없다"* 며 안 만들었는데
 *   **그 판단의 근거가 틀렸다** — 표는 `reactions` 라는 이름으로 처음부터 있었고
 *   `reaction_target` 에 `place` 까지 들어 있었다. 진짜로 비어 있던 것은
 *   **집계가 장소 저장을 안 세는 것**이었고, 063 이 그 한 줄을 채웠다.
 *   (죽은 버튼을 안 만든 판단은 맞았다. 이름으로 표를 못 찾은 것을 *"없다"* 로
 *    적은 것이 틀렸다.)
 *
 * ★ **거리를 다시 재지 않는다.** 부른 쪽이 알고 있으면(`distM`) 그걸 그대로 쓴다 —
 *   서버가 준 숫자와 앱이 센 숫자가 갈라지면 같은 곳을 두 화면이 다르게 말한다(§13.34).
 */
import { useEffect, useState } from "react";
import { useTopPad } from "./safeArea";
import {
  Image, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { C, CAT } from "./theme";
import { driveText } from "./course";
import * as API from "./api";
import { useSkeletonPulse, SkelBar, SkelBox } from "./Skeleton";
import { ReportSheet, type Target } from "./ReportSheet";

const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, ".");
const md = (iso: string) => iso.slice(5, 10).replace("-", ".");

/** 오늘이 행사 기간 안인가. ★ 날짜만 비교한다 — 시각을 섞으면 시작일 당일이 빠진다 */
function eventState(s: string | null, e: string | null) {
  if (!s) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (e && e < today) return "지났습니다";
  if (s > today) return "곧 시작합니다";
  return "지금 열려 있습니다";
}

export function PlaceSheet(
  { placeId, fallbackName, distM, onClose, onOpenMap, onSaveChanged }: {
    placeId: string;
    /** 받아오기 전에도 **이름은 보여 준다** — 빈 화면이 깜빡이면 잘못 누른 줄 안다 */
    fallbackName?: string;
    distM?: number | null;
    onClose: () => void;
    onOpenMap?: (p: { lng: number; lat: number; name: string }) => void;
    /** 저장이 **서버에 실제로 박힌 뒤** 한 번 부른다 — `저장한 곳` 줄이 이걸 듣고
        다시 읽는다(§13.103). 낙관적으로 켜진 순간에 부르면 실패했을 때
        목록과 버튼이 어긋난다. */
    onSaveChanged?: (on: boolean) => void;
  },
) {
  const topPad = useTopPad(0);
  const [d, setD] = useState<API.PlaceDetail | null>(null);
  const [shots, setShots] = useState<API.PlaceMedia[] | null>(null);
  const [fail, setFail] = useState(false);
  const [broken, setBroken] = useState(false);
  /* 격자를 눌렀을 때 **그 자리에서** 크게 본다. 사진 뷰어를 따로 만들지 않는다 —
     지금 필요한 것은 *"작아서 안 보인다"* 를 푸는 일이지 새 화면이 아니다. */
  const [big, setBig] = useState<API.PlaceMedia | null>(null);
  /* 남의 사진이 보이는 자리에는 신고·차단이 있어야 한다(§13.135) */
  const [target, setTarget] = useState<Target>(null);
  const [gone, setGone] = useState<string[]>([]);
  /* ★ 저장은 **눌리자마자** 바뀐다(낙관적). 서버를 기다리면 한 박자 늦게 켜져
     *"안 눌렸나"* 하고 두 번 누르게 된다. 실패하면 되돌리고 이유를 적는다. */
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saveN, setSaveN] = useState(0);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveWhy, setSaveWhy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setD(null); setShots(null); setFail(false); setBroken(false); setBig(null);
    setSaved(null); setSaveN(0); setSaveWhy(null);
    void API.placeDetail(placeId).then((r) => {
      if (!alive) return;
      if (!r) { setFail(true); return; }
      setD(r);
      setSaved(r.saved); setSaveN(r.save_count);
    });
    /* ★ 사진은 **따로** 받는다. 상세 한 줄이 사진 스물넷을 기다릴 이유가 없다 —
       이름과 주소가 먼저 뜨고 격자가 뒤따라 채워지는 편이 빠르게 느껴진다. */
    void API.placeMedia(placeId, { limit: 24 }).then((r) => {
      if (alive) setShots(r.ok ? (r.data ?? []) : []);
    });
    return () => { alive = false; };
  }, [placeId]);

  const cat = CAT[d?.category ?? "etc"] ?? CAT.etc;
  /* 표지 — 사용자 사진이 이기고, 없으면 기관 사진. **고르는 규칙은 서버에 있다**
     (029 가 top_media_id 를 고른다). 여기서는 있는 것을 쓸 뿐이다. */
  const uri = !broken
    ? (d?.cover_url || d?.image_url || undefined)
    : undefined;
  const ev = eventState(d?.event_start ?? null, d?.event_end ?? null);

  return (
    <View style={s.root}>
      <View style={[s.head, { paddingTop: topPad }]}>
        <Text style={s.headT} numberOfLines={1}>{d?.name ?? fallbackName ?? "장소"}</Text>
        <Pressable onPress={onClose} hitSlop={12} style={s.close}>
          <Text style={s.closeT}>✕</Text>
        </Pressable>
      </View>

      {fail ? (
        <View style={s.center}>
          <Text style={s.dim}>장소를 불러오지 못했습니다</Text>
          <Text style={s.dimS}>잠시 뒤에 다시 눌러 주세요</Text>
        </View>
      ) : !d ? (
        /* ★ 스피너가 아니라 **들어올 모양**이다(§13.110). 상세는 표지 → 이름 →
           한 줄 메타 → 주소 → 내 발자국 순서가 늘 같아서 미리 그릴 수 있다.
           ★ 높이를 **실제와 맞춘다.** 안 맞으면 응답이 오는 순간 글이 튄다 —
             기다린 보람이 '화면이 흔들렸다'로 끝난다(§13.110 에서 33pt 틀렸었다). */
        <View style={s.body}><SheetSkeleton /></View>
      ) : (
        <ScrollView contentContainerStyle={s.body}>
          {/* ── 표지 ── */}
          {uri
            ? <Image source={{ uri }} style={s.cover} onError={() => setBroken(true)} />
            : <View style={[s.cover, s.coverBlank]}>
                <View style={[s.dot, { backgroundColor: cat.c }]} />
                <Text style={s.dimS}>사진이 없는 곳입니다</Text>
              </View>}
          {/* ★ 출처를 적는 것이 §12.25-A 의 **절반**이다. 사용자 사진이면 그 사람
              이름을, 기관 사진이면 관광공사를 적는다. 모르면 적지 않는다. */}
          {uri ? (
            <Text style={s.by}>
              {d.cover_author ? `@${d.cover_author}의 사진`
                              : d.cover_url ? "이용자 사진"
                              : `한국관광공사${d.image_license ? ` · ${d.image_license}` : ""}`}
            </Text>
          ) : null}

          {/* ── 이름과 자리 ── */}
          <Text style={s.name}>{d.name}</Text>
          <View style={s.row}>
            <View style={[s.dotS, { backgroundColor: cat.c }]} />
            <Text style={s.meta}>
              {cat.k}
              {d.region_name ? ` · ${d.region_name}` : ""}
              {typeof distM === "number" ? ` · ${driveText(distM)}` : ""}
            </Text>
          </View>
          {d.address ? <Text style={s.addr}>{d.address}</Text> : null}
          {d.concept ? <Text style={s.concept}>{d.concept}</Text> : null}

          {/* ★ 문을 닫은 곳은 **맨 위에서** 말한다 — 가고 나서 알면 늦다(051) */}
          {d.closed_at ? (
            <Text style={s.closed}>문을 닫았다고 신고된 곳입니다</Text>
          ) : null}

          {/* ── 행사 기간 ── */}
          {d.event_start ? (
            <Text style={[s.badge, ev === "지금 열려 있습니다" && s.badgeLive]}>
              {md(d.event_start)}
              {d.event_end && d.event_end !== d.event_start ? `–${md(d.event_end)}` : ""}
              {ev ? ` · ${ev}` : ""}
            </Text>
          ) : null}

          {/* ── ★ 내 발자국. 상세를 열었을 때 첫 질문이 이것이다 ── */}
          <View style={s.mine}>
            <Text style={d.mine_count ? s.mineOn : s.mineOff}>
              {d.mine_count === 0
                ? "아직 안 가봤습니다"
                : d.mine_count === 1
                  ? `한 번 갔습니다${d.mine_last_at ? ` · ${ymd(d.mine_last_at)}` : ""}`
                  : `${d.mine_count}번 갔습니다${d.mine_last_at ? ` · 마지막 ${ymd(d.mine_last_at)}` : ""}`}
            </Text>
            {/* ★ 남들 숫자는 **사람과 사진을 같이** 적는다 — 하나만 적으면
                "열 명이 한 장"과 "한 명이 열 장"이 같아 보인다(§13.10). */}
            <Text style={s.dimS}>
              {d.visitor_count === 0
                ? "아직 아무도 기록을 남기지 않았습니다"
                : `${d.visitor_count}명이 ${d.media_count}장을 남겼습니다`}
            </Text>
          </View>

          {/* ── 그 자리의 사진 ── */}
          {shots === null ? (
            /* ★ 사진은 **한 박자 늦게** 온다(따로 부른다). 여기도 빈 칸이 아니라
               칸 모양을 둔다 — 안 그러면 "사진이 없는 곳"처럼 보인다. */
            <>
              <Text style={s.secT}>이 장소의 사진</Text>
              <ShotsSkeleton />
            </>
          ) : shots.length ? (
            <>
              <Text style={s.secT}>이 장소의 사진</Text>
              <View style={s.grid}>
                {shots.filter((m) => !gone.includes(m.user_id)).map((m) => (
                  <Pressable key={m.media_id} style={s.cell} onPress={() => setBig(m)}>
                    <Image source={{ uri: m.thumb_url }} style={s.cellImg} />
                    {/* 찍은 사람을 **칸마다** 적는다 — 격자는 누구 사진인지 가장 헷갈리는 모양이다 */}
                    {m.author ? (
                      <Text style={s.cellBy} numberOfLines={1}>@{m.author}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {/* ── 저장 (§13.97 ④) ──
              ★ 숫자를 **같이** 보여 준다. 별 하나만 있으면 *"나만 눌렀나"* 를 알 수 없다.
              ★ 0 일 때는 숫자를 안 적는다 — `저장 0` 은 *"아무도 안 했다"* 를
                굳이 광고하는 것이고, 첫 사람에게 그건 말릴 이유가 된다. */}
          <Pressable
            style={[s.save, saved && s.saveOn]}
            disabled={saveBusy}
            onPress={() => {
              const next = !saved;
              setSaved(next); setSaveN((n) => n + (next ? 1 : -1));
              setSaveWhy(null); setSaveBusy(true);
              void API.savePlace(d.place_id, next).then((r) => {
                setSaveBusy(false);
                if (r.ok) { onSaveChanged?.(next); return; }
                /* ★ 되돌린다. 화면만 켜 두면 다시 열었을 때 꺼져 있어
                   *"저장이 안 된다"* 가 아니라 *"앱이 이상하다"* 가 된다. */
                setSaved(!next); setSaveN((n) => n + (next ? -1 : 1));
                setSaveWhy(r.why === "need_login"
                  ? "로그인 뒤에 저장할 수 있습니다" : "저장하지 못했습니다");
              });
            }}>
            <Text style={[s.saveT, saved && s.saveTOn]}>
              {saved ? "★ 저장함" : "☆ 저장"}{saveN > 0 ? `  ${saveN}` : ""}
            </Text>
          </Pressable>
          {saveWhy ? <Text style={s.saveWhy}>{saveWhy}</Text> : null}

          {/* ── 지도에서 보기 ── */}
          {onOpenMap ? (
            <Pressable style={s.cta}
                       onPress={() => onOpenMap({ lng: d.lng, lat: d.lat, name: d.name })}>
              <Text style={s.ctaT}>지도에서 보기</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      {/* 크게 보기 — 아무 데나 누르면 닫힌다 */}
      {big ? (
        <Pressable style={s.bigWrap} onPress={() => setBig(null)}>
          <Image source={{ uri: big.url }} style={s.bigImg} resizeMode="contain" />
          <Text style={s.bigBy}>
            {[big.author ? `@${big.author}` : null,
              big.taken_at ? ymd(big.taken_at) : "촬영 시기 미상",
              big.caption].filter(Boolean).join(" · ")}
          </Text>
          {/* ★ 내 사진에는 안 띄운다. 그리고 **배경 누르면 닫히는** 자리라
              이 버튼은 전파를 막아야 한다 — 안 그러면 누르는 순간 창이 닫힌다. */}
          {big.user_id !== API.SESSION.user_id && (
            <Pressable style={s.bigMore} hitSlop={12}
                       onPress={(e) => { e.stopPropagation();
                                         setTarget({ pinId: big.pin_id, userId: big.user_id }); }}>
              <Text style={s.bigMoreT}>⋯</Text>
            </Pressable>
          )}
        </Pressable>
      ) : null}

      <ReportSheet
        target={target} onClose={() => setTarget(null)}
        onBlocked={(uid) => {
          /* 차단하면 그 사람 사진은 **지금 화면에서도** 빠져야 한다 */
          setGone((g) => [...g, uid]);
          setBig(null);
        }} />
    </View>
  );
}

/* ── 기다리는 동안의 모양 ──────────────────────────────────────── */
function SheetSkeleton() {
  const pulse = useSkeletonPulse();
  return (
    <>
      <SkelBox pulse={pulse} style={s.cover} />
      {/* ★ 표지 아래 **출처 줄은 안 그린다.** 한 번 넣었다가 뺐다 — 사진 있는 곳에서는
          맞지만 **장소 46만 곳 중 사진이 있는 곳은 10.6%** 뿐이다(실측). 아홉 곳 중
          여덟에서 오히려 17pt 어긋나게 만든다. 흔한 쪽에 맞춘다. */}
      <SkelBar pulse={pulse} style={{ height: 21, width: "62%", marginTop: 12 }} />
      <SkelBar pulse={pulse} style={{ height: 13, width: "45%", marginTop: 9 }} />
      <SkelBar pulse={pulse} style={{ height: 12, width: "78%", marginTop: 9 }} />
      <View style={s.mine}>
        <SkelBar pulse={pulse} style={{ height: 14, width: "40%" }} />
        <SkelBar pulse={pulse} style={{ height: 12, width: "56%", marginTop: 6 }} />
      </View>
    </>
  );
}

function ShotsSkeleton() {
  const pulse = useSkeletonPulse();
  /* 세 칸. 한 줄이 다 차야 "사진이 들어올 자리"로 읽힌다 */
  return (
    <View style={s.grid}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={s.cell}><SkelBox pulse={pulse} style={s.cellImg} /></View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bigMore: { position: "absolute", top: 54, right: 16, width: 38, height: 38,
             borderRadius: 19, backgroundColor: "rgba(0,0,0,0.45)",
             alignItems: "center", justifyContent: "center" },
  bigMoreT: { color: "#fff", fontSize: 19, lineHeight: 21 },
  root: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg,
  },
  head: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  headT: { flex: 1, color: C.text, fontSize: 16, fontWeight: "600" },
  close: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  closeT: { color: C.muted, fontSize: 17 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  /* 탭바(26 + 52) 위로 여백 — 안 두면 `지도에서 보기` 가 탭바에 가린다(§13.66) */
  body: { padding: 16, paddingBottom: 110 },
  cover: { width: "100%", aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: C.surface },
  coverBlank: { alignItems: "center", justifyContent: "center", gap: 8 },
  by: { color: C.muted, fontSize: 11, marginTop: 6, textAlign: "right" },
  name: { color: C.text, fontSize: 21, fontWeight: "700", marginTop: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotS: { width: 7, height: 7, borderRadius: 4 },
  meta: { color: C.muted, fontSize: 13 },
  addr: { color: C.muted, fontSize: 12.5, marginTop: 6, lineHeight: 18 },
  concept: { color: C.text, fontSize: 13, marginTop: 10, lineHeight: 20 },
  closed: {
    color: C.warn, fontSize: 12.5, marginTop: 10,
    borderWidth: 1, borderColor: C.warn, borderRadius: 8,
    paddingVertical: 6, paddingHorizontal: 10, alignSelf: "flex-start",
  },
  badge: {
    color: C.muted, fontSize: 12, marginTop: 10, alignSelf: "flex-start",
    backgroundColor: C.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
  },
  badgeLive: { color: C.onAccent, backgroundColor: C.accent, fontWeight: "600" },
  mine: {
    marginTop: 16, paddingTop: 14, gap: 4,
    borderTopWidth: 1, borderTopColor: C.line,
  },
  mineOn: { color: C.visited, fontSize: 14, fontWeight: "600" },
  mineOff: { color: C.text, fontSize: 14 },
  secT: { color: C.text, fontSize: 14, fontWeight: "600", marginTop: 22, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: { width: "31.5%" },
  cellImg: { width: "100%", aspectRatio: 1, borderRadius: 9, backgroundColor: C.surface },
  cellBy: { color: C.muted, fontSize: 10, marginTop: 3 },
  save: {
    marginTop: 16, borderRadius: 12, paddingVertical: 11,
    alignItems: "center", borderWidth: 1, borderColor: C.line,
    backgroundColor: C.surface,
  },
  saveOn: { borderColor: C.warn, backgroundColor: "rgba(224,169,74,0.14)" },
  saveT: { color: C.muted, fontSize: 14, fontWeight: "600" },
  saveTOn: { color: C.warn },
  saveWhy: { color: C.warn, fontSize: 12, marginTop: 6, textAlign: "center" },
  cta: {
    marginTop: 26, backgroundColor: C.accent, borderRadius: 12,
    paddingVertical: 13, alignItems: "center",
  },
  ctaT: { color: C.onAccent, fontSize: 15, fontWeight: "700" },
  bigWrap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center",
    gap: 14, padding: 16,
    /* ★ 찍은 사람 줄이 **탭바에 가렸다**(실측). 가운데 정렬이라 사진이 커질수록
       설명이 아래로 밀리는데, 바닥에는 떠 있는 탭바가 있다 — §13.66 에서 시트에
       겪은 것과 같은 자리다. 출처를 못 읽으면 격자에 이름을 적은 뜻이 없다. */
    paddingBottom: 96,
  },
  bigImg: { width: "100%", height: "78%" },
  bigBy: { color: C.muted, fontSize: 12, textAlign: "center" },
  dim: { color: C.text, fontSize: 14 },
  dimS: { color: C.muted, fontSize: 12 },
});
