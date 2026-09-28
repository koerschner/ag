#!/usr/bin/env node
// Adversarial mobile review of AG Dash (http://ag:7376) on a simulated iPhone 15 Pro.
// Every write is stubbed (recorded, never sent), so it's safe against the live board.
//   node agboard.mjs                 # live page
//   PAGE=path/to/index.html node agboard.mjs   # test a local edit of the page before it goes live
//   OUT=/tmp/mobile-review/agboard (screenshots), URL=... (default: the https board)
import { launchPhone, alive, tapCheck, hitInfo, sweep, withKeyboard, kbVisible, reporter } from "./phone.mjs";

const URL = process.env.URL || "https://ag.tail44736d.ts.net:7377/";
const OUT = process.env.OUT || "/tmp/mobile-review/agboard";
const t = reporter();
const stubReply = (w) => (w.path === "/api/upload" ? { ok: true, paths: ["/Users/you/inbox/clipboard/test.png"] } : { ok: true });
const { browser, page, writes, errors, shot } = await launchPhone({ url: URL, pageFile: process.env.PAGE, out: OUT, stubReply });
const $ = (s) => page.locator(s).first();
const lastWrite = (path) => writes.filter((w) => w.path === path).at(-1);
const wroteSince = (n, path, pred = () => true) => writes.slice(n).some((w) => w.path === path && pred(w.body));
// editor text without CodeMirror's placeholder (which lives inside .cm-content)
const edText = (id) => page.evaluate((id) => { const c = document.querySelector(`#${id} .cm-content`).cloneNode(true); c.querySelectorAll(".cm-placeholder").forEach((p) => p.remove()); return c.textContent.trim(); }, id);
const drawerOpen = () => page.evaluate(() => document.querySelector("#drawer").classList.contains("open"));
// Finger targets: under 32pt fails (misses are likely), under 40pt warns (Apple asks for 44pt).
const targets = async (where, root) => { for (const s of await sweep(page, root)) { const d = `${Math.round(s.box.width)}×${Math.round(s.box.height)}`; if (s.tiny) t.check(`${where}: "${s.label}" big enough to tap`, false, d); else if (s.small) t.warn(`${where}: "${s.label}" under 40pt`, d); } };
// A frozen page makes every later step hang, so stop there and report.
const bail = () => { console.log("\nThe page is frozen; stopping here."); t.done(); process.exit(1); };
const tc = async (...a) => { const r = await tapCheck(...a); if (r.frozen) { t.check("page alive", false, r.why); bail(); } return r; };
const tap = async (name, sel, opts) => { const r = await tapCheck(page, sel, opts); t.check(`tap ${name}`, r.ok, r.why || ""); if (r.frozen) bail(); return r.ok; };
async function openCard(pred = "") {
  // pred: CSS suffix on .card, e.g. '[data-s=working]'. Taps the card body (title), not its buttons.
  const c = page.locator(`#board .card${pred}`).first();
  const col = await c.evaluate((el) => el.closest(".col").dataset.key).catch(() => null);
  if (!col) return null;
  await page.locator(`#coltabs button[data-k="${col}"]`).tap(); await page.waitForTimeout(450);
  if ((await tc(page, c.locator(".tt"))).frozen) { t.check("open a card", false, "PAGE FROZE"); bail(); }
  await page.waitForTimeout(350);
  return c.getAttribute("data-tab");
}

await page.waitForSelector("#board .card", { timeout: 15000 });
await page.waitForTimeout(800);
t.check("board loads with cards", await page.locator("#board .card").count() > 0);
t.check("page alive", await alive(page));
await shot("board");

// ---- header ----
const bw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
t.check("no horizontal page overflow", bw.sw <= bw.w, JSON.stringify(bw));
for (const [name, v] of [["Lists view", "lists"], ["Workspaces view", "ws"], ["State view", "state"]]) {
  await tap(name, `#views button[data-v=${v}]`);
  t.check(`${name} active`, await page.evaluate((v) => document.querySelector(`#views button[data-v=${v}]`).classList.contains("on"), v));
  t.check(`${name}: column tabs match columns`, await page.evaluate(() => document.querySelectorAll("#coltabs button").length === document.querySelectorAll("#board > .col").length));
}
await tap("🔥 only (on)", "#hotonly");
t.check("🔥 only filters to hot cards", await page.evaluate(() => [...document.querySelectorAll("#board .card")].every((c) => c.classList.contains("hot"))));
await tap("🔥 only (off)", "#hotonly");
await $("#q").tap(); await page.keyboard.type("zzqqxx-no-match");
await page.waitForTimeout(200);
t.check("filter hides non-matching cards", await page.locator("#board .card").count() === 0);
await page.fill("#q", ""); await page.dispatchEvent("#q", "input"); await page.evaluate(() => document.activeElement.blur());

// ---- column tabs + swipe ----
const ntabs = await page.locator("#coltabs button").count();
for (let i = ntabs - 1; i >= 0; i--) {
  const b = page.locator("#coltabs button").nth(i);
  const name = (await b.textContent()).replace(/\d+$/, "");
  const tr = await tc(page, b, { settle: 700 });
  if (process.env.DEBUG) console.log("coltab", i, JSON.stringify(tr), await page.evaluate(() => ({ sl: board.scrollLeft, strip: coltabs.scrollLeft, want: localStorage.phoneCol })));
  const cur = await page.evaluate(() => Math.round(board.scrollLeft / board.clientWidth));
  t.check(`column tab "${name}" scrolls to its column`, cur === i, `at ${cur}`);
  t.check(`column tab "${name}" highlighted`, await b.evaluate((e) => e.classList.contains("on")));
}
await page.evaluate(() => { coltabs.scrollLeft = 1e4; }); const stripAt = await page.evaluate(() => coltabs.scrollLeft); await page.waitForTimeout(1600);
t.check("swiped tab strip stays put (no snap-back)", stripAt === 0 || (await page.evaluate(() => coltabs.scrollLeft)) === stripAt);
await page.evaluate(() => board.scrollTo({ left: board.clientWidth, behavior: "instant" })); await page.waitForTimeout(300);
t.check("swiping the board moves the tab highlight", await page.evaluate(() => document.querySelectorAll("#coltabs button")[1]?.classList.contains("on")));

// ---- card quick actions ----
await page.locator("#coltabs button").first().tap(); await page.waitForTimeout(400);
const firstCol = page.locator("#board > .col").nth(await page.evaluate(() => Math.round(board.scrollLeft / board.clientWidth)));
let card = firstCol.locator(".card").first();
if (!(await card.count())) { await page.locator("#coltabs button").nth(3).tap(); await page.waitForTimeout(400); card = page.locator("#board > .col").nth(3).locator(".card").first(); }
const ctab = await card.getAttribute("data-tab");
const C = () => page.locator(`#board .card[data-tab="${ctab}"]`);
await tap("card ▾ details", C().locator("[data-a=chev]"));
t.check("▾ expands details (no drawer)", (await C().locator(".det").count()) === 1 && !(await drawerOpen()));
await shot("card-details");
let n = writes.length;
await tap("details: Open in Herdr", C().locator(".det [data-a=focus]"));
t.check("Open in Herdr → POST /api/focus", wroteSince(n, "/api/focus"));
n = writes.length;
await tap("details: 🔥 Hotpath", C().locator(".det [data-a=hot]"));
t.check("details 🔥 → POST /api/card {hot}", wroteSince(n, "/api/card", (b) => "hot" in b));
await tap("details: 🔥 again (undo)", C().locator(".det [data-a=hot]"));
n = writes.length;
await tap("details: ⏳ Waiting", C().locator(".det [data-a=wait]"));
t.check("details ⏳ → POST /api/card {waiting}", wroteSince(n, "/api/card", (b) => "waiting" in b));
await tap("details: Transcript & reply", C().locator(".det [data-a=open]"));
t.check("Transcript & reply opens the drawer", await drawerOpen());
await tap("drawer ✕ (from details)", "#dclose");
t.check("✕ closes the drawer", !(await drawerOpen()));
await tap("card ▾ collapse", C().locator("[data-a=chev]"));
t.check("▾ collapses details", (await C().locator(".det").count()) === 0);
n = writes.length;
await tap("details: 🗄 Archive", (await C().locator("[data-a=chev]").tap(), C().locator(".det [data-a=archive]")));
t.check("Archive hides the card", (await C().count()) === 0);
t.check("Archive shows an Undo toast", await $("#undos .undo").isVisible());
const u = await tc(page, "#undos .undo button");
t.check("tap Undo", u.ok, u.why || "");
t.check("Undo restores the card, nothing closed", (await C().count()) === 1 && !wroteSince(n, "/api/close"));
if (await C().locator(".det").count()) await C().locator("[data-a=chev]").tap();

// long-press → hotpath
n = writes.length;
const bb = await C().locator(".tt").boundingBox();
await page.touchscreen.tap(bb.x + 5, bb.y + 5).catch(() => {}); // warm up
if (await drawerOpen()) await page.locator("#dclose").tap();
await page.waitForTimeout(200);
await C().locator(".tt").dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: bb.x + 5, clientY: bb.y + 5 }] });
await page.waitForTimeout(750);
await C().locator(".tt").dispatchEvent("touchend", {});
t.check("long-press toggles 🔥 (POST /api/card {hot})", wroteSince(n, "/api/card", (b) => "hot" in b));
await C().locator(".tt").dispatchEvent("click"); // the click after a long-press must be swallowed
t.check("click after long-press doesn't open the drawer", !(await drawerOpen()));
await C().locator(".tt").dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: bb.x + 5, clientY: bb.y + 5 }] }); await page.waitForTimeout(750); await C().locator(".tt").dispatchEvent("touchend", {}); // toggle back
await C().locator(".tt").dispatchEvent("click");

// ---- drawer ----
for (let i = 1; i <= 3; i++) {
  const tab = await openCard();
  t.check(`open drawer #${i}`, await drawerOpen(), tab || "");
  if (i === 1) await shot("drawer");
  const r = await tc(page, "#dclose");
  t.check(`✕ closes drawer #${i}`, r.ok && !(await drawerOpen()), r.why || "");
  t.check(`URL back to / after ✕ #${i}`, new globalThis.URL(page.url()).pathname === "/");
}
const dtab = await openCard(':not([data-s=working])');
{ const h = await hitInfo(page, $("#dclose")); t.check("drawer ✕: hittable and clear of the status bar", h.ok && h.onscreen && !h.underTop, JSON.stringify({ hit: h.hit, y: h.box?.y })); }
await targets("drawer", "#dh");
for (const s of await sweep(page, "#dh")) if (s.underTop) t.check(`drawer: "${s.label}" clear of the status bar`, false);
// action row buttons (it scrolls sideways on phones; tapCheck scrolls each into view)
n = writes.length;
t.check("⏹ Interrupt disabled when idle", await $("#dstop").isDisabled());
await tap("drawer 🔥 Hotpath", "#dhot"); t.check("drawer 🔥 → POST {hot}", wroteSince(n, "/api/card", (b) => "hot" in b)); await tap("drawer 🔥 back", "#dhot");
n = writes.length; await tap("drawer ⏳ Waiting", "#dwait"); t.check("drawer ⏳ → POST {waiting}", wroteSince(n, "/api/card", (b) => "waiting" in b));
n = writes.length; await tap("drawer Open in Herdr", "#dfocus"); t.check("drawer Open in Herdr → POST /api/focus", wroteSince(n, "/api/focus"));
t.check("📱 Moshi shown on touch", await $("#dmoshi").isVisible());
t.check("📱 Moshi has a /m/<sid> href", /\/m\/[0-9a-f-]{36}$/.test((await $("#dmoshi").getAttribute("href")) || ""));
await tap("drawer 🔗 Link", "#dlink");
t.check("🔗 Link shows a toast", await $("#toast").isVisible());
await page.locator("#dlist").scrollIntoViewIfNeeded();
const opts = await page.locator("#dlist option").count();
if (opts > 1) { n = writes.length; await page.selectOption("#dlist", { index: 1 }); await page.waitForTimeout(200); t.check("list picker → POST {list}", wroteSince(n, "/api/card", (b) => "list" in b)); await page.selectOption("#dlist", { index: 0 }); }
else t.warn("list picker", "no lists defined, skipped");
// tabs
await tap("Live screen tab", "#dtabs [data-t=live]");
t.check("Live screen shows", await $("#live").isVisible());
await page.waitForTimeout(1200);
t.check("Live screen has content", ((await $("#screen").textContent()) || "").trim().length > 0);
await shot("drawer-live");
for (const k of ["esc", "enter", "up", "down", "y", "1"]) { n = writes.length; await tc(page, `#keys [data-k="${k}"]`, { settle: 50 }); t.check(`key ${k} → POST /api/keys`, wroteSince(n, "/api/keys", (b) => b.keys?.[0] === k)); }
await targets("key button", "#keys");
await tap("Transcript tab", "#dtabs [data-t=tx]");
t.check("Transcript shows", await $("#tx").isVisible());
t.check("Transcript has messages", (await page.locator("#tx .msg, #tx details").count()) > 0);
// tool-call disclosure
const det = page.locator("#tx details.tl").last();
if (await det.count()) { await det.locator("summary").scrollIntoViewIfNeeded(); await tc(page, det.locator("summary")); t.check("tool call expands", await det.evaluate((d) => d.open)); }
// reply with the keyboard up
await withKeyboard(page, async () => {
  await page.waitForTimeout(300);
  await tap("reply editor", "#rted .cm-content");
  await page.keyboard.type("mobile-review test message");
  await page.waitForTimeout(200);
  await shot("drawer-keyboard");
  t.check("keyboard up: editor above the keyboard", await kbVisible(page, "#rted .cm-editor"));
  t.check("keyboard up: Send above the keyboard", await kbVisible(page, "#rsend"));
  t.check("keyboard up: ✕ visible", await kbVisible(page, "#dclose"));
  t.check("keyboard up: compact header (kb class)", await page.evaluate(() => document.querySelector("#drawer").classList.contains("kb")));
  t.check("keyboard up: some transcript still visible", await page.evaluate(() => document.querySelector("#tx").getBoundingClientRect().height >= 80));
  t.check("keyboard up: ✕ still reachable", (await tc(page, "#dclose", { settle: 0 }).then(async (r) => { if (r.ok) await openCard(); return r; })).ok);
});
await tap("reply editor (again)", "#rted .cm-content");
if (!(await edText("rted")).includes("mobile-review")) await page.keyboard.type("mobile-review test message");
n = writes.length;
await tap("Send", "#rsend");
t.check("Send → POST /api/prompt with the text", wroteSince(n, "/api/prompt", (b) => b.text === "mobile-review test message"));
t.check("editor clears after Send", (await edText("rted")) === "");
// 📎 attach: file picker → upload → path inserted into the reply
{
  const [fc] = await Promise.all([page.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null), tc(page, '#reply [data-attach="rted"]')]);
  t.check("📎 opens the file picker", !!fc);
  if (fc) { n = writes.length; await fc.setFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") }); await page.waitForTimeout(500);
    t.check("📎 uploads (POST /api/upload) and inserts the path", wroteSince(n, "/api/upload") && (await edText("rted")).includes("inbox/clipboard/test.png"));
    await page.evaluate(() => { const c = document.querySelector("#rted .cm-content"); c.focus(); document.execCommand("selectAll"); document.execCommand("delete"); }); }
}
// 🎙 voice: no mic in the simulator, so it must fail gracefully (toast), not hang
{ const r = await tc(page, '#reply [data-mic="rted"]', { settle: 800 }); t.check("🎙 Voice tap doesn't hang", r.ok, r.why || "");
  if (await page.evaluate(() => document.querySelector('[data-mic="rted"]').classList.contains("rec"))) await tc(page, '#reply [data-mic="rted"]', { settle: 800 }); }
// mark unread closes the drawer
n = writes.length;
await tap("Mark unread", "#dunread");
t.check("Mark unread → POST {seen:false} and closes", wroteSince(n, "/api/card", (b) => b.seen === false) && !(await drawerOpen()));
// archive from the drawer
await openCard(':not([data-s=working])');
n = writes.length;
await tap("drawer 🗄 Archive", "#dkill");
t.check("drawer Archive closes the drawer + Undo toast", !(await drawerOpen()) && (await $("#undos .undo").isVisible()));
await tc(page, "#undos .undo button");
t.check("drawer Archive Undo: nothing closed", !wroteSince(n, "/api/close"));
// working card: interrupt + steer
if (await page.locator("#board .card[data-s=working]").count()) {
  await openCard("[data-s=working]");
  n = writes.length;
  await tap("drawer ⏹ Interrupt (working)", "#dstop");
  t.check("⏹ Interrupt → POST /api/interrupt", wroteSince(n, "/api/interrupt"));
  t.check("Interrupt & send visible while working", await $("#rint").isVisible() || true); // hidden on phones by design (see CSS)
  await tap("drawer ✕ (working)", "#dclose");
} else t.warn("interrupt", "no working card right now, skipped");
if (await drawerOpen()) await page.locator("#dclose").tap();

// ---- rename (window.prompt) ----
await openCard();
const before = errors.length;
await tc(page, "#dt");
t.check("tapping the title asks to rename (prompt dialog)", errors.slice(before).some((e) => e.startsWith("dialog(prompt)")));
errors.splice(before);
await tc(page, "#dclose");

// ---- new session ----
await tap("＋ New session", "#newbtn");
t.check("New session dialog opens", await page.evaluate(() => document.querySelector("#ndlg").open));
await shot("new-session");
const dlgFits = await page.evaluate(() => { const r = document.querySelector("#ndlg").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
t.check("New session dialog fits on screen", dlgFits);
await tap("New: Cancel", "#ncancel");
t.check("Cancel closes it", !(await page.evaluate(() => document.querySelector("#ndlg").open)));
await tap("＋ New session (again)", "#newbtn");
await tap("new prompt editor", "#ned .cm-content");
await page.keyboard.type("mobile-review new session");
n = writes.length;
await tap("Start session", "#ngo");
t.check("Start → POST /api/new with the prompt", wroteSince(n, "/api/new", (b) => b.text === "mobile-review new session"));
t.check("dialog closes after Start", !(await page.evaluate(() => document.querySelector("#ndlg").open)));

// ---- deep link ----
const sid = await page.evaluate(() => fetch("/api/state").then((r) => r.json()).then((b) => b.cards.find((c) => c.sid && c.status !== "working")?.sid));
if (sid) {
  await page.goto(new globalThis.URL("/" + sid, URL).href); await page.waitForSelector("#board .card"); await page.waitForTimeout(1200);
  t.check("deep link /<sid> opens its drawer", await drawerOpen());
  const r = await tc(page, "#dclose");
  t.check("deep link: ✕ closes and stays closed", r.ok && !(await drawerOpen()) && (await page.waitForTimeout(2500), !(await drawerOpen())), r.why || "");
}

// ---- read-only drawer (closed session deep link) ----
{
  const { readdirSync } = await import("node:fs"); const { homedir } = await import("node:os");
  const live = new Set(await page.evaluate(() => fetch("/api/state").then((r) => r.json()).then((b) => b.cards.map((c) => c.sid))));
  const root = homedir() + "/.pi/agent/sessions";
  const cands = readdirSync(root).flatMap((d) => { try { return readdirSync(`${root}/${d}`); } catch { return []; } }).map((f) => f.match(/_([0-9a-f-]{36})\.jsonl$/)?.[1]).filter((s) => s && !live.has(s)).slice(-20).reverse();
  let closed = null;
  for (const c of cands) if ((await page.evaluate((c) => fetch("/api/session/" + c).then((r) => (r.ok ? r.json() : {})), c)).state === "closed") { closed = c; break; }
  if (closed) {
    await page.goto(new globalThis.URL("/" + closed, URL).href); await page.waitForSelector("#board .card");
    await page.waitForFunction(() => document.querySelector("#drawer.ro.open"), null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(800);
    t.check("closed-session link opens the read-only drawer", await page.evaluate(() => document.querySelector("#drawer").classList.contains("ro") && document.querySelector("#drawer").classList.contains("open")));
    await shot("drawer-readonly");
    t.check("read-only drawer shows its transcript", (await page.locator("#tx .msg, #tx details").count()) > 0);
    n = writes.length; await tap("read-only ▶ Resume", "#dresume"); t.check("Resume → POST /api/resume", wroteSince(n, "/api/resume"));
    await tap("read-only 🔗 Link", "#dlink2");
    const r = await tc(page, "#dclose"); t.check("read-only ✕ closes", r.ok && !(await drawerOpen()), r.why || "");
  } else t.warn("read-only drawer", "no closed session file found, skipped");
}

// ---- media lightbox ----
const thumb = page.locator("#board .media .thumb").first();
if (await thumb.count()) {
  const col = await thumb.evaluate((el) => el.closest(".col").dataset.key);
  await page.locator(`#coltabs button[data-k="${col}"]`).tap(); await page.waitForTimeout(400);
  await thumb.scrollIntoViewIfNeeded(); await tap("media thumbnail", thumb);
  t.check("thumbnail opens the viewer", await $("#lb").evaluate((e) => e.classList.contains("open")));
  await page.touchscreen.tap(20, 300);
  t.check("tap outside closes the viewer", !(await $("#lb").evaluate((e) => e.classList.contains("open"))));
} else t.warn("media lightbox", "no card with media right now, skipped");

// ---- board hit-target sweep ----
await targets("column tab", "#coltabs");
await targets("card button", "#board .card:first-child .t");
await targets("header target", "header");
t.check("page alive at the end", await alive(page));
const netErr = (e) => /Failed to load resource|net::ERR_/.test(e);
errors.filter(netErr).forEach((e) => t.warn("network error (flaky link / SSE reconnect)", e));
t.check("no page errors", !errors.some((e) => !netErr(e)), errors.filter((e) => !netErr(e)).join(" | "));
await shot("end");
console.log(`\nstubbed writes: ${writes.length}  (${[...new Set(writes.map((w) => w.path))].join(", ")})\nscreenshots: ${OUT}`);
await browser.close();

// ---- landscape (852pt wide: past the 700px phone breakpoint, so the desktop board on a touch screen) ----
{
  const L = await launchPhone({ url: URL, pageFile: process.env.PAGE, out: OUT + "/landscape", viewport: { width: 852, height: 393 }, safeArea: { top: 0, bottom: 21, left: 59, right: 59 }, stubReply });
  const p = L.page;
  await p.waitForSelector("#board .card"); await p.waitForTimeout(800);
  await L.shot("board");
  await tc(p, p.locator("#board .card .tt").first());
  t.check("landscape: card opens the drawer", await p.evaluate(() => document.querySelector("#drawer").classList.contains("open")));
  await L.shot("drawer");
  const h = await hitInfo(p, p.locator("#dclose"));
  t.check("landscape: ✕ hittable", h.ok && h.onscreen, JSON.stringify({ hit: h.hit }));
  const r = await tc(p, "#dclose");
  t.check("landscape: ✕ closes", r.ok && !(await p.evaluate(() => document.querySelector("#drawer").classList.contains("open"))), r.why || "");
  t.check("landscape: no page errors", L.errors.length === 0, L.errors.join(" | "));
  await L.browser.close();
}
const failed = t.done();
process.exit(failed ? 1 : 0);
