#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "opencv-python-headless>=4.10"]
# ///
"""ag-rec export: turn a raw ag-rec recording into a dense, nice-to-watch mp4.

  export.py <session-dir | video> <out.mp4> [options]

A session dir (from `ag-rec start/stop`) holds screen.mkv (captured without the cursor),
cursor.csv (cursorlog) and ffmpeg.log (whose `start:` line is the video's epoch start).
Any other video is accepted too; then only dead-time cutting applies.

Pipeline:
  1. analysis: per-frame pixel-change score on a small grayscale copy, plus cursor motion/clicks
  2. timeline: idle stretches (no change for >= --idle s) are fast-forwarded (--speed, with a
     badge) or dropped (--drop); --pad s of real time is kept around every change
  3. cursor: teleports (agents' instant moves) become eased glides that land exactly at the
     jump; everything gets a light zero-lag smoothing; drawn enlarged with a click ripple
  4. camera: gentle spring zoom (--zoom) toward click areas, back out when clicks stop
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


def log(*a):
    print("ag-rec:", *a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- inputs

def probe(video: Path) -> tuple[int, int, float, float]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate:format=duration", "-of", "json", str(video)],
        check=True, capture_output=True, text=True).stdout
    j = json.loads(out)
    s = j["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), float(num) / float(den), float(j["format"]["duration"])


@dataclass
class Cursor:
    t: np.ndarray        # source seconds, uniform grid
    x: np.ndarray        # video pixels
    y: np.ndarray
    visible: np.ndarray  # on the captured screen
    down: np.ndarray     # left/right button held (0..1)
    clicks: list[tuple[float, float, float]]  # (t, x, y) of button-downs
    scrolls: list[float]


def load_cursor(csv: Path, t0: float, W: int, H: int, screen: int, dur: float, hz: float,
                raw: bool = False) -> Cursor | None:
    if not csv.exists():
        return None
    scr = {}
    samples, clicks, scrolls, presses = [], [], [], []
    for line in csv.read_text().splitlines():
        if line.startswith("#screen"):
            _, i, x, y, w, h, _s = line.split()
            scr[int(i)] = tuple(map(float, (x, y, w, h)))
        elif line and line[0].isdigit():
            t, k, x, y = line.split(",")
            t, x, y = float(t) - t0, float(x), float(y)
            samples.append((t, x, y))
            if k in "dD":
                clicks.append((t, x, y)); presses.append((t, 1))
            elif k in "uU":
                presses.append((t, 0))
            elif k == "s":
                scrolls.append(t)
    if not samples or screen not in scr:
        return None
    ox, oy, sw, sh = scr[screen]
    kx, ky = W / sw, H / sh
    samples.sort()
    st = np.array([s[0] for s in samples])
    sx = (np.array([s[1] for s in samples]) - ox) * kx
    sy = (np.array([s[2] for s in samples]) - oy) * ky

    # Teleports: a big step right after the cursor sat still. Replace each with an eased glide
    # that *ends* at the jump time, so a click right after the jump lands where it should.
    gx, gy, gt = [sx[0]], [sy[0]], [st[0]]
    still_since = st[0]
    for i in range(1, len(st)):
        d = math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1])
        if not raw and d > 60 * kx and st[i] - still_since > 0.12:
            dur_g = min(0.8, max(0.3, 0.25 + d / (2400 * kx)))
            start = max(st[i] - dur_g, gt[-1] + 1e-3)
            n = max(2, int((st[i] - start) * 120))
            for j in range(n):
                u = j / n
                e = u * u * u * (u * (6 * u - 15) + 10)  # smootherstep
                gt.append(start + (st[i] - start) * u)
                gx.append(sx[i - 1] + (sx[i] - sx[i - 1]) * e)
                gy.append(sy[i - 1] + (sy[i] - sy[i - 1]) * e)
        if d > 1.5:
            still_since = st[i]
        gt.append(st[i]); gx.append(sx[i]); gy.append(sy[i])
    gt, gx, gy = np.array(gt), np.array(gx), np.array(gy)
    order = np.argsort(gt, kind="stable")
    gt, gx, gy = gt[order], gx[order], gy[order]

    # Uniform grid, sample-and-hold between log samples (the log only writes when it moves).
    t = np.arange(0, dur + 1, 1 / hz)
    idx = np.clip(np.searchsorted(gt, t, side="right") - 1, 0, len(gt) - 1)
    x, y = gx[idx], gy[idx]
    # Zero-lag gaussian smoothing (~30 ms) takes the edge off hand jitter and 60 Hz stepping.
    sig = 0.03 * hz if not raw else 0.3
    k = np.exp(-0.5 * (np.arange(-3 * sig, 3 * sig + 1) / sig) ** 2); k /= k.sum()
    pad = len(k) // 2
    x = np.convolve(np.pad(x, pad, mode="edge"), k, mode="valid")[: len(t)]
    y = np.convolve(np.pad(y, pad, mode="edge"), k, mode="valid")[: len(t)]
    visible = (x > -4) & (x < W + 4) & (y > -4) & (y < H + 4)

    down = np.zeros(len(t))
    presses.sort()
    state, pi = 0, 0
    for i, ti in enumerate(t):
        while pi < len(presses) and presses[pi][0] <= ti:
            state = presses[pi][1]; pi += 1
        down[i] = state
    # Guarantee every click shows a press, even an instant one.
    for (tc, _, _) in clicks:
        down[(t >= tc) & (t < tc + 0.12)] = 1

    clicks = [(tc, (cx - ox) * kx, (cy - oy) * ky) for tc, cx, cy in clicks]
    return Cursor(t, x, y, visible, down, clicks, scrolls)


def activity(video: Path, fps: float) -> np.ndarray:
    """Fraction of pixels that changed noticeably, per frame, on a 480-wide gray copy."""
    w = 480
    W, H, _, _ = probe(video)
    h = int(round(H * w / W / 2)) * 2
    p = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps},scale={w}:{h}:flags=area",
         "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
    scores, prev, n = [], None, w * h
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        f = np.frombuffer(b, np.uint8).astype(np.int16)
        scores.append(0.0 if prev is None else float(np.count_nonzero(np.abs(f - prev) > 10)) / n)
        prev = f
    p.wait()
    return np.array(scores)


# ---------------------------------------------------------------- timeline

def build_timeline(score, cur: Cursor | None, fps, a) -> tuple[list[int], list[float]]:
    """Returns the source frame for every output frame and the speed it plays at."""
    n = len(score)
    act = score > a.threshold
    if cur is not None:
        ct = np.arange(n) / fps
        ci = np.clip(np.round(ct * (len(cur.t) / (cur.t[-1] + 1e-9))).astype(int), 0, len(cur.t) - 1)
        speed = np.hypot(np.diff(cur.x, prepend=cur.x[0]), np.diff(cur.y, prepend=cur.y[0])) * (len(cur.t) / cur.t[-1])
        act |= (speed[ci] > 40) & cur.visible[ci]   # moving faster than 40 px/s
        for tc, _, _ in cur.clicks:
            i = int(tc * fps)
            if 0 <= i < n:
                act[i] = True
        for ts in cur.scrolls:
            i = int(ts * fps)
            if 0 <= i < n:
                act[i] = True
    # Keep real time around every change so it stays readable.
    keep = np.zeros(n, bool)
    before, after = int(a.pad * fps), int(a.pad * 1.5 * fps)
    for i in np.flatnonzero(act):
        keep[max(0, i - before): i + after + 1] = True
    keep[: int(0.5 * fps)] = True
    keep[-int(0.8 * fps):] = True

    src, spd = [], []
    i = 0
    min_idle = int(a.idle * fps)
    while i < n:
        j = i
        while j < n and keep[j] == keep[i]:
            j += 1
        L = j - i
        if keep[i] or L < min_idle:
            src += range(i, j); spd += [1.0] * L
        elif not a.drop:
            m = max(1, min(math.ceil(L / a.speed), int(a.max_ff * fps)))
            sp = L / m
            src += [i + int(k * sp) for k in range(m)]; spd += [sp] * m
        i = j
    return src, spd


# ---------------------------------------------------------------- drawing

def arrow_sprite(h: int) -> np.ndarray:
    """macOS-style arrow (black, white outline, soft shadow) as BGRA, tip at (pad, pad)."""
    ss = 4
    s = h * ss / 21.0
    pts = np.array([(0, 0), (0, 16.5), (3.9, 12.9), (6.6, 19.3), (9.3, 18.2), (6.7, 12.0), (12.0, 12.0)])
    pad = int(0.3 * h)
    size = (int(13 * s) + 2 * pad * ss, int(20 * s) + 2 * pad * ss)
    P = (pts * s + pad * ss).astype(np.int32)
    alpha = np.zeros(size[::-1], np.uint8)
    col = np.zeros(size[::-1] + (3,), np.uint8)
    ow = max(2, int(1.5 * s))
    cv2.fillPoly(alpha, [P], 255, cv2.LINE_AA)
    cv2.polylines(alpha, [P], True, 255, ow * 2, cv2.LINE_AA)
    col[:] = 255
    inner = np.zeros_like(alpha)
    cv2.fillPoly(inner, [P], 255, cv2.LINE_AA)
    inner = cv2.erode(inner, np.ones((3, 3), np.uint8), iterations=max(1, ow // 2))
    col[inner > 127] = 0
    shadow = cv2.GaussianBlur(alpha, (0, 0), s * 1.2)
    shadow = np.roll(shadow, (int(s * 0.8), int(s * 0.3)), (0, 1))
    a = alpha.astype(np.float32) / 255
    sh = shadow.astype(np.float32) / 255 * 0.45
    out_a = a + sh * (1 - a)
    rgb = (col.astype(np.float32) * a[..., None]) / np.maximum(out_a[..., None], 1e-6)
    big = np.dstack([rgb, out_a * 255]).clip(0, 255).astype(np.uint8)
    small = cv2.resize(big, (size[0] // ss, size[1] // ss), interpolation=cv2.INTER_AREA)
    return small, pad


_sprites: dict[int, tuple[np.ndarray, int]] = {}


def blit(frame, sprite, x, y):
    h, w = sprite.shape[:2]
    x0, y0 = int(round(x)), int(round(y))
    fx0, fy0 = max(0, x0), max(0, y0)
    fx1, fy1 = min(frame.shape[1], x0 + w), min(frame.shape[0], y0 + h)
    if fx1 <= fx0 or fy1 <= fy0:
        return
    s = sprite[fy0 - y0: fy1 - y0, fx0 - x0: fx1 - x0].astype(np.float32)
    a = s[..., 3:4] / 255
    roi = frame[fy0:fy1, fx0:fx1].astype(np.float32)
    frame[fy0:fy1, fx0:fx1] = (s[..., :3] * a + roi * (1 - a)).astype(np.uint8)


def draw_cursor(frame, x, y, h):
    h = max(8, int(round(h)))
    if h not in _sprites:
        _sprites[h] = arrow_sprite(h)
    spr, pad = _sprites[h]
    blit(frame, spr, x - pad, y - pad)


def draw_ripple(frame, x, y, age, r):
    u = age / 0.55
    if not 0 <= u < 1:
        return
    e = 1 - (1 - u) ** 3
    rad = r * (0.35 + 0.9 * e)
    al = 0.75 * (1 - u)
    ov = frame.copy()
    cv2.circle(ov, (int(x), int(y)), int(rad), (255, 190, 90), -1, cv2.LINE_AA)
    cv2.addWeighted(ov, al * 0.45, frame, 1 - al * 0.45, 0, frame)
    ov = frame.copy()
    cv2.circle(ov, (int(x), int(y)), int(rad), (255, 170, 60), max(2, int(r * 0.12)), cv2.LINE_AA)
    cv2.addWeighted(ov, al, frame, 1 - al, 0, frame)


def draw_badge(frame, speed, alpha):
    if alpha <= 0.01:
        return
    H, W = frame.shape[:2]
    s = W / 1920
    label = f"{speed:.0f}x"
    font, fs, th = cv2.FONT_HERSHEY_DUPLEX, 1.1 * s, max(1, int(2 * s))
    (tw, tht), _ = cv2.getTextSize(label, font, fs, th)
    icon = int(34 * s)
    bw, bh = int(icon + tw + 44 * s), int(56 * s)
    x0, y0 = W - bw - int(28 * s), int(28 * s)
    ov = frame.copy()
    r = bh // 2
    cv2.rectangle(ov, (x0 + r, y0), (x0 + bw - r, y0 + bh), (30, 30, 30), -1, cv2.LINE_AA)
    cv2.circle(ov, (x0 + r, y0 + r), r, (30, 30, 30), -1, cv2.LINE_AA)
    cv2.circle(ov, (x0 + bw - r, y0 + r), r, (30, 30, 30), -1, cv2.LINE_AA)
    cy, ix = y0 + bh // 2, x0 + int(18 * s)
    half = icon // 2
    for k in (0, half):  # ⏩: two triangles
        tri = np.array([(ix + k, cy - half * 0.8), (ix + k + half, cy), (ix + k, cy + half * 0.8)], np.int32)
        cv2.fillPoly(ov, [tri], (255, 255, 255), cv2.LINE_AA)
    cv2.putText(ov, label, (ix + icon + int(10 * s), cy + tht // 2), font, fs, (255, 255, 255), th, cv2.LINE_AA)
    cv2.addWeighted(ov, 0.85 * alpha, frame, 1 - 0.85 * alpha, 0, frame)


class Spring:
    """Critically damped spring, stepped in output time."""

    def __init__(self, x, omega):
        self.x, self.v, self.w = x, 0.0, omega

    def step(self, target, dt):
        for _ in range(4):
            h = dt / 4
            a = self.w * self.w * (target - self.x) - 2 * self.w * self.v
            self.v += a * h
            self.x += self.v * h
        return self.x


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(prog="ag-rec export", description=__doc__.split("\n\n")[0])
    ap.add_argument("input")
    ap.add_argument("out")
    ap.add_argument("--speed", type=float, default=8, help="fast-forward speed for idle stretches (8)")
    ap.add_argument("--idle", type=float, default=1.2, help="min idle seconds to fast-forward (1.2)")
    ap.add_argument("--pad", type=float, default=0.4, help="real-time seconds kept before a change (0.4; 1.5x after)")
    ap.add_argument("--max-ff", type=float, default=1.5, help="max output seconds per idle stretch; longer ones speed up more (1.5)")
    ap.add_argument("--threshold", type=float, default=3e-4, help="changed-pixel fraction that counts as activity (3e-4)")
    ap.add_argument("--drop", action="store_true", help="cut idle stretches instead of fast-forwarding")
    ap.add_argument("--no-cut", action="store_true", help="keep the full timeline")
    ap.add_argument("--zoom", type=float, default=1.6, help="auto-zoom level toward clicks; 1 disables (1.6)")
    ap.add_argument("--cursor-scale", type=float, default=1.5, help="cursor size vs the native one (1.5)")
    ap.add_argument("--no-cursor", action="store_true", help="don't draw the cursor")
    ap.add_argument("--width", type=int, default=1920, help="max output width (1920)")
    ap.add_argument("--plain", action="store_true",
                    help="unpolished reference: full timeline, raw native-size cursor, no zoom/ripples")
    ap.add_argument("--offset", type=float, default=0.0, help="shift cursor log vs video, seconds (+ = cursor later)")
    a = ap.parse_args()
    if a.plain:
        a.no_cut, a.zoom, a.cursor_scale = True, 1.0, 1.0

    inp = Path(a.input).expanduser()
    video, cur = inp, None
    W, H, fps, dur = probe(inp / "screen.mkv" if inp.is_dir() else inp)
    if inp.is_dir():
        video = inp / "screen.mkv"
        meta = json.loads((inp / "meta.json").read_text()) if (inp / "meta.json").exists() else {}
        m = re.search(r"start: ([0-9.]+)", (inp / "ffmpeg.log").read_text())
        if m and not a.no_cursor:
            cur = load_cursor(inp / "cursor.csv", float(m.group(1)) + a.offset, W, H,
                              int(meta.get("screen", 0)), dur, 120.0, raw=a.plain)
            if cur is None:
                log("no usable cursor log; exporting without a cursor")
    fps = round(fps) or 30

    log(f"analyzing {video.name} ({dur:.1f}s, {W}x{H} @ {fps}fps)")
    score = activity(video, fps)
    n = len(score)
    if a.no_cut:
        src, spd = list(range(n)), [1.0] * n
    else:
        src, spd = build_timeline(score, cur, fps, a)
    log(f"timeline: {n / fps:.1f}s → {len(src) / fps:.1f}s")

    ow = min(a.width, W) // 2 * 2
    oh = int(round(H * ow / W / 2)) * 2
    k = ow / W
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{ow}x{oh}",
         "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out], stdin=subprocess.PIPE)
    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps}", "-f", "rawvideo",
         "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    fsize = W * H * 3

    # Zoom windows around clicks (source seconds), merged when close together.
    wins: list[list] = []
    if cur is not None and a.zoom > 1.01:
        for tc, cx, cy in cur.clicks:
            # Stay zoomed through short gaps between clicks instead of bouncing in and out.
            if wins and tc - 1.0 <= wins[-1][1] + 2.5:
                wins[-1][1] = tc + 2.5; wins[-1][2].append((tc, cx, cy))
            else:
                wins.append([tc - 1.0, tc + 2.5, [(tc, cx, cy)]])
    zs, cxs, cys = Spring(1.0, 5.0), Spring(W / 2, 4.0), Spring(H / 2, 4.0)
    badge, badge_speed = Spring(0.0, 14.0), 8
    click_t = [c[0] for c in cur.clicks] if cur else []

    frame, fi = None, -1
    dt = 1 / fps
    for oi, (si, sp) in enumerate(zip(src, spd)):
        while fi < si:
            b = dec.stdout.read(fsize)
            if len(b) < fsize:
                break
            frame, fi = b, fi + 1
        img = np.frombuffer(frame, np.uint8).reshape(H, W, 3)
        t = si / fps

        tz, tx, ty = 1.0, W / 2, H / 2
        for w0, w1, cl in wins:
            if w0 <= t <= w1:
                tz = a.zoom
                nxt = next((c for c in cl if c[0] >= t - 0.3), cl[-1])
                tx, ty = nxt[1], nxt[2]
                break
        z = zs.step(tz, dt)
        vw, vh = W / z, H / z
        cx = min(max(cxs.step(tx, dt), vw / 2), W - vw / 2)
        cy = min(max(cys.step(ty, dt), vh / 2), H - vh / 2)
        s = k * z
        M = np.float32([[s, 0, -(cx - vw / 2) * s], [0, s, -(cy - vh / 2) * s]])
        out = cv2.warpAffine(img, M, (ow, oh), flags=cv2.INTER_LINEAR if z > 1.001 else cv2.INTER_AREA)
        if z <= 1.001 and (ow, oh) != (W, H):
            out = cv2.resize(img, (ow, oh), interpolation=cv2.INTER_AREA)

        if cur is not None:
            ci = min(len(cur.t) - 1, int(t * 120))
            px, py = cur.x[ci] * s + M[0, 2], cur.y[ci] * s + M[1, 2]
            j = bisect.bisect_right(click_t, t)
            for tc, ccx, ccy in ([] if a.plain else cur.clicks[max(0, j - 3): j]):
                draw_ripple(out, ccx * s + M[0, 2], ccy * s + M[1, 2], t - tc, 34 * s * a.cursor_scale / 1.5)
            if cur.visible[ci]:
                press = 1 - 0.14 * cur.down[ci] * (not a.plain)
                draw_cursor(out, px, py, 21 * s * a.cursor_scale * press)

        if sp > 1.5:
            badge_speed = round(sp)  # keep the label while it fades out
        draw_badge(out, badge_speed, badge.step(1.0 if sp > 1.5 else 0.0, dt))
        enc.stdin.write(out.tobytes())
        if oi % (fps * 10) == 0:
            log(f"render {oi / fps:.0f}s / {len(src) / fps:.0f}s")
    enc.stdin.close(); enc.wait(); dec.kill()
    if enc.returncode:
        sys.exit("ag-rec: encode failed")
    print(a.out)


if __name__ == "__main__":
    main()
