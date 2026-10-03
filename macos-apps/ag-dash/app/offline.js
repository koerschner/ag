// When ag-dash can't be reached, the window shows offline.html instead of staying blank: why (Tailscale stopped on
// this Mac, Tailscale needs a sign-in, Tailscale not installed or not running, ag-engine not answering, ag-dash not
// running on it) and a button for the local fixes (Start Tailscale runs `tailscale up`; Open Tailscale for a
// sign-in or when it isn't running; Download Tailscale when it's missing) or Retry now. It keeps probing every 3 s
// and loads the chat again the moment ag-dash answers.
const { ipcMain, shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const TS = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const PROBE_MS = 3000;
let origin, start, getWin;
let active = false;
let timer = null;
let busy = ""; // what a fix is doing right now, shown on the page
let last = { state: "probing" };

const run = (file, args, timeout = 8000) => new Promise((resolve) =>
  execFile(file, args, { timeout, encoding: "utf8" }, (err, stdout, stderr) => resolve({ ok: !err, out: stdout || "", err: (stderr || err?.message || "").trim() })));

// Tailscale's BackendState: Running, Stopped, NeedsLogin, NoState, Starting; plus Missing (no app) and Unknown
// (the CLI can't talk to it: the app and its network extension aren't running).
async function tailscaleState() {
  if (!fs.existsSync(TS)) return "Missing";
  const r = await run(TS, ["status", "--json"], 4000);
  try { return JSON.parse(r.out).BackendState || "Unknown"; } catch { return "Unknown"; }
}
async function dashUp() {
  try { return (await fetch(`${origin}/api/pinned`, { signal: AbortSignal.timeout(4000) })).ok; } catch { return false; }
}
const engineUp = async () => (await run(TS, ["ping", "-c", "1", "--timeout", "3s", "ag-engine"], 7000)).ok;

// up | ts-<BackendState> | engine-down (Tailscale is up here, ag-engine doesn't answer) | dash-down (ag-engine
// answers, ag-dash on it doesn't).
async function diagnose() {
  if (await dashUp()) return { state: "up" };
  const ts = await tailscaleState();
  if (ts !== "Running") return { state: `ts-${ts}` };
  return { state: (await engineUp()) ? "dash-down" : "engine-down" };
}

function push() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send("ag-dash:offline", { ...last, busy });
}
async function probe() {
  clearTimeout(timer);
  timer = null;
  const win = getWin();
  if (!active || !win || win.isDestroyed()) return;
  const d = await diagnose();
  if (!active) return;
  if (d.state === "up") { stop(); win.loadURL(start).catch(() => {}); return; }
  last = { ...d, at: Date.now() };
  push();
  timer = setTimeout(probe, PROBE_MS);
}
// Called when the chat failed to load (or the proxy answered 5xx): show the offline page and start probing.
function show() {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  if (!active) {
    active = true;
    last = { state: "probing" };
    win.loadFile(path.join(__dirname, "offline.html")).catch(() => {});
  }
  probe();
}
function stop() { active = false; clearTimeout(timer); timer = null; busy = ""; }

function setup(opts) {
  ({ origin, start, getWin } = opts);
  ipcMain.handle("ag-dash:offline-status", () => ({ ...last, busy }));
  ipcMain.handle("ag-dash:offline-retry", () => { probe(); return ""; });
  // Returns "" or an error message for the page to show.
  ipcMain.handle("ag-dash:offline-fix", async (_e, what) => {
    let err = "";
    if (what === "tailscale-up") {
      busy = "Starting Tailscale…";
      push();
      const r = await run(TS, ["up"], 30_000);
      busy = "";
      if (!r.ok) err = r.err || "`tailscale up` failed";
    } else if (what === "open-tailscale") shell.openPath("/Applications/Tailscale.app");
    else if (what === "download-tailscale") shell.openExternal("https://tailscale.com/download/mac");
    probe();
    return err;
  });
}

module.exports = { setup, show, stop, isActive: () => active };
