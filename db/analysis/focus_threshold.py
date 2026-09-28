#!/usr/bin/env python3
"""
초점 기준을 **기기 값으로** 다시 뽑는다 (§13.77).

010 은 `sips` 로 줄여 잰 값에서 200 을 정했다. 앱은 Skia 로 줄이므로 같은 사진에
다른 값이 나온다(§13.76 실측 1.3~1.8배). 기준은 **재는 도구와 함께** 정해져야 한다.

입력: /tmp/calib.jsonl  (앱이 :5199 로 보낸 것)
"""
import json, sys
import numpy as np

rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/calib.jsonl")]
dev_n = np.array([r["focus"] for r in rows if r["k"] == "normal"])
dev_b = np.array([r["focus"] for r in rows if r["k"] == "blur"])
py_n, py_b = np.load("/tmp/py_normal.npy"), np.load("/tmp/py_blur.npy")

def line(nm, v):
    return (f"  {nm:<12} {len(v):>4}  {v.min():>9.1f} {np.percentile(v,5):>9.1f} "
            f"{np.median(v):>9.1f} {np.percentile(v,95):>9.1f} {v.max():>9.1f}")

print("초점 분포\n")
print(f"  {'':12} {'n':>4}  {'최소':>9} {'5%':>9} {'중앙':>9} {'95%':>9} {'최대':>9}")
print(line("정상 · 참조", py_n)); print(line("정상 · 기기", dev_n))
print(line("흐림 · 참조", py_b)); print(line("흐림 · 기기", dev_b))

print(f"\n  기기/참조 배율 — 정상 중앙 {np.median(dev_n)/np.median(py_n):.2f} · "
      f"흐림 중앙 {np.median(dev_b)/np.median(py_b):.2f}")

print("\n\n기준 후보 — 양쪽 오류\n")
print(f"  {'기준':>6} {'흐린 사진 통과':>14} {'멀쩡한 사진 차단':>16}")
best = None
for t in (150, 200, 250, 300, 350, 400, 450, 500, 600, 700):
    fp = float((dev_b >= t).mean())      # 흐린데 통과 — 나쁜 사진이 지도에 오른다
    fn = float((dev_n <  t).mean())      # 멀쩡한데 차단 — 사용자 사진을 잃는다
    mark = ""
    if fp == 0 and fn == 0:
        # 양쪽 0 인 구간의 **한가운데**를 고른다 — 여유를 양쪽에 나눈다
        if best is None: best = [t, t]
        else: best[1] = t
        mark = "  ← 양쪽 0"
    print(f"  {t:>6} {fp*100:>13.1f}% {fn*100:>15.1f}%{mark}")

lo, hi = dev_b.max(), dev_n.min()
print(f"\n  흐림 최대 {lo:.1f}  <  정상 최소 {hi:.1f}   (깨끗하게 갈린다)"
      if lo < hi else f"\n  ★ 겹친다: 흐림 최대 {lo:.1f} ≥ 정상 최소 {hi:.1f}")
if lo < hi:
    mid = int(round((lo + hi) / 2 / 50) * 50)
    print(f"  → 가운데를 50 단위로 끊어 **{mid}** 을 제안한다 "
          f"(아래 여유 {mid-lo:.0f} · 위 여유 {hi-mid:.0f})")
