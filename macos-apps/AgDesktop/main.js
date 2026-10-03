// Ag Desktop: a thin Electron shell around Ag Chat (http://ag:7376/chat), served live by ag-board, so edits to
// chat.html only need a reload (Cmd+R). The shell exists for what a PWA can't do: a system-wide shortcut.
// Ctrl+Cmd+A shows and focuses the window, or hides it when it's already in front.
const { app, BrowserWindow, globalShortcut, shell, session, screen } = require("electron");
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
    webPreferences: { spellcheck: true },
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
});
