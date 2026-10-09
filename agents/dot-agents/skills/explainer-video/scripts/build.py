#!/usr/bin/env python3
"""Build an explainer video from a project's video.json: narrate, time, render, mix, review.

  python3 build.py video.json [--stage tts|render|all] [--from S --to S] [--workers N] [--draft]

video.json (paths relative to it):
{
  "comp": "comp.html",                 # the HTML/JS composition (see ev.js)
  "out": "out/video.mp4",
  "fps": 30, "size": [1920, 1080],
  "voice": { "model": "gemini-primary/gemini-3.8-flash-tts", "voice": "Puck",
             "instructions": "Warm, upbeat narrator talking to a 10-year-old." },
  "lead": 0.8, "tail": 2.5,            # silence before the first line / after the last
  "lines": [ { "id": "intro", "text": "...", "gap": 0.5, "scene": "intro" } ],   # gap: silence after this line
  "music": { "bpm": 96, "key": "D", "mode": "major", "volume": 0.16 }            # generated bed (feature-trailer music.ts)
        # or { "file": "music.mp3", "volume": 0.2 } or false
  "sfx": [ ["line-id", 0.35, "sfx/reward.wav", 0.8] ]   # at a line's start + offset; or ["word:line-id:battery", 0, path, vol]
}
Writes build/vo/*.wav (cached per line text+voice), build/data.json (the timeline the composition reads),
build/frames/, the mp4, and build/review/ (sheet.jpg, cue frames, transcript check, loudness) via review.py.
TTS and transcription go through the TrueFoundry gateway ($TFY_TOKEN, $AG_AI_GATEWAY).
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = Path.home() / '.cache/explainer-video/runtime'
GW = os.environ.get('AG_AI_GATEWAY', 'https://tfy.promptlens.trilogy.com').rstrip('/')
TRAILER = Path.home() / '.agents/skills/feature-trailer/scripts'


def sh(cmd, **kw):
    print('+', ' '.join(map(str, cmd))[:300], flush=True)
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def token():
    t = os.environ.get('TFY_TOKEN') or os.environ.get('TFY_API_KEY')
    if not t:
        f = Path.home() / '.zshenv.local'
        for line in (f.read_text().splitlines() if f.exists() else []):
            line = line.strip().removeprefix('export ')
            if line.startswith('TFY_TOKEN='):
                t = line.split('=', 1)[1].strip().strip('\'"')
    if not t:
        sys.exit('build.py: TFY_TOKEN is not set (see ~/.zshenv.local)')
    return t


def post(path, body=None, files=None):
    hdr = {'Authorization': f'Bearer {token()}'}
    if files:
        import uuid
        b = uuid.uuid4().hex
        out = bytearray()
        for k, v in (body or {}).items():
            vals = v if isinstance(v, list) else [v]
            for x in vals:
                out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{x}\r\n'.encode()
        for k, p in files.items():
            out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{Path(p).name}"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
            out += Path(p).read_bytes() + b'\r\n'
        out += f'--{b}--\r\n'.encode()
        data, hdr['Content-Type'] = bytes(out), f'multipart/form-data; boundary={b}'
    else:
        data, hdr['Content-Type'] = json.dumps(body).encode(), 'application/json'
    req = urllib.request.Request(f'{GW}{path}', data, hdr)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{path}: HTTP {e.code}: {e.read()[:400].decode(errors="replace")}')


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True)
    return float(out.stdout.strip())


def tts(line, voice, vo):
    key = hashlib.sha1(json.dumps([line['text'], voice], sort_keys=True).encode()).hexdigest()[:10]
    wav, words = vo / f"{line['id']}-{key}.wav", vo / f"{line['id']}-{key}.json"
    if not wav.exists():
        model = voice.get('model', 'gemini-primary/gemini-3.8-flash-tts')
        gemini = 'gemini' in model
        body = {'model': model, 'input': line['text'], 'voice': voice.get('voice', 'Puck'),
                'response_format': 'pcm16' if gemini else 'wav'}
        if voice.get('instructions'):
            body['instructions'] = voice['instructions']
        raw = vo / f'{wav.stem}.raw'
        raw.write_bytes(post('/audio/speech', body))
        # normalise to 48 kHz mono and trim leading/trailing silence so timing is exact
        sh(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-af',
            'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
            '-ar', '48000', '-ac', '1', wav])
        raw.unlink()
    if not words.exists():
        res = json.loads(post('/audio/transcriptions', {'model': 'openai-primary/whisper-1', 'response_format': 'verbose_json',
                                                         'timestamp_granularities[]': 'word'}, {'file': wav}))
        words.write_text(json.dumps({'text': res.get('text', ''), 'words': [{'w': w['word'], 's': round(w['start'], 3), 'e': round(w['end'], 3)} for w in res.get('words', [])]}))
    return wav, json.loads(words.read_text())


def runtime():
    RUN.mkdir(parents=True, exist_ok=True)
    for f in HERE.iterdir():
        if f.suffix in ('.ts', '.js', '.json', '.html'):
            shutil.copy(f, RUN / f.name)
    if not (RUN / 'node_modules/gsap').exists():
        sh(['bun', 'install'], cwd=RUN)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('--stage', default='all', choices=['tts', 'render', 'all'])
    ap.add_argument('--from', dest='frm', type=float)
    ap.add_argument('--to', type=float)
    ap.add_argument('--workers', type=int, default=max(2, (os.cpu_count() or 4) - 2))
    ap.add_argument('--draft', action='store_true', help='half-size, 15 fps: fast look at motion and timing')
    a = ap.parse_args()
    spec_path = Path(a.spec).resolve()
    root = spec_path.parent
    S = json.loads(spec_path.read_text())
    build = root / 'build'
    vo = build / 'vo'
    vo.mkdir(parents=True, exist_ok=True)
    fps = 15 if a.draft else S.get('fps', 30)
    W, H = S.get('size', [1920, 1080])

    # 1. narration + timeline
    t = S.get('lead', 0.8)
    lines = []
    for ln in S['lines']:
        wav, tr = tts(ln, S.get('voice', {}), vo)
        d = probe(wav)
        lines.append({**{k: v for k, v in ln.items() if k != 'gap'}, 'start': round(t, 3), 'dur': round(d, 3), 'end': round(t + d, 3),
                      'wav': str(wav), 'heard': tr['text'], 'words': [{**w, 's': round(t + w['s'], 3), 'e': round(t + w['e'], 3)} for w in tr['words']]})
        t += d + ln.get('gap', 0.45)
    duration = round(lines[-1]['end'] + S.get('tail', 2.5), 3)
    data = {'fps': fps, 'size': [W, H], 'duration': duration, 'lines': lines, 'cues': S.get('cues', {})}
    (build / 'data.json').write_text(json.dumps(data, indent=1))
    shutil.copy(build / 'data.json', root / 'data.json')  # for live preview beside comp.html
    print(f'timeline: {len(lines)} lines, {duration:.1f}s')
    for l in lines:
        print(f"  {l['start']:6.2f}-{l['end']:6.2f}  {l['id']:<14} {l['text'][:70]}")
    if a.stage == 'tts':
        return

    # 2. frames
    runtime()
    frames = build / ('frames-draft' if a.draft else 'frames')
    partial = a.frm is not None or a.to is not None
    if not partial and frames.exists():
        shutil.rmtree(frames)
    cmd = ['bun', RUN / 'render.ts', root / S.get('comp', 'comp.html'), frames, build / 'data.json', '--fps', fps, '--workers', a.workers,
           '--size', f'{W}x{H}', '--scale', 0.5 if a.draft else 1]
    if a.frm is not None:
        cmd += ['--from', a.frm]
    if a.to is not None:
        cmd += ['--to', a.to]
    sh(cmd)
    if partial:
        print(f'partial render in {frames} (frames only); run without --from/--to for the mp4')
        return
    silent = build / 'video.mp4'
    sh(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', fps, '-i', frames / 'f%05d.jpg', '-c:v', 'libx264', '-preset', 'medium',
        '-crf', '18', '-pix_fmt', 'yuv420p', silent])

    # 3. audio: VO + music bed (ducked under the voice) + sfx, loudness -16 LUFS
    ins, flt, vo_tags = [], [], []
    for i, l in enumerate(lines):
        ins += ['-i', l['wav']]
        ms = int(l['start'] * 1000)
        flt.append(f'[{i}]adelay={ms}|{ms},apad=whole_dur={duration}[v{i}]')
        vo_tags.append(f'[v{i}]')
    flt.append(f"{''.join(vo_tags)}amix=inputs={len(lines)}:normalize=0,atrim=0:{duration}[vo]")
    n = len(lines)
    m = S.get('music', {'bpm': 96, 'key': 'D', 'mode': 'major', 'volume': 0.16})
    mix = ['[vo]']
    if m:
        if m.get('file'):
            mfile = root / m['file']
        else:
            mfile = build / f"music-{m.get('bpm', 96)}-{m.get('key', 'D')}-{int(duration)}.wav"
            if not mfile.exists():
                trun = Path.home() / '.cache/feature-trailer/runtime'
                if not (trun / 'music.ts').exists():
                    trun.mkdir(parents=True, exist_ok=True)
                    for f in ('music.ts', 'package.json'):
                        shutil.copy(TRAILER / f, trun / f)
                    sh(['bun', 'install'], cwd=trun)
                cfg = {'bpm': m.get('bpm', 96), 'seconds': duration + 2, 'dropAt': m.get('dropAt', lines[0]['start'] + 0.01 if lines else 0),
                       'key': m.get('key', 'D'), 'mode': m.get('mode', 'major')}
                sh(['bun', trun / 'music.ts', mfile, json.dumps(cfg)], cwd=trun)
        ins += ['-stream_loop', '-1', '-i', mfile]
        vol = m.get('volume', 0.16)
        flt.append(f"[{n}]atrim=0:{duration},volume={vol},afade=t=in:d=1.2,afade=t=out:st={max(0, duration - 2.5)}:d=2.5[bed]")
        flt.append('[vo]asplit=2[vo1][vokey]')
        flt.append('[bed][vokey]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=400[duck]')
        mix = ['[vo1]', '[duck]']
        n += 1
    for j, (cue, off, path, *rest) in enumerate(S.get('sfx', [])):
        vol = rest[0] if rest else 0.8
        if cue.startswith('word:'):
            _, lid, word = cue.split(':', 2)
            l = next(x for x in lines if x['id'] == lid)
            hit = next((w['s'] for w in l['words'] if w['w'].lower().strip('.,!?').startswith(word.lower())), l['start'])
        elif cue.startswith('t:'):
            hit = float(cue[2:])
        else:
            hit = next(x for x in lines if x['id'] == cue)['start']
        at = max(0, int((hit + off) * 1000))
        ins += ['-i', root / path]
        flt.append(f'[{n}]aformat=channel_layouts=mono,volume={vol},adelay={at}|{at},apad=whole_dur={duration}[s{j}]')
        mix.append(f'[s{j}]')
        n += 1
    flt.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0,atrim=0:{duration},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]")
    audio = build / 'mix.wav'
    sh(['ffmpeg', '-loglevel', 'error', '-y', *ins, '-filter_complex', ';'.join(flt), '-map', '[a]', '-ac', '2', audio])
    out = root / S.get('out', 'out/video.mp4')
    if a.draft:
        out = out.with_name(out.stem + '-draft' + out.suffix)
    out.parent.mkdir(parents=True, exist_ok=True)
    sh(['ffmpeg', '-loglevel', 'error', '-y', '-i', silent, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out])
    print('wrote', out)
    sh([sys.executable, HERE / 'review.py', spec_path, out])


if __name__ == '__main__':
    main()
