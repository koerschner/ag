// Render a cards.html card to PNG frames.
// bun frames.ts <outdir> <setupFn> '<json args>' <dur> [fps]
// Env: TRANSPARENT=1 keeps the background transparent; FONT_DISPLAY / FONT_BODY are .ttf/.otf paths.
// Images in args are absolute paths; they are served as /file/<path>.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { dirname, extname } from 'path'

const [outdir, fn, json, durS, fpsS = '30'] = process.argv.slice(2)
const dur = Number(durS), fps = Number(fpsS)
mkdirSync(outdir, { recursive: true })

function browserPath() {
  if (process.env.CHROME) return process.env.CHROME
  const base = `${process.env.HOME}/.cache/ms-playwright`
  const shell = existsSync(base) && readdirSync(base).find(d => d.startsWith('chromium_headless_shell'))
  if (!shell) throw new Error('no headless Chromium: run `bunx playwright install chromium-headless-shell` or set CHROME')
  const dir = `${base}/${shell}`
  const sub = readdirSync(dir).find(d => d.startsWith('chrome-headless-shell'))!
  return `${dir}/${sub}/chrome-headless-shell`
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' }
const HERE = dirname(new URL(import.meta.url).pathname)
const browser = await chromium.launch({ executablePath: browserPath() })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', e => console.error('[pageerror]', e.message))
await page.route('http://cards.local/**', r => {
  const u = decodeURIComponent(new URL(r.request().url()).pathname)
  const file = u === '/' ? `${HERE}/cards.html`
    : u === '/font/display' ? process.env.FONT_DISPLAY
    : u === '/font/body' ? process.env.FONT_BODY
    : u.startsWith('/file/') ? u.slice(5) : undefined
  if (!file || !existsSync(file)) return r.fulfill({ status: 404, body: '' })
  r.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' })
})
await page.goto('http://cards.local/')
const args = JSON.parse(json)
// absolute image paths -> served URLs
const fix = (v: any): any => typeof v === 'string' && v.startsWith('/') && existsSync(v) ? `/file${v}`
  : Array.isArray(v) ? v.map(fix) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v
await page.evaluate(([fn, a, dur]) => { const w = window as any; w.setTheme(a.theme); w[fn]({ ...a, dur }) }, [fn, fix(args), dur] as const)
await page.evaluate(() => document.fonts.ready)
await page.waitForLoadState('networkidle')
const n = Math.max(1, Math.round(dur * fps))
for (let i = 0; i < n; i++) {
  await page.evaluate(t => (window as any).render(t), i / fps)
  await page.screenshot({ path: `${outdir}/f${String(i).padStart(4, '0')}.png`, omitBackground: !!process.env.TRANSPARENT })
}
await browser.close()
console.log('frames', n)
