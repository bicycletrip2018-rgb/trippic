/**
 * 안드로이드 **뒤로가기**로 닫는다 (§13.172)
 *
 * ★ 사용자: *"여기서 뒤로가기 누르면 왜 검은 화면이 나오는지 확인해줘. 거기서
 *   한 번 더 뒤로가기 누르니까 갑자기 카메라 앱으로 열려."*
 *
 * 원인은 단순하다. `PinSheet` 과 `PlaceSheet` 은 **`Modal` 이 아니라 그냥
 * 절대배치 `View`** 다. `Modal` 은 `onRequestClose` 로 뒤로가기를 받지만, 그냥
 * 뷰는 **안드로이드가 그 존재를 모른다.** 그래서 뒤로가기가 곧장 액티비티로
 * 가고, 앱에 `BackHandler` 가 **한 군데도 없어서** 액티비티가 끝난다.
 *   → 화면이 검게 지워지고(종료 전환), 한 번 더 누르면 **작업 스택에 남아 있던
 *     이전 액티비티**(지난번 「지금 여기」가 띄운 카메라)가 올라온다.
 *   실제로 그렇게 보였다.
 *
 * ★ 겹을 `Modal` 로 바꾸지 않는다. 이 시트들은 지도 위에 **같은 창으로** 떠 있어야
 *   지도 제스처·레이아웃이 그대로고, 모달로 바꾸면 키보드·세이프에어리어가 전부
 *   다시 틀어진다(§13.168 에서 모달 안 키보드로 한 번 겪었다).
 *   필요한 것은 **뒤로가기를 받아 주는 것 하나**다.
 *
 * ★ RN 의 `BackHandler` 는 **나중에 등록한 것부터** 부른다. 그래서 장소 시트가
 *   기록 시트 위에 떠 있으면 장소 시트가 먼저 받는다 — 겹친 순서와 같다.
 *   따로 우선순위를 매길 필요가 없다.
 */
import { useEffect } from "react";
import { BackHandler, Platform } from "react-native";

export function useBackClose(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;            // 여기서 **먹는다** — 액티비티까지 가면 앱이 꺼진다
    });
    return () => sub.remove();
  }, [active, onClose]);
}
