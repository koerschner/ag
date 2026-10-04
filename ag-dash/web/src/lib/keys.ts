// Keyboard shortcuts come from the user's keys ag-rule ag-dash-keys (~/.ag/ag-rules/ag-dash-keys/keys.json, merged by
// `ag-rules keys ag-dash`, served at /api/ag-rules/keys?app=ag-dash). The page supplies named actions and `when`
// predicates (keyboard.ts); the keymap says which keys run which action, where.
//
// Binding: { keys: "shift+cmd+o" | [...], do?: "action", when?: "predicate", label?, group?, note? }
//   keys: modifiers cmd (⌘ or Ctrl), alt, shift, then a key: a letter/digit/symbol or enter, esc, backspace,
//         delete, space, up, down, left, right, "\\". Symbols typed with Shift (?) match regardless of Shift.
//   do:   an action; it may return false ("not mine": the key falls through) or "stop" (handled, but leave the
//         browser's default alone). No `do` = documentation only (e.g. ⇧Enter for a new line).
//   when: a predicate (default: always). The first matching binding whose action handles the key wins.
export type Binding = { keys: string | string[]; do?: string; when?: string; label?: string; group?: string; note?: string };
type Parsed = { key: string; cmd: boolean; alt: boolean; shift: boolean; raw: string };
export type Action = (e: KeyboardEvent) => void | false | "stop";

const NAMES: Record<string, string> = { esc: "escape", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", space: " " };
const SHOW: Record<string, string> = { cmd: "⌘", alt: "⌥", shift: "⇧", enter: "Enter", esc: "Esc", backspace: "⌫", delete: "⌦", space: "Space", up: "↑", down: "↓", left: "←", right: "→" };

export function parse(combo: string): Parsed {
	const parts = combo.split("+").filter((p, i, a) => p || i === a.length - 1);
	const key = (parts.pop() || "+").toLowerCase();
	const mods = new Set(parts.map((p) => p.toLowerCase()));
	return { key: NAMES[key] ?? key, cmd: mods.has("cmd"), alt: mods.has("alt"), shift: mods.has("shift"), raw: key };
}
const isLetter = (k: string) => /^[a-z]$/.test(k);
const isSymbol = (k: string) => k.length === 1 && !/[a-z0-9 ]/.test(k);
export function matches(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "key" | "code">, b: Parsed) {
	const cmd = e.metaKey || e.ctrlKey;
	if (cmd !== b.cmd || e.altKey !== b.alt) return false;
	const key = e.key.toLowerCase();
	// ⌥ changes e.key on a Mac (⌥V types √), so also match the physical key.
	const code = (e.code || "").replace(/^Key|^Digit/, "").toLowerCase();
	const codeKey = ({ backslash: "\\", slash: "/", period: ".", comma: "," } as Record<string, string>)[code] ?? code;
	if (key !== b.key && !(e.altKey && codeKey === b.key) && !(isLetter(b.key) && codeKey === b.key && cmd)) return false;
	if (isSymbol(b.key) && !b.shift) return true; // ? / . — Shift may be needed to type them
	return e.shiftKey === b.shift;
}
// Key caps for the shortcuts sheet: ["⇧", "⌘", "O"].
export function caps(combo: string): string[] {
	const b = parse(combo);
	const k = SHOW[b.raw] ?? (b.raw.length === 1 ? b.raw.toUpperCase() : b.raw);
	return [...[b.shift && "shift", b.alt && "alt", b.cmd && "cmd"].filter(Boolean).map((m) => SHOW[m as string]), k];
}

let bindings: (Binding & { parsed: Parsed[] })[] = [];
export const use = (list: Binding[]) => (bindings = (list || []).map((b) => ({ ...b, parsed: ([] as string[]).concat(b.keys).map(parse) })));
export const all = () => bindings;
// The keymap from the last visit is used at once (keys work the moment the page shows), then refreshed.
export async function load(app: string) {
	const k = `agchat.keys.${app}`;
	try {
		const saved = localStorage.getItem(k);
		if (saved) use(JSON.parse(saved));
	} catch {}
	try {
		const r = await fetch(`/api/ag-rules/keys?app=${encodeURIComponent(app)}`);
		if (r.ok) {
			const list = (await r.json()).bindings;
			use(list);
			localStorage.setItem(k, JSON.stringify(list));
		}
	} catch {}
	return bindings;
}
export function dispatch(e: KeyboardEvent, actions: Record<string, Action>, when: Record<string, (e: KeyboardEvent) => boolean>, opts: { only?: string; skip?: string[] } = {}) {
	if (e.isComposing) return false;
	for (const b of bindings) {
		if (!b.do || (opts.only !== undefined && b.when !== opts.only) || opts.skip?.includes(b.when ?? "")) continue;
		if (!b.parsed.some((p) => matches(e, p))) continue;
		if (b.when && when[b.when] && !when[b.when](e)) continue;
		const f = actions[b.do];
		if (!f) continue;
		const r = f(e);
		if (r === false) continue;
		if (r !== "stop") e.preventDefault();
		return true;
	}
	return false;
}
