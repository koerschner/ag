// Runs in Ag Chat's page before its scripts (contextIsolation off: the page is our own, served by ag-board).
// Electron's web Notification fails on macOS here (it fires "error" and nothing shows), while main-process
// notifications work. So the page's Notification is replaced by one that main.js shows natively; it keeps the
// web API the page uses (permission, requestPermission, onclick/onshow/onclose/onerror, close, tag), and a click
// also brings the window back before the page's own handler opens the chat. macOS still asks once for the app.
const { ipcRenderer } = require("electron");
const live = new Map();
let seq = 0;
class AgNotification extends EventTarget {
  constructor(title, options = {}) {
    super();
    this.title = String(title);
    this.body = options.body || "";
    this.tag = options.tag || "";
    this.id = ++seq;
    for (const t of ["click", "show", "close", "error"]) this[`on${t}`] = null;
    live.set(this.id, this);
    ipcRenderer.send("ag-desktop:notify", { id: this.id, title: this.title, body: this.body, tag: this.tag, silent: !!options.silent });
  }
  close() { ipcRenderer.send("ag-desktop:notify-close", this.id); }
  static get permission() { return "granted"; }
  static requestPermission(cb) { cb?.("granted"); return Promise.resolve("granted"); }
}
ipcRenderer.on("ag-desktop:notify-event", (_e, { id, type }) => {
  const n = live.get(id);
  if (!n) return;
  const ev = new Event(type);
  n.dispatchEvent(ev);
  n[`on${type}`]?.call(n, ev);
  if (type === "close" || type === "error") live.delete(id);
});
window.Notification = AgNotification;
// Ag Desktop raises pinned alerts itself (main.js), so the page doesn't notify for pinned chats too.
window.agDesktop = { pinnedAlerts: true };
