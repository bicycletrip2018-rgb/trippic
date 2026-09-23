#!/usr/bin/env python3
"""
사진 폴더에서 **촬영시각과 좌표만** 뽑아 TSV로 내보낸다.
파일명·인물·썸네일은 읽지 않고 기록하지도 않는다. 사진을 옮기거나 고치지 않는다.

외부 라이브러리를 쓰지 않는다 — 이 맥에 exiftool도 Pillow도 없고,
검증 한 번 하자고 설치를 요구하는 건 과하다. JPEG EXIF는 직접 읽고,
HEIC처럼 직접 읽기 어려운 형식만 macOS의 mdls로 넘긴다.

출력:  epoch초 \t 위도 \t 경도
사용:  python3 db/analysis/exif_scan.py <폴더> > data/out/album_real.tsv
"""
import os, sys, struct, subprocess, calendar

EXTS_JPEG = (".jpg", ".jpeg")
EXTS_OTHER = (".heic", ".heif", ".png", ".tiff", ".tif", ".dng",
              ".mp4", ".mov", ".m4v")   # 영상도 앨범의 일부다

def _rational(buf, off, bo):
    n, d = struct.unpack(bo + "II", buf[off:off + 8])
    return n / d if d else 0.0

def _ifd(buf, off, bo, want):
    """IFD 하나를 훑어 원하는 태그만 (태그 -> (타입, 개수, 값오프셋)) 으로 돌려준다."""
    out = {}
    if off + 2 > len(buf):
        return out
    cnt = struct.unpack(bo + "H", buf[off:off + 2])[0]
    for i in range(cnt):
        e = off + 2 + i * 12
        if e + 12 > len(buf):
            break
        tag, typ, num = struct.unpack(bo + "HHI", buf[e:e + 8])
        if tag not in want:
            continue
        size = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}.get(typ, 1) * num
        val = struct.unpack(bo + "I", buf[e + 8:e + 12])[0] if size > 4 else e + 8
        out[tag] = (typ, num, val)
    return out

def _long(buf, t, bo):
    """IFD 포인터(LONG 1개)의 **값**을 읽는다.

    ★ EXIF에서 값의 크기가 4바이트 이하이면 오프셋이 아니라 그 자리에 값이 들어간다.
      LONG 1개는 정확히 4바이트라 이 경계에 걸린다. 앞선 판은 `size > 4`일 때만
      값을 읽어서, 포인터 태그에서 **값 대신 값이 놓인 위치**를 돌려줬다.
      그래서 GPS IFD가 통째로 안 보였다 — 좌표가 있는 사진을 없다고 보고했다."""
    typ, num, off = t
    return struct.unpack(bo + "I", buf[off:off + 4])[0]

def _ascii(buf, t):
    typ, num, off = t
    return buf[off:off + num].split(b"\x00")[0].decode("ascii", "replace")

def _deg(buf, t, bo, ref):
    typ, num, off = t
    if num < 3:
        return None
    d = _rational(buf, off, bo); m = _rational(buf, off + 8, bo); s = _rational(buf, off + 16, bo)
    v = d + m / 60 + s / 3600
    return -v if ref in ("S", "W") else v

def jpeg_exif(path):
    """(촬영시각 문자열, 위도, 경도) — 없으면 None

    ★ 마커를 한 바이트씩 정직하게 훑는다. 앞선 판은 2바이트씩 읽고
      길이를 그대로 믿어서, 길이가 2보다 작은 순간 seek이 **뒤로** 가며
      영원히 돌았다 (실제로 48장짜리 폴더에서 멈췄다).
      JPEG에는 길이가 없는 마커(D0~D7, D8, 01)와 0xFF 채움 바이트가 있다."""
    STANDALONE = set(range(0xD0, 0xD8)) | {0xD8, 0x01}
    try:
        with open(path, "rb") as f:
            if f.read(2) != b"\xff\xd8":
                return None
            buf = None
            for _ in range(4096):                   # 안전장치 — 무한 루프 방지
                b = f.read(1)
                if not b:
                    return None
                if b[0] != 0xFF:
                    continue                        # 재동기화
                m = f.read(1)
                while m and m[0] == 0xFF:           # 채움 바이트
                    m = f.read(1)
                if not m:
                    return None
                marker = m[0]
                if marker in STANDALONE:
                    continue
                if marker in (0xD9, 0xDA):          # 끝 / 이미지 데이터 시작
                    return None
                hdr = f.read(2)
                if len(hdr) < 2:
                    return None
                ln = struct.unpack(">H", hdr)[0] - 2
                if ln < 0:
                    return None
                if marker == 0xE1:
                    seg = f.read(ln)
                    if seg.startswith(b"Exif\x00\x00"):
                        buf = seg[6:]
                        break
                    continue
                f.seek(ln, 1)
            if buf is None:
                return None
    except Exception:
        return None

    if len(buf) < 8:
        return None
    bo = "<" if buf[:2] == b"II" else ">"
    ifd0 = struct.unpack(bo + "I", buf[4:8])[0]
    top = _ifd(buf, ifd0, bo, {0x8769, 0x8825, 0x0132})
    when = lat = lng = None
    if 0x0132 in top:
        when = _ascii(buf, top[0x0132])
    if 0x8769 in top:                                   # Exif IFD
        sub = _ifd(buf, _long(buf, top[0x8769], bo), bo, {0x9003})
        if 0x9003 in sub:
            when = _ascii(buf, sub[0x9003])             # DateTimeOriginal 우선
    if 0x8825 in top:                                   # GPS IFD
        g = _ifd(buf, _long(buf, top[0x8825], bo), bo, {1, 2, 3, 4})
        if 2 in g and 4 in g:
            lat = _deg(buf, g[2], bo, _ascii(buf, g[1]) if 1 in g else "N")
            lng = _deg(buf, g[4], bo, _ascii(buf, g[3]) if 3 in g else "E")
    return (when, lat, lng)

def mdls_batch(paths):
    """macOS Spotlight로 읽는다 (HEIC 등). 색인이 안 된 파일은 빠진다."""
    out = {}
    for i in range(0, len(paths), 100):
        chunk = paths[i:i + 100]
        try:
            r = subprocess.run(
                ["mdls", "-name", "kMDItemContentCreationDate", "-name", "kMDItemLatitude",
                 "-name", "kMDItemLongitude"] + chunk,
                capture_output=True, text=True, timeout=120).stdout
        except Exception:
            continue
        for blk, p in zip(r.split("\n\n"), chunk):   # mdls는 파일마다 빈 줄로 나눈다
            d = {}
            for line in blk.split("\n"):
                if "=" in line:
                    k, v = line.split("=", 1)
                    d[k.strip()] = v.strip()
            try:
                la = float(d.get("kMDItemLatitude", "null"))
                lo = float(d.get("kMDItemLongitude", "null"))
                when = d.get("kMDItemContentCreationDate", "")[:19].replace("-", ":")
                if when:
                    out[p] = (when, la, lo)
            except ValueError:
                pass
    return out

def to_epoch(when):
    """EXIF는 촬영지 현지시각을 오프셋 없이 적는다. 국내 앨범을 전제로 KST로 읽는다."""
    try:
        d, t = when.strip().split(" ")
        Y, M, D = [int(x) for x in d.split(":")[:3]]
        h, m, s = [int(x) for x in t.split(":")[:3]]
        return calendar.timegm((Y, M, D, h, m, s, 0, 0, 0)) - 9 * 3600
    except Exception:
        return None

def main(root):
    jpegs, others = [], []
    for dp, _, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            low = fn.lower()
            if low.endswith(EXTS_JPEG):
                jpegs.append(p)
            elif low.endswith(EXTS_OTHER):
                others.append(p)

    rows, no_gps, no_exif = [], 0, 0
    for p in jpegs:
        r = jpeg_exif(p)
        if not r:
            no_exif += 1        # APP1 자체가 없다 — 카톡·다운로드·편집본
            continue
        when, la, lo = r
        if la is None or lo is None or not when:
            no_gps += 1
            continue
        ts = to_epoch(when)
        if ts:
            rows.append((ts, la, lo))
    if others:
        got = mdls_batch(others)
        for p in others:
            if p in got:
                when, la, lo = got[p]
                ts = to_epoch(when)
                if ts:
                    rows.append((ts, la, lo))
            else:
                no_gps += 1

    for ts, la, lo in sorted(rows):
        print(f"{ts}\t{la:.6f}\t{lo:.6f}")
    print(f"사진 {len(jpegs)+len(others)}장 → 좌표 있음 {len(rows)}장 · "
          f"좌표 없음 {no_gps}장 · EXIF 없음 {no_exif}장", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용: exif_scan.py <사진폴더>", file=sys.stderr); sys.exit(1)
    main(sys.argv[1])
