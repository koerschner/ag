// ag-dash chat (http://ag:7376/chat) on a simulated iPhone: swipe the sidebar, sheets, long-press menus, keyboard.
// Every write is stubbed. node agdash-chat.mjs (URL=..., SCHEME=light, OUT=dir for screenshots). Exit 1 on any FAIL.
import { launchPhone, alive, withKeyboard, kbVisible, sweep } from "./phone.mjs";
const OUT = process.env.OUT || "/tmp/mobile-review/agdash-chat";
const BASE = process.env.URL || "http://127.0.0.1:7376";
const { browser, page, ctx, errors, writes, shot } = await launchPhone({ url: `${BASE}/chat`, out: OUT });
let fails = 0; const _R = (n, v) => { if (!v) fails++; console.log((v ? "PASS " : "FAIL ") + n); };
await page.emulateMedia({ colorScheme: process.env.SCHEME || "dark" });
const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
async function drag(x0, y0, x1, y1, steps = 8, ms = 16) { await touch("touchStart", x0, y0); for (let i = 1; i <= steps; i++) { await touch("touchMove", x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(ms); } await touch("touchEnd"); await page.waitForTimeout(450); }
async function press(sel, ms = 650) {
  const loc = page.locator(sel).first(); await loc.scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  const b = await loc.boundingBox(), vh = page.viewportSize().height;
  const top = Math.max(b.y, 120), bot = Math.min(b.y + b.height, vh - 160); // the part on screen, clear of the header and composer
  await touch("touchStart", b.x + Math.min(40, b.width / 2), (top + bot) / 2); await page.waitForTimeout(ms); await touch("touchEnd"); await page.waitForTimeout(700);
}
const open = () => page.evaluate(() => !document.querySelector("#app").classList.contains("collapsed"));
const R = _R;
await page.waitForSelector("#sideScroll .item", { state: "attached" }); await page.waitForTimeout(500);
await shot("home"); await page.waitForTimeout(300);
await drag(30, 400, 300, 410); R("swipe right opens sidebar", await open());
await shot("sidebar"); await page.waitForTimeout(300);
await drag(300, 400, 40, 405); R("swipe left closes", !(await open()));
await drag(200, 400, 230, 600); R("vertical drag doesn't open", !(await open()));
await page.locator(".top [data-do=toggle]").tap(); await page.waitForTimeout(400); R("☰ opens", await open());
await page.locator(".scrim").tap({ position: { x: 370, y: 300 } }); await page.waitForTimeout(400); R("scrim closes", !(await open()));
await page.locator(".top [data-do=toggle]").tap(); await page.waitForTimeout(400);
await page.locator(".side .msearch").tap(); await page.waitForTimeout(300); R("search opens", await page.locator(".back.open .modal").count() === 1); await shot("search");
await page.locator(".back.open [data-do=closeModal]").tap(); await page.waitForTimeout(200);
await press("#sideScroll [data-sec=chats] .item"); R("long-press chat → sheet", await page.locator(".pop.sheet").count() === 1); await shot("chat-sheet");
R("sheet still open after lift", await page.locator(".pop.sheet").count() === 1);
const sb = await page.locator(".pop.sheet").boundingBox();
await drag(200, sb.y + 20, 200, sb.y + 220); R("swipe down closes sheet", await page.locator(".pop.sheet").count() === 0);
R("still in sidebar (long-press didn't navigate)", (await open()) && new URL(page.url()).pathname === "/chat");
await press("#sideScroll [data-sec=chats] .item"); R("long-press chat again → sheet", await page.locator(".pop.sheet").count() === 1);
await page.locator(".sheet-back").tap({ position: { x: 200, y: 100 } }); await page.waitForTimeout(200); R("backdrop closes sheet", await page.locator(".pop").count() === 0 || console.log("  still open:", await page.evaluate(() => [document.querySelector(".pop")?.innerText, document.elementFromPoint(200, 100)?.className])));
await page.locator("#sideScroll [data-sec=chats] .item:not(:has(.spin))").first().tap(); await page.waitForTimeout(2500);
R("tap chat opens it", /\/chat\/./.test(page.url()) && !(await open()));
await shot("chat");
await page.locator("#picker").tap(); await page.waitForTimeout(300); R("picker is a sheet", await page.locator(".pop.sheet").count() === 1); await shot("picker");
await page.locator(".sheet-back").tap({ position: { x: 200, y: 60 } }); await page.waitForTimeout(200);
await press(".thread .a .md >> nth=-1"); R("long-press answer → message sheet", await page.locator(".pop.sheet [data-msg=copy]").count() === 1); await shot("msg-sheet");
await page.locator(".pop [data-msg=select]").tap(); await page.waitForTimeout(200);
R("select text selects", (await page.evaluate(() => getSelection().toString().length)) > 0);
await page.locator(".top #dotsBtn").tap(); await page.waitForTimeout(300); await shot("dots");
await page.locator(".sheet-back").tap({ position: { x: 200, y: 60 } });
await withKeyboard(page, async () => { await page.locator("#input").tap(); R("composer visible with keyboard", await kbVisible(page, "#input")); await shot("keyboard"); });
await page.goto(`${BASE}/chat?view=you`); await page.waitForTimeout(1500); await shot("list");
await press("#rows .crow"); R("long-press list row → sheet", await page.locator(".pop.sheet").count() === 1);
const tiny = (await sweep(page, ".app")).filter((x) => x.tiny).map((x) => x.label);
console.log("tiny:", tiny.slice(0, 10));
console.log("writes", writes.map((w) => w.path), "errors", errors, "alive", await alive(page));
await browser.close();
process.exit(fails ? 1 : 0);
