// Composition helpers, served at /lib/ev.js. Load GSAP first (/lib/gsap.min.js).
//
//   EV.data            window.DATA: { fps, duration, size, lines: [{ id, text, start, end, dur, words: [{ w, s, e }] }], cues: {...} }
//   EV.at('id', +0.2)  a line's start (+ offset); EV.end('id', -0.3) its end; EV.line('id') the whole line
//   EV.word('id', 'battery')  absolute time the word is spoken (first match, case-insensitive), for hitting a beat on a word
//   EV.start(build)    put all your setup in build() (it may be async) and call EV.start(build) once, at the
//                      end of <body>: it runs when DATA is available (rendering: at once; preview: after fetching data.json)
//   window.tl          build ONE paused GSAP timeline (gsap.timeline({ paused: true })) and put every tween on it at EV.at(...)
//   EV.onFrame(fn)     fn(t) runs every frame (counters, captions, anything not in the timeline)
//   EV.captions(el, { maxWords })  karaoke captions from the VO word timings into el (spans .w, current gets .on)
//   EV.ready           resolves when build() finishes; the renderer awaits it (and fonts and images) before frame 0
// Preview live in a browser: open the composition with ?play (needs data.json beside it), or ?t=12.5 to freeze a frame.
(function () {
  const EV = (window.EV = window.EV || {})
  const hooks = []
  EV.data = window.DATA || null
  let started
  EV.ready = new Promise(r => (started = r))
  EV.start = build => {
    const go = async () => { await build(); started() }
    if (EV.data) go()
    else fetch('data.json').then(r => r.json()).then(d => { EV.data = window.DATA = d; go() })
  }
  const need = () => { if (!EV.data) throw new Error('no DATA: render with render.ts or preview with data.json beside the page') }
  EV.line = id => { need(); const l = EV.data.lines.find(x => x.id === id); if (!l) throw new Error(`no VO line "${id}"`); return l }
  EV.at = (id, off = 0) => EV.line(id).start + off
  EV.end = (id, off = 0) => EV.line(id).end + off
  EV.word = (id, word, nth = 0) => {
    const l = EV.line(id), w = String(word).toLowerCase()
    const hits = l.words.filter(x => x.w.toLowerCase().replace(/[^a-z0-9']/g, '').startsWith(w))
    if (!hits.length) { console.warn(`word "${word}" not in line "${id}"`); return l.start }
    return hits[Math.min(nth, hits.length - 1)].s
  }
  EV.onFrame = fn => hooks.push(fn)
  let primed = false
  EV.seek = async t => {
    // render every tween once (end, then start) so set()/from() states are applied even at t=0
    if (window.tl && !primed) { window.tl.seek(window.tl.duration(), true); window.tl.seek(0, true); primed = true }
    if (window.tl) window.tl.seek(t, false)
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000 }
    for (const fn of hooks) fn(t)
    const pending = [...document.images].filter(i => !i.complete)
    if (pending.length) await Promise.all(pending.map(i => i.decode().catch(() => {})))
  }
  EV.captions = (el, { maxWords = 7 } = {}) => {
    need()
    const chunks = []
    for (const l of EV.data.lines) for (let i = 0; i < l.words.length; i += maxWords) {
      const ws = l.words.slice(i, i + maxWords)
      if (ws.length) chunks.push({ s: ws[0].s, e: Math.min(ws[ws.length - 1].e + 0.35, l.end + 0.35), ws })
    }
    let shown = null
    EV.onFrame(t => {
      const c = chunks.find(c => t >= c.s && t < c.e) || null
      if (c !== shown) { el.innerHTML = c ? c.ws.map(w => `<span class="w">${w.w}</span>`).join(' ') : ''; shown = c }
      el.style.opacity = c ? 1 : 0
      if (c) [...el.children].forEach((s, i) => s.classList.toggle('on', t >= c.ws[i].s))
    })
  }
  // live preview outside the renderer
  if (!window.RENDERING) addEventListener('load', async () => {
    await EV.ready
    const q = new URLSearchParams(location.search)
    if (q.has('t')) return EV.seek(Number(q.get('t')))
    if (q.has('play')) { const t0 = performance.now(); const tick = () => { const t = (performance.now() - t0) / 1000; EV.seek(t % EV.data.duration); requestAnimationFrame(tick) }; tick() }
  })
})()
