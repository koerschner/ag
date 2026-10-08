#!/usr/bin/env python3
"""Build a feature trailer from a JSON spec: animated HTML cards (intro, one title card per
feature, panels, outro) + gameplay/screen shots sped up and framed on a branded stage, cut on a
fixed BPM grid, with a music bed, transition SFX and per-moment SFX, mixed and loudness-normalised.

  uv run trailer.py spec.json            # build (cached: only changed cards/segments re-render)
  uv run trailer.py spec.json --plan     # print the timeline without rendering

See ../SKILL.md for the spec format and the workflow around it."""
import hashlib, json, os, shutil, subprocess, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.realpath(__file__))
SFX_CACHE = os.path.expanduser('~/.cache/feature-trailer/sfx')
SFX_URL = 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/skills/media-use/audio/assets/sfx/{}.mp3'
SFX_NAMES = {'chime', 'click', 'click-soft', 'error', 'glitch-1', 'glitch-2', 'glitch-3', 'impact-bass-1', 'impact-bass-2',
             'key-press', 'notification', 'ping', 'pop', 'riser', 'sparkle', 'typing', 'whoosh', 'whoosh-short', 'whoosh-cinematic'}
W, H = 1920, 1080
WIN = (120, 48, 1680, 944)        # ~16:9 shot window on the stage (even sizes for x264)
PANEL_WIN = (900, 150, 900, 780)  # clip window on panel cards (cropped to cover)


def sh(cmd, **kw):
    r = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)
    if r.returncode:
        print(r.stdout[-2000:], r.stderr[-3000:])
        sys.exit(f'failed: {cmd if isinstance(cmd, str) else " ".join(cmd)[:400]}')
    return r.stdout


def digest(*parts):
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:12]


def probe_dur(path):
    return float(sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).strip())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    spec_path = os.path.abspath(args[0])
    S = json.load(open(spec_path))
    root = os.path.dirname(spec_path)
    P = lambda p: p if not p or os.path.isabs(p) else os.path.normpath(os.path.join(root, os.path.expanduser(p)))
    B = os.path.join(root, S.get('build_dir', 'build'))
    os.makedirs(B, exist_ok=True)
    FPS, BPM = S.get('fps', 30), S.get('bpm', 128)
    beat = 60 / BPM
    theme = S.get('theme', {})
    accent, accent2 = theme.get('accent', '#3d8bff'), theme.get('accent2', '#ffb400')
    fonts = S.get('fonts', {})
    font_env = {}
    for role, fallback in (('display', '~/.fonts/ChakraPetch-Bold.ttf'), ('body', '~/.fonts/Outfit.ttf')):
        f = P(fonts.get(role)) or os.path.expanduser(fallback)
        if os.path.exists(f):
            font_env[f'FONT_{role.upper()}'] = f

    # ---- timeline: (kind, payload, start_s, nframes) on the beat grid --------------------------
    timeline, t = [], 0.0
    def add(kind, payload, beats=None, secs=None):
        nonlocal t
        dur = beats * beat if beats is not None else secs
        f0, f1 = round(t * FPS), round((t + dur) * FPS)
        timeline.append(dict(kind=kind, p=payload, start=f0 / FPS, n=f1 - f0))
        t += dur

    features = [f for f in S['features'] if f.get('kind', 'feature') == 'feature']
    intro = S.get('intro')
    if intro:
        add('intro', intro, intro.get('beats', 8))
    drop_at = t
    for i, f in enumerate(S['features']):
        if f.get('kind') in ('panel', 'grid', 'lineup'):
            add(f['kind'], f, f.get('beats', {'panel': 16, 'grid': 12, 'lineup': 16}[f['kind']]))
            continue
        f = dict(f, index=features.index(f) + 1)
        f.setdefault('color', accent); f.setdefault('color2', accent2)
        if f.get('title_beats', 4):
            add('title', f, f.get('title_beats', 4))
        for j, shot in enumerate(f['shots']):
            add('shot', dict(feature=f, shot=shot, j=j), shot.get('beats', 4))
    outro = S.get('outro')
    if outro:
        add('outro', outro, outro.get('beats', 12))
    total_n = sum(x['n'] for x in timeline)
    total = total_n / FPS

    print(f'{len(timeline)} segments, {total:.1f}s at {BPM} BPM ({beat:.3f}s/beat)')
    for i, x in enumerate(timeline):
        d = x['n'] / FPS
        desc = x['p'].get('head') or x['p'].get('name') or ''
        if x['kind'] == 'shot':
            s = x['p']['shot']
            sp = (s['out'] - s['in']) / d if 'out' in s else s.get('speed', 1)
            desc = f"{x['p']['feature']['name']}: {os.path.basename(s['clip'])} {s['in']}s x{sp:.2f}" + (f" \"{s['caption']}\"" if s.get('caption') else '')
        print(f"  {i:02d} {x['start']:6.2f}s {d:5.2f}s {x['kind']:6} {desc}")
    if '--plan' in sys.argv:
        return

    # ---- cards (HTML frames, rendered serially: one browser each) ------------------------------
    # run the bun helpers from a cache copy, so node_modules never lands in the skill checkout
    RUN = os.path.expanduser('~/.cache/feature-trailer/runtime')
    os.makedirs(RUN, exist_ok=True)
    for f in ('frames.ts', 'music.ts', 'cards.html', 'package.json'):
        src, dst = os.path.join(HERE, f), os.path.join(RUN, f)
        if not os.path.exists(dst) or open(src, 'rb').read() != open(dst, 'rb').read():
            shutil.copyfile(src, dst)
    if not os.path.exists(os.path.join(RUN, 'node_modules', 'playwright-core')):
        sh(['bun', 'install', '--silent'], cwd=RUN)

    def frames(fn, a, dur, transparent=False):
        out = os.path.join(B, 'frames', f'{fn}-{digest(fn, a, dur, theme, font_env, transparent, open(os.path.join(HERE, "cards.html")).read())}')
        if os.path.exists(f'{out}/.done'):
            return out
        shutil.rmtree(out, ignore_errors=True)
        env = dict(os.environ, **font_env, **({'TRANSPARENT': '1'} if transparent else {}))
        sh(['bun', 'frames.ts', out, fn, json.dumps(dict(a, theme=theme)), str(dur), str(FPS)], cwd=RUN, env=env)
        open(f'{out}/.done', 'w').close()
        return out

    def art_for(f):
        """Feature art: given image, else a still from the middle of its first shot."""
        if f.get('art'):
            return P(f['art'])
        s = f['shots'][0]
        at = (s['in'] + s.get('out', s['in'] + 2)) / 2
        out = os.path.join(B, f'art-{digest(s["clip"], at, s.get("crop"))}.jpg')
        if not os.path.exists(out):
            crop = 'crop={2}:{3}:{0}:{1},'.format(*s['crop']) if s.get('crop') else ''
            sh(f'ffmpeg -v error -y -ss {at} -i "{P(s["clip"])}" -frames:v 1 -vf "{crop}scale=1920:-2" -q:v 3 "{out}"')
        return out

    def mask(w, h, r=26):
        m = os.path.join(B, f'mask-{w}x{h}.png')
        if not os.path.exists(m):
            sh(f"ffmpeg -v error -y -f lavfi -i color=white:s={w}x{h} -vf \"format=gray,geq=lum='if(gt(abs(X-{w}/2+0.5),{w}/2-{r})*gt(abs(Y-{h}/2+0.5),{h}/2-{r}),if(lte(hypot(abs(X-{w}/2+0.5)-({w}/2-{r}),abs(Y-{h}/2+0.5)-({h}/2-{r})),{r}),255,0),255)'\" -frames:v 1 {m}")
        return m

    for f in features:
        f['_art'] = art_for(f)
    jobs = []  # (index, segment, card frames dirs)
    for i, x in enumerate(timeline):
        k, p, dur = x['kind'], x['p'], x['n'] / FPS
        if k == 'intro':
            x['frames'] = frames('setupIntro', dict(beat=beat, label=p.get('label', ''), head=p.get('head', ''), sub=p.get('sub', '')), dur)
        elif k == 'title':
            f = next(ff for ff in features if ff['name'] == p['name'])
            line1 = p.get('line1') or (f"New · {p['index']} of {len(features)}" if len(features) > 1 else 'New')
            x['frames'] = frames('setupTitle', dict(beat=beat, line1=line1, name=p.get('title', p['name']), tagline=p.get('tagline', ''),
                                                    sub=p.get('sub', ''), color=p['color'], color2=p['color2'], art=f['_art']), dur)
        elif k == 'shot':
            f, s = p['feature'], p['shot']
            art = next(ff for ff in features if ff['name'] == f['name'])['_art']
            x['bg'] = frames('setupStage', dict(color=f['color'], art=art, win=WIN), 1 / FPS) + '/f0000.png'
            x['fg'] = frames('setupOverlay', dict(part='frame', name=f.get('tab', f['name']), color=f['color'], color2=f['color2'], win=WIN), 1 / FPS, True) + '/f0000.png'
            if s.get('caption'):
                x['cap'] = frames('setupOverlay', dict(part='caption', caption=s['caption'], color=f['color'], color2=f['color2'], win=WIN), 1 / FPS, True) + '/f0000.png'
        elif k == 'panel':
            x['frames'] = frames('setupPanel', dict(beat=beat, label=p.get('label', ''), head=p.get('head', ''), body=p.get('body', ''),
                                                    color=p.get('color', accent2), win=p.get('win', PANEL_WIN)), dur)
        elif k == 'grid':
            x['frames'] = frames('setupGrid', dict(beat=beat, label=p.get('label', ''), head=p.get('head', ''), color=p.get('color'),
                                                   tiles=[[P(a), n] for a, n in p['tiles']]), dur)
        elif k == 'lineup':
            x['frames'] = frames('setupLineup', dict(beat=beat, label=p.get('label', ''), head=p.get('head', ''), foot=p.get('foot', ''),
                                                     step=p.get('step', 2), color=p.get('color'),
                                                     items=[dict(it, img=P(it['img'])) for it in p['items']]), dur)
        elif k == 'outro':
            tiles = [[f['_art'], f.get('tab', f['name'])] for f in features] if p.get('tiles', True) else []
            x['frames'] = frames('setupOutro', dict(beat=beat, head=p.get('head', ''), sub=p.get('sub', ''), cta=p.get('cta', ''), tiles=tiles), dur)

    # ---- segments (ffmpeg, parallel, cached by command) ---------------------------------------
    enc = f'-c:v libx264 -preset medium -crf 17 -pix_fmt yuv420p -r {FPS}'

    def run_cached(i, cmd):
        out = os.path.join(B, f'seg{i:02d}-{digest(cmd)}.mp4')
        if not os.path.exists(out):
            sh(cmd.replace('{OUT}', f'"{out}.tmp.mp4"'))
            os.replace(f'{out}.tmp.mp4', out)
        return out

    def clip_chain(s, dur, w, h, zoom_end):
        """trim+speed -> optional crop -> cover w x h -> slow push-in (plus a small punch on entry)."""
        span = s['out'] - s['in'] if 'out' in s else s.get('speed', 1) * dur
        speed = span / dur
        crop = 'crop={2}:{3}:{0}:{1},'.format(*s['crop']) if s.get('crop') else ''
        if s.get('blur'):  # soften (a teaser), and dim a little
            crop += f"gblur=sigma={s['blur']},eq=brightness=-0.06:saturation=1.15,"
        n = max(1, round(dur * FPS))
        z = f"1+{zoom_end - 1:.4f}*min(on/{n},1)+0.05*pow(max(0,1-on/{FPS / 4:.2f}),2)"
        # zoompan on a 2x plate so the slow push doesn't stair-step
        chain = (f'setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},{crop}scale={2 * w}:{2 * h}:force_original_aspect_ratio=increase:flags=lanczos,crop={2 * w}:{2 * h},'
                 f"zoompan=z='{z}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={w}x{h}:fps={FPS}")
        return chain, span, speed

    def seg_cmd(i, x):
        k, p, n = x['kind'], x['p'], x['n']
        dur = n / FPS
        if k in ('intro', 'title', 'outro', 'grid', 'lineup'):
            return f'ffmpeg -v error -y -framerate {FPS} -i "{x["frames"]}/f%04d.png" -frames:v {n} {enc} {{OUT}}'
        if k == 'panel':
            px, py, pw, ph = p.get('win', PANEL_WIN)
            vdur = dur - 0.4
            if p.get('image'):  # a still, with a slow push (Ken Burns)
                p = dict(p, speed=1, zoom=p.get('zoom', 1.12))
                chain, span, _ = clip_chain(p, vdur, pw, ph, p['zoom'])
                src = f'-loop 1 -framerate {FPS} -t {span + 0.5} -i "{P(p["image"])}"'
            else:
                chain, span, _ = clip_chain(p, vdur, pw, ph, p.get('zoom', 1.0))
                src = f'-ss {p["in"]} -t {span + 0.5} -i "{P(p["clip"])}"'
            return (f'ffmpeg -v error -y -framerate {FPS} -i "{x["frames"]}/f%04d.png" {src} -loop 1 -i {mask(pw, ph, 24)} '
                    f'-filter_complex "[1]{chain},setpts=PTS+0.2/TB,format=rgba[v];[2]format=gray[m];[v][m]alphamerge,'
                    f'fade=in:st=0.2:d=0.35:alpha=1,fade=out:st={dur - 0.5:.3f}:d=0.5:alpha=1[vm];[0][vm]overlay={px}:{py}:eof_action=pass" '
                    f'-frames:v {n} {enc} {{OUT}}')
        s = p['shot']
        fx, fy, fw, fh = WIN
        chain, span, speed = clip_chain(s, dur, fw, fh, s.get('zoom', 1.06))
        x['speed'] = speed
        cap_in, cap_f = '', ''
        if x.get('cap'):
            ct = s.get('caption_at', 0.25)
            cap_in = f'-loop 1 -i "{x["cap"]}" '
            cap_f = f'[c];[4]format=rgba,fade=in:st={ct}:d=0.15:alpha=1[cc];[c][cc]overlay=0:0:shortest=1'
        return (f'ffmpeg -v error -y -ss {s["in"]} -t {span + 0.5} -i "{P(s["clip"])}" -loop 1 -i "{x["bg"]}" -loop 1 -i "{x["fg"]}" -loop 1 -i {mask(fw, fh)} {cap_in}'
                f'-filter_complex "[0]{chain},format=rgba[v];[3]format=gray[m];[v][m]alphamerge[vm];[1][vm]overlay={fx}:{fy}:shortest=1[a];[a][2]overlay=0:0:shortest=1'
                + cap_f + f'" -frames:v {n} {enc} {{OUT}}')

    cmds = [seg_cmd(i, x) for i, x in enumerate(timeline)]
    with ThreadPoolExecutor(4) as ex:
        outs = list(ex.map(lambda a: run_cached(*a), enumerate(cmds)))
    with open(f'{B}/concat.txt', 'w') as fh:
        fh.writelines(f"file '{o}'\n" for o in outs)
    sh(f'ffmpeg -v error -y -f concat -safe 0 -i {B}/concat.txt -c copy {B}/video.mp4')

    # ---- audio ---------------------------------------------------------------------------------
    def sfx(name):
        if '/' in name or '.' in name:
            return P(name)
        if name not in SFX_NAMES:
            sys.exit(f'unknown sfx "{name}" (built-in: {", ".join(sorted(SFX_NAMES))}; or give a file path)')
        path = os.path.join(SFX_CACHE, f'{name}.mp3')
        if not os.path.exists(path):
            os.makedirs(SFX_CACHE, exist_ok=True)
            urllib.request.urlretrieve(SFX_URL.format(name), path)
        return path

    inputs, filters, mix = [], [], []
    def inp(path, pre=''):
        inputs.append((pre, path)); return len(inputs) - 1
    def place(path, at, vol=1.0, skip=0.0, length=2.5):
        """Sound at output time `at`, starting `skip` s into the file, cut to `length` s with a short fade."""
        j = inp(path)
        if at < 0:
            skip, at = skip - at, 0.0
        ms = int(at * 1000)
        filters.append(f'[{j}]atrim=start={skip:.3f}:end={skip + length:.3f},asetpts=PTS-STARTPTS,'
                       f'afade=out:st={max(0, length - 0.25):.3f}:d=0.25,adelay={ms}|{ms},volume={vol}[a{j}]')
        mix.append(f'a{j}')

    m = S.get('music', {})
    if m.get('file'):
        music = P(m['file'])
        j = inp(music, f'-stream_loop -1 -ss {m.get("offset", 0)}')
        filters.append(f'[{j}]atrim=0:{total:.3f},afade=in:d={m.get("fade_in", 1.0)},volume={m.get("volume", 1.0)}[a{j}]'); mix.append(f'a{j}')
    elif m.get('file') is not False:
        mcfg = dict(bpm=BPM, seconds=round(total + 0.05, 3), dropAt=round(drop_at, 4), key=m.get('key', 'A'), mode=m.get('mode', 'major'))
        end = m.get('end_at')
        if end is None and outro:
            end = timeline[-1]['start'] + beat * min(8, max(2, outro.get('beats', 12) - 6))
        if end is not None:
            mcfg['endAt'] = round(end, 4)
        music = os.path.join(B, f'music-{digest(mcfg, open(os.path.join(HERE, "music.ts")).read())}.wav')
        if not os.path.exists(music):
            sh(['bun', 'music.ts', music, json.dumps(mcfg)], cwd=RUN)
        j = inp(music)
        filters.append(f'[{j}]volume={m.get("volume", 0.8)}[a{j}]'); mix.append(f'a{j}')

    auto = S.get('auto_sfx', True)
    for x in timeline:
        k, p, st = x['kind'], x['p'], x['start']
        if auto and k == 'intro':
            place(sfx('whoosh-cinematic'), st + 0.0, 0.6, length=3.0)
        if auto and k in ('title', 'panel', 'grid', 'lineup'):
            place(sfx('whoosh-short'), st - 0.15, 0.6)
            if k == 'title':
                place(sfx('impact-bass-1'), st, 0.2, length=0.9)
            if k == 'grid':
                for ti in range(len(p['tiles'])):
                    place(sfx('pop'), st + 0.35 + ti * beat * 0.5, 0.35)
            if k == 'lineup':  # mirrors setupLineup's timing
                step = p.get('step', 2)
                for ii, it in enumerate(p['items']):
                    a = st + 0.5 + ii * beat * step + (beat * step if it.get('mystery') else 0)
                    if it.get('mystery'):
                        place(sfx('riser'), a - beat * step, 0.45, skip=10.0 - beat * step, length=beat * step + 0.3)
                        place(sfx('impact-bass-2'), a, 0.35, length=1.6)
                        place(sfx('glitch-2'), a + 0.05, 0.3, length=0.6)
                    else:
                        place(sfx('whoosh-short'), a - 0.12, 0.45)
                        place(sfx('pop'), a + 0.05, 0.5)
        if auto and k == 'outro':
            place(sfx('whoosh'), st - 0.2, 0.6)
            place(sfx('sparkle'), st + (beat * 2 if p.get('tiles', True) else 0.05), 0.6)
        if k == 'shot':
            s = p['shot']
            if auto and s.get('caption'):
                place(sfx('pop'), st + s.get('caption_at', 0.25), 0.7)
            for ev in s.get('sfx', []):
                src_t, name = ev[0], ev[1]
                vol = ev[2] if len(ev) > 2 else 0.9
                hit = ev[3] if len(ev) > 3 else 0.0  # seconds into the sound where its hit is (a riser's peak, a drum roll's crash)
                pre = ev[4] if len(ev) > 4 else hit  # how much of the sound to play before the hit
                at = st + (src_t - s['in']) / x['speed']
                place(sfx(name), at - pre, vol, skip=hit - pre, length=pre + 1.0)
            if s.get('audio'):  # the clip's own sound, sped up with pitch kept
                span, speed = x['speed'] * x['n'] / FPS, x['speed']
                tempo, chain = speed, []
                while tempo > 2:
                    chain.append('atempo=2'); tempo /= 2
                while tempo < 0.5:
                    chain.append('atempo=0.5'); tempo /= 0.5
                chain.append(f'atempo={tempo:.4f}')
                j = inp(P(s['clip']), f'-ss {s["in"]} -t {span:.3f}')
                ms = int(st * 1000)
                filters.append(f'[{j}:a]{",".join(chain)},afade=out:st={max(0, x["n"] / FPS - 0.08):.3f}:d=0.08,adelay={ms}|{ms},volume={s["audio"]}[a{j}]')
                mix.append(f'a{j}')
    for ev in S.get('sfx', []):  # spec-level [time_s, name, vol]
        place(sfx(ev[1]), ev[0], ev[2] if len(ev) > 2 else 0.9)

    filters.append(''.join(f'[{a}]' for a in mix) + f'amix=inputs={len(mix)}:normalize=0:duration=longest,'
                   f'atrim=0:{total:.4f},afade=out:st={max(0, total - 1.2):.3f}:d=1.2,loudnorm=I=-14:TP=-1.5:LRA=9[out]')
    cmd = ['ffmpeg', '-v', 'error', '-y']
    for pre, path in inputs:
        cmd += pre.split() + ['-i', path]
    cmd += ['-filter_complex', ';'.join(filters), '-map', '[out]', '-ar', '48000', f'{B}/audio.wav']
    sh(cmd)
    out = P(S.get('out', 'trailer.mp4'))
    sh(f'ffmpeg -v error -y -i {B}/video.mp4 -i {B}/audio.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "{out}"')
    # contact sheet for self-review: one frame per second, small enough to read safely
    cols = 8
    rows = max(1, -(-int(total) // cols))
    sh(f'ffmpeg -v error -y -i "{out}" -vf "fps=1,scale=240:-2,tile={cols}x{rows}:padding=4" -frames:v 1 -q:v 4 "{B}/sheet.jpg"')
    print(f'done {out} ({total:.1f}s)\nsheet {B}/sheet.jpg')


if __name__ == '__main__':
    main()
