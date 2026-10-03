// The ag-dash Mac app: ag-dash (http://ag:7376/chat, served live, so chat.html edits only need Cmd+R) in its own
// window, plus what a web page can't do: system-wide keys and quick entry. Loaded live from the ag checkout by the
// app shell (../shell/main.js), so edits here need only a relaunch (install.sh does it). The keys are the user's
// keys ag-rules for app ag-dash-app (hotkeys.js): by default Ctrl+Cmd+A shows/hides the window, both Command keys
// open the quick entry box (entry.js), and with Shift too a screenshot of the screen under the mouse is attached.
// agdash://entry also opens the box. When ag-dash can't be reached, the window shows why and offers the fix (offline.js).
const { app, BrowserWindow, desktopCapturer, ipcMain, Notification, shell, session, screen } = require("electron");
const fs = require("fs");
const path = require("path");
const entry = require("./entry");
const hotkeys = require("./hotkeys");
const offline = require("./offline");

const ORIGIN = "http://ag:7376";
const START = `${ORIGIN}/chat`;
// Session links (`ag link`: http://ag:7376/<session id>, /t/<tab>) count as in-app too: ag-dash redirects them to /chat/….
const inApp = (url) => url === START || url.startsWith(`${START}/`) || url.startsWith(`${START}?`) || url.startsWith(`${START}#`)
  || /^http:\/\/ag:7376\/(?:[0-9a-f-]{36}|t\/[^/?#]+)(?:\/live)?\/?(?:[?#].*)?$/.test(url);

if (!app.requestSingleInstanceLock()) app.quit();

// Crashes and hangs → ag-telemetry (http://ag:7378): one JSON line in its spool, shipped by `ag-telemetry flush`
// right away (and by the every-minute collector if the host is unreachable). Electron minidumps land in
// ~/Library/Application Support/ag-dash/Crashpad, which the collector also reports.
const TELEMETRY_DIR = path.join(require("os").homedir(), ".local/state/ag-telemetry");
function telemetry(kind, severity, message, detail) {
  try {
    fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    const ev = { id: require("crypto").randomUUID(), at: new Date().toISOString(), machine: require("os").hostname().split(".")[0], source: "ag-dash app", kind, severity, message, detail: { version: app.getVersion(), ...detail } };
    fs.appendFileSync(path.join(TELEMETRY_DIR, "spool.jsonl"), JSON.stringify(ev) + "\n");
    require("child_process").spawn(path.join(require("os").homedir(), ".local/bin/ag-telemetry"), ["flush"], { detached: true, stdio: "ignore", env: { ...process.env, PATH: `${require("os").homedir()}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` } }).unref();
  } catch {}
}
require("electron").crashReporter.start({ uploadToServer: false });
process.on("uncaughtExceptionMonitor", (err) => telemetry("exception", "crash", `main process: ${err?.message ?? err}`, { stack: String(err?.stack ?? "").slice(0, 4000) }));
app.on("render-process-gone", (_e, wc, d) => {
  if (d.reason !== "clean-exit") telemetry("crash", "crash", `renderer gone: ${d.reason} (exit ${d.exitCode})`, { url: wc?.getURL?.(), ...d });
});
app.on("child-process-gone", (_e, d) => {
  if (d.reason !== "clean-exit" && (d.reason !== "killed" || d.type === "GPU")) telemetry("crash", d.type === "GPU" ? "error" : "crash", `${d.type} process gone: ${d.reason} (exit ${d.exitCode})`, d);
});

let win = null;
let quitting = false;
let launchedForEntry = false; // started by agdash://entry: keep the main window hidden until asked for
let entryAt = 0; // last agdash://entry: the activation that comes with it mustn't raise the main window
const boundsFile = () => path.join(app.getPath("userData"), "bounds.json");
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    const area = screen.getDisplayMatching(b).workArea; // drop bounds from a display that's gone
    if (b.x < area.x + area.width && b.y < area.y + area.height && b.x + b.width > area.x && b.y + b.height > area.y) return b;
  } catch {}
  return { width: 1280, height: 860 };
}

// Open an ag-dash URL: inside the running page when it's loaded (its router: instant, keeps its state and cache),
// otherwise as a full load.
function goTo(url) {
  if (!win) return;
  const load = () => win?.loadURL(url).catch(() => {});
  if (!inApp(win.webContents.getURL())) return load();
  win.webContents.executeJavaScript(`typeof go === "function" ? (go(${JSON.stringify(url.slice(ORIGIN.length))}), true) : false`).then((ok) => { if (!ok) load(); }, load);
}

function show() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  win.focus();
}

function toggle() {
  if (win && win.isVisible() && win.isFocused()) { win.hide(); app.hide(); } else show();
}

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 420,
    minHeight: 400,
    backgroundColor: "#212121",
    titleBarStyle: "hidden", // with titleBarOverlay, the page sees window-controls-overlay (its header becomes the title bar)
    titleBarOverlay: true,
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { spellcheck: true, preload: path.join(__dirname, "preload.js"), contextIsolation: false },
  });
  win.once("ready-to-show", () => { if (!launchedForEntry) win.show(); });
  win.webContents.on("unresponsive", () => telemetry("hang", "warn", "window unresponsive", { url: win?.webContents.getURL() }));
  const load = () => win.loadURL(START).catch(() => {});
  // ag-dash unreachable (Tailscale down here, ag-engine down, ag-dash restarting) or its proxy answering 5xx: a
  // restart takes a second or two, so retry quietly a few times first; then show the offline page (offline.js:
  // why, and a button for the local fixes), which reloads the chat when ag-dash is back. Once loaded, the page
  // rides out restarts itself (saved board and transcripts, outbox, reconnecting event stream).
  let quickRetries = 0;
  const failed = (url) => {
    if (!offline.isActive() && quickRetries++ < 4) setTimeout(() => win?.loadURL(inApp(url) ? url : START).catch(() => {}), 1000);
    else offline.show();
  };
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) failed(url);
  });
  win.webContents.on("did-navigate", (_e, url, status) => {
    if (status >= 500 && url.startsWith(ORIGIN)) failed(url);
  });
  win.webContents.on("did-finish-load", () => { if (inApp(win.webContents.getURL())) quickRetries = 0; });
  // ag-dash chat stays in the window; everything else (the board, links in answers, window.open) opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inApp(url)) { goTo(url); return { action: "deny" }; }
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!inApp(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  // Closing the window hides it (Mac convention); Cmd+Q quits.
  win.on("close", (e) => {
    try { fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds())); } catch {}
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  win.on("closed", () => { win = null; offline.stop(); });
  load();
}
offline.setup({ origin: ORIGIN, start: START, getWin: () => win });

// agdash:// links (may arrive before the app is ready, when they launch it).
app.on("open-url", (e, url) => {
  e.preventDefault();
  if (url.startsWith("agdash://entry")) {
    entryAt = Date.now();
    if (!app.isReady()) launchedForEntry = true;
    app.whenReady().then(() => entry.open(url));
  }
  else app.whenReady().then(() => {
    show();
    // agdash://chat/<session id | t/<tab>>?h=<nonce>: ag-dash's hand-off page for session links clicked in a
    // browser. Acknowledging the nonce tells that page the app has it, so it can go back to where the link was.
    const m = url.match(/^agdash:\/\/chat\/((?:[0-9a-f-]{36}|t\/[\w:%.-]+))\/?(?:\?h=([\w-]+))?$/);
    if (m) win?.loadURL(`${START}/${m[1]}`).catch(() => {});
    if (m?.[2]) fetch(`${ORIGIN}/api/handoff?h=${m[2]}`, { method: "POST" }).catch(() => {});
  });
});
entry.setup(() => win);
app.on("second-instance", show);
// The page's notifications, shown natively (see preload.js). Kept referenced until closed so they aren't
// garbage-collected (which would drop their click). A tag replaces the earlier notification with the same tag.
const notes = new Map(); // page id → { n, tag }
// Each notification and what macOS did with it goes to ~/Library/Logs/ag-dash/notifications.log (kept small).
const logFile = () => path.join(app.getPath("logs"), "notifications.log");
function noteLog(...parts) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    if (fs.existsSync(logFile()) && fs.statSync(logFile()).size > 256 * 1024) fs.renameSync(logFile(), `${logFile()}.1`);
    fs.appendFileSync(logFile(), `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch {}
}
ipcMain.on("ag-dash:notify", (e, { id, title, body, tag, silent }) => {
  const send = (type) => { noteLog(type, JSON.stringify(title)); if (!e.sender.isDestroyed()) e.sender.send("ag-dash:notify-event", { id, type }); };
  noteLog("request", JSON.stringify(title), `focused=${!!win?.isFocused()}`);
  if (tag) for (const [k, v] of notes) if (v.tag === tag) { v.n.close(); notes.delete(k); }
  const n = new Notification({ title, body, silent });
  notes.set(id, { n, tag });
  n.on("show", () => send("show"));
  n.on("click", () => { show(); send("click"); notes.delete(id); });
  n.on("close", () => { send("close"); notes.delete(id); });
  n.on("failed", (_e, err) => { noteLog("failed", err); send("error"); notes.delete(id); });
  n.show();
});
ipcMain.on("ag-dash:notify-close", (_e, id) => { notes.get(id)?.n.close(); notes.delete(id); });

// Pinned alerts: every pinned session whose agent isn't working (done, idle or blocked; not waiting) keeps a
// notification up until it's addressed, so pinned items stay in motion. Polls ag-dash's /api/pinned. The alert
// is withdrawn the moment the agent works again, the card is marked waiting, or it's unpinned. Clicking it
// opens that chat here. If it's dismissed and the agent is still stalled RESURFACE_MS later, it comes back.
// ag-dash's notification style is Alerts (NSUserNotificationAlertStyle, see install.sh), so they stay on
// screen, and it's an allowed app in Do Not Disturb, so they break through it.
const PINNED_URL = `${ORIGIN}/api/pinned`;
const RESURFACE_MS = 10 * 60_000;
const pinned = new Map(); // tab → { key, n, postedAt, shown }
function postPinned(card, key) {
  const a = { key, n: new Notification({ title: card.title, body: card.body, closeButtonText: "Later" }), postedAt: Date.now(), shown: true };
  a.n.on("click", () => {
    show();
    if (card.sid) goTo(`${START}/${card.sid}`);
    a.shown = false;
  });
  a.n.on("close", () => { a.shown = false; });
  a.n.on("failed", (_e, err) => noteLog("pinned-failed", err));
  a.n.show();
  noteLog("pinned", JSON.stringify(card.title));
  return a;
}
async function pollPinned() {
  let cards;
  try {
    const r = await fetch(PINNED_URL, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return;
    cards = await r.json();
  } catch { return; } // ag-dash unreachable: keep what's showing
  const live = new Set();
  for (const card of cards) {
    live.add(card.tab);
    const key = `${card.status}@${card.since}`; // a new stall is a new alert; the same stall keeps its alert
    const a = pinned.get(card.tab);
    if (!a || a.key !== key || (!a.shown && Date.now() - a.postedAt >= RESURFACE_MS)) {
      a?.n.close();
      pinned.set(card.tab, postPinned(card, key));
    }
  }
  for (const [tab, a] of pinned) if (!live.has(tab)) { a.n.close(); pinned.delete(tab); }
}
app.on("activate", () => { if (Date.now() - entryAt > 1500) show(); });
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => hotkeys.stop());

// Quick entry from a key chord: with a screenshot, grab the screen under the mouse first (so the box isn't in it).
// Needs Screen Recording for ag-dash (macOS asks the first time). The front app's name goes along as context.
async function quickEntry(withShot) {
  if (entry.isOpen()) return entry.close(); // the chord again closes it
  const q = new URLSearchParams();
  if (withShot) {
    try {
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: d.size });
      const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
      if (src && !src.thumbnail.isEmpty()) {
        const dir = path.join(require("os").homedir(), "Library/Caches/ag-inbox");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${Math.random().toString(16).slice(2, 8)}.jpg`);
        fs.writeFileSync(file, src.thumbnail.toJPEG(80));
        q.set("shot", file);
        sweepShots(dir);
      }
    } catch (e) { console.error(`ag-dash: screenshot failed: ${e.message}`); }
    try {
      const out = require("child_process").execFileSync("/usr/bin/lsappinfo", ["info", "-only", "name", "front"], { encoding: "utf8", timeout: 2000 });
      q.set("app", out.match(/"LSDisplayName"="([^"]*)"/)?.[1] || "");
    } catch {}
  }
  entryAt = Date.now();
  entry.open(`agdash://entry?${q}`);
}
// Screenshots never sent (closed with Esc) are cleared after a day.
function sweepShots(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (f.endsWith(".jpg") && Date.now() - fs.statSync(p).mtimeMs > 86_400_000) fs.rmSync(p); } catch {}
  }
}

app.whenReady().then(() => {
  // Mic (dictation, voice messages), notifications, clipboard: allowed for Ag only.
  const ok = (wc, origin) => (origin || wc?.getURL() || "").startsWith(ORIGIN);
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb, details) => cb(ok(wc, details?.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, _perm, origin) => ok(wc, origin));
  app.setLoginItemSettings({ openAtLogin: true });
  app.setAsDefaultProtocolClient("agdash");
  hotkeys.setup({ toggle, quickEntry: () => quickEntry(false), quickEntryWithShot: () => quickEntry(true) }, (m) => console.error(`ag-dash: ${m}`));
  entry.setKeys(() => hotkeys.scoped("entry"));
  createWindow();
  pollPinned();
  setInterval(pollPinned, 5000);
});
