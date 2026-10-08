// Procedural trailer music bed, rendered offline with WebAudio in headless Chromium.
// bun music.ts <out.wav> '<json>'   json: { bpm, seconds, dropAt, endAt?, key?, mode? }
//   dropAt  seconds where the full groove kicks in (first feature); a riser + snare roll leads into it
//   endAt   seconds of the final hit (default: last whole bar before seconds-2); the tail rings out after
//   key     root note name (default 'A'); mode 'major' (bright, I-V-vi-IV) or 'minor' (epic, i-VI-III-VII)
// Use it when the product has no music of its own. Everything is on a fixed BPM grid,
// so cuts placed on beats (beats * 60/bpm) land on the music.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, writeFileSync } from 'fs'

const [out, json] = process.argv.slice(2)
const cfg = JSON.parse(json)
const base = `${process.env.HOME}/.cache/ms-playwright`
const shell = existsSync(base) && readdirSync(base).find(d => d.startsWith('chromium_headless_shell'))
if (!shell && !process.env.CHROME) throw new Error('no headless Chromium')
const exe = process.env.CHROME ?? (() => { const d = `${base}/${shell}`; return `${d}/${readdirSync(d).find(x => x.startsWith('chrome-headless-shell'))}/chrome-headless-shell` })()
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
page.on('pageerror', e => console.error('[pageerror]', e.message))
await page.goto('about:blank')

const b64: string = await page.evaluate(async (cfg: any) => {
  const SR = 48000
  const { bpm, seconds } = cfg
  const beat = 60 / bpm, bar = beat * 4
  const dropAt = Math.max(0, cfg.dropAt ?? bar * 4)
  const endAt = cfg.endAt ?? Math.max(dropAt + bar, Math.floor((seconds - 2) / bar) * bar)
  const NOTES: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
  let root = 45 + ((NOTES[cfg.key ?? 'A'] ?? 9) + 3) % 12 // MIDI, A2..G#3
  if (root > 50) root -= 12 // keep it within a fifth of A2
  const minor = cfg.mode === 'minor'
  // chords as semitone offsets from the key root: triad + 7th-ish color
  const PROG = minor ? [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]]
                     : [[0, 4, 7, 11], [7, 11, 14, 17], [9, 12, 16, 19], [5, 9, 12, 16]]
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR)
  const master = ctx.createDynamicsCompressor()
  master.threshold.value = -14; master.ratio.value = 3; master.attack.value = 0.01; master.release.value = 0.2
  master.connect(ctx.destination)
  const bus = (gain: number, pan = 0) => { const g = ctx.createGain(); g.gain.value = gain; const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(master); return g }
  // sidechain-ish pump on music (pads/bass/arp) under the kick
  const music = ctx.createGain(); music.connect(master)
  const noiseBuf = (() => { const b = ctx.createBuffer(1, SR * 2, SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b })()
  const noise = (t: number, dur: number, dest: AudioNode, type: BiquadFilterType, f: number, q = 1, g0 = 1) => {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q
    const g = ctx.createGain(); g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    s.connect(flt).connect(g).connect(dest); s.start(t); s.stop(t + dur + 0.05)
    return { flt, g }
  }
  const drums = bus(0.9)
  const kick = (t: number, g0 = 1) => {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    g.gain.setValueAtTime(g0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
    o.connect(g).connect(drums); o.start(t); o.stop(t + 0.5)
    music.gain.setValueAtTime(0.45, t); music.gain.linearRampToValueAtTime(1, t + beat * 0.6)
  }
  const clap = (t: number, g0 = 0.5) => { noise(t, 0.18, drums, 'bandpass', 1800, 0.8, g0); noise(t + 0.012, 0.12, drums, 'bandpass', 1200, 1, g0 * 0.6) }
  const hat = (t: number, open = false, g0 = 0.18) => noise(t, open ? 0.22 : 0.05, drums, 'highpass', 8000, 0.7, g0)
  const crash = (t: number, g0 = 0.4, dur = 3) => noise(t, dur, drums, 'highpass', 5000, 0.3, g0)
  const voice = (type: OscillatorType, m: number, t: number, dur: number, dest: AudioNode, g0: number, cutoff: number, env = 0.01, detune = 0) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(m); o.detune.value = detune
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 2
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(g0, t + env)
    g.gain.setValueAtTime(g0, Math.max(t + env, t + dur - 0.05)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25)
    o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.3)
    return f
  }
  const padBus = ctx.createGain(); padBus.gain.value = 0.10
  const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.Q.value = 0.7
  padFilter.frequency.setValueAtTime(500, 0); padFilter.frequency.exponentialRampToValueAtTime(2600, Math.max(0.1, dropAt)); padFilter.frequency.setValueAtTime(3200, dropAt + 0.01)
  padBus.connect(padFilter).connect(music)
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.22; bassBus.connect(music)
  const arpBus = ctx.createGain(); arpBus.gain.value = 0.07; const arpPan = ctx.createStereoPanner(); arpPan.pan.value = 0.25
  const delay = ctx.createDelay(1); delay.delayTime.value = beat * 0.75; const fb = ctx.createGain(); fb.gain.value = 0.3
  arpBus.connect(arpPan).connect(music); arpBus.connect(delay); delay.connect(fb).connect(delay); delay.connect(music)

  const nBars = Math.ceil(endAt / bar)
  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar, chord = PROG[b % 4], full = t0 >= dropAt - 1e-6
    const intro = !full, introP = dropAt > 0 ? t0 / dropAt : 1
    // pads: every bar
    for (const n of chord) for (const d of [-7, 7]) voice('sawtooth', root + 12 + n, t0, bar, padBus, 0.5, 5000, 0.08, d)
    // arp: 16ths across the chord, quieter in the intro
    const arpNotes = [0, 1, 2, 3, 2, 1, 2, 3].map(i => chord[i] + 24)
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * beat / 4
      if (intro && s % 2) continue
      voice('square', root + arpNotes[s % 8] + (s >= 8 ? 12 : 0) * (full ? 1 : 0), t, beat / 4 * 0.6, arpBus, intro ? 0.5 + introP * 0.5 : 1, intro ? 1500 + introP * 2500 : 4500, 0.003)
    }
    if (full) {
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat
        kick(t)
        if (q % 2 === 1) clap(t)
        hat(t + beat / 2, true)
        hat(t + beat / 4, false, 0.07); hat(t + beat * 3 / 4, false, 0.07)
        // bass: octave-bouncing 8ths on the root
        voice('sawtooth', root - 12 + chord[0], t, beat / 2 * 0.85, bassBus, 0.9, 700, 0.005)
        voice('sawtooth', root + chord[0], t + beat / 2, beat / 2 * 0.85, bassBus, 0.7, 900, 0.005)
      }
      if (b % 8 === 7) for (let s = 0; s < 4; s++) clap(t0 + bar - beat + s * beat / 4, 0.25 + s * 0.08) // fill every 8 bars
    } else if (introP > 0.5) {
      for (let q = 0; q < 4; q++) hat(t0 + q * beat + beat / 2, false, 0.05 + introP * 0.08)
    }
  }
  // riser + snare roll into the drop
  if (dropAt >= bar) {
    const r0 = Math.max(0, dropAt - bar * 2)
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3
    f.frequency.setValueAtTime(400, r0); f.frequency.exponentialRampToValueAtTime(9000, dropAt)
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, r0); g.gain.exponentialRampToValueAtTime(0.35, dropAt - 0.02); g.gain.setValueAtTime(0, dropAt)
    s.connect(f).connect(g).connect(master); s.start(r0); s.stop(dropAt + 0.05)
    const roll0 = dropAt - bar
    for (let i = 0; i < 16; i++) clap(roll0 + i * beat / 4, 0.12 + 0.3 * i / 16)
  }
  if (dropAt > 0) { crash(dropAt, 0.35); kick(dropAt, 1.1) }
  // final hit: big chord + crash + boom, ringing out
  const last = PROG[0]
  for (const n of last) for (const d of [-9, 0, 9]) voice('sawtooth', root + 12 + n, endAt, Math.max(0.5, seconds - endAt - 0.6), padBus, 0.6, 4000, 0.005, d)
  voice('sine', root - 12, endAt, Math.max(0.5, seconds - endAt - 0.8), bassBus, 1, 400, 0.005)
  kick(endAt, 1.3); crash(endAt, 0.5, Math.max(1, seconds - endAt))
  music.gain.setValueAtTime(1, endAt + 0.3)

  const buf = await ctx.startRendering()
  const L = buf.getChannelData(0), R = buf.getChannelData(1)
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
  const k = peak > 0 ? 0.89 / peak : 1
  const n = L.length, data = new DataView(new ArrayBuffer(44 + n * 4))
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true)
  data.setUint16(22, 2, true); data.setUint32(24, SR, true); data.setUint32(28, SR * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true)
  w(36, 'data'); data.setUint32(40, n * 4, true)
  for (let i = 0; i < n; i++) {
    data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * k)) * 32767, true)
    data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * k)) * 32767, true)
  }
  const bytes = new Uint8Array(data.buffer); let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}, cfg)
writeFileSync(out, Buffer.from(b64, 'base64'))
await browser.close()
console.log('music', out)
