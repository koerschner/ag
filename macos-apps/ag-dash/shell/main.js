// The ag-dash Mac app's bundle is only this loader (plus Electron and native modules): the app itself is
// ~/ag/macos-apps/ag-dash/app/main.js, loaded live from the ag checkout. So changing the app needs a relaunch,
// not a rebuild, and the bundle (whose code signature macOS ties the microphone, Accessibility and Screen
// Recording permissions to) stays the same. install.sh rebuilds only when this shell or its dependencies change.
const path = require("path");
const os = require("os");
const dir = process.env.AG_DASH_APP || path.join(os.homedir(), "ag/macos-apps/ag-dash/app");
global.agDashRequire = require; // the bundle's own modules (uiohook-napi), for code loaded from outside it
global.agDashShell = 2; // bump with the shell's capabilities; the app checks it
try {
  require(path.join(dir, "main.js"));
} catch (e) {
  const { app, dialog } = require("electron");
  app.whenReady().then(() => { dialog.showErrorBox("ag-dash couldn't start", `${dir}/main.js: ${e.stack || e}`); app.quit(); });
}
