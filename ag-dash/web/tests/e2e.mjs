// ag-dash end to end, on a desktop browser, against a passive test instance of this checkout's server and build
// (port 7386, its own state dir, so the real ag-dash is untouched). It starts one throwaway chat (it says it's a test
// and only answers "pong"), exercises it, and archives it at the end. Needs Playwright: the mobile-review skill's
// scripts/setup.sh. Run: node ag-dash/web/tests/e2e.mjs (from the ag checkout; build first). Exit 1 on any failure.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(join(homedir(), ".local/share/mobile-review/node_modules/playwright/index.mjs"));

const AG = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PORT = 7386, base = `http://127.0.0.1:${PORT}`, STATE = "/tmp/ag-dash-e2e";
mkdirSync(`${STATE}/shots`, { recursive: true });
const real = join(homedir(), ".local/state/ag-dash/state.json");
if (existsSync(real) && !existsSync(`${STATE}/state.json`)) cpSync(real, `${STATE}/state.json`);
let server;
const startServer = async () => {
	server = spawn("bun", [join(AG, "bin/dot-local/bin/ag-dash")], { env: { ...process.env, AG_DASH_PORT: String(PORT), AG_DASH_PASSIVE: "1", AG_DASH_STATE_DIR: STATE }, stdio: "ignore" });
	for (let i = 0; i < 100; i++) {
		if (await fetch(`${base}/api/state`).then((r) => r.ok, () => false)) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error("test server didn't start");
};
await startServer();

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
let fails = 0;
const step = async (name, f) => {
	const t = Date.now();
	try {
		await f();
		console.log("PASS", name, `${Date.now() - t}ms`);
	} catch (e) {
		fails++;
		console.log("FAIL", name, String(e).split("\n")[0]);
		await p.screenshot({ path: `${STATE}/shots/fail-${name.replace(/\W+/g, "_")}.png` });
	}
};
const MARK = `e2e${Date.now().toString(36)}`;
const sel = () => p.locator(".side .item[aria-current=page] .lbl");
await p.goto(`${base}/chat`);
await p.waitForSelector(".side .item");
await p.waitForTimeout(500);
let url = "";
await step("new chat starts and opens", async () => {
	await p.locator("textarea#input").fill(`${MARK}: this is an automated ag-dash test. Reply with just the word pong, nothing else, and don't use any tools.`);
	await p.keyboard.press("Enter");
	await p.waitForSelector("text=Starting a new chat", { timeout: 3000 });
	await p.waitForURL(/\/chat\/[0-9a-f-]{36}$/, { timeout: 60000 });
	url = p.url();
});
await step("answer arrives", () => p.waitForSelector(".thread .a .md", { timeout: 120000 }));
await step("reply shows at once and lands", async () => {
	await p.keyboard.press("r");
	await p.locator("textarea#input").fill("Say pong once more.");
	const t = Date.now();
	await p.keyboard.press("Enter");
	await p.waitForSelector(".bubble.pending", { timeout: 1000 });
	if (Date.now() - t > 300) throw new Error("pending bubble slow");
	await p.waitForFunction(() => [...document.querySelectorAll(".thread .u .bubble:not(.pending)")].some((b) => b.textContent.includes("Say pong once more")), null, { timeout: 60000 });
	await p.waitForFunction(() => !document.querySelector(".bubble.pending"), null, { timeout: 10000 });
});
const inPinned = () => p.evaluate(() => { const r = [...document.querySelectorAll(".vrow")]; const s = r.findIndex((x) => x.querySelector(".item[aria-current=page]")); const c = r.findIndex((x) => x.textContent.trim() === "Chats"); return s >= 0 && s < c; });
await step("pin shows at once and doesn't flicker back (⇧⌘P)", async () => {
	await p.keyboard.press("Shift+Control+P");
	await p.waitForFunction(() => { const r = [...document.querySelectorAll(".vrow")]; const s = r.findIndex((x) => x.querySelector(".item[aria-current=page]")); return s >= 0 && s < r.findIndex((x) => x.textContent.trim() === "Chats"); }, null, { timeout: 300 });
	for (let i = 0; i < 10; i++) { await p.waitForTimeout(250); if (!(await inPinned())) throw new Error("flickered back"); }
	await p.keyboard.press("Shift+Control+P");
	await p.waitForTimeout(300);
});
await step("rename inline", async () => {
	await p.locator(".side .item[aria-current=page]").click({ button: "right" });
	await p.locator(".pop .mi", { hasText: "Rename" }).click();
	await p.locator(".side input.rename").fill(`${MARK} renamed`);
	await p.locator(".side input.rename").press("Enter");
	await p.waitForFunction((m) => document.querySelector(".side .item[aria-current=page] .lbl")?.textContent.includes(m), `${MARK} renamed`, { timeout: 300 });
	await p.waitForTimeout(2500);
	if (!(await sel().textContent())?.includes("renamed")) throw new Error("rename reverted");
});
await step("mark waiting and back", async () => {
	await p.locator("#dotsBtn").click();
	await p.locator(".pop .mi", { hasText: "Mark waiting for" }).click();
	await p.waitForSelector(".side .item[aria-current=page] .dot.waiting", { timeout: 500 });
	await p.waitForTimeout(1500);
	await p.locator("#dotsBtn").click();
	await p.locator(".pop .mi", { hasText: "Not waiting" }).click();
	await p.waitForFunction(() => !document.querySelector(".side .item[aria-current=page] .dot.waiting"), null, { timeout: 500 });
});
await step("search (⌘K) finds it; sent text didn't come back as a draft", async () => {
	await p.goto(`${base}/chat`);
	await p.waitForSelector(".side .item");
	if (await p.locator("textarea#input").inputValue()) throw new Error("the sent text came back as a draft");
	await p.keyboard.press("Control+K");
	await p.locator(".modal-h input").fill(MARK);
	await p.keyboard.press("Enter");
	await p.waitForURL(url, { timeout: 2000 });
});
await step("j/k move between chats", async () => {
	await p.keyboard.press("j");
	await p.waitForFunction((u) => location.href !== u, url, { timeout: 1000 });
	await p.keyboard.press("k");
	await p.waitForURL(url, { timeout: 1000 });
});
await step("rows hold still under the pointer", async () => {
	const order = () => p.evaluate(() => [...document.querySelectorAll(".side .item")].map((a) => a.dataset.tab).join());
	await p.locator(".side .item").nth(3).hover();
	const before = await order();
	await p.waitForTimeout(3000);
	if ((await order()) !== before) throw new Error("rows moved under the pointer");
	await p.mouse.move(800, 400);
});
await step("copy last response (⇧⌘C)", async () => {
	await p.keyboard.press("Shift+Control+C");
	await p.waitForSelector(".toast.show", { timeout: 500 });
});
await step("shortcuts sheet (?)", async () => {
	await p.keyboard.press("Shift+?");
	await p.waitForSelector(".keys-tbl td", { timeout: 1000 });
	await p.keyboard.press("Escape");
	await p.waitForFunction(() => !document.querySelector(".keys-tbl"), null, { timeout: 500 });
});
await step("archive, undo", async () => {
	await p.keyboard.press("Shift+Control+Backspace");
	await p.waitForFunction((m) => ![...document.querySelectorAll(".side .item .lbl")].some((l) => l.textContent.includes(m)), MARK, { timeout: 300 });
	await p.locator(".toast button", { hasText: "Undo" }).click();
	await p.waitForFunction((m) => [...document.querySelectorAll(".side .item .lbl")].some((l) => l.textContent.includes(m)), MARK, { timeout: 500 });
	await p.waitForURL(url, { timeout: 1000 });
});
await step("rides out a server restart", async () => {
	server.kill("SIGTERM");
	await p.waitForTimeout(3500);
	if (!(await p.locator(".net").count())) throw new Error("no reconnecting pill");
	await startServer();
	await p.waitForTimeout(3000);
	if (await p.locator(".net").count()) throw new Error("still reconnecting");
	if (!(await p.locator(".thread .a .md").count())) throw new Error("thread gone");
});
await step("scrolled up, nothing moves (the window slides, older pages load)", async () => {
	// Any open chat with more history than one page; skipped when there's none.
	const st = await (await fetch(`${base}/api/state`)).json();
	let long = null;
	for (const c of st.cards) if (c.sid && (await fetch(`${base}/api/transcript?sid=${c.sid}&limit=150`)).headers.get("x-more") === "1") (long = c.sid);
	if (!long) return console.log("     (no long chat open; skipped)");
	await p.evaluate((u) => window.go(u), `/chat/${long}`);
	await p.waitForSelector(".thread .turn");
	await p.waitForTimeout(1000);
	await p.evaluate(() => document.querySelector("#scroll").scrollTo(0, 0));
	await p.waitForTimeout(1500);
	await p.evaluate(() => { const s = document.querySelector("#scroll"); s.scrollTo(0, s.scrollHeight / 2); });
	await p.waitForTimeout(400);
	const before = await p.evaluate(() => { const s = document.querySelector("#scroll"); const top = s.getBoundingClientRect().top; const el = [...document.querySelectorAll("[data-turn]")].find((e) => e.getBoundingClientRect().bottom > top + 50); return { key: el.dataset.turn, y: Math.round(el.getBoundingClientRect().top - top) }; });
	await p.evaluate(() => { const { useTx, useUi } = window.agDash; const ref = `sid=${useUi.getState().route.sid}`; const e = useTx.getState().entries[ref]; const extra = e.items.slice(-15).map((x, i) => ({ ...x, k: `e2e${i}` })); useTx.setState({ entries: { ...useTx.getState().entries, [ref]: { ...e, items: [...e.items.slice(15), ...extra] } } }); });
	await p.waitForTimeout(300);
	const y = await p.evaluate((k) => { const s = document.querySelector("#scroll"); const el = document.querySelector(`[data-turn="${CSS.escape(k)}"]`); return el ? Math.round(el.getBoundingClientRect().top - s.getBoundingClientRect().top) : null; }, before.key);
	if (y === null || Math.abs(y - before.y) > 2) throw new Error(`moved from ${before.y} to ${y}`);
	// Loading an older page above keeps the view still (and loads one page, not the whole history).
	await p.evaluate((u) => window.go(u), "/chat");
	await p.evaluate((u) => window.go(u), `/chat/${long}`);
	await p.waitForTimeout(1500);
	const n0 = await p.locator("[data-turn]").count();
	await p.evaluate(() => document.querySelector("#scroll").scrollTo(0, 0));
	await p.waitForTimeout(1500);
	const top = await p.evaluate(() => document.querySelector("#scroll").scrollTop);
	if (top < 200) throw new Error(`older page load jumped to the top (scrollTop ${top}, turns ${n0} → ${await p.locator("[data-turn]").count()})`);
	await p.goto(url);
	await p.waitForSelector(".thread .a .md");
});
await step("archive for real", async () => {
	await p.keyboard.press("Shift+Control+Backspace");
	await p.waitForTimeout(7500);
	const st = await (await fetch(`${base}/api/state`)).json();
	if (st.cards.some((c) => c.sid === url.split("/").pop())) throw new Error("still open");
});
console.log("page errors", errs);
await b.close();
server.kill("SIGTERM");
process.exit(fails || errs.length ? 1 : 0);
