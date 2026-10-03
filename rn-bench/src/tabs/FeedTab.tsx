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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Easing, Image, Linking, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { C, CAT } from "../theme";
import { driveText as courseDriveText } from "../course";
import * as API from "../api";
import { saveNote } from "../saveNote";
import { sawCover, openedCover, flushCovers } from "../coverLog";
import { PlaceSheet } from "../PlaceSheet";

/* ★ 카드 치수를 상수로 올린다 — 아래 `Rail` 이 **무엇이 보이는지** 계산하는 데
   쓴다. 스타일에만 적어 두면 둘이 조용히 어긋난다. */
const CARD_W = 158, CARD_GAP = 10, RAIL_PAD = 18;
const STRIDE = CARD_W + CARD_GAP;

/* ★ 시간 예산 (§12.25-C) — 사람이 실제로 묻는 것은 "근처 어디"가 아니라
   **"지금 3시간 비는데 어디 갈까"** 다. 왕복 이동과 머무는 시간을 빼야 답이 된다.
   ★ 체류 시간은 §13.32 에서 서버에 남겼다 — 남들은 이 값을 모른다. */
const BUDGETS: [number, string][] = [[120, "2시간"], [240, "반나절"], [480, "하루"]];
const THIS_MONTH = new Date().getMonth() + 1;

/* 서버 행에 **화면에서만 쓰는 한 줄**을 더한 모양. 서버 타입을 더럽히지 않는다. */
type FeedItem = Omit<API.FeedRow, "rail" | "dist_m"> & {
  rail: API.FeedRow["rail"] | "again" | "sponsor" | "saved"; note?: string;
  /* ★ 거리를 **모를 수 있다.** 지도에서 온 줄은 좌표를 안 주고 묻기 때문이다
     (§13.104). 모르면 그 줄을 비운다 — 0 을 적으면 읽는 사람이 그걸 믿는다. */
  dist_m: number | null;
  /* ★ `다시 가보기` 는 **장소에 안 붙은 핀**도 담는다 — `RevisitRow.place_id` 가
     null 일 수 있어 거기서는 합성 키를 쓴다(아래). 그 카드로 장소 상세를 열면
     서버가 *"그런 장소 없다"* 로 빈 화면을 준다. 그런 카드는 지도로 보낸다. */
  noPlace?: boolean;
};

/** `2025-10-01` → `작년` / `3년 전` */
function yearsAgo(iso: string) {
  const n = new Date().getFullYear() - new Date(iso).getFullYear();
  return n <= 0 ? "오늘" : n === 1 ? "작년" : `${n}년 전`;
}

const RAILS: { k: API.FeedRow["rail"]; t: string; why: string }[] = [
  { k: "live",   t: "지금 하는 행사", why: "오늘 열려 있는 곳 · 가까운 순" },
  { k: "soon",   t: "곧 시작합니다", why: "날짜가 잡힌 행사" },
  { k: "near",   t: "여기서 가까운", why: "지도에서 보던 자리 기준 · 가까운 순" },
  /* ★ 이제 **진짜로** 안 가본 곳이다 — 서버가 내 핀을 빼고 준다(§13.81).
     씨앗판은 어디를 가 봤는지 모른 채 이 이름을 달고 있었다. */
  { k: "unseen", t: "아직 안 가본 곳", why: "기록이 없는 곳 · 지역마다 하나씩" },
];

export function FeedTab(
  { center, visible = true, onOpenMap }: {
    center: { lat: number; lng: number };
    /* ★ 지금 **보이고 있는가**(§13.111). 이 탭은 이제 떠나도 안 지워지므로,
       숨어 있는 동안 지도를 밀면 그때마다 묶음을 다시 받게 된다 — 보이지도 않는
       화면 때문에 **가장 비싼 질의**가 반복해 나간다. 보일 때만 따라간다. */
    visible?: boolean;
    /* ★ 카드 탭의 끝이 **더 이상 지도가 아니다**(§13.91). 예전에는 여기서 바로
       지도로 날아갔는데, 내 핀이 없는 장소면 도착해서 **열 것이 없었다.**
       이제 장소 상세가 먼저 열리고, 지도로 가는 것은 그 안의 버튼이 한다 —
       웹 시안의 alert 가 적어 둔 순서(`기록 · 지도에서 보기 · 저장`)가 그것이다. */
    onOpenMap?: (p: { lng: number; lat: number; name: string }) => void;
  },
) {
  /* 상세로 넘길 것: id 와, **이미 알고 있는** 이름·거리. 거리를 상세에서 다시
     재면 카드와 상세가 같은 곳을 다르게 말한다(§13.34). */
  /* ★ **보이는 동안에만 따라가는 자리**(§13.111).
     효과를 여섯 개나 손대는 대신 **들어오는 값 하나를 얼린다** — 그러면
     `[center.lat, center.lng]` 로 걸린 것들이 전부 저절로 멈춘다. 고칠 곳이
     하나면 다음에 효과가 하나 더 늘어도 **빠뜨릴 수가 없다**(§13.37).
     ★ 같은 자리면 **같은 객체**를 돌려준다 — 새 객체를 주면 값이 안 바뀌었는데도
       효과가 다시 돈다. */
  const [shownCenter, setShownCenter] = useState(center);
  useEffect(() => {
    if (!visible) return;
    setShownCenter((p) => (p.lat === center.lat && p.lng === center.lng ? p : center));
  }, [visible, center.lat, center.lng]);
  const at = shownCenter;

  const [open, setOpen] = useState<{ id: string; name: string; distM: number | null } | null>(null);
  const [rows, setRows] = useState<API.FeedRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [budgetRows, setBudgetRows] = useState<API.BudgetPlace[] | null>(null);
  const [season, setSeason] = useState(false);
  const [seasonRows, setSeasonRows] = useState<API.MonthPlace[] | null>(null);
  /* ★ 내 발자국. 서버 묶음과 **따로** 부른다 — 이건 남의 데이터가 아니라
     내 핀이고, 로그인 상태에 따라 비기도 한다(§13.86). */
  const [revisit, setRevisit] = useState<API.RevisitRow[]>([]);
  /* ★ 스폰서 줄(§13.92). **계약이 없으면 빈 배열**이고 그러면 줄이 아예 안 뜬다 —
     광고 줄은 광고가 없을 때 비어 있는 것이 정상이다. 지금은 계약이 0건이라
     **실제로 늘 비어 있다.** 그게 맞는 모습이다. */
  const [sponsor, setSponsor] = useState<API.SponsorRow[]>([]);
  /* ★ 저장한 곳(§13.103). `다시 가보기` 와 같이 **내 데이터로 서는 줄**이고,
     비면 줄이 안 뜬다 — 그래서 탭을 만들지 않았다. */
  const [saves, setSaves] = useState<API.SaveRow[]>([]);

  /* ★ 보던 자리가 바뀌면 다시 묻는다. `center` 는 지도의 실제 중심이다(§13.74). */
  useEffect(() => {
    let live = true;
    setRows(null); setErr(null);
    void API.feedRails(at.lat, at.lng).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data ?? []);
      else setErr(r.error ?? "불러오지 못했습니다");
    });
    return () => { live = false; };
  }, [at.lat, at.lng]);

  useEffect(() => {
    let live = true;
    void API.myRevisit(at.lat, at.lng).then((r) => {
      if (live && r.ok) setRevisit(r.data ?? []);
    });
    return () => { live = false; };
  }, [at.lat, at.lng]);

  useEffect(() => {
    let live = true;
    void API.sponsorRail(at.lat, at.lng).then((r) => {
      if (live) setSponsor(r.ok ? (r.data ?? []) : []);
    });
    return () => { live = false; };
  }, [at.lat, at.lng]);

  /* ★ 좌표가 바뀌면 다시 읽는다 — **목록 자체는 안 바뀌고 거리만 바뀐다.**
     저장 순서는 좌표와 무관하지만, 카드가 적는 거리는 지금 보는 자리 기준이라야
     쓸모가 있다("여기서 12km"). */
  const loadSaves = useCallback(() => {
    void API.mySaves(at.lat, at.lng)
      .then((r) => { if (r.ok) setSaves(r.data ?? []); });
  }, [at.lat, at.lng]);
  useEffect(() => { loadSaves(); }, [loadSaves]);

  const rails = useMemo(() => {
    if (!rows) return [];
    return RAILS
      .map((r) => ({ ...r, items: rows.filter((x) => x.rail === r.k) }))
      .filter((r) => r.items.length);
  }, [rows]);

  /* ── 표지 (§12.25-A) ─────────────────────────────────────────────
     029 가 고른 표지를 **읽어 온다.** 여기서 다시 고르지 않는다. */
  /* ★ 스폰서 줄의 장소도 **같은 호출로** 표지를 받는다. 따로 부르면 왕복이 하나 늘고,
     무엇보다 표지를 고르는 곳이 둘이 된다(§12.25-A 가 금한 것). */
  const shownIds = useMemo(
    () => [...new Set([
      ...rails.flatMap((r) => r.items.map((x) => x.place_id)),
      ...sponsor.map((x) => x.place_id),
      /* ★ 저장한 곳도 **같은 호출로** 표지를 받는다(§13.103). 따로 부르면 왕복이
         하나 늘고, 무엇보다 표지를 고르는 곳이 둘이 된다 — §12.25-A 가 금한 것.
         표지를 **받는** 것과 표지 경쟁에 **참가하는** 것은 다른 일이다:
         받되(`covers`) 세지는 않는다(`rank={false}`). */
      ...saves.map((x) => x.place_id),
    ])], [rails, sponsor, saves]);

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
    void API.placesInBudget(at.lat, at.lng, budget, { limit: 24 })
      .then((r) => { if (live) setBudgetRows(r.data ?? []); });
    return () => { live = false; };
  }, [budget, at.lat, at.lng]);

  useEffect(() => {
    if (!season) { setSeasonRows(null); return; }
    let live = true;
    setSeasonRows(null);
    void API.placesByMonth(at.lat, at.lng, THIS_MONTH, { limit: 24 })
      .then((r) => { if (live) setSeasonRows(r.data ?? []); });
    return () => { live = false; };
  }, [season, at.lat, at.lng]);

  /* ★ 카드 하나를 여는 **단 한 곳**. 두 군데에서 결정하면 `다시 가보기` 의
     장소 없는 카드 처리가 한쪽에서만 빠진다. */
  const openCard = (x: FeedItem) => {
    if (x.noPlace) { onOpenMap?.({ lng: x.lng, lat: x.lat, name: x.name }); return; }
    setOpen({ id: x.place_id, name: x.name, distM: x.dist_m ?? null });
  };

  /* ★ **화면을 통째로 갈아치우지 않는다**(§13.110).
     예전에는 여기서 `if (!rows) return <ActivityIndicator/>` 로 **전부** 치웠다.
     그래서 제목도 `2시간·반나절·하루` 칩도 **서버가 답할 때까지** 안 나왔다 —
     §13.109 로 재 보니 그것들은 **8ms 면 그릴 수 있는 것**인데 최대 **2.2초** 동안
     까만 화면이었다. 앱이 이미 가진 것을 숨기고 있었던 것이다.
     → 머리글과 칩은 **늘 그린다.** 바뀌는 것은 **묶음 자리**뿐이다. */
  const loading = !rows && !err;

  const list = (
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

      {/* ★ 오류도 **머리글을 지우지 않는다.** 예전에는 오류 한 줄만 남기고 화면을
          비웠는데, 그러면 칩도 못 누르고 할 수 있는 일이 아무것도 없다. */}
      {err && <Text style={[s.dim, { marginTop: 24 }]}>{err}</Text>}

      {/* ★ 기다리는 동안 **뼈대**를 둔다(§13.110). 치수를 진짜 묶음과 **똑같이**
          맞췄다 — 안 맞으면 답이 왔을 때 화면이 **덜컥 뛴다.** 뛰는 뼈대는
          없느니만 못하다.
          ★ 제목은 **글자가 아니라 회색 막대**다. 네 묶음 중 어느 것이 설지
            아직 모르는데 `지금 하는 행사` 라고 적어 두면, 비었을 때 그 줄이
            사라지면서 **방금 한 말을 무르는 꼴**이 된다. */}
      {loading && <><RailSkeleton /><RailSkeleton /></>}

      {!loading && !err && !rails.length && (
        <Text style={s.dim}>
          이 자리 둘레에는 보여 드릴 곳을 찾지 못했습니다. 지도를 옮겨 보십시오.
        </Text>
      )}
      {rails.map((r) => (
        <Rail key={r.k} title={r.t} why={r.why} items={r.items}
              covers={covers} onOpen={openCard} />
      ))}

      {/* ★ 스폰서 줄은 **유기적인 줄들 아래**에 둔다(§13.92). 맨 위에 두면 이 탭이
          *"뭐 볼까"* 에 답하는 화면이 아니라 광고판으로 읽힌다 — §12.20 이
          *"왜 떴는지 묶음마다 적는다. 우리 추천은 설명할 수 있어야 한다"* 고 적어
          둔 것과 정면으로 어긋난다. **유기적인 답이 먼저고, 돈 받은 답이 그 아래다.**
          (스폰서가 상단을 요구하면 그건 계약서에서 다룰 일이지 여기서 몰래 정할 일이 아니다.) */}
      <SponsorRail rows={sponsor} covers={covers} onOpen={openCard}
                   onClaimed={() => {
                     /* 받고 나면 줄을 다시 읽는다 — `claimed` 가 바뀌어야 버튼이 사라진다 */
                     void API.sponsorRail(at.lat, at.lng)
                       .then((r) => { if (r.ok) setSponsor(r.data ?? []); });
                   }} />

      {/* ── 저장한 곳 (§13.103) ──
          ★ **스폰서 아래, `다시 가보기` 위**다. 여기부터가 *"내 것"* 무리고,
            그 안에서는 **아직 안 간 곳이 이미 간 곳보다 먼저**다 — 저장은
            *"가 보자"* 는 할 일이고 `다시 가보기` 는 *"또 갈까"* 라는 회상이다.
          ★ **비면 안 그린다.** 이게 탭을 안 만든 이유다 — 제목만 있는 빈 줄이
            §12.4·§12.26-A 가 두 번 거절한 그 화면이다. */}
      {!!saves.length && (
        <Rail
          title="저장한 곳" why="★ 눌러 둔 곳 — 최근에 저장한 것부터입니다"
          items={saves.map((x) => ({
            rail: "saved" as const,
            place_id: x.place_id,
            name: x.name, category: x.category,
            lng: x.lng, lat: x.lat, dist_m: x.dist_m,
            image_url: x.image_url, thumb_url: x.thumb_url,
            event_start: x.event_start, event_end: x.event_end,
            region_name: x.region_name,
            /* ★ 무슨 말을 할지는 `saveNote` 가 정한다 — **순서가 규칙**이라
                 떼어 놨다(닫힘 > 다녀옴 > 저장한 날). 여기 삼항으로 두면
                 누가 줄을 바꿔 써도 아무 일도 안 일어난다. */
            note: saveNote(x),
          }))}
          covers={covers}
          /* ★ 표지 경쟁에 **참가하지 않는다** — `다시 가보기` 와 같은 이유다(§13.86).
             분모는 *"남들이 보고 고르는 것"* 인데, 내가 이미 찜해 둔 것을 다시
             보는 것은 고르는 행동이 아니다. 노출도 열림도 둘 다 끈다(§13.92). */
          rank={false}
          onOpen={openCard} />
      )}

      {/* ★ **맨 아래에 둔다.** 위 넷은 *"어디 갈까"* 에 답하고, 이건 *"거기 또 갈까"* 다.
          묻는 것이 달라서 섞으면 둘 다 흐려진다. */}
      {!!revisit.length && (
        <Rail
          title="다시 가보기" why="예전에 갔던 자리 — 내 기록입니다"
          items={revisit.map((x) => ({
            rail: "again" as const,
            place_id: x.place_id ?? `pin-${x.name}-${x.visited_at}`,
            name: x.name, category: x.category,
            lng: x.lng, lat: x.lat, dist_m: x.dist_m,
            image_url: x.image_url, thumb_url: x.thumb_url,
            event_start: null, event_end: null, region_name: x.region_name,
            noPlace: !x.place_id,
            note: x.anniversary
              ? `${yearsAgo(x.visited_at)} 오늘 이 자리에`
              : `${x.visited_at.slice(0, 10).replace(/-/g, ".")} 방문`,
          }))}
          covers={{}}
          /* ★ 표지 경쟁에 **참가하지 않는다**(§13.86). 분모는 *"남들이 보고
             고르는 것"* 인데, 내가 내 기록을 들여다본 것을 거기 섞으면 그건
             경쟁이 아니라 자기 표를 던지는 것이다.
             ★ 예전에는 **노출만** 껐다 — 열림은 그대로 세고 있었다. 점수가
               노출 대비라 그 상태가 오히려 점수를 **부풀렸다**(§13.92에서 고쳤다). */
          rank={false}
          onOpen={openCard} />
      )}
      <Text style={s.credit}>장소·사진 출처 한국관광공사 · 경계 © OpenStreetMap contributors</Text>
    </ScrollView>
  );

  /* ★ 상세는 목록 **위에** 얹는다. 목록을 갈아 끼우면 닫을 때 스크롤 위치와
     받아 둔 묶음을 잃는다 — 카드 하나 보고 돌아왔는데 처음부터면 안 된다. */
  return (
    <View style={{ flex: 1 }}>
      {list}
      {open && (
        <PlaceSheet
          placeId={open.id} fallbackName={open.name} distM={open.distM}
          onClose={() => setOpen(null)}
          /* 지도로 가는 것은 **상세 안의 버튼**이 한다. 가면 상세는 닫는다 —
             돌아왔을 때 지도를 덮고 있으면 방금 날아간 자리를 못 본다. */
          onOpenMap={(p) => { setOpen(null); onOpenMap?.(p); }}
          /* ★ 상세에서 저장을 켜면 **줄이 바로 바뀐다.** 닫을 때 다시 읽게 하면
             사용자가 저장해 놓고 시트를 안 닫는 동안 줄과 버튼이 어긋난다. */
          onSaveChanged={loadSaves} />
      )}
    </View>
  );
}

/* ── 기다리는 동안의 뼈대 (§13.110) ───────────────────────────────
   ★ 치수를 **진짜 묶음에서 그대로 가져온다**(`s.rail`·`s.railT`·`s.row`·`s.card`·`s.img`).
     따로 적어 두면 한쪽을 고칠 때 다른 쪽이 안 따라와 **답이 올 때 화면이 뛴다.**
   ★ **숨을 쉰다.** 완전히 멈춰 있으면 고장 난 화면과 구별이 안 된다 — 네이티브
     드라이버로 투명도만 흔들어, 자바스크립트가 바빠도 끊기지 않게 한다.
   ★ 카드는 **셋**이다. 화면에 두 장 반이 걸치므로 그만큼만 그린다 — 안 보이는
     것을 그리는 값은 기다리는 동안에도 값이다. */
function RailSkeleton() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad),
                               useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad),
                               useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  const o = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  return (
    <View style={s.rail} pointerEvents="none">
      {/* 제목·설명 자리 — 글자가 아니라 막대다 */}
      <Animated.View style={[s.skBar, { width: 112, marginHorizontal: 18, opacity: o }]} />
      <Animated.View
        style={[s.skBar, { width: 168, height: 9, marginHorizontal: 18,
                           marginTop: 6, marginBottom: 9, opacity: o }]} />
      {/* ★ **가로로** 세운다. `s.row` 는 진짜 묶음에서 **가로 ScrollView 의
          contentContainerStyle** 로 쓰여서 방향이 거기서 온다 — 그냥 `View` 에
          얹으면 세로로 쌓인다(실제로 그렇게 나왔다). 치수를 빌려 쓸 때는
          **그 치수가 기대는 것까지** 빌려야 한다. */}
      <View style={[s.row, { flexDirection: "row" }]}>
        {[0, 1, 2].map((i) => (
          /* ★ 줄 수를 **진짜 카드와 맞춘다**: 사진 · 이름 · 갈래·지역 · 거리 · 출처.
             처음엔 막대를 둘만 뒀는데 카드가 **33pt 낮아서**, 답이 왔을 때 아래
             묶음이 그만큼 **밀려 내려갔다.** 뛰는 뼈대는 없느니만 못하다 —
             주석에 "치수를 맞췄다"고 적어 놓고 안 맞춰 두면 그 주석이 거짓말이다.
             ★ 거리 줄은 **오른쪽**이다(진짜 카드가 `textAlign: "right"`). */
          <View key={i} style={s.card}>
            <Animated.View style={[s.img, { opacity: o }]} />
            <Animated.View style={[s.skBar, { width: 104, marginHorizontal: 10,
                                              marginTop: 11, opacity: o }]} />
            <Animated.View style={[s.skBar, { width: 68, height: 9, marginHorizontal: 10,
                                              marginTop: 7, opacity: o }]} />
            <Animated.View style={[s.skBar, { width: 52, height: 9, marginHorizontal: 10,
                                              marginTop: 9, alignSelf: "flex-end",
                                              opacity: o }]} />
            <Animated.View style={[s.skBar, { width: 88, height: 8, marginHorizontal: 10,
                                              marginTop: 8, marginBottom: 17,
                                              opacity: o }]} />
          </View>
        ))}
      </View>
    </View>
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
  { title, why, items, covers, onOpen, rank = true, badge, foot }: {
    title: string; why: string; items: FeedItem[];
    covers: Record<string, API.PlaceCover>;
    /** 카드 하나를 연다 — 장소 상세로 간다(§13.91) */
    onOpen: (x: FeedItem) => void;
    /* ★ 이 묶음이 **표지 경쟁에 참가하는가**(§13.86 · §13.92).
       예전 이름은 `countSeen` 이었고 **노출만** 껐다. 그런데 점수는
       `wilson_lower(opened*0.4…, max(imp,1))` 라(027) — 노출을 안 세고 열림만 세면
       **분모가 그대로인 채 분자만 올라 점수가 거꾸로 부푼다.** 끄려면 둘 다 꺼야 한다.
       (`다시 가보기` 가 그 상태였다. 자기 표를 안 던지려고 만든 장치가 반대로
        자기 표를 더 세게 던지고 있었다.) */
    rank?: boolean;
    /** 제목 옆 꼬리표 — 광고 표시 같은 것 */
    badge?: string;
    /** 묶음 아래에 붙는 것 — 보상 받기 버튼 같은 것 */
    foot?: React.ReactNode;
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
      if (vis >= CARD_W / 2 && rank) sawCover(items[i].place_id);
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
      <View style={s.railHead}>
        <Text style={s.railT}>{title}</Text>
        {/* ★ 광고는 **명확히** 알려야 한다(표시광고법). 제목 옆, 같은 줄에 둔다 —
            설명 줄에 섞어 두면 읽는 사람이 흘려 보낸다. */}
        {badge ? <Text style={s.railBadge}>{badge}</Text> : null}
      </View>
      <Text style={s.railWhy}>{why}</Text>
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}
        scrollEventThrottle={64}
        onLayout={(e) => { w.current = e.nativeEvent.layout.width; settle(); }}
        onScroll={(e) => { x.current = e.nativeEvent.contentOffset.x; settle(); }}>
        {items.map((it) => (
          <Card key={`${it.rail}-${it.place_id}`} x={it}
                cover={covers[it.place_id]} onOpen={onOpen} rank={rank} />
        ))}
      </ScrollView>
      {foot}
    </View>
  );
}

const ymd = (d: string) => d.slice(5).replace("-", ".");

function Card(
  { x, cover, onOpen, rank = true }: {
    x: FeedItem;
    cover?: API.PlaceCover;
    onOpen: (x: FeedItem) => void;
    /** 이 카드가 표지 경쟁에 참가하는가 — 위 `Rail` 주석 참고 */
    rank?: boolean;
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
        /* **열었다**는 것은 노출의 부분집합이다(§13.9 규칙 2).
           ★ 여는 곳이 지도에서 장소 상세로 바뀌었어도 이 신호의 뜻은 같다 —
             *"이 표지를 보고 눌렀다."* 오히려 더 정확해졌다(§13.91).
           ★ **참가하지 않는 묶음에서는 세지 않는다**(§13.92). 노출을 안 센 묶음에서
             열림만 세면 분모가 그대로인 채 분자만 올라 점수가 부푼다. */
        if (rank) openedCover(x.place_id);
        onOpen(x);
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
      {x.dist_m == null
        ? null
        : <Text style={s.dist}>{courseDriveText(x.dist_m)}</Text>}
      {/* ★ 출처를 적는 것이 §12.25-A 의 **절반**이다. */}
      {x.note
        /* 내 기록 줄은 출처가 아니라 **언제 갔는지**를 말한다 */
        ? <Text style={s.byUser}>{x.note}</Text>
        : mine
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

/* ── 스폰서 줄 (§12.23 · §12.26-A · §13.92) ───────────────────────
   ★ **계약이 없으면 아무것도 그리지 않는다.** 자동 생성물로 채우지 않는다 —
     §12.26-A 가 퀘스트를 탭에서 내린 이유가 *"§12.22 `아직 안 간 곳`에 옷만
     갈아입힌 것"* 이었다. 빈 광고 줄을 가짜로 메우면 그때 거절한 것을 되살린다.
   ★ **광고 표시는 묻지 않는다.** `sponsor` 가 있으면 제목 옆에 `광고` 가 선다
     (표시광고법은 명확히 알리라고 한다). 이 줄은 돈을 받은 줄이다.
   ★ 진행도는 **핀에서 파생**한다 — 퀘스트 전용 업로드 경로를 만들지 않는다(§12.23-G).
     그래서 *"제출을 조작한다"* 는 공격이 성립하지 않는다.
   ★ 보상은 **URL 하나**다. 쿠폰은 우리가 발행하지 않는다(§12.23-D) —
     금전 사고와 환불 책임을 앱이 지면 안 되고, 전자금융 규제에 걸릴 이유도 없다. */
function SponsorRail(
  { rows, covers, onOpen, onClaimed }: {
    rows: API.SponsorRow[];
    covers: Record<string, API.PlaceCover>;
    onOpen: (x: FeedItem) => void;
    onClaimed: () => void;
  },
) {
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  if (!rows.length) return null;            // ← 계약이 없는 날의 정상 상태
  const q = rows[0];                        // 메타는 모든 행에 같은 값으로 실려 온다
  const left = Math.ceil(
    (new Date(q.ends_at).getTime() - Date.now()) / 86400000);
  const done = Math.min(q.done_count, q.target_count);
  const ready = q.done_count >= q.target_count && !q.claimed;

  const items: FeedItem[] = rows.map((x) => ({
    rail: "sponsor" as const,
    place_id: x.place_id, name: x.name, category: x.category,
    lng: x.lng, lat: x.lat, dist_m: x.dist_m,
    image_url: x.image_url, thumb_url: x.thumb_url,
    event_start: null, event_end: null, region_name: x.region_name,
    /* ★ 이미 다녀온 곳을 카드가 **스스로** 말한다. 진행도 숫자만 적어 두면
       *"어디를 더 가야 하나"* 를 사용자가 세어야 한다. */
    note: x.mine ? "다녀왔습니다" : undefined,
  }));

  const claim = async () => {
    setBusy(true);
    const r = await API.questClaim(q.quest_id);
    setBusy(false);
    if (r?.ok && r.reward_url) {
      /* ★ 여는 것은 **사용자가 누른 결과**다. 자동으로 열지 않는다. */
      void Linking.openURL(r.reward_url).catch(() => setWhy("링크를 열지 못했습니다"));
      onClaimed();
      return;
    }
    setWhy(
      r?.why === "already"  ? "이미 받으셨습니다"
    : r?.why === "not_yet"  ? `아직 ${q.target_count}곳을 채우지 못했습니다`
    : r?.why === "not_open" ? "지금은 받을 수 없는 퀘스트입니다"
    : r?.why === "need_login" ? "로그인이 필요합니다"
    : "받지 못했습니다");
  };

  return (
    <Rail
      title={q.title}
      /* ★ `sponsor` 하나로 갈린다 — 유료면 `광고`, 우리 것이면 꼬리표가 없다 */
      badge={q.sponsor ? "광고" : undefined}
      why={[
        q.sponsor ? `${q.sponsor} 제공` : null,
        `${q.target_count}곳 중 ${done}곳`,
        /* ★ 남은 날을 **지어내지 않는다** — 오늘 끝나면 "오늘까지"다 */
        left <= 0 ? "오늘까지" : `${left}일 남음`,
      ].filter(Boolean).join(" · ")}
      items={items}
      covers={covers}
      onOpen={onOpen}
      /* ★ **표지 경쟁에 참가하지 않는다.** 우리가 **팔아서** 생긴 노출을 "사람들이
         보고 골랐다"는 분모에 섞으면, 그 장소의 사진이 돈으로 순위를 산 것이 된다.
         §13.8 이 *"표지는 주어지지 않는다. 이긴다"* 로 정한 것을 돈이 뒤집으면 안 된다. */
      rank={false}
      foot={
        <View style={s.spFoot}>
          {q.claimed ? (
            <Text style={s.spDone}>받으셨습니다</Text>
          ) : ready ? (
            <Pressable style={s.spBtn} onPress={() => { void claim(); }} disabled={busy}>
              <Text style={s.spBtnT}>{busy ? "확인 중…" : "보상 받기"}</Text>
            </Pressable>
          ) : (
            /* ★ **현장 인증만 인정된다는 것을 미리 적는다.** 다 가고 나서 "안 된다"를
               보면 그건 속은 기분이다 — 조건은 시작할 때 보여야 한다(§12.23-D). */
            <Text style={s.spHint}>
              남은 {q.target_count - done}곳을{" "}
              {/* ★ 별표는 RN 에서 **글자 그대로 찍힌다.** 강조는 스타일로 한다 */}
              <Text style={s.spStrong}>지금 찍기</Text>로 남기면 받을 수 있습니다
            </Text>
          )}
          {why ? <Text style={s.spWhy}>{why}</Text> : null}
        </View>
      } />
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
  h1: { color: C.text, fontSize: 19, fontWeight: "700", paddingHorizontal: 18, paddingTop: 58 },
  sub: { color: C.muted, fontSize: 11.5, lineHeight: 18, paddingHorizontal: 18, paddingTop: 5 },
  chips: { paddingHorizontal: 18, paddingVertical: 12, gap: 6 },
  railHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  spFoot: { paddingHorizontal: RAIL_PAD, paddingTop: 10, gap: 6 },
  spBtn: {
    backgroundColor: C.accent, borderRadius: 10,
    paddingVertical: 11, alignItems: "center",
  },
  spBtnT: { color: C.onAccent, fontSize: 14, fontWeight: "700" },
  spHint: { color: C.muted, fontSize: 12, lineHeight: 18 },
  spStrong: { color: C.text, fontWeight: "700" },
  spDone: { color: C.visited, fontSize: 13, fontWeight: "600" },
  spWhy: { color: C.warn, fontSize: 12 },
  railBadge: {
    color: C.muted, fontSize: 10.5, fontWeight: "700",
    borderWidth: 1, borderColor: C.line, borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 1.5, overflow: "hidden",
  },
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
  /* 뼈대 막대 — 카드 바탕(`rgba(255,255,255,0.03)`)보다 **한 단만** 밝다.
     너무 밝으면 글자가 있는 줄 알고 읽으려 든다 */
  skBar: { height: 11, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.11)" },
});
