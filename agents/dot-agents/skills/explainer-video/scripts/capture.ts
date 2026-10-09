// Capture real product screens (a live app, a dev server, or Storybook stories) as stills
// plus the boxes of the elements you name, so a composition can zoom to, ring, or point at them.
//
//   bun capture.ts <shots.json> <outdir>
//
// shots.json: { "defaults": {...}, "shots": [ { name, url | story, ... } ] }
//   url        any page; story: a Storybook story id (served from $STORYBOOK, default http://localhost:6006)
//   width, height   viewport (default 1920x1080); scale: deviceScaleFactor (default 1)
//   zoom       CSS zoom on <html> (e.g. 1.25 to make a small component fill the frame)
//   wait       ms to wait after load (default 800), waitFor: a selector to wait for
//   hide       CSS selectors to hide (dev badges, Storybook chrome, cookie bars)
//   css        extra CSS to inject
//   actions    [{ click: sel } | { type: [sel, text] } | { press: key } | { hover: sel } | { wait: ms } | { eval: js }]
//   boxes      { key: selector } -> boxes.json gets each element's {x,y,w,h} in screenshot pixels
//   rename     { "From": "To" }  rewrites visible text (test names, emails) before the shot
//   crop       a selector: save only that element (plus `pad` px, default 24), e.g. "#storybook-root > *" for a story's component
//   omitBackground  true for a transparent PNG where the page has no background
//   fullPage   true for a full-page capture
//   html       true also saves the page's rendered HTML (serialize DOM + inline styles) for re-animation
// Writes <outdir>/<name>.png and <outdir>/boxes.json ({ name: { size:[w,h], boxes:{key:{x,y,w,h}} } }).
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { browserPath } from './browser.ts'

const [specPath, outdir] = process.argv.slice(2)
if (!specPath || !outdir) { console.error('usage: bun capture.ts <shots.json> <outdir>'); process.exit(2) }
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const SB = process.env.STORYBOOK ?? 'http://localhost:6006'
mkdirSync(outdir, { recursive: true })
const boxesPath = `${outdir}/boxes.json`
const allBoxes: Record<string, any> = existsSync(boxesPath) ? JSON.parse(readFileSync(boxesPath, 'utf8')) : {}
const only = process.env.ONLY?.split(',')

const browser = await chromium.launch({ executablePath: browserPath(), args: ['--autoplay-policy=no-user-gesture-required'] })
for (const raw of spec.shots) {
  const s = { ...(spec.defaults ?? {}), ...raw }
  if (only && !only.includes(s.name)) continue
  const w = s.width ?? 1920, h = s.height ?? 1080, scale = s.scale ?? 1
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: s.colorScheme ?? 'dark' })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.error(`[${s.name}] pageerror`, e.message))
  const url = s.url ?? `${SB}/iframe.html?id=${s.story}&viewMode=story${s.args ? `&args=${s.args}` : ''}${s.globals ? `&globals=${s.globals}` : ''}`
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(e => console.error(`[${s.name}] goto`, e.message))
  if (s.waitFor) await page.waitForSelector(s.waitFor, { timeout: 15000 }).catch(() => console.error(`[${s.name}] waitFor timed out: ${s.waitFor}`))
  const css = [s.css ?? '', ...(s.hide ?? []).map((x: string) => `${x}{visibility:hidden!important}`)].join('\n')
  if (css.trim()) await page.addStyleTag({ content: css })
  if (s.zoom) await page.evaluate(z => { document.documentElement.style.zoom = String(z) }, s.zoom)
  for (const a of s.actions ?? []) {
    if (a.click) await page.click(a.click, { timeout: 10000 }).catch(e => console.error(`[${s.name}] click`, e.message))
    if (a.hover) await page.hover(a.hover, { timeout: 10000 }).catch(e => console.error(`[${s.name}] hover`, e.message))
    if (a.type) await page.fill(a.type[0], a.type[1]).catch(e => console.error(`[${s.name}] type`, e.message))
    if (a.press) await page.keyboard.press(a.press)
    if (a.eval) await page.evaluate(a.eval)
    if (a.wait) await page.waitForTimeout(a.wait)
  }
  if (s.rename) await page.evaluate((map: Record<string, string>) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode())
      for (const [from, to] of Object.entries(map)) if (n.nodeValue?.includes(from)) n.nodeValue = n.nodeValue.split(from).join(to)
  }, s.rename)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(s.wait ?? 800)
  const boxes: Record<string, any> = {}
  for (const [key, sel] of Object.entries(s.boxes ?? {})) {
    const b = await page.locator(sel as string).first().boundingBox().catch(() => null)
    if (!b) { console.error(`[${s.name}] box not found: ${key} = ${sel}`); continue }
    const z = s.zoom ?? 1 // boundingBox already reports zoomed CSS px in Chromium; scale to screenshot px
    boxes[key] = { x: Math.round(b.x * scale), y: Math.round(b.y * scale), w: Math.round(b.width * scale), h: Math.round(b.height * scale) }
    void z
  }
  let clip
  if (s.crop) {
    const b = await page.locator(s.crop).first().boundingBox().catch(() => null)
    if (!b) console.error(`[${s.name}] crop not found: ${s.crop}`)
    else {
      const p = s.pad ?? 24
      const x = Math.max(0, b.x - p), y = Math.max(0, b.y - p)
      clip = { x, y, width: Math.min(w - x, b.width + 2 * p), height: Math.min(h - y, b.height + 2 * p) }
    }
  }
  await page.screenshot({ path: `${outdir}/${s.name}.png`, fullPage: !!s.fullPage, clip, omitBackground: !!s.omitBackground })
  if (s.html) writeFileSync(`${outdir}/${s.name}.html`, await page.content())
  allBoxes[s.name] = { size: [w * scale, h * scale], url, boxes }
  console.log('captured', s.name, Object.keys(boxes).length ? `boxes: ${Object.keys(boxes).join(',')}` : '')
  await ctx.close()
}
await browser.close()
writeFileSync(boxesPath, JSON.stringify(allBoxes, null, 2))
