/**
 * 기록 하나 — **남의 기록을 열어 보는 자리** (098 · §13.190)
 *
 * ★ 왜 생겼나. 「모두의 지도」에서 장소는 열리는데, 그 장소의 사진을 크게 봐도
 *   *"이 사진을 누가 왜 올렸나"* 로 가는 길이 없었다. 지도에서 남의 핀을 눌러도
 *   `PinSheet` 는 사진 한 장 · 메모 · 날짜만 적었다 — **누구의 기록인지, 어느
 *   장소인지, 사진이 더 있는지를 안 적었다.** 서버(`api_pin_detail`·`api_pin_media`)는
 *   098 에서 이미 서 있었다(§13.180).
 *
 * ★ `PinSheet` 를 고치지 않고 따로 둔 이유: 그건 지도 위 **바텀시트**다 —
 *   사진 한 장이 들어갈 높이이고, 지도를 가리지 않는 것이 그 시트의 일이다.
 *   기록의 사진 전부와 장소·올린 사람을 넣으면 `PlaceSheet` 가 처음 생길 때 적은
 *   *"둘이 같은 바닥을 다툰다"*(§13.66)가 된다. 그래서 `PlaceSheet` 처럼 **전면**이다.
 *   `PinSheet` 에는 이리로 오는 한 줄만 더했다.
 *
 * ★ 안 보이는 기록을 **가르지 않는다.** 서버는 지운 것 · 공개를 거둔 것 · 차단한
 *   사람의 것을 똑같이 빈 결과로 준다. 화면이 그 넷을 갈라 말하면 남의 사정
 *   («이 사람이 공개를 거뒀다»)을 흘리게 된다 — «볼 수 없다» 고만 적는다.
 *
 * ★ 댓글은 여기 **없다.** 댓글은 공유 스페이스에만 열고(028), 그 화면은 따로 붙인다.
 *   열 수 없는 숫자를 적지 않는다는 `PinSheet` 의 규칙(댓글 수 숨김)을 그대로 따른다.
 */
import { useEffect, useState } from "react";
import {
  Dimensions, Image, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useTopPad } from "./safeArea";
import { useBackClose } from "./backClose";
import { C, CAT } from "./theme";
import { dur, ymd } from "./course";
import * as API from "./api";
import { ReportSheet, type Target } from "./ReportSheet";

/* 위치를 무엇으로 정했는지 — `MapTab` 의 `VER_LABEL` 과 같은 말. ★ 'manual' 을
   '사진 정보' 라고 쓰지 않는다(그건 사실이 아니다). */
const VER: Record<string, string> = { live: "현장 인증", exif: "사진 정보", manual: "직접 지정" };

export function PinDetail(
  { pinId, onClose, onBlocked, onOpenPlace }: {
    pinId: string;
    onClose: () => void;
    /** 이 화면에서 올린 사람을 차단했다 — 부른 쪽이 **그 자리에서** 그 사람 것을 치운다 */
    onBlocked?: (userId: string) => void;
    /** 장소로 가기. 장소 시트에서 열었으면 안 준다 — 같은 곳으로 되돌아가는 버튼이 된다 */
    onOpenPlace?: (p: { id: string; name: string }) => void;
  },
) {
  const topPad = useTopPad(0);
  /* undefined = 받는 중 · null = 볼 수 없음 */
  const [d, setD] = useState<API.PinDetail | null | undefined>(undefined);
  const [shots, setShots] = useState<API.PinMedia[] | null>(null);
  const [fail, setFail] = useState(false);
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState<Target>(null);
  const W = Dimensions.get("window").width;

  useEffect(() => {
    let alive = true;
    setD(undefined); setShots(null); setFail(false); setPage(0);
    void API.pinDetail(pinId).then((r) => {
      if (!alive) return;
      /* ★ 망이 끊긴 것과 «볼 수 없다» 는 다르다 — 섞으면 멀쩡한 기록을 없는 줄 안다 */
      if (!r.ok) { setFail(true); return; }
      setD(r.data);
    });
    /* 사진은 **따로** 받는다 — 한 줄짜리 상세가 사진을 기다릴 이유가 없다(PlaceSheet 와 같다) */
    void API.pinMedia(pinId).then((rows) => { if (alive) setShots(rows ?? []); });
    return () => { alive = false; };
  }, [pinId]);

  useBackClose(onClose);

  const cat = CAT[d?.category ?? "etc"] ?? CAT.etc;
  /* 제목: 장소 이름 → 사용자가 적은 이름 → 분류. ★ 메모는 제목으로 올리지 않는다 —
     메모는 *"그때 어땠는지"* 이고(§13.168) 아래에 따로 있다. 둘을 섞어 이름이
     갈아끼워지는 것처럼 보인 적이 있다(§13.166). */
  const title = d ? (d.place_name || d.place_label || cat.k) : "기록";
  const stay = dur(d?.stay_sec);
  const day = d?.visited_at ? ymd(new Date(d.visited_at)) : null;

  return (
    <View style={s.root}>
      <View style={[s.head, { paddingTop: topPad }]}>
        <Text style={s.headT} numberOfLines={1}>{title}</Text>
        {/* ★ 남의 기록에만. 내 기록에 신고 버튼은 뜻이 없다 */}
        {d && !d.is_mine ? (
          <Pressable hitSlop={12} style={s.close}
                     onPress={() => setTarget({ pinId: d.id, userId: d.user_id })}>
            <Text style={s.closeT}>⋯</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} hitSlop={12} style={s.close}>
          <Text style={s.closeT}>✕</Text>
        </Pressable>
      </View>

      {fail ? (
        <View style={s.center}>
          <Text style={s.dimT}>지금은 불러오지 못했습니다</Text>
          <Text style={s.dimS}>연결이 불안정한 것 같습니다. 잠시 뒤 다시 열어 주세요.</Text>
        </View>
      ) : d === undefined ? (
        <View style={s.center}><Text style={s.dimS}>불러오는 중…</Text></View>
      ) : d === null ? (
        <View style={s.center}>
          <Text style={s.dimT}>이 기록을 볼 수 없습니다</Text>
          <Text style={s.dimS}>지워졌거나, 더 이상 공개되지 않는 기록입니다.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.body}>
          {/* ── 사진 — 옆으로 넘긴다 ──
              ★ 한 장이면 넘김 표시를 안 단다. `1/1` 은 아무것도 말하지 않는다. */}
          {shots === null ? (
            <View style={[s.photo, { width: W - 32 }]} />
          ) : shots.length ? (
            <>
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                          style={{ width: W - 32 }}
                          onMomentumScrollEnd={(e) =>
                            setPage(Math.round(e.nativeEvent.contentOffset.x / (W - 32)))}>
                {shots.map((m) => (
                  <View key={m.media_id} style={{ width: W - 32 }}>
                    {/* ★ 동영상은 **표지만** 보인다 — 여기서 재생하지 않는다. 재생을
                        붙이기 전까지 «동영상» 이라고 적어 사진으로 착각하지 않게 한다. */}
                    <Image source={{ uri: m.type === "video" ? (m.poster_url ?? m.thumb_url) : m.url }}
                           style={[s.photo, { width: W - 32 }]} resizeMode="cover" />
                    {m.type === "video" ? <Text style={s.video}>동영상</Text> : null}
                    {m.caption ? <Text style={s.caption}>{m.caption}</Text> : null}
                  </View>
                ))}
              </ScrollView>
              {shots.length > 1 ? (
                <Text style={s.pager}>{page + 1} / {shots.length}</Text>
              ) : null}
            </>
          ) : (
            /* ★ 남의 기록인데 사진이 0장이면 — 공개 가능한 장이 없는 것이다.
               "사진이 없는 기록" 이라고 단정하지 않는다(있는데 안 보이는 것일 수 있다). */
            <Text style={s.none}>{d.is_mine ? "사진이 없는 기록입니다" : "보여 드릴 수 있는 사진이 없습니다"}</Text>
          )}

          {/* ── 누구의 기록인가 ──
              ★ 이게 이 화면이 생긴 이유다. 남의 기록에서 이름이 빠지면 «이 사진을
                누가 올렸나» 에 답하지 못한다. 내 기록이면 «내 기록» 이라고만 적는다. */}
          <View style={s.byRow}>
            <View style={[s.dot, { backgroundColor: cat.c }]} />
            <Text style={s.cat}>{cat.k}</Text>
            <Text style={s.by} numberOfLines={1}>
              {d.is_mine ? "내 기록" : `@${d.author ?? "이름 없는 사용자"}`}
            </Text>
          </View>

          <Text style={s.meta}>
            {[
              day,
              stay ? `${stay} 머물렀습니다` : null,
              d.verification ? VER[d.verification] : null,
              /* 내 기록에서만 공개 여부를 적는다 — 남의 것은 보인다는 사실이 곧 공개다 */
              d.is_mine ? (d.is_public ? "공개" : "나만 보기") : null,
            ].filter(Boolean).join(" · ")}
          </Text>

          {d.memo ? <Text style={s.memo}>{d.memo}</Text> : null}

          {/* ── 어디였나 ── 장소가 잡혀 있을 때만. 지역 이름만 있으면 그것만. */}
          {(d.place_name || d.region_name) ? (
            <View style={s.place}>
              <Text style={s.placeT}>{d.place_name ?? d.region_name}</Text>
              {d.place_address ? <Text style={s.placeA}>{d.place_address}</Text>
                : d.place_name && d.region_name ? <Text style={s.placeA}>{d.region_name}</Text> : null}
              {d.place_id && d.place_name && onOpenPlace ? (
                <Pressable style={s.cta}
                           onPress={() => onOpenPlace({ id: d.place_id!, name: d.place_name! })}>
                  <Text style={s.ctaT}>이 장소 보기</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      <ReportSheet
        target={target} onClose={() => setTarget(null)}
        onBlocked={(uid) => {
          /* 차단하면 그 사람 기록을 **계속 보여 주지 않는다** — 닫고, 부른 쪽도 치운다 */
          onBlocked?.(uid);
          onClose();
        }} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg },
  head: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  headT: { flex: 1, color: C.text, fontSize: 16, fontWeight: "600" },
  close: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  closeT: { color: C.muted, fontSize: 17 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, padding: 24 },
  dimT: { color: C.text, fontSize: 15, fontWeight: "600" },
  dimS: { color: C.muted, fontSize: 12.5, textAlign: "center", lineHeight: 19 },
  /* 탭바 위로 여백 — PlaceSheet 와 같은 값(§13.66) */
  body: { padding: 16, paddingBottom: 110 },
  photo: { aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: C.surface },
  video: {
    position: "absolute", top: 10, left: 10, color: "#fff", fontSize: 11, fontWeight: "700",
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  caption: { color: C.muted, fontSize: 12, marginTop: 6 },
  pager: { color: C.muted, fontSize: 11, textAlign: "right", marginTop: 6 },
  none: { color: C.muted, fontSize: 13, paddingVertical: 18 },
  byRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  cat: { color: C.muted, fontSize: 12.5 },
  by: { flex: 1, color: C.text, fontSize: 13.5, fontWeight: "600", textAlign: "right" },
  meta: { color: C.muted, fontSize: 12.5, marginTop: 8 },
  memo: { color: C.text, fontSize: 14, lineHeight: 21, marginTop: 12 },
  place: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line, gap: 4 },
  placeT: { color: C.text, fontSize: 14, fontWeight: "600" },
  placeA: { color: C.muted, fontSize: 12.5 },
  cta: {
    marginTop: 10, paddingVertical: 11, borderRadius: 12, alignItems: "center",
    borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
  },
  ctaT: { color: C.text, fontSize: 13.5, fontWeight: "600" },
});
