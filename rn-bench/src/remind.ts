/**
 * 주간 정리 알림 (§12.28-4 · §13.79)
 *
 * ★ §12.25 가 가장 크게 걱정한 것이 **F1 — 재방문이 안 나온다** 였다:
 *     *"여행 계획은 월 1회다. 피드는 매일 열려야 사는데 '어디 갈까'는 매일 묻지 않는다."*
 *   §12.27 이 그 답을 찾았다: **여행은 월 1회지만 사진은 매주 찍힌다.**
 *   그래서 이 앱이 보낼 자격이 있는 **유일한 푸시**는 *"당신이 찍은 사진"* 얘기다.
 *
 * ★ **서버 푸시가 아니다.** 내 앨범 사정은 기기만 안다 — 서버는 어느 사진이 아직
 *   안 올라왔는지 모른다(올라온 것만 안다). 그래서 기기가 스스로 거는 지역 알림이다.
 *   덤으로 토큰·FCM·APNs 가 전부 필요 없다.
 *
 * ★ **할 일이 없으면 안 건다.** 숫자를 부풀리거나 빈손으로 부르면 그 순간
 *   *"광고 보내는 앱"* 이 된다 — 한 번이면 끈다. 남은 일이 0이면 걸려 있던 것도 지운다.
 *
 * ★ 권한을 **미리 묻지 않는다.** 보낼 거리가 생겼을 때 묻는다. 맥락 없이 물으면
 *   거절당하고, iOS 는 한 번 거절하면 앱에서 다시 못 묻는다(§13.53 의 권한 순서와 같다).
 */
import * as Notifications from "expo-notifications";
import { minutesFor } from "./registered";

/** 토요일 오전 10시. 주말 사진을 찍기 **전**이 아니라, 지난 주말을 정리할 때다. */
const WEEKDAY = 7;      // expo: 1=일 … 7=토
const HOUR = 10, MINUTE = 0;

const ID = "trippic-weekly-tidy";

export type Pending = { trips: number; stops: number; photos: number };

/** 알림을 눌렀을 때 앱이 어디로 갈지 구분하는 꼬리표 */
export const TIDY = "tidy";

export async function canAsk() {
  const s = await Notifications.getPermissionsAsync();
  return s.status !== "denied";
}

/**
 * 남은 일에 맞춰 주간 알림을 **다시 건다.**
 *
 * ★ 늘 지우고 다시 건다. 내용(장수)이 바뀌는데 예전 것을 두면 **옛 숫자로 울린다** —
 *   그게 거짓말이 되는 가장 쉬운 길이다.
 */
export async function syncWeeklyTidy(p: Pending): Promise<"scheduled" | "cleared" | "denied"> {
  try {
    await Notifications.cancelScheduledNotificationAsync(ID).catch(() => {});

    if (!p.trips || !p.stops) return "cleared";      // 할 일이 없으면 안 건다

    let s = await Notifications.getPermissionsAsync();
    if (s.status === "undetermined") s = await Notifications.requestPermissionsAsync();
    if (s.status !== "granted") return "denied";

    const mins = minutesFor(p.stops);
    await Notifications.scheduleNotificationAsync({
      identifier: ID,
      content: {
        title: `아직 지도에 없는 여행 ${p.trips}개`,
        /* ★ *"정리하세요"* 는 부담이고 *"N분이면 끝납니다"* 는 초대다(§12.27). */
        body: `사진 ${p.photos}장이 기다리고 있습니다 — ${mins}분이면 끝납니다.`,
        data: { to: TIDY },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday: WEEKDAY, hour: HOUR, minute: MINUTE,
      },
    });
    return "scheduled";
  } catch {
    return "cleared";          // 알림이 안 되는 기기에서 등록 자체를 막지 않는다
  }
}

/** 검사용 — 지금 걸려 있는 것. */
export async function scheduled() {
  try { return await Notifications.getAllScheduledNotificationsAsync(); }
  catch { return []; }
}
