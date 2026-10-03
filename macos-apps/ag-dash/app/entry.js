// Quick entry: a floating prompt box that starts a new Ag session through the ag-inbox (http://ag:7373/prompt).
// Opened by agdash://entry[?shot=<jpg>&app=<name>&window=<title>], which main.js sends for the quick entry key chord
// (by default both Command keys; with Shift a screenshot is grabbed first and passed as `shot`, always attached).
// Images pasted into the box (Cmd+V, e.g. a CleanShot copy) are attached too, as `file`s with source=mac. Its keys
// are the keys ag-rules' `when: entry` bindings (by default Enter sends, Cmd+Enter sends and pins, Esc closes).
const { app, BrowserWindow, clipboard, ipcMain, nativeImage, Notification, screen, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const INBOX = "http://ag:7373/prompt";
const WIDTH = 820;

let entry = null;
let ready = null; // resolves once entry.html has loaded
let current = { pasted: [] }; // this capture: shot, app, window, annotated, watcher, returnTo, pasted (image files)
let centerY = 0; // vertical center of the box on its display; it stays centered as it grows
let getMain = () => null;
let getKeys = () => [];
function setKeys(fn) { getKeys = fn; }

function create() {
  entry = new BrowserWindow({
    width: WIDTH, height: 120, show: false, frame: false, transparent: true, resizable: false, movable: true,
    fullscreenable: false, minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: true,
    type: "panel", vibrancy: "popover", visualEffectState: "active", roundedCorners: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "entry-preload.js"), contextIsolation: true, sandbox: true },
  });
  entry.setAlwaysOnTop(true, "floating");
  entry.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); // else Electron hides the app from the Dock and ⌘Tab
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
  dropPasted();
  const q = new URL(url).searchParams;
  const shot = q.get("shot") && fs.existsSync(q.get("shot")) ? q.get("shot") : null;
  const main = getMain();
  current = { shot, app: q.get("app") || "", window: q.get("window") || "", returnTo: main?.isFocused() ? "main" : "app", pasted: [] };
  entry.webContents.send("entry:open", { thumb: shot ? thumb(shot) : null, keys: getKeys() });
  place(entry.getBounds().height);
  // A panel takes the keyboard without activating the app (Spotlight-style), so the main Ag window stays put.
  entry.show();
  entry.focus();
  entry.webContents.focus();
  entry.webContents.send("entry:focus");
}

// Back to where you were: the Ag window if you came from it, otherwise the previous app (never activated).
function close() {
  stopWatching();
  if (!entry?.isVisible()) return;
  entry.hide();
  if (current.returnTo === "main") getMain()?.focus();
}

function stopWatching() {
  current.watcher?.close();
  current.watcher = null;
}

function dropPasted(keep = []) {
  for (const f of current.pasted || []) if (!keep.includes(f)) fs.rm(f, { force: true }, () => {});
  current.pasted = current.pasted?.filter((f) => keep.includes(f)) || [];
}

// A paste with images: the renderer passes the image files it found in the paste ({type, data}); if it found none
// (some apps put only raw image data on the pasteboard), read the clipboard image here. Returns [{file, thumb}].
let pasteN = 0;
function paste(_e, items) {
  const imgs = (items || []).map((it) => nativeImage.createFromBuffer(Buffer.from(it.data))).filter((i) => !i.isEmpty());
  if (!imgs.length) { const img = clipboard.readImage(); if (!img.isEmpty()) imgs.push(img); }
  return imgs.map((img) => {
    const file = path.join(os.tmpdir(), `ag-paste-${process.pid}-${Date.now()}-${++pasteN}.png`);
    fs.writeFileSync(file, img.toPNG());
    current.pasted.push(file);
    return { file, thumb: img.resize({ height: 160 }).toDataURL() };
  });
}

// Every capture goes into the outbox first (userData/outbox/<time>-<id>/: meta.json + its images), then out to the
// ag-inbox; it's deleted only once the ag-inbox has it. If Ag can't be reached (ag-engine restarting, Tailscale or
// the network down) it stays there and is retried every RETRY_MS, oldest first, with the same id each time, so the
// ag-inbox never starts one twice. Nothing is lost: a notification says it's queued, another when it went out.
const RETRY_MS = 5000;
const outboxDir = () => path.join(app.getPath("userData"), "outbox");
function send({ text, pin, shot: keepShot, pasted = [] }) {
  const { shot, app: appName, window: windowTitle } = current;
  const files = current.pasted.filter((f) => pasted.includes(f));
  dropPasted(files);
  current.pasted = [];
  close();
  const id = require("crypto").randomUUID();
  const dir = path.join(outboxDir(), `${Date.now()}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const move = (from, name) => { try { fs.renameSync(from, path.join(dir, name)); } catch { fs.copyFileSync(from, path.join(dir, name)); fs.rmSync(from, { force: true }); } return name; };
  const meta = { id, text, pin: !!pin, files: files.map((f, i) => move(f, `pasted-${i + 1}.png`)), shot: null, app: appName, window: windowTitle, at: Date.now() };
  if (keepShot && shot) meta.shot = move(shot, path.basename(shot));
  else if (shot) fs.rm(shot, { force: true }, () => {});
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  flush();
}
let flushing = false, retryT = null;
async function flush() {
  if (flushing) return;
  flushing = true;
  clearTimeout(retryT);
  try {
    let dirs = [];
    try { dirs = fs.readdirSync(outboxDir()).sort(); } catch {}
    for (const d of dirs) {
      const dir = path.join(outboxDir(), d);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")); } catch { fs.rmSync(dir, { recursive: true, force: true }); continue; }
      const form = new FormData();
      form.append("id", meta.id);
      form.append("text", meta.text);
      form.append("source", "mac");
      if (meta.pin) form.append("pin", "1");
      for (const f of meta.files) form.append("file", new Blob([fs.readFileSync(path.join(dir, f))], { type: "image/png" }), "pasted.png");
      if (meta.shot) {
        form.append("screenshot", new Blob([fs.readFileSync(path.join(dir, meta.shot))], { type: "image/jpeg" }), meta.shot);
        form.append("app", meta.app || "");
        form.append("window", meta.window || "");
      }
      try {
        const res = await fetch(INBOX, { method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(60_000) });
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (res.status >= 400) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).trim()}`), { final: true });
      } catch (e) {
        if (e.final) { // the ag-inbox refused it: no point retrying; hand the text back
          fs.rmSync(dir, { recursive: true, force: true });
          clipboard.writeText(meta.text);
          new Notification({ title: "Ag: couldn't send", body: `${e.message}. Your prompt is on the clipboard.` }).show();
          continue;
        }
        if (!meta.queued) {
          meta.queued = true;
          fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
          new Notification({ title: "Ag isn't reachable", body: "Your prompt is saved and will be sent as soon as Ag is back." }).show();
        }
        retryT = setTimeout(flush, RETRY_MS);
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      if (meta.queued) new Notification({ title: "Ag: queued prompt sent", body: meta.text.slice(0, 120) || "Your capture" }).show();
    }
  } finally { flushing = false; }
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
  ipcMain.handle("entry:paste", paste);
  ipcMain.on("entry:resize", (_e, h) => {
    if (!entry || h <= 0) return;
    const b = entry.getBounds();
    entry.setBounds({ ...b, y: centerY ? Math.round(centerY - h / 2) : b.y, height: Math.round(h) });
  });
  app.whenReady().then(() => { create(); flush(); }); // prebuilt and hidden, so it opens instantly; queued captures go out
}

const isOpen = () => !!entry?.isVisible();
module.exports = { setup, open, close, isOpen, setKeys };
