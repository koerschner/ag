// Render an HTML composition to JPEG frames, deterministically (no wall clock).
//
//   bun render.ts <comp.html> <outdir> <data.json> [--fps 30] [--workers 4] [--from S] [--to S] [--size 1920x1080] [--scale 0.5]
//
// The composition is served from its own directory at http://video.local/ (so relative
// asset paths work); absolute paths are served as /file/<abs path>. Also served:
//   /lib/gsap.min.js   GSAP 3 (build a paused timeline; we seek it)
//   /lib/ev.js         the composition helpers (EV.*: data, cue times, captions, seek)
// window.DATA is set to data.json before any script runs (VO line timings, words, duration).
// Each frame calls `await EV.seek(t)`: it seeks window.tl (GSAP), sets every CSS/Web
// Animation's currentTime, runs EV.onFrame hooks, then waits for pending image decodes.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, extname, resolve } from 'path'
import { browserPath } from './browser.ts'

const argv = process.argv.slice(2)
const pos = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const [compPath, outdir, dataPath] = pos.map(p => resolve(p))
const fps = Number(opt('fps', '30')), workers = Number(opt('workers', '4'))
const [W, H] = opt('size', '1920x1080').split('x').map(Number)
const scale = Number(opt('scale', '1')) // 0.5 for drafts: same layout, half the pixels
const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const from = Number(opt('from', '0')), to = Math.min(Number(opt('to', String(data.duration))), data.duration)
mkdirSync(outdir, { recursive: true })

const HERE = dirname(new URL(import.meta.url).pathname)
const ROOT = dirname(compPath)
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' }
const LIB: Record<string, string> = { '/lib/gsap.min.js': `${HERE}/node_modules/gsap/dist/gsap.min.js`, '/lib/ev.js': `${HERE}/ev.js` }

const first = Math.round(from * fps), last = Math.max(first + 1, Math.round(to * fps))
const total = last - first
const per = Math.ceil(total / workers)
const browser = await chromium.launch({ executablePath: browserPath(), args: ['--font-render-hinting=none', '--disable-lcd-text'] })
const errors: string[] = []

async function worker(k: number) {
  const a = first + k * per, b = Math.min(last, a + per)
  if (a >= b) return
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale })
  // print page errors as they happen (worker 0 only, to avoid 4x duplicates), and keep them for the summary
  const note = (msg: string) => { if (!errors.includes(msg) && k === 0) console.error('[page]', msg); errors.push(msg) }
  page.on('pageerror', e => note(e.message))
  page.on('console', m => { if (m.type() === 'error') note(m.text()) })
  await page.addInitScript(d => { (window as any).DATA = d; (window as any).RENDERING = true }, data)
  await page.route('http://video.local/**', r => {
    const u = decodeURIComponent(new URL(r.request().url()).pathname)
    const file = LIB[u] ?? (u.startsWith('/file/') ? u.slice(5) : `${ROOT}${u === '/' ? '/' + compPath.split('/').pop() : u}`)
    if (!existsSync(file)) { errors.push(`404 ${u}`); return r.fulfill({ status: 404, body: '' }) }
    r.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' })
  })
  await page.goto(`http://video.local/${compPath.split('/').pop()}`, { waitUntil: 'networkidle' })
  const ready = page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode().catch(() => {}))); await (window as any).EV?.ready })
  const timeout = new Promise((_, j) => setTimeout(() => j(new Error('composition not ready after 60 s: did build() throw, or EV.start() never get called?')), 60000))
  try { await Promise.race([ready, timeout]) } catch (e) {
    console.error(`render.ts: ${(e as Error).message}\n` + [...new Set(errors)].slice(0, 10).join('\n'))
    process.exit(1)
  }
  for (let i = a; i < b; i++) {
    await page.evaluate(t => (window as any).EV.seek(t), i / fps)
    await page.screenshot({ path: `${outdir}/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 })
    if (k === 0 && (i - a) % 150 === 0) console.log(`frame ${i - a}/${b - a} (worker 0 of ${workers})`)
  }
  await page.close()
}
await Promise.all(Array.from({ length: workers }, (_, k) => worker(k)))
await browser.close()
if (errors.length) console.error('[page errors]\n' + [...new Set(errors)].slice(0, 20).join('\n'))
console.log(`frames ${first}..${last - 1} (${total})`)
