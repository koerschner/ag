#!/usr/bin/env python3
"""Self-review pack for a rendered explainer: what the grader looks at each round.

  python3 review.py video.json out.mp4

Writes build/review/:
  sheet.jpg      contact sheet, one frame every ~2 s with timestamps (<=1500 px wide: safe to read)
  cues.jpg       one frame per VO line, 0.8 s after it starts, labelled with the line id (does the picture match the words?)
  report.md      narration check (what Whisper heard vs the script), loudness, black/frozen stretches, and the rubric to grade
Never read full-res frames into context; read these.
"""
import json, re, subprocess, sys, difflib
from pathlib import Path

spec_path, mp4 = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
root = spec_path.parent
build = root / 'build'
rev = build / 'review'
rev.mkdir(parents=True, exist_ok=True)
data = json.loads((build / 'data.json').read_text())
dur = data['duration']
SKILL = Path(__file__).resolve().parent.parent


def run(cmd):
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True)


def grid(times, labels, out, cols=4, w=360):
    h = w * 9 // 16
    ins, flt = [], []
    for i, (t, lab) in enumerate(zip(times, labels)):
        ins += ['-ss', f'{t:.2f}', '-i', mp4]
        lab = lab.replace(':', r'\:').replace("'", '')
        flt.append(f"[{i}:v]trim=end_frame=1,scale={w}:{h},drawtext=text='{lab}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.7[v{i}]")
    n = len(times)
    lay = '|'.join(f'{(i % cols) * w}_{(i // cols) * h}' for i in range(n))
    flt.append(''.join(f'[v{i}]' for i in range(n)) + (f'xstack=inputs={n}:layout={lay}:fill=black' if n > 1 else 'null'))
    run(['ffmpeg', '-loglevel', 'error', '-y', *ins, '-filter_complex', ';'.join(flt), '-frames:v', '1', '-q:v', '3', out])


step = max(1.5, dur / 32)
ts = [round(i * step, 2) for i in range(int(dur / step) + 1) if i * step < dur - 0.1]
grid(ts, [f'{t:.1f}s' for t in ts], rev / 'sheet.jpg', cols=4 if len(ts) <= 16 else 5, w=360 if len(ts) <= 16 else 290)
cue_t = [min(l['start'] + 0.8, l['end']) for l in data['lines']]
grid(cue_t, [f"{l['id']} {l['start']:.1f}s" for l in data['lines']], rev / 'cues.jpg', cols=4, w=360)


def norm(s):  # letters only, no spaces: "FreeTime" and "free time" compare equal
    return re.sub(r'[^a-z0-9]', '', s.lower())


rows, issues = [], []
for l in data['lines']:
    a, b = norm(l['text']), norm(l.get('heard', ''))
    r = difflib.SequenceMatcher(None, a, b).ratio()
    flag = '' if r >= 0.9 else ' ⚠'
    if flag:
        issues.append(f"narration '{l['id']}' heard as: {l.get('heard')!r}")
    rows.append(f"| {l['id']} | {l['start']:.1f}–{l['end']:.1f} | {r:.2f}{flag} | {l.get('heard', '')} |")

lufs = run(['ffmpeg', '-hide_banner', '-nostats', '-i', mp4, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr
I = re.findall(r'I:\s+(-?[\d.]+) LUFS', lufs)
P = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', lufs)
blk = run(['ffmpeg', '-hide_banner', '-nostats', '-i', mp4, '-vf', 'blackdetect=d=0.4:pix_th=0.06', '-an', '-f', 'null', '-']).stderr
blacks = re.findall(r'black_start:([\d.]+) black_end:([\d.]+)', blk)
frz = run(['ffmpeg', '-hide_banner', '-nostats', '-i', mp4, '-vf', 'freezedetect=n=0.002:d=3', '-an', '-f', 'null', '-']).stderr
freezes = re.findall(r'freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)', frz)
for s, e in blacks:
    if float(s) > 0.5 and float(e) < dur - 0.5:
        issues.append(f'black frames {float(s):.1f}–{float(e):.1f}s')
for s, d in freezes:
    issues.append(f'picture frozen {float(s):.1f}s for {float(d):.1f}s (a hold with no motion: add drift or cut sooner)')
loud = f"{I[-1] if I else '?'} LUFS integrated, true peak {P[-1] if P else '?'} dBFS (target -16 LUFS, peak < -1 dBFS)"
if I and abs(float(I[-1]) + 16) > 1.5:
    issues.append(f'loudness off target: {loud}')

rubric = (SKILL / 'references/rubric.md').read_text() if (SKILL / 'references/rubric.md').exists() else ''
(rev / 'report.md').write_text(f"""# Review: {mp4.name}

Duration {dur:.1f}s, {len(data['lines'])} narration lines. Loudness: {loud}.

## Automatic findings
{chr(10).join('- ' + i for i in issues) or '- none'}

## Narration check (script vs what Whisper heard)
| line | time | match | heard |
|---|---|---|---|
{chr(10).join(rows)}

## Look at
- `sheet.jpg`: the whole film, every {step:.1f}s
- `cues.jpg`: one frame per line: does the picture show what the voice is saying right then?

{rubric}
""")
print(f'review: {rev}/report.md ({len(issues)} automatic findings)')
for i in issues:
    print('  -', i)
