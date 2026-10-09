// Example recorder from a trailer: Playwright over a Storybook story, fake camera, zoom, drawn cursor, RENAME, route stubs.
// Usage: ZOOM=1.5 RENAME="A=B" bun record-story.ts <story-id> <out.webm> <secs> <steps-name>   (imports ./steps-<name>.ts exporting run(page, click, move))
const { chromium } = await import(`${process.env.HOME}/.cache/feature-trailer/runtime/node_modules/playwright-core/index.mjs`)
import { readdirSync, renameSync } from 'fs'
const [story, out, secs = '30', script = 'selfie'] = process.argv.slice(2)
const base = `${process.env.HOME}/.cache/ms-playwright`
const dir = readdirSync(base).find(d => d.startsWith('chromium-') && !d.includes('headless'))!
const browser = await chromium.launch({
  executablePath: `${base}/${dir}/chrome-linux64/chrome`, headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${process.env.CAM ?? "cam.y4m"}`, '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['camera', 'microphone'],
  recordVideo: { dir: 'vid', size: { width: 1920, height: 1080 } } })
const page = await ctx.newPage()
page.on('pageerror', e => console.error('[pageerror]', e.message)); page.on('requestfailed', r => console.error('[reqfail]', r.url().slice(0,160), r.failure()?.errorText)); page.on('response', r => { if (r.status() >= 400) console.error('[http]', r.status(), r.url().slice(0,160)) }); page.on('console', m => { if (/error|warn|segment|effect|processor|webgl|gpu/i.test(m.text())) console.error('[console]', m.type(), m.text().slice(0, 200)) })
await page.addInitScript((z) => addEventListener('DOMContentLoaded', () => {
  document.documentElement.style.zoom = z
  const c = document.createElement('div'); c.id = '__cur'
  c.style.cssText = 'position:fixed;z-index:2147483647;width:30px;height:30px;pointer-events:none;left:-60px;top:-60px;transition:left .35s ease-out,top .35s ease-out'
  c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#fff" stroke="#000" stroke-width="1.5"/></svg>'
  document.body.append(c)
}), process.env.ZOOM || '2.2326')
const move = async (x: number, y: number) => { await page.evaluate(([x, y]) => { const c = document.getElementById('__cur'); if (c) { const z = parseFloat(document.documentElement.style.zoom || '1'); c.style.left = x / z + 'px'; c.style.top = y / z + 'px' } }, [x, y]); await page.mouse.move(x, y, { steps: 10 }); await page.waitForTimeout(420) }
const click = async (loc: any) => { const b = await loc.boundingBox(); if (!b) { console.error('no box'); return }; await move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300) }
;(globalThis as any).page = page; ;(globalThis as any).click = click; ;(globalThis as any).move = move
if (process.env.RENAME) { const [from, to] = process.env.RENAME.split('='); await page.addInitScript(([f, t]) => { const fix = () => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue && n.nodeValue.includes(f)) n.nodeValue = n.nodeValue.split(f).join(t) }; addEventListener('DOMContentLoaded', () => { fix(); new MutationObserver(fix).observe(document.body, { subtree: true, childList: true, characterData: true }) }) }, [from, to]) }
await page.route('**/api/economy/wallpapers/*/image', r => { const k = new URL(r.request().url()).pathname.split('/')[4]; r.fulfill({ path: `${process.env.STUB_DIR}/${k}.webp`, contentType: 'image/webp', headers: { 'access-control-allow-origin': '*' } }) })
await page.goto(`http://localhost:${process.env.SB_PORT ?? 6006}/iframe.html?id=${story}&viewMode=story&globals=theme:dark&realcam=1`)
await page.waitForTimeout(2500)
const steps = await import(`./steps-${script}.ts`)
await steps.run(page, click, move)
const v = page.video()!; await ctx.close(); await browser.close()
renameSync(await v.path(), out); console.log('ok', out)
