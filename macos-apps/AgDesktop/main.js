// Ag Desktop: a thin Electron shell around Ag Chat (http://ag:7376/chat), served live by ag-board, so edits to
// chat.html only need a reload (Cmd+R). The shell exists for what a PWA can't do: a system-wide shortcut.
// Ctrl+Cmd+A shows and focuses the window, or hides it when it's already in front.
const { app, BrowserWindow, globalShortcut, ipcMain, Notification, shell, session, screen } = require("electron");
const fs = require("fs");
const path = require("path");

const ORIGIN = "http://ag:7376";
const START = `${ORIGIN}/chat`;
const HOTKEY = "Control+Command+A";
const inApp = (url) => url === START || url.startsWith(`${START}/`) || url.startsWith(`${START}?`) || url.startsWith(`${START}#`);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let quitting = false;
const boundsFile = () => path.join(app.getPath("userData"), "bounds.json");
function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
    const area = screen.getDisplayMatching(b).workArea; // drop bounds from a display that's gone
    if (b.x < area.x + area.width && b.y < area.y + area.height && b.x + b.width > area.x && b.y + b.height > area.y) return b;
  } catch {}
  return { width: 1280, height: 860 };
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
    titleBarStyle: "hidden", // with titleBarOverlay, the page sees window-controls-overlay, like the installed PWA
    titleBarOverlay: true,
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: { spellcheck: true, preload: path.join(__dirname, "preload.js"), contextIsolation: false },
  });
  win.once("ready-to-show", () => win.show());
  const load = () => win.loadURL(START).catch(() => {});
  // ag-board unreachable (asleep, offline, restarting): retry until it's back.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (isMain && code !== -3) setTimeout(() => win && !win.isDestroyed() && load(), 3000);
  });
  // Ag Chat stays in the window; everything else (AG Dash, links in answers, window.open) opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inApp(url)) { win.loadURL(url); return { action: "deny" }; }
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
  win.on("closed", () => { win = null; });
  load();
}

app.on("second-instance", show);
// The page's notifications, shown natively (see preload.js). Kept referenced until closed so they aren't
// garbage-collected (which would drop their click). A tag replaces the earlier notification with the same tag.
const notes = new Map(); // page id → { n, tag }
// Each notification and what macOS did with it goes to ~/Library/Logs/Ag Desktop/notifications.log (kept small).
const logFile = () => path.join(app.getPath("logs"), "notifications.log");
function noteLog(...parts) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    if (fs.existsSync(logFile()) && fs.statSync(logFile()).size > 256 * 1024) fs.renameSync(logFile(), `${logFile()}.1`);
    fs.appendFileSync(logFile(), `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch {}
}
ipcMain.on("ag-desktop:notify", (e, { id, title, body, tag, silent }) => {
  const send = (type) => { noteLog(type, JSON.stringify(title)); if (!e.sender.isDestroyed()) e.sender.send("ag-desktop:notify-event", { id, type }); };
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
ipcMain.on("ag-desktop:notify-close", (_e, id) => { notes.get(id)?.n.close(); notes.delete(id); });

// Pinned alerts: every pinned session whose agent isn't working (done, idle or blocked; not waiting) keeps a
// notification up until it's addressed, so pinned items stay in motion. Polls AG Dash's /api/pinned. The alert
// is withdrawn the moment the agent works again, the card is marked waiting, or it's unpinned. Clicking it
// opens that chat here. If it's dismissed and the agent is still stalled RESURFACE_MS later, it comes back.
// Ag Desktop's notification style is Alerts (NSUserNotificationAlertStyle, see install.sh), so they stay on
// screen, and it's an allowed app in Do Not Disturb, so they break through it.
const PINNED_URL = `${ORIGIN}/api/pinned`;
const RESURFACE_MS = 10 * 60_000;
const pinned = new Map(); // tab → { key, n, postedAt, shown }
function postPinned(card, key) {
  const a = { key, n: new Notification({ title: card.title, subtitle: card.workspace, body: card.body, closeButtonText: "Later" }), postedAt: Date.now(), shown: true };
  a.n.on("click", () => {
    show();
    if (card.sid) win?.loadURL(`${START}/${card.sid}`).catch(() => {});
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
  } catch { return; } // AG Dash unreachable: keep what's showing
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
app.on("activate", show);
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  // Mic (dictation, voice messages), notifications, clipboard: allowed for Ag only.
  const ok = (wc, origin) => (origin || wc?.getURL() || "").startsWith(ORIGIN);
  session.defaultSession.setPermissionRequestHandler((wc, _perm, cb, details) => cb(ok(wc, details?.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc, _perm, origin) => ok(wc, origin));
  app.setLoginItemSettings({ openAtLogin: true });
  if (!globalShortcut.register(HOTKEY, toggle)) console.error(`Ag Desktop: ${HOTKEY} is taken by another app`);
  createWindow();
  pollPinned();
  setInterval(pollPinned, 5000);
});
