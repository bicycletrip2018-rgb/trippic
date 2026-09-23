#!/usr/bin/env python3
"""
사진 품질 기준을 **실제 사진에서** 정한다.

모두의 지도에 올릴 사진의 하한을 정해야 하는데, 숫자를 임의로 고르면
멀쩡한 사진이 막히거나 흐린 사진이 통과한다. 그래서 실제 여행 사진의
분포를 보고 정한다.

재는 것:
  · 해상도 (긴 변 픽셀)
  · 선명도 = 라플라시안 분산. 초점이 안 맞거나 흔들린 사진은 값이 낮다.
  · 단조로움 = 밝기 표준편차. 하늘만 찍힌 사진, 깜깜한 사진을 잡는다.

의존성 없이 macOS 기본 `sips`로 BMP로 줄여서 읽는다 (Pillow 불필요).
실제 앱에서는 온디바이스(Vision / ML Kit)가 같은 일을 한다 — 여기서는 **기준만** 정한다.
"""
import subprocess, sys, os, struct, tempfile, json
import numpy as np

def to_gray(path, side=320):
    """sips로 작게 줄여 BMP로 뽑고 흑백 배열로 읽는다."""
    with tempfile.NamedTemporaryFile(suffix=".bmp", delete=False) as t:
        tmp = t.name
    try:
        r = subprocess.run(["sips", "-Z", str(side), "-s", "format", "bmp", path, "--out", tmp],
                           capture_output=True)
        if r.returncode != 0 or not os.path.getsize(tmp): return None
        b = open(tmp, "rb").read()
        off = struct.unpack_from("<I", b, 10)[0]
        w, h = struct.unpack_from("<ii", b, 18)
        bpp = struct.unpack_from("<H", b, 28)[0]
        if bpp not in (24, 32): return None
        step = bpp // 8
        row = ((w * step + 3) // 4) * 4          # BMP 행은 4바이트 정렬
        a = np.frombuffer(b, dtype=np.uint8, count=row * abs(h), offset=off)
        a = a.reshape(abs(h), row)[:, :w * step].reshape(abs(h), w, step)[:, :, :3]
        if h > 0: a = a[::-1]                     # BMP는 보통 아래에서 위로
        return (a[:, :, 2] * .299 + a[:, :, 1] * .587 + a[:, :, 0] * .114)
    finally:
        os.unlink(tmp)

def _lap(g):
    return (-4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:])

def sharpness(g):
    """전역 라플라시안 분산. ★ 이것만 보면 안 된다 — 초점이 아니라 **내용**을 잰다."""
    return float(_lap(g).var())

def sharp_focus(g, tiles=8):
    """가장 선명한 영역의 선명도 (타일 분산의 90분위).

    ★ 전역 분산으로 기준을 잡으면 멀쩡한 사진이 막힌다.
      실측: 131장 중 최하위였던 p4.jpg(158)는 흐린 게 아니라 흐린 날 해변이었다.
      하늘이 화면 대부분이라 분산이 낮았을 뿐, 모래와 깃발은 또렷하다.
      안개·바다·설경 같은 미니멀한 풍경이 통째로 걸린다.

    초점이 맞은 사진은 **어딘가는 선명하다.** 그래서 전체 평균이 아니라
    '가장 선명한 부분'을 본다. 진짜 흔들린 사진은 어느 타일도 선명하지 않다."""
    l = np.abs(_lap(g))
    h, w = l.shape
    th, tw = max(h // tiles, 1), max(w // tiles, 1)
    vals = [l[y:y+th, x:x+tw].var()
            for y in range(0, h - th + 1, th) for x in range(0, w - tw + 1, tw)]
    return float(np.percentile(vals, 90)) if vals else 0.0

def dims(path):
    r = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path],
                       capture_output=True, text=True)
    w = h = 0
    for line in r.stdout.splitlines():
        if "pixelWidth:" in line: w = int(line.split(":")[1])
        if "pixelHeight:" in line: h = int(line.split(":")[1])
    return w, h

def measure(path):
    g = to_gray(path)
    if g is None: return None
    w, h = dims(path)
    return {"file": os.path.basename(path), "w": w, "h": h,
            "long": max(w, h), "sharp": round(sharpness(g), 1),
            "focus": round(sharp_focus(g), 1),
            "contrast": round(float(g.std()), 1),
            "bytes": os.path.getsize(path)}

def pct(v, p): return float(np.percentile(v, p)) if len(v) else 0.0

def main(paths):
    rows = [m for m in (measure(p) for p in paths) if m]
    if not rows: sys.exit("읽은 사진이 없다")
    L = [r["long"] for r in rows]; S = [r["sharp"] for r in rows]; C = [r["contrast"] for r in rows]
    F = [r["focus"] for r in rows]
    print(f"사진 {len(rows)}장\n")
    for nm, v in (("긴 변(px)", L), ("전역 선명도", S), ("초점 선명도", F), ("대비", C)):
        print(f"  {nm:10} 최소 {min(v):>8.1f} / 10% {pct(v,10):>8.1f} / 중앙 {pct(v,50):>8.1f} "
              f"/ 90% {pct(v,90):>8.1f} / 최대 {max(v):>8.1f}")
    print()
    worst = sorted(rows, key=lambda r: r["focus"])[:5]
    print("  초점 선명도가 가장 낮은 5장:")
    for r in worst:
        print(f"    {r['file']:<10} 초점 {r['focus']:>8.1f}  전역 {r['sharp']:>7.1f}  대비 {r['contrast']}")
    if "--json" in sys.argv: json.dump(rows, open("data/out/image_quality.json", "w"))

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args)
