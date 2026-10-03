// Quick entry: a floating prompt box that starts a new Ag session through the ag inbox (http://ag:7373/prompt).
// Opened by agdesktop://entry[?shot=<jpg>&app=<name>&window=<title>], which Hammerspoon's ag_inbox.lua sends when
// both Command keys are pressed together (holding Shift too grabs the screen first and passes it as `shot`; a
// screenshot sent this way is always attached). Enter sends, Cmd+Enter sends and pins the session, Esc closes.
const { app, BrowserWindow, clipboard, ipcMain, nativeImage, Notification, screen, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const INBOX = "http://ag:7373/prompt";
const WIDTH = 820;

let entry = null;
let ready = null; // resolves once entry.html has loaded
let current = {}; // this capture: shot, app, window, annotated, watcher, returnTo
let centerY = 0; // vertical center of the box on its display; it stays centered as it grows
let getMain = () => null;

function create() {
  entry = new BrowserWindow({
    width: WIDTH, height: 120, show: false, frame: false, transparent: true, resizable: false, movable: true,
    fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: true,
    type: "panel", vibrancy: "popover", visualEffectState: "active", roundedCorners: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "entry-preload.js"), contextIsolation: true, sandbox: true },
  });
  entry.setAlwaysOnTop(true, "floating");
  entry.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ready = entry.loadFile(path.join(__dirname, "entry.html"));
  entry.on("closed", () => { entry = null; });
}

const thumb = (file) => {
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? null : img.resize({ height: 160 }).toDataURL();
};

// Centered on the display under the mouse; resizing keeps it centered vertically.
function place(height) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  centerY = area.y + area.height / 2;
  entry.setBounds({ x: Math.round(area.x + (area.width - WIDTH) / 2), y: Math.round(centerY - height / 2), width: WIDTH, height });
}

async function open(url) {
  if (!entry) create();
  await ready;
  stopWatching();
  const q = new URL(url).searchParams;
  const shot = q.get("shot") && fs.existsSync(q.get("shot")) ? q.get("shot") : null;
  const main = getMain();
  current = { shot, app: q.get("app") || "", window: q.get("window") || "", returnTo: main?.isFocused() ? "main" : "app" };
  entry.webContents.send("entry:open", { thumb: shot ? thumb(shot) : null });
  place(entry.getBounds().height);
  entry.show();
  app.focus({ steal: true });
  entry.focus();
  entry.webContents.focus();
  entry.webContents.send("entry:focus");
}

// Back to where you were: the Ag window if you came from it, otherwise the previous app.
function close() {
  stopWatching();
  if (!entry?.isVisible()) return;
  entry.hide();
  if (current.returnTo === "main") getMain()?.focus();
  else if (!getMain()?.isFocused()) app.hide();
}

function stopWatching() {
  current.watcher?.close();
  current.watcher = null;
}

async function send({ text, pin, shot: keepShot }) {
  const { shot, app: appName, window: windowTitle } = current;
  close();
  const form = new FormData();
  form.append("text", text);
  if (pin) form.append("pin", "1");
  const file = keepShot && shot;
  if (file) {
    form.append("screenshot", new Blob([fs.readFileSync(file)], { type: "image/jpeg" }), path.basename(file));
    form.append("app", appName);
    form.append("window", windowTitle);
  }
  try {
    const res = await fetch(INBOX, { method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    if (shot) fs.rm(shot, { force: true }, () => {});
  } catch (e) {
    clipboard.writeText(text);
    new Notification({ title: "Ag: couldn't send", body: `${e.message}. Your prompt is on the clipboard.` }).show();
  }
}

// CleanShot's editor overwrites the file on Cmd+S; show the annotated version when it does.
function annotate() {
  const { shot } = current;
  if (!shot) return;
  if (!current.watcher) {
    let timer;
    current.watcher = fs.watch(shot, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const t = thumb(shot);
        if (!t || !entry) return;
        current.annotated = true;
        entry.webContents.send("entry:annotated", { thumb: t });
        entry.show();
        entry.focus();
      }, 300);
    });
  }
  shell.openExternal(`cleanshot://open-annotate?filepath=${encodeURIComponent(shot)}`);
}

function setup(mainWindow) {
  getMain = mainWindow;
  ipcMain.on("entry:send", (_e, msg) => send(msg));
  ipcMain.on("entry:cancel", close);
  ipcMain.on("entry:annotate", annotate);
  ipcMain.on("entry:resize", (_e, h) => {
    if (!entry || h <= 0) return;
    const b = entry.getBounds();
    entry.setBounds({ ...b, y: centerY ? Math.round(centerY - h / 2) : b.y, height: Math.round(h) });
  });
  app.whenReady().then(create); // prebuilt and hidden, so it opens instantly
}

module.exports = { setup, open };
