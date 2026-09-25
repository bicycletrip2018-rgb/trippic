/**
 * 지금 여기서 찍기 — **`live` 는 여기서만 만들어진다** (§6.5 · 016 · §13.53)
 *
 * ★ 서버는 처음부터 `live` 를 받을 준비가 되어 있었다(016):
 *     - `pins_live_is_recent`      찍은 시각이 등록 시각과 하루 이상 벌어지면 live 가 아니다
 *     - `pins_live_needs_accuracy` 정확도 150m 초과면 live 가 아니다
 *   그런데 **그것을 만들어 내는 길이 앱에 없었다.** 화면은 "현장 인증" 뱃지를
 *   그리고 있었고(RecordTabs), 웹 씨앗 데이터가 `i % 7 === 0` 으로 가짜를
 *   심고 있었을 뿐이다. **얻을 수 없는 뱃지를 그리는 것**은 §13.52 에서 고친
 *   "죽은 버튼"과 같은 형태다. 이 파일이 그 구멍을 메운다.
 *
 * ★ **EXIF 를 믿지 않는다.** §8 이 *"EXIF GPS는 조작이 쉬워 실방문 인증의 근거로
 *   쓸 수 없다"* 고 적어 뒀다. 그래서 여기서는 사진 파일의 메타데이터를 읽지 않고
 *   **찍은 직후 기기에 직접 물어본 좌표**를 쓴다. 파일을 갈아 끼워도 좌표는 안 바뀐다.
 *
 * ★ **완벽하지 않다는 것도 적어 둔다.** GPS 스푸핑과 화면 재촬영은 여전히 가능하다.
 *   그래서 §8 이 *"셋 다 지도는 채우되 뱃지와 노출 가중치만 차등한다"* 고 한 것이다 —
 *   live 는 **담장이지 자물쇠가 아니다.**
 */
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as VideoThumbnails from "expo-video-thumbnails";

/** 016 이 정한 상한. 이 값을 넘으면 `live` 라고 부르지 않는다. */
export const LIVE_ACCURACY_M = 150;
/** 002 의 `media_video_len` 이 정한 상한. */
export const VIDEO_MAX_SEC = 15;

export type Shot = {
  uri: string;
  type: "photo" | "video";
  w?: number; h?: number;
  durationSec?: number;
  posterUri?: string;          // 동영상 첫 프레임 — 없으면 `media_video_poster` 에 걸린다
  lat: number; lng: number;
  accuracyM: number;
  /** 정확도가 상한을 넘어 `live` 를 주장하지 못하는 경우. 화면이 이걸 말해야 한다. */
  liveOk: boolean;
  takenAt: number;
};

export type ShotFail = { ok: false; why: string; needsSettings?: boolean };

/**
 * 권한 → 촬영 → 위치. 셋 중 하나라도 어긋나면 **이유를 말하고 멈춘다.**
 *
 * ★ 순서가 중요하다. **위치를 먼저 묻지 않는다** — 찍지도 않았는데 위치부터
 *   물으면 무엇에 쓰는지 모른 채 거절당한다. 찍은 **뒤에** 물으면 맥락이 있다.
 *   (대신 좌표는 찍은 직후의 것이라 촬영 시점과 사실상 같다.)
 */
export async function capture(kind: "photo" | "video"): Promise<Shot | ShotFail> {
  // ── 1. 카메라 권한 ─────────────────────────────────────────────
  const cam = await ImagePicker.requestCameraPermissionsAsync();
  if (!cam.granted) {
    return { ok: false, needsSettings: !cam.canAskAgain,
             why: cam.canAskAgain
               ? "카메라를 허용하셔야 현장 인증을 남길 수 있습니다."
               : "설정 > 트립픽에서 카메라를 켜 주십시오." };
  }

  // ── 2. 촬영 ────────────────────────────────────────────────────
  /* ★ `launchCameraAsync` 는 **반드시 카메라를 연다.** 앨범에서 고를 수 없다 —
     그게 이 경로와 소급 등록을 가르는 지점이고, live 의 근거 절반이다. */
  let shot: ImagePicker.ImagePickerResult;
  try {
    shot = await ImagePicker.launchCameraAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      videoMaxDuration: VIDEO_MAX_SEC,
      /* ★ 원본 화질로 두면 15초짜리가 수십 MB 가 되어 버킷 상한(030)을 넘긴다.
         올라가지 않는 최고 화질보다 **올라가는 화질**이 낫다. */
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      quality: 0.9,
      exif: false,                 // ★ 안 읽는다 — 위는 그 이유를 적어 뒀다
    });
  } catch (e: any) {
    /* 시뮬레이터에는 카메라가 없다. 실기기에서만 되는 경로라는 것을 숨기지 않는다. */
    return { ok: false, why: `카메라를 열지 못했습니다 — ${String(e?.message ?? e)}` };
  }
  if (shot.canceled || !shot.assets?.length) return { ok: false, why: "" };  // 취소는 오류가 아니다
  const a = shot.assets[0];

  if (kind === "video" && (a.duration ?? 0) / 1000 > VIDEO_MAX_SEC + 1) {
    return { ok: false, why: `동영상은 ${VIDEO_MAX_SEC}초까지 담을 수 있습니다.` };
  }

  // ── 3. 위치 ────────────────────────────────────────────────────
  const loc = await Location.requestForegroundPermissionsAsync();
  if (!loc.granted) {
    return { ok: false, needsSettings: !loc.canAskAgain,
             why: loc.canAskAgain
               ? "위치를 허용하셔야 어느 장소인지 찾을 수 있습니다."
               : "설정 > 트립픽에서 위치를 켜 주십시오." };
  }
  let pos: Location.LocationObject;
  try {
    pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
  } catch (e: any) {
    return { ok: false, why: `위치를 받지 못했습니다 — ${String(e?.message ?? e)}` };
  }

  /* ★ 정확도가 나쁘면 **막지 않고 낮춘다.** 사진은 이미 찍혔다 — 버리게 하면
     사용자는 그 순간을 잃는다. 지도는 채우되 뱃지만 안 준다(§8). */
  const accuracyM = pos.coords.accuracy ?? 9999;

  // ── 4. 동영상이면 표지 한 장 ────────────────────────────────────
  let posterUri: string | undefined;
  if (kind === "video") {
    try {
      const t = await VideoThumbnails.getThumbnailAsync(a.uri, { time: 0 });
      posterUri = t.uri;
    } catch {
      /* 표지가 없으면 `media_video_poster` 에 걸려 저장 자체가 안 된다.
         여기서 멈추는 편이 "올렸는데 없다"보다 낫다. */
      return { ok: false, why: "동영상 표지를 만들지 못했습니다 — 다시 찍어 주십시오." };
    }
  }

  return {
    uri: a.uri,
    type: kind,
    w: a.width, h: a.height,
    durationSec: kind === "video" ? Math.round((a.duration ?? 0) / 100) / 10 : undefined,
    posterUri,
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM,
    liveOk: accuracyM <= LIVE_ACCURACY_M,
    takenAt: Date.now(),
  };
}

export const isFail = (r: Shot | ShotFail): r is ShotFail => (r as any).ok === false;
