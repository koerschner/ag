// Page errors → ag-telemetry (http://ag:7378) via ag-dash's /api/telemetry: uncaught errors and unhandled rejections
// in ag-dash and its chat view (browser, phone, the Mac app). Loaded first in <head>; at most 20 reports per page load,
// each distinct message once.
(() => {
  const seen = new Set();
  const page = location.pathname.startsWith("/chat") ? "chat" : "board";
  const send = (message, stack) => {
    message = String(message || "unknown error").slice(0, 500);
    if (seen.size >= 20 || seen.has(message)) return;
    seen.add(message);
    const body = JSON.stringify({ message, stack: String(stack || "").slice(0, 4000), url: location.href, page });
    try { navigator.sendBeacon?.("/api/telemetry", new Blob([body], { type: "application/json" })) || fetch("/api/telemetry", { method: "POST", body, keepalive: true }); } catch {}
  };
  addEventListener("error", (e) => { if (e.error || e.message) send(e.message || e.error, e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`); });
  addEventListener("unhandledrejection", (e) => send(`Unhandled rejection: ${e.reason?.message ?? e.reason}`, e.reason?.stack));
})();
