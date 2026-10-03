/**
 * 기다리는 동안의 **뼈대** 조각 (§13.110 · §13.112)
 *
 * ★ 왜 따로 뺐나 — 숨 쉬는 규칙이 **두 곳에 생기려 했다**(`갈 곳`, `내 하루`).
 *   숨을 쉬게 하는 이유(*"멈춰 있으면 고장 난 화면과 구별이 안 된다"*)는 하나인데
 *   구현이 둘이면, 한쪽만 고쳐 놓고 다른 쪽은 안 고친 줄도 모른다(§13.37).
 *
 * ★ **네이티브 드라이버**로 돈다. 자바스크립트가 바쁠 때(마침 응답을 받아
 *   48행을 그리는 중일 때!) 끊기면, 하필 가장 바쁜 순간에 화면이 멈춘 것처럼 보인다.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, type ViewStyle } from "react-native";

/** 0 ↔ 1 을 오가는 값. 뼈대 한 벌에 **하나만** 만들어 여러 막대가 나눠 쓴다 */
export function useSkeletonPulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad),
                           useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad),
                           useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  /* 0.35~0.7 — 바탕에서 뜨되 **글자로 보이지는 않을 만큼**이다. 더 밝으면
     읽으려 들고, 더 어두우면 아무것도 없는 줄 안다. */
  return v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
}

/** 글자 한 줄이 들어올 자리 */
export function SkelBar(
  { pulse, style }: { pulse: Animated.AnimatedInterpolation<number>; style?: ViewStyle },
) {
  return <Animated.View style={[st.bar, style, { opacity: pulse }]} />;
}

/** 사진이 들어올 자리 — 높이는 쓰는 쪽이 정한다(카드마다 다르다) */
export function SkelBox(
  { pulse, style }: { pulse: Animated.AnimatedInterpolation<number>; style?: ViewStyle },
) {
  return <Animated.View style={[st.box, style, { opacity: pulse }]} />;
}

const st = StyleSheet.create({
  bar: { height: 11, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.11)" },
  box: { backgroundColor: "#222" },
});
