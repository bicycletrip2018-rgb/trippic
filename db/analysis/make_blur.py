#!/usr/bin/env python3
"""
흐림 대조군을 **다시 만든다** (§13.77)

010 이 기준을 정할 때 *"같은 사진을 흐리게 만들어 대조 (60장)"* 을 썼는데
**그 사진들도, 흐리게 만든 스크립트도 남아 있지 않다.** 남은 것은 그때의 분포뿐이다:

    흐림  중앙 62 · 최대 159      (정상  최소 265 · 5% 481 · 중앙 2,245)

그래서 대조군을 **그 분포에 맞춰 복원한다.** 임의의 흐림을 쓰면 새 기준이
010 의 기준과 **다른 세기의 흐림**을 상대로 정해져 비교가 성립하지 않는다.
→ `--calibrate` 로 sigma 를 훑어 중앙값이 62 에 가장 가까운 값을 고른다.

의존성은 numpy 뿐이다. 읽고 쓰기는 macOS 기본 `sips` 로 BMP 를 거친다.
"""
import subprocess, sys, os, struct, tempfile, glob
import numpy as np

def read_rgb(path):
    with tempfile.NamedTemporaryFile(suffix=".bmp", delete=False) as t: tmp = t.name
    try:
        r = subprocess.run(["sips", "-s", "format", "bmp", path, "--out", tmp], capture_output=True)
        if r.returncode != 0 or not os.path.getsize(tmp): return None
        b = open(tmp, "rb").read()
        off = struct.unpack_from("<I", b, 10)[0]
        w, h = struct.unpack_from("<ii", b, 18)
        bpp = struct.unpack_from("<H", b, 28)[0]
        if bpp not in (24, 32): return None
        step = bpp // 8
        row = ((w * step + 3) // 4) * 4
        a = np.frombuffer(b, dtype=np.uint8, count=row * abs(h), offset=off)
        a = a.reshape(abs(h), row)[:, :w * step].reshape(abs(h), w, step)[:, :, :3]
        if h > 0: a = a[::-1]
        return a[:, :, ::-1].astype(np.float64)        # BGR -> RGB
    finally: os.unlink(tmp)

def write_jpg(rgb, path, quality=90):
    """BMP 로 써서 sips 로 jpg 로 바꾼다."""
    h, w, _ = rgb.shape
    bgr = np.clip(rgb, 0, 255).astype(np.uint8)[:, :, ::-1][::-1]   # 아래에서 위로
    row = ((w * 3 + 3) // 4) * 4
    pad = row - w * 3
    body = b"".join(bgr[y].tobytes() + b"\0" * pad for y in range(h))
    hdr = (b"BM" + struct.pack("<IHHI", 54 + len(body), 0, 0, 54)
           + struct.pack("<IiiHHIIiiII", 40, w, h, 1, 24, 0, len(body), 2835, 2835, 0, 0))
    with tempfile.NamedTemporaryFile(suffix=".bmp", delete=False) as t:
        t.write(hdr + body); tmp = t.name
    try:
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality),
                        tmp, "--out", path], capture_output=True, check=True)
    finally: os.unlink(tmp)

def gauss1d(sigma):
    r = max(1, int(round(3 * sigma)))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-(x ** 2) / (2 * sigma ** 2)); return k / k.sum()

def blur(rgb, sigma):
    """분리형 가우시안. 카메라 초점 흐림에 가장 가까운 단순한 모형이다."""
    k = gauss1d(sigma)
    out = rgb
    for axis in (0, 1):
        pad = [(0, 0)] * 3; pad[axis] = (len(k) // 2, len(k) // 2)
        p = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, wgt in enumerate(k):
            sl = [slice(None)] * 3
            sl[axis] = slice(i, i + out.shape[axis])
            acc += wgt * p[tuple(sl)]
        out = acc
    return out

def _iq():
    import importlib.util
    s = importlib.util.spec_from_file_location("iq", os.path.join(os.path.dirname(__file__), "image_quality.py"))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m

def calibrate(paths, target_median=62.0):
    """010 의 흐림 분포(중앙 62 · 최대 159)를 재현하는 sigma 를 찾는다.

    ★ 흐린 배열을 바로 재면 안 된다. **파일로 써서 `image_quality.py` 로 재야** 한다 —
      참조는 `sips -Z 320` 으로 줄이는데 그건 제대로 리샘플링한다. 내가 처음에
      최근접 이웃으로 줄여서 쟀더니 고주파가 그대로 남아 값이 전부 수십 배로 나왔고,
      sigma 5 도 목표에 못 미치는 것처럼 보였다. **줄이는 방식이 곧 측정의 일부다.**
    """
    iq = _iq()
    print(f"{'sigma':>6}{'중앙':>9}{'최대':>9}   (목표 중앙 {target_median} · 최대 159)")
    best = None
    for sigma in (3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 7.0):   # 4.5 에서 최대 159.1 — 010 의 159 와 맞는다
        vals = []
        for p in paths:
            rgb = read_rgb(p)
            if rgb is None: continue
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as t: tmp = t.name
            try:
                write_jpg(blur(rgb, sigma), tmp)
                g = iq.to_gray(tmp)
                if g is not None: vals.append(iq.sharp_focus(g))
            finally: os.unlink(tmp)
        med, mx = float(np.median(vals)), float(np.max(vals))
        print(f"{sigma:>6.1f}{med:>9.1f}{mx:>9.1f}")
        if best is None or abs(med - target_median) < abs(best[1] - target_median):
            best = (sigma, med)
    print(f"\n채택: sigma {best[0]} (중앙 {best[1]:.1f})")
    return best[0]

if __name__ == "__main__":
    args = sys.argv[1:]
    src = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "../../prototype/photos/p*.jpg")))
    if "--calibrate" in args:
        import random; random.seed(7)
        calibrate(random.sample(src, min(25, len(src))))
    else:
        sigma = float(args[args.index("--sigma") + 1]) if "--sigma" in args else 4.5
        out = args[args.index("--out") + 1] if "--out" in args else "/tmp/blur"
        os.makedirs(out, exist_ok=True)
        for i, p in enumerate(src):
            rgb = read_rgb(p)
            if rgb is None: continue
            write_jpg(blur(rgb, sigma), os.path.join(out, os.path.basename(p)))
            if (i+1) % 20 == 0: print(f"  {i+1}/{len(src)}")
        print(f"흐림 {len(src)}장 → {out} (sigma {sigma})")
