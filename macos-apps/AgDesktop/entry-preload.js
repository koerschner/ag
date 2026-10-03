// The quick entry window's bridge to main.js (contextIsolation on: entry.html only gets these calls).
const { contextBridge, ipcRenderer } = require("electron");
const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, data) => fn(data || {}));
contextBridge.exposeInMainWorld("agEntry", {
  send: (msg) => ipcRenderer.send("entry:send", msg),
  cancel: () => ipcRenderer.send("entry:cancel"),
  annotate: () => ipcRenderer.send("entry:annotate"),
  resize: (height) => ipcRenderer.send("entry:resize", height),
  onOpen: on("entry:open"),
  onAnnotated: on("entry:annotated"),
  onFocus: on("entry:focus"),
});
