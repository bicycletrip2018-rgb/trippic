/**
 * 화면 위쪽 안전영역(상태바·노치·다이내믹 아일랜드)을 한 군데서 센다.
 *
 * ★ 왜 모듈로 뺐나 — §13.143 이전에는 화면마다 `paddingTop: 52 / 54 / 56 / 58 / 76`
 *   이 **눈대중으로** 박혀 있었다. 다 같은 것을 노리고 있었다: *"상태바 바로
 *   아래에 앉혀라."* 아이폰의 실제 값이 59 였으니 52~58 은 전부 **조금씩 틀린
 *   근사치**였고, 상태바가 다른 기기에서는 더 틀린다.
 *
 * ★ 안드로이드에서는 이 값이 iOS 와 **크게 다르다**(상태바가 노치보다 얕다).
 *   그래서 한 숫자로는 둘 다 맞출 수 없다 — 기기에게 물어야 한다.
 */
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** 화면 맨 위 머리말이 앉을 자리. `gap` 은 안전영역 **아래로** 더 둘 여백이다. */
export function useTopPad(gap = 0): number {
  return useSafeAreaInsets().top + gap;
}

/**
 * 상태바 자리를 덮는 띠의 높이.
 *
 * ★ 안전영역을 지켜도 **스크롤한 내용은 그 위로 지나간다** — 안드로이드에서
 *   제목이 시계와 겹치는 것을 §13.142 에서 봤다. 띠가 있어야 글자가 그 밑으로
 *   숨는다. 이제 iOS 에서도 같은 일이 일어나므로 **양쪽 다** 덮는다.
 */
export function useStatusBarHeight(): number {
  return useSafeAreaInsets().top;
}
