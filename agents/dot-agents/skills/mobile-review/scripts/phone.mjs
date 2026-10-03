// phone.mjs: a simulated iPhone for adversarial mobile review (Playwright, touch + mobile viewport).
// Library used by the suites next to it (agdash.mjs) and by ad-hoc scripts:
//   import { launchPhone, alive, tapCheck, sweep } from "~/.agents/skills/mobile-review/scripts/phone.mjs";
// Playwright is installed once into ~/.local/share/mobile-review by setup.sh (the scripts load it from there).
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync, mkdirSync } from "node:fs";

const PW_DIR = `${homedir()}/.local/share/mobile-review/`;
let pw;
try { pw = createRequire(PW_DIR)("playwright"); } catch { console.error(`Playwright missing: run ${new URL("./setup.sh", import.meta.url).pathname}`); process.exit(2); }
export const { devices } = pw;

// iPhone 15 Pro portrait safe areas (points). Playwright can't emulate env(safe-area-inset-*), so the served
// HTML has them substituted; that's what puts buttons under the Dynamic Island / home bar like on the phone.
export const SAFE = { top: 59, bottom: 34, left: 0, right: 0 };

/**
 * launchPhone({ url, device, engine, safeArea, stubWrites, pageFile, allowWrites })
 * - engine: "chromium" (default; works on ag-mac) or "webkit" (closer to Safari, but Playwright's WebKit build
 *   currently can't start its web process on macOS 26 here; try it, fall back to chromium).
 * - stubWrites (default true): every non-GET request is answered {ok:true} and recorded instead of reaching
 *   the server, so tapping Send / Archive / Interrupt on a real, live app has no side effects.
 *   allowWrites: RegExp of URLs that may still go through (e.g. an upload endpoint you want to exercise).
 * - stubReply(write): custom JSON reply for a stubbed write (default {ok:true}), e.g. fake upload paths.
 * - viewport: override the device viewport, e.g. {width:852,height:393} for landscape.
 * - pageFile: serve this local HTML file for document requests (test an edit before it goes live).
 * Returns { browser, ctx, page, writes, errors, shot(name) }.
 */
export async function launchPhone(o = {}) {
  const { url, device = "iPhone 15 Pro", engine = process.env.ENGINE || "chromium", safeArea = SAFE, stubWrites = true, pageFile, allowWrites, stubReply, viewport, out = "/tmp/mobile-review" } = o;
  mkdirSync(out, { recursive: true });
  const browser = await pw[engine].launch();
  const ctx = await browser.newContext({ ...devices[device], ...(viewport ? { viewport } : {}), ignoreHTTPSErrors: true, permissions: engine === "chromium" ? ["clipboard-read", "clipboard-write"] : [] });
  const page = await ctx.newPage();
  const writes = [], errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  page.on("dialog", (d) => { errors.push(`dialog(${d.type()}): ${d.message()}`); d.dismiss().catch(() => {}); });
  await page.route("**/*", async (route) => {
    const r = route.request();
    if (stubWrites && r.method() !== "GET" && !(allowWrites && allowWrites.test(r.url()))) {
      let body = r.postData() || ""; try { body = JSON.parse(body); } catch {}
      writes.push({ method: r.method(), path: new URL(r.url()).pathname, body, t: Date.now() });
      return route.fulfill({ json: typeof stubReply === "function" ? stubReply(writes.at(-1)) : { ok: true } });
    }
    if (r.resourceType() === "document") {
      const res = await route.fetch();
      let html = pageFile ? readFileSync(pageFile, "utf8") : await res.text();
      html = html.replace(/env\(safe-area-inset-(top|bottom|left|right)\)/g, (_, s) => safeArea[s] + "px");
      return route.fulfill({ response: res, body: html, headers: { ...res.headers(), "content-type": "text/html; charset=utf-8" } });
    }
    return route.continue();
  });
  if (url) await page.goto(url);
  let n = 0;
  const shot = async (name) => { const p = `${out}/${String(++n).padStart(2, "0")}-${name}.png`; await page.screenshot({ path: p }); return p; };
  return { browser, ctx, page, writes, errors, shot };
}

/** True if the page's main thread answers within ms (catches infinite loops / microtask storms that freeze taps). */
export async function alive(page, ms = 2000) {
  return Promise.race([page.evaluate(() => new Promise((r) => setTimeout(() => r(true), 0))).catch(() => false), new Promise((r) => setTimeout(() => r(false), ms))]);
}

/** What a finger at the element's centre would actually hit. */
export async function hitInfo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return { visible: false };
  const vp = page.viewportSize();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const hit = await locator.evaluate((el, [x, y]) => { const h = document.elementFromPoint(x, y); return { ok: !!h && (h === el || el.contains(h)), hit: h ? h.tagName.toLowerCase() + (h.id ? "#" + h.id : "") + (h.className && typeof h.className === "string" ? "." + h.className.split(" ").join(".") : "") : null }; }, [cx, cy]);
  const onscreen = cx >= 0 && cy >= 0 && cx <= vp.width && cy <= vp.height;
  const underTop = box.y < SAFE.top, underBottom = box.y + box.height > vp.height - SAFE.bottom;
  return { visible: true, box, onscreen, small: Math.min(box.width, box.height) < 40, tiny: Math.min(box.width, box.height) < 32, underTop, underBottom, ...hit };
}

/**
 * Tap like a finger and confirm the app stays alive. Returns { ok, why, hit }.
 * `ok` is false when the element isn't visible/on screen, something else covers it, the tap throws or times
 * out, or the main thread is hung afterwards.
 */
export async function tapCheck(page, target, { timeout = 4000, settle = 250 } = {}) {
  const loc = typeof target === "string" ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded({ timeout }).catch(() => {}); // a finger scrolls to it first
  const hit = await hitInfo(page, loc).catch((e) => ({ visible: false, err: e.message }));
  if (!hit.visible) return { ok: false, why: "not visible", hit };
  if (!hit.onscreen) return { ok: false, why: "off screen", hit };
  if (!hit.ok) return { ok: false, why: `covered by ${hit.hit}`, hit };
  try { await loc.tap({ timeout, noWaitAfter: true }); } catch (e) {
    if (!(await alive(page))) return { ok: false, frozen: true, why: "PAGE FROZE on tap (main thread hung)", hit };
    return { ok: false, why: "tap failed: " + e.message.split("\n")[0], hit };
  }
  await page.waitForTimeout(settle);
  if (!(await alive(page))) return { ok: false, frozen: true, why: "PAGE FROZE after tap (main thread hung)", hit };
  return { ok: true, hit };
}

/** Every visible tappable thing in `root`: size, safe-area overlap, and whether a finger would reach it. */
export async function sweep(page, root = "body") {
  const sel = `${root} :is(button, a[href], [role=button], select, input:not([type=hidden]), summary, [data-a], [onclick])`;
  const locs = await page.locator(sel).all();
  const rows = [];
  for (const l of locs) {
    if (!(await l.isVisible().catch(() => false))) continue;
    const h = await hitInfo(page, l);
    const label = (await l.evaluate((e) => (e.getAttribute("aria-label") || e.title || e.textContent || e.id || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40)));
    rows.push({ label, ...h });
  }
  return rows;
}

/**
 * Simulate the iOS on-screen keyboard the way Safari does it: the layout viewport (innerHeight, 100dvh,
 * position:fixed) stays full height and only window.visualViewport shrinks, so anything the app doesn't
 * explicitly move with visualViewport ends up hidden under the keyboard. Inside fn, use kbVisible(page, sel)
 * to check an element is in the visible area.
 */
export async function withKeyboard(page, fn, kbHeight = 336) {
  await page.evaluate((kb) => {
    const vv = window.visualViewport, real = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height");
    window.__kbReal = real;
    Object.defineProperty(vv, "height", { configurable: true, get: () => innerHeight - kb });
    vv.dispatchEvent(new Event("resize"));
  }, kbHeight);
  await page.waitForTimeout(150);
  try { return await fn(); } finally {
    await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event("resize")); });
    await page.waitForTimeout(150);
  }
}
/** Is the element fully inside the visual viewport (i.e. not under a simulated keyboard or off screen)? */
export async function kbVisible(page, sel) {
  return page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(), vv = window.visualViewport; return r.height > 0 && r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1; });
}

/** Tiny test reporter: t.check(name, cond, detail) → prints a PASS/FAIL table at the end; exits 1 on failures. */
export function reporter() {
  const rows = [];
  return {
    check(name, ok, detail = "") { rows.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); return !!ok; },
    warn(name, detail = "") { rows.push({ name, ok: true, warn: true, detail }); console.log(`WARN  ${name}${detail ? "  — " + detail : ""}`); },
    done() {
      const f = rows.filter((r) => !r.ok), w = rows.filter((r) => r.warn);
      console.log(`\n${rows.length - w.length} checks, ${f.length} failed, ${w.length} warnings`);
      f.forEach((r) => console.log("  ✗ " + r.name + (r.detail ? " — " + r.detail : "")));
      return f.length;
    },
  };
}
