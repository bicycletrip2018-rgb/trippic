/**
 * 처음 한 번 **약관을 보이고 동의받는 화면** (§13.136)
 *
 * ★ 왜 전면인가 — 가이드라인 1.2 가 요구하는 것은 *"쓰기 전에 동의"* 다.
 *   구석의 체크박스는 동의를 받은 것이 아니다.
 *
 * ★ **요약을 화면에 적고**, 전문은 링크로 둔다. 전문만 링크해 두면 아무도
 *   안 읽고 누르고, 그러면 *"동의를 받았다"* 가 형식이 된다. 특히
 *   **무관용 조항**은 여기 그대로 적는다 — 그게 이 화면의 요점이다.
 *
 * ★ 링크를 **못 만들면 안 그린다.** 주소가 없는데 글자만 띄우면 눌러도
 *   아무 일이 안 일어나고, 사용자는 앱이 고장 난 줄 안다(`sitePage` 가 null).
 *
 * ★ **거절할 길을 준다.** 동의 없이는 쓸 수 없다고 말하고 끝낸다 —
 *   동의 말고 다른 선택지가 없는 화면은 동의가 아니라 통행료다.
 */
import { useState } from "react";
import { useTopPad } from "./safeArea";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C } from "./theme";
import { sitePage } from "./siteLinks";
import { INVITE_BASE } from "./config";
import { setAgreed } from "./terms";

export function TermsGate({ onDone }: { onDone: () => void }) {
  const topPad = useTopPad(18);
  const [bye, setBye] = useState(false);
  const terms = sitePage(INVITE_BASE, "terms");
  const privacy = sitePage(INVITE_BASE, "privacy");
  const open = (u: string | null) => { if (u) void Linking.openURL(u); };

  if (bye) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.h}>동의하셔야 쓸 수 있습니다</Text>
        <Text style={s.p}>
          트립픽은 다른 분이 올린 사진을 함께 보는 서비스라, 지킬 것을 먼저
          정해 두어야 합니다. 마음이 바뀌시면 앱을 다시 열어 주십시오.
        </Text>
        <Pressable style={s.ghost} onPress={() => setBye(false)}>
          <Text style={s.ghostT}>돌아가기</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.body, { paddingTop: topPad }]}>
        <Text style={s.h}>시작하기 전에</Text>
        <Text style={s.p}>
          트립픽은 <Text style={s.b}>다른 분이 올린 사진</Text>이 함께 보이는
          서비스입니다. 그래서 지킬 것이 몇 가지 있습니다.
        </Text>

        {/* ★ 무관용 — 1.2 가 약관에 **명시**를 요구하는 바로 그 대목 */}
        <View style={s.key}>
          <Text style={s.keyH}>불쾌한 콘텐츠와 괴롭힘은 용인하지 않습니다</Text>
          <Text style={s.keyP}>
            폭력적·선정적이거나 혐오를 조장하는 사진, 타인을 괴롭히는 행위,
            동의 없이 올린 타인의 사진, 광고·도배는 올리실 수 없습니다.{"\n"}
            <Text style={s.b}>신고가 들어오면 24시간 안에 확인하고 지우거나 계정을
            정지합니다.</Text>
          </Text>
        </View>

        <Text style={s.li}>· 기록은 <Text style={s.b}>기본이 ‘나만 보기’</Text>입니다.
          공개로 바꾸신 것만 다른 분께 보입니다.</Text>
        <Text style={s.li}>· 마음에 들지 않는 기록은 <Text style={s.b}>신고</Text>하거나
          그 사람을 <Text style={s.b}>차단</Text>하실 수 있습니다. 차단은 언제든 푸십니다.</Text>
        <Text style={s.li}>· 사진의 촬영 시각·좌표는 <Text style={s.b}>기기 안에서만</Text> 읽고,
          올라가는 것은 직접 고르신 사진뿐입니다.</Text>

        {(terms || privacy) && (
          <View style={s.links}>
            {!!terms && (
              <Pressable onPress={() => open(terms)}>
                <Text style={s.link}>이용약관 전문</Text>
              </Pressable>
            )}
            {!!privacy && (
              <Pressable onPress={() => open(privacy)}>
                <Text style={s.link}>개인정보처리방침</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <View style={s.foot}>
        <Pressable style={s.cta} onPress={() => { void setAgreed().then(onDone); }}>
          <Text style={s.ctaT}>동의하고 시작하기</Text>
        </Pressable>
        <Pressable style={s.ghost} onPress={() => setBye(true)}>
          <Text style={s.ghostT}>동의하지 않습니다</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  body: { padding: 22, paddingBottom: 24 },
  h: { color: C.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  p: { color: C.muted, fontSize: 14.5, lineHeight: 23, marginTop: 10 },
  b: { color: C.text, fontWeight: "700" },
  li: { color: C.muted, fontSize: 14, lineHeight: 22, marginTop: 12 },
  key: {
    marginTop: 20, padding: 16, borderRadius: 14,
    borderWidth: 1.5, borderColor: C.accent, backgroundColor: C.surface,
  },
  keyH: { color: C.text, fontSize: 15.5, fontWeight: "700", lineHeight: 22 },
  keyP: { color: C.muted, fontSize: 13.5, lineHeight: 21, marginTop: 7 },
  links: { flexDirection: "row", gap: 18, marginTop: 24 },
  link: { color: C.accent, fontSize: 13.5, textDecorationLine: "underline" },
  foot: { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: C.line, gap: 6 },
  cta: { backgroundColor: C.accent, borderRadius: 13, paddingVertical: 15, alignItems: "center" },
  ctaT: { color: C.onAccent, fontSize: 16, fontWeight: "700" },
  ghost: { paddingVertical: 12, alignItems: "center" },
  ghostT: { color: C.muted, fontSize: 14 },
});
