// ag-rules, the keys hook for ag-dash chat and ag-dash: keyboard shortcuts come from the user's keys ag-rules
// (~/ag/ag-rules/<name>.md + .json keymap, merged by `ag-rules keys <app>`, served at /api/ag-rules/keys?app=).
// The page supplies named actions and `when` predicates; the keymap says which keys run which action, where.
//
// Binding: { keys: "shift+cmd+o" | [...], do?: "action", when?: "predicate", label?: "…", group?: "…" }
//   keys: modifiers cmd (⌘ or Ctrl), alt, shift, then a key: a letter/digit/symbol or enter, esc, backspace,
//         delete, space, up, down, left, right, "\\". Symbols typed with Shift (?) match regardless of Shift.
//   do:   an action the page defines; it may return false for "not mine" (the key falls through) or "stop"
//         (handled, without preventDefault).
//         No `do` = documentation only (the browser's own behavior, e.g. ⇧Enter for a new line).
//   when: a predicate the page defines (default: always). First matching binding that handles the key wins.
// Bindings with a label are listed in the page's shortcuts sheet, under their group.
"use strict";
(() => {
  const NAMES = { esc: "escape", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", space: " " };
  const SHOW = { cmd: "⌘", alt: "⌥", shift: "⇧", enter: "Enter", esc: "Esc", backspace: "⌫", delete: "⌦", space: "Space", up: "↑", down: "↓", left: "←", right: "→" };
  function parse(combo) {
    const parts = combo.split("+").filter((p, i, a) => p || i === a.length - 1);
    const key = (parts.pop() || "+").toLowerCase();
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    return { key: NAMES[key] ?? key, cmd: mods.has("cmd"), alt: mods.has("alt"), shift: mods.has("shift"), raw: key };
  }
  const isLetter = (k) => /^[a-z]$/.test(k);
  const isSymbol = (k) => k.length === 1 && !/[a-z0-9 ]/.test(k);
  function matches(e, b) {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd !== b.cmd || e.altKey !== b.alt) return false;
    const key = e.key.toLowerCase();
    // ⌥ changes e.key on a Mac (⌥V types √), so also match the physical key.
    const code = (e.code || "").replace(/^Key|^Digit/, "").toLowerCase();
    const codeKey = { backslash: "\\", slash: "/", period: ".", comma: "," }[code] ?? code;
    if (key !== b.key && !(e.altKey && codeKey === b.key) && !(isLetter(b.key) && codeKey === b.key && cmd)) return false;
    if (isSymbol(b.key) && !b.shift) return true; // ? / . — Shift may be needed to type them
    return e.shiftKey === b.shift;
  }
  function kbd(combo) {
    const b = parse(combo);
    const k = SHOW[b.raw] ?? (b.raw.length === 1 ? b.raw.toUpperCase() : b.raw);
    return [b.shift && "shift", b.alt && "alt", b.cmd && "cmd"].filter(Boolean).map((m) => `<kbd>${SHOW[m]}</kbd>`).join("") + `<kbd>${k.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</kbd>`;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  window.agKeys = {
    bindings: [],
    async load(app) {
      try {
        const r = await fetch(`/api/ag-rules/keys?app=${encodeURIComponent(app)}`);
        if (r.ok) this.use((await r.json()).bindings);
      } catch {}
      return this.bindings;
    },
    // Use these bindings directly (pages that get their keymap another way, e.g. the Mac app's quick entry box).
    use(bindings) { this.bindings = (bindings || []).map((b) => ({ ...b, parsed: [].concat(b.keys).map(parse) })); return this.bindings; },
    // Run the first binding that matches e, passes its `when` and whose action handles it. `only`: just the
    // bindings with that `when` (e.g. a text box's own keys); `skip`: never these `when`s.
    dispatch(e, actions, when = {}, { only, skip = [] } = {}) {
      if (e.isComposing) return false;
      for (const b of this.bindings) {
        if (!b.do || (only !== undefined && b.when !== only) || skip.includes(b.when)) continue;
        if (!b.parsed.some((p) => matches(e, p))) continue;
        if (b.when && when[b.when] && !when[b.when](e)) continue;
        const f = actions[b.do];
        if (!f) { console.warn(`ag-rules: no action ${b.do}`); continue; }
        const r = f(e);
        if (r === false) continue;
        if (r !== "stop") e.preventDefault(); // "stop": handled, but leave the browser's default alone
        return true;
      }
      return false;
    },
    // The shortcuts sheet: one row per labeled binding, grouped. Rows render with `row(label, keysHtml)`.
    sheet(row, header) {
      let html = "", group = null;
      for (const b of this.bindings) {
        if (!b.label) continue;
        if (b.group && b.group !== group) { group = b.group; html += header(esc(group)); }
        html += row(esc(b.label), [].concat(b.keys).map(kbd).join(" ") + (b.note ? ` · ${esc(b.note)}` : ""));
      }
      return html;
    },
  };
})();
