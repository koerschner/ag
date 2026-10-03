// ag-dash's system-wide keys, from the keys ag-rules for app ag-dash-app (`ag-rules keys ag-dash-app`; yours are in
// ~/.ag/ag-rules/*/). Two kinds of binding:
//   - a normal shortcut (ctrl+cmd+a): registered with Electron's globalShortcut;
//   - a modifier-only chord (lcmd+rcmd, shift+lcmd+rcmd): Electron can't register those, so a keyboard listener
//     (uiohook-napi, bundled in the app shell; needs Accessibility for ag-dash) watches the modifiers. A chord fires
//     once per press, when its last modifier goes down with exactly those modifiers held (left/right as named;
//     plain cmd/shift/alt/ctrl = either side) and no other key pressed; the most specific match wins.
// Actions are named by the binding's `do` (main.js supplies them). The rules are re-read when they change.
const { globalShortcut, systemPreferences } = require("electron");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AG_RULES = path.join(os.homedir(), ".local/bin/ag-rules");
const ACCEL = { ctrl: "Control", cmd: "Command", alt: "Option", opt: "Option", shift: "Shift" };
// uiohook keycodes → [kind, side]
const MODS = { 3675: ["cmd", "l"], 3676: ["cmd", "r"], 42: ["shift", "l"], 54: ["shift", "r"], 56: ["alt", "l"], 3640: ["alt", "r"], 29: ["ctrl", "l"], 3613: ["ctrl", "r"] };
const TOKEN = /^([lr]?)(cmd|shift|alt|opt|ctrl)$/;

let bindings = [];
let actions = {};
// Everything is also logged to ~/.local/state/ag-dash-hotkeys.log: the app runs headless from launchd, so stderr is lost.
const LOG = path.join(os.homedir(), ".local/state/ag-dash-hotkeys.log");
let logger = console.error;
const log = (m) => { logger(m); try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch {} };

function load() {
  try {
    bindings = JSON.parse(execFileSync(AG_RULES, ["keys", "ag-dash-app"], { encoding: "utf8", timeout: 5000 })).bindings || [];
  } catch (e) {
    log(`ag-rules: ${e.message}`);
    bindings = [];
  }
  return bindings;
}

// A binding's keys as a chord: [{kind, side}] if every part is a modifier, else null.
function chordOf(keys) {
  const parts = keys.split("+").map((p) => p.match(TOKEN));
  if (parts.some((m) => !m)) return null;
  return parts.map((m) => ({ kind: m[2] === "opt" ? "alt" : m[2], side: m[1] }));
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  for (const b of bindings) {
    if (!b.do || b.when || !actions[b.do]) continue;
    for (const k of [].concat(b.keys)) {
      if (chordOf(k)) continue;
      const accel = k.split("+").map((p) => ACCEL[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("+");
      try {
        if (!globalShortcut.register(accel, () => actions[b.do]())) log(`${accel} is taken by another app`);
      } catch (e) { log(`can't register ${accel}: ${e.message}`); }
    }
  }
}

// ---- modifier-only chords ----
const down = new Set(); // "cmd:l", "shift:r", …
let fired = false, otherKey = false, hook = null;
// Touch ~/.local/state/ag-dash-keylog (and relaunch) to log every modifier and keydown the hook sees.
const keylog = fs.existsSync(path.join(os.homedir(), ".local/state/ag-dash-keylog"));
function chordMatches(chord) {
  const kinds = new Set([...down].map((d) => d.split(":")[0]));
  const want = new Set(chord.map((c) => c.kind));
  if (kinds.size !== want.size || [...kinds].some((k) => !want.has(k))) return false;
  return chord.every((c) => (c.side ? down.has(`${c.kind}:${c.side}`) : down.has(`${c.kind}:l`) || down.has(`${c.kind}:r`)));
}
// macOS reports modifiers as flag changes, and uiohook decides press vs. release from the shared flag (any Command
// key), so releasing one Command key while the other is still held arrives as a second keydown. Modifiers never
// auto-repeat on macOS, so a keydown for a held modifier is its release. A modifier flag that's off on any event
// also clears that kind, in case a release is lost some other way.
const FLAG = { cmd: "metaKey", shift: "shiftKey", alt: "altKey", ctrl: "ctrlKey" };
function onKey(e, pressed) {
  if (keylog && (MODS[e.keycode] || pressed)) log(`key ${pressed ? "down" : "up"} ${e.keycode} meta=${e.metaKey} down=[${[...down]}] fired=${fired} other=${otherKey}`);
  for (const d of down) if (e[FLAG[d.split(":")[0]]] === false) down.delete(d);
  const m = MODS[e.keycode];
  if (!m) { if (pressed && down.size) otherKey = true; if (!down.size) fired = otherKey = false; return; }
  const id = `${m[0]}:${m[1]}`;
  // A keyup means the kind's flag cleared (every key of that kind is up), so drop both sides.
  if (!pressed) { for (const d of down) if (d.startsWith(`${m[0]}:`)) down.delete(d); }
  if (!pressed || down.has(id)) { down.delete(id); if (!down.size) fired = otherKey = false; return; }
  down.add(id);
  if (fired || otherKey) return;
  let best = null;
  for (const b of bindings) {
    if (!b.do || b.when || !actions[b.do]) continue;
    for (const k of [].concat(b.keys)) {
      const c = chordOf(k);
      if (c && chordMatches(c) && (!best || c.length > best.n)) best = { n: c.length, act: b.do };
    }
  }
  if (best) {
    fired = true;
    log(`chord → ${best.act}`);
    setImmediate(async () => { try { await actions[best.act](); } catch (e) { log(`${best.act} failed: ${e.stack || e}`); } });
  }
}
function startChords() {
  const wanted = bindings.some((b) => b.do && !b.when && [].concat(b.keys).some(chordOf));
  if (!wanted || hook) return;
  // Without Accessibility the hook starts but sees no keys; ask macOS (shows its prompt and lists the app).
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    log("no Accessibility permission: key chords won't fire; asking macOS (System Settings → Privacy & Security → Accessibility)");
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  try {
    const { uIOhook } = global.agDashRequire("uiohook-napi");
    uIOhook.on("keydown", (e) => onKey(e, true));
    uIOhook.on("keyup", (e) => onKey(e, false));
    uIOhook.start(); // asks macOS for Accessibility the first time
    hook = uIOhook;
    log(`key chords on (Accessibility: ${systemPreferences.isTrustedAccessibilityClient(false)})`);
  } catch (e) { log(`key chords unavailable (rebuild the app shell: macos-apps/ag-dash/install.sh): ${e.message}`); }
}

function apply() {
  load();
  log(`${bindings.length} key bindings loaded`);
  registerShortcuts();
  startChords();
}

// Re-read when a rule changes: the rule folders in `ag-rules path` (new rules) and the real folders of the
// ag-dash-app rules (~/.ag/ag-rules holds links into dotfiles, and watching a link doesn't see its target change).
function watch() {
  let t;
  const dirs = new Set();
  try { for (const d of execFileSync(AG_RULES, ["path"], { encoding: "utf8", timeout: 5000 }).split("\n")) if (d) dirs.add(d); } catch {}
  try {
    for (const r of JSON.parse(execFileSync(AG_RULES, ["list", "--json"], { encoding: "utf8", timeout: 5000 })))
      if (r.on === "keys" && r.app === "ag-dash-app" && r.path) dirs.add(path.dirname(fs.realpathSync(r.path)));
  } catch {}
  for (const d of dirs) {
    try { fs.watch(d, { recursive: true }, () => { clearTimeout(t); t = setTimeout(apply, 500); }); } catch {}
  }
}

function setup(acts, log_) {
  actions = acts;
  if (log_) logger = log_;
  apply();
  watch();
}

// The bindings for one `when` (e.g. the quick entry box's keys), for windows that dispatch keys themselves.
const scoped = (when) => bindings.filter((b) => b.when === when);
function stop() { globalShortcut.unregisterAll(); try { hook?.stop(); } catch {} }

module.exports = { setup, scoped, stop, reload: apply };
