// toolsum: deterministic one-line summaries of agent tool calls, plus the machine each call runs on.
//
//   summarize(name, args, { host }) → { sum?, hosts, rule? }
//
// `sum` is set only when the call is fully understood: every meaningful piece of a shell command matched a
// rule. Otherwise it is left out and callers show the raw command, so a summary never hides something the
// rules don't cover. `hosts` lists the machines the call touches (ag-mac, ag-client, ag-engine, ag-phone, mcp);
// `host` in the options is the session's own machine, used for anything that runs locally.
//
// Used by AG Dash (bin/ag-board) for tool rows, and by `toolsum` (check fixtures, measure coverage over real
// traces). The `toolsum-review` routine reads the coverage report daily and extends these rules; every
// change must keep `toolsum check` (fixtures.json) passing. Add a fixture for each new rule.

export type Summary = { sum?: string; hosts: string[]; rule?: string; miss?: string; parts?: { sum: string; host?: string }[] };
type Ctx = { host: string; fns?: Record<string, string>; miss?: string /* innermost piece that failed */; heredocs?: Record<string, string> };
type SegOut = { sum: string; host?: string; rule: string; parts?: { sum: string; host?: string }[] } | "noise" | null;

const HOME_RE = /^(?:\/home\/nathan|\/Users\/natkoersch|\/Users\/nathan|\$HOME|~)(?=\/|$)/;
const clip = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** ~/a/b/c/d/e.ts → ~/…/d/e.ts; keeps paths short but recognisable. */
export function shortPath(p: string): string {
	if (!p) return p;
	let s = p.replace(HOME_RE, "~").replace(/^['"]|['"]$/g, "");
	const parts = s.split("/");
	if (parts.length > 4) s = `${parts[0] === "" ? "" : `${parts[0]}/`}…/${parts.slice(-2).join("/")}`;
	return s;
}
const shortUrl = (u: string) => {
	const m = u.match(/^(?:https?:\/\/)?([^/?#\s'"]+)([^?#\s'"]*)/);
	if (!m) return clip(u, 50);
	const path = m[2] === "/" ? "" : m[2];
	return clip(`${m[1].replace(/^www\./, "")}${path}`, 50);
};

export function normHost(h: string): string {
	const x = h.replace(/^.*@/, "").replace(/\..*$/, "");
	if (/^(nathan-dev-client|ag-client|client)$/.test(x)) return "ag-client";
	if (/^(ag-mac|ag|mac)$/.test(x)) return "ag-mac";
	if (/^(ag-engine|engine)$/.test(x)) return "ag-engine";
	return x;
}

// ---------- shell parsing ----------

/** Drop heredoc bodies (cat > f <<'EOF' … EOF) and join the rest into one line with ";". Bodies go in `bodies` by tag. */
function stripHeredocs(cmd: string, bodies: Record<string, string> = {}): string {
	const lines = cmd.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		out.push(line);
		const tags = [...line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][\w]*)\1/g)].map((m) => m[2]);
		for (const tag of tags) {
			const body: string[] = [];
			while (i + 1 < lines.length && lines[i + 1].trim() !== tag) body.push(lines[++i]);
			bodies[tag] = body.join("\n");
			i++; // the terminator line
		}
	}
	return out.join(" ;\n");
}

/** Split at top-level ; && || | & and newlines, respecting quotes, $( ), ` `, and ( ) { } groups. */
export function splitShell(cmd: string): { seg: string; pipeAfter: boolean }[] {
	const out: { seg: string; pipeAfter: boolean }[] = [];
	let cur = "";
	let depth = 0;
	let q: string | null = null;
	const push = (pipe: boolean) => {
		const s = cur.trim();
		if (s) out.push({ seg: s, pipeAfter: pipe });
		cur = "";
	};
	for (let i = 0; i < cmd.length; i++) {
		const c = cmd[i];
		if (q) {
			cur += c;
			if (c === "\\" && q === '"' && i + 1 < cmd.length) cur += cmd[++i];
			else if (c === q) q = null;
			continue;
		}
		if (c === "\\" && i + 1 < cmd.length) {
			cur += c + cmd[++i];
			continue;
		}
		if (c === "'" || c === '"' || c === "`") {
			q = c;
			cur += c;
			continue;
		}
		if (c === "(" || (c === "{" && /\s|^$/.test(cmd[i + 1] ?? ""))) depth++;
		if ((c === ")" || c === "}") && depth > 0) depth--;
		if (depth === 0) {
			if (c === ";" || c === "\n") { push(false); continue; }
			if (c === "&" && cmd[i + 1] === "&") { push(false); i++; continue; }
			if (c === "|" && cmd[i + 1] === "|") { push(false); i++; continue; }
			if (c === "|") { push(true); continue; }
			if (c === "&" && cmd[i - 1] !== ">" && cmd[i + 1] !== ">") { push(false); continue; }
		}
		cur += c;
	}
	push(false);
	return out;
}

/** Shell words of one simple command, quotes removed (no expansion); $( ) and ( ) groups stay one word. */
export function words(seg: string): string[] {
	const out: string[] = [];
	let cur = "";
	let has = false;
	let q: string | null = null;
	let depth = 0;
	for (let i = 0; i < seg.length; i++) {
		const c = seg[i];
		if (q) {
			if (c === q) { q = null; if (depth) cur += c; }
			else if (c === "\\" && q === '"' && i + 1 < seg.length) {
				const n = seg[++i];
				cur += depth || !'$`"\\\n'.includes(n) ? c + n : n;
			} else cur += c;
			continue;
		}
		if (c === "\\" && i + 1 < seg.length) { cur += depth ? c + seg[++i] : seg[++i]; continue; }
		if (c === "'" || c === '"') { q = c; has = true; if (depth) cur += c; continue; }
		if (c === "(") depth++;
		if (c === ")" && depth > 0) depth--;
		if (/\s/.test(c) && depth === 0) {
			if (has || cur) out.push(cur);
			cur = "";
			has = false;
			continue;
		}
		cur += c;
	}
	if (has || cur) out.push(cur);
	return out;
}

/** Drop redirections (2>&1, >/dev/null, > file) from a word list. */
function dropRedirs(w: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < w.length; i++) {
		if (/^\d*>>?&?\d*$|^&>>?$|^<$/.test(w[i])) { if (!/&\d$/.test(w[i])) i++; continue; }
		if (/^\d*>>?&?\S+$|^&>\S+$|^<[^<(]\S*$/.test(w[i]) || /^<<-?/.test(w[i])) continue;
		out.push(w[i]);
	}
	return out;
}

/** Positional arguments, skipping flags (and the values of flags listed in `withVal`). */
function positional(args: string[], withVal: string[] = []): string[] {
	const out: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--") { out.push(...args.slice(i + 1)); break; }
		if (a.startsWith("-") && a.length > 1) {
			if (withVal.includes(a)) i++;
			continue;
		}
		out.push(a);
	}
	return out;
}
const paths = (ps: string[], n = 2) => (ps.length ? ps.slice(0, n).map(shortPath).join(", ") + (ps.length > n ? ` +${ps.length - n}` : "") : "");
const flagVal = (args: string[], ...names: string[]) => {
	for (let i = 0; i < args.length; i++) {
		for (const n of names) {
			if (args[i] === n) return args[i + 1];
			if (args[i].startsWith(`${n}=`)) return args[i].slice(n.length + 1);
		}
	}
};

// ---------- computer-use tasks ----------

const APPS = ["Telegram", "Discord", "Slack", "Gmail", "Google Calendar", "Google Meet", "Google Docs", "Google Sheets", "Google Drive", "Messages", "Mail", "Finder", "System Settings", "iPhone Mirroring", "1Password", "Roblox", "Minecraft", "Microsoft Teams", "Teams", "Spotify", "Xcode", "Notes", "Calendar", "Photos", "Zoom", "Read.ai", "Nessie", "Twitter", "DoorDash", "Squarespace", "Hetzner", "ChatGPT", "Codex", "Terminal", "Ghostty", "TestFlight", "App Store", "Preview", "TextEdit", "CleanShot", "Hammerspoon", "Linear", "GitHub", "Notion", "Figma", "YouTube", "LinkedIn", "Amazon", "Jump Desktop", "Tailscale", "Safari", "Google Chrome", "Chrome"];
const BROWSERS = new Set(["Google Chrome", "Chrome", "Safari"]);
const VERBS = "open|launch|click|tap|press|type|enter|search|find|go|navigate|visit|read|check|look|verify|confirm|create|make|send|reply|post|write|draft|compose|sign|log|take|capture|close|quit|download|install|update|upload|copy|select|choose|scroll|accept|allow|approve|deny|dismiss|cancel|delete|remove|add|set|change|enable|disable|turn|toggle|list|get|fetch|export|save|share|invite|join|start|stop|play|pause|bring|switch|drag|fill|submit|pay|order|buy|book|schedule|rsvp|answer|call|grant|edit|qa|test|use|try|describe|screenshot|report|tell|reload|refresh|unblock|block|mute|pin|archive|rename|move|upgrade|clear|record|collect|gather|research|review|inspect|compare|extract|note|locate|place|publish|connect|pair|link|authorize|configure|paste|drop|mark|reset|restart|relaunch|wait|watch|unsubscribe|forward|attach";
const VERB_RE = new RegExp(`^(?:${VERBS})\\b(?!-)`, "i");
const WEAK_RE = /^(?:report|tell|describe|use|try)\b/i;

function cuaApp(task: string): string | undefined {
	let best: { app: string; at: number } | undefined;
	let browser: { app: string; at: number } | undefined;
	for (const app of APPS) {
		const at = task.search(new RegExp(`(?<![@\\w.])${app.replace(/[.]/g, "\\.")}\\b`, app === "Mail" || app === "Notes" || app === "Messages" || app === "Calendar" || app === "Photos" || app === "Preview" ? "" : "i"));
		if (at < 0) continue;
		if (BROWSERS.has(app)) { if (!browser || at < browser.at) browser = { app, at }; continue; }
		if (!best || at < best.at) best = { app, at };
	}
	const site = (task.match(/https?:\/\/((?:[a-z0-9-]+\.)+[a-z]{2,})/i) ?? task.match(/(?<![@\w.-])((?:[a-z0-9-]+\.)+(?:com|org|io|ai|net|co|school|dev|gg))\b/i))?.[1]?.replace(/^www\./, "");
	if (best && (!site || best.at < task.indexOf(site))) return best.app;
	return site ?? best?.app ?? (browser?.app === "Google Chrome" ? "Chrome" : browser?.app);
}

/** "On this Mac, in Chrome, open https://x.com/a and click Save (…)" → "x.com: Open x.com/a and click Save". */
export function cuaSummary(task: string): string | undefined {
	const text = task.replace(/\s+/g, " ").trim();
	const sentences = text.split(/(?<=[.!?:])\s+(?=[A-Z0-9"'(])|(?:^|\s)\(?\d{1,2}[.)]\s+|\s[-•]\s/);
	let action: string | undefined;
	let weak: string | undefined;
	for (let s of sentences) {
		s = s.trim().replace(/\([^()]*\)/g, "").replace(/\s+/g, " ");
		s = s.replace(/^(?:urgent[.!:]?|please|then|now|first|next|finally|also|step \d+[:.]?)[,:]?\s+/i, "").replace(/^(?:goal|task|todo|your job|job|what to do|steps?)\s*:\s*/i, "");
		// leading context clauses: "On this Mac (ag), in Google Chrome's existing tab, …"
		for (let k = 0; k < 3; k++) {
			const m = s.match(/^(?:on|in|using|from|with|inside|within|via|at)\b[^,]{0,90},\s*/i);
			if (!m) break;
			s = s.slice(m[0].length);
		}
		if (/^(?:do not|don't|never|if|when|stop|only|note that|take no|research only|research task|read[- ]only)\b/i.test(s) || /^[A-Z-]{4,}\b/.test(s)) continue;
		if (!VERB_RE.test(s)) continue;
		let a = s
			.replace(/https?:\/\/[^\s,)]+/g, (u) => shortUrl(u))
			.replace(/\s*(?:;|:\s).*$/, "")
			.replace(/:$/, "")
			.replace(/,?\s+(?:then|and then|so that|before|after|until|if|unless|once)\b.*$/i, "")
			.replace(/,?\s+and (?:report|tell|describe|confirm|reply)\b.*$/i, "")
			.replace(/\s+of this Mac's\b/gi, " of the")
			.replace(/\bthis Mac's\b/gi, "the")
			.replace(/\s+on this Mac\b/gi, "")
			.replace(/\s+,/g, ",")
			.replace(/[.,!]+$/, "")
			.trim();
		if (a.split(" ").length < 2 && !/^(?:screenshot|quit|close)/i.test(a)) continue;
		a = cap(a);
		if (WEAK_RE.test(a)) { weak ??= a; continue; }
		action = a;
		break;
	}
	action ??= weak;
	if (!action) return;
	const app = cuaApp(text.replace(/\([^()]*\)/g, "")) ?? cuaApp(text);
	const label = app && !action.toLowerCase().includes(app.toLowerCase().replace(/^google /, "")) ? `${app}: ${action}` : action;
	return clip(label, 80);
}

/** Top-level $( … ) command substitutions in a string (arithmetic $(( … )) skipped). */
function substitutions(s: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < s.length - 1; i++) {
		if (s[i] === "\\") { i++; continue; }
		if (s[i] !== "$" || s[i + 1] !== "(") continue;
		if (s[i + 2] === "(") { i += 2; continue; }
		let depth = 1;
		let j = i + 2;
		let q: string | null = null;
		for (; j < s.length && depth; j++) {
			const c = s[j];
			if (q) { if (c === q) q = null; else if (c === "\\") j++; continue; }
			if (c === "'" || (c === '"' && depth > 1)) q = c;
			else if (c === "(") depth++;
			else if (c === ")") depth--;
		}
		if (depth) break;
		out.push(s.slice(i + 2, j - 1));
		i = j - 1;
	}
	return out;
}

/** A computer-use task argument: literal text, a heredoc body, or a file it is read from. */
function cuaTask(t: string, ctx: Ctx): { task?: string; file?: string } {
	const hd = t.match(/^\$\(cat\s+<<-?\s*['"]?(\w+)/);
	if (hd) return { task: ctx.heredocs?.[hd[1]] };
	const f = t.match(/^\$\((?:cat|<)\s+([^\s()]+)\s*\)$/);
	if (f) return { file: f[1] };
	return { task: t };
}

// ---------- shell segment rules ----------

const FILTERS = new Set(["grep", "rg", "egrep", "head", "tail", "jq", "sed", "awk", "sort", "uniq", "wc", "cut", "tr", "cat", "column", "less", "tee", "fold", "nl", "fmt", "base64", "xxd", "od", "python3", "node"]);
const NOISE = /^(?:echo|printf|sleep|date|true|false|:|set|export|umask|source|\.|wait|clear|unset|cd|pushd|popd|local|shopt|trap|exit|return|break|continue|read|done|fi|esac|else|\[\[?|\]|test|time|then|do)$/;

type Rule = { id: string; cmd: RegExp; fn: (args: string[], raw: string, ctx: Ctx, seg: string) => string | SegOut | undefined };

const gitSub: Record<string, (a: string[]) => string | undefined> = {
	status: () => "Git status",
	fetch: () => "Fetch from origin",
	pull: () => "Pull",
	push: (a) => (a.includes("--delete") ? `Delete remote branch ${positional(a).pop() ?? ""}`.trim() : "Push"),
	add: () => "Stage changes",
	commit: (a) => { const m = flagVal(a, "-m", "--message"); return m ? `Commit "${clip(m.split("\n")[0], 50)}"` : "Commit"; },
	log: () => "Git log",
	diff: (a) => (a.includes("--stat") || a.includes("--shortstat") ? "Diff stats" : "Diff"),
	show: (a) => {
		const p = positional(a, ["--format", "--pretty"])[0];
		if (!p) return "Show last commit";
		const m = p.match(/^([^:]+):(.+)$/);
		return m ? `Show ${shortPath(m[2])} at ${m[1]}` : `Show commit ${clip(p, 12)}`;
	},
	grep: (a) => { const p = positional(a, ["-e", "-A", "-B", "-C", "-m"]); const pat = flagVal(a, "-e") ?? p[0]; return pat ? `Search repo for "${clip(pat, 40)}"` : undefined; },
	worktree: (a) => { const [sub, p] = positional(a, ["-b", "-B"]); return sub === "add" ? `Create worktree ${shortPath(p ?? "")}` : sub === "remove" ? `Remove worktree ${shortPath(p ?? "")}` : sub === "list" ? "List worktrees" : sub === "prune" ? "Prune worktrees" : undefined; },
	branch: (a) => (a.includes("-D") || a.includes("-d") ? `Delete branch ${positional(a)[0] ?? ""}`.trim() : a.includes("-m") || a.includes("-M") ? `Rename branch to ${positional(a).pop() ?? ""}`.trim() : a.includes("--show-current") ? "Show current branch" : "List branches"),
	checkout: (a) => `Check out ${positional(a, ["-b"])[0] ?? flagVal(a, "-b") ?? ""}`.trim(),
	switch: (a) => `Switch to ${positional(a, ["-c"])[0] ?? flagVal(a, "-c") ?? ""}`.trim(),
	merge: (a) => (a.includes("--abort") ? "Abort merge" : `Merge ${positional(a, ["-m"])[0] ?? ""}`.trim()),
	rebase: (a) => (a.includes("--abort") ? "Abort rebase" : a.includes("--continue") ? "Continue rebase" : `Rebase onto ${positional(a)[0] ?? ""}`.trim()),
	stash: (a) => `Stash ${positional(a)[0] ?? ""}`.trim(),
	"rev-parse": () => "Resolve git ref",
	"ls-tree": () => "List files in git tree",
	"ls-files": () => "List tracked files",
	clone: (a) => `Clone ${shortUrl(positional(a)[0] ?? "")}`,
	reset: () => "Reset branch",
	"cherry-pick": () => "Cherry-pick commit",
	config: () => "Git config",
	remote: () => "Git remotes",
	"merge-base": () => "Find merge base",
	blame: (a) => `Blame ${shortPath(positional(a, ["-L"]).pop() ?? "")}`,
	restore: (a) => `Restore ${paths(positional(a, ["--source", "-s"]))}`,
	rm: (a) => `Untrack ${paths(positional(a))}`,
	mv: (a) => { const p = positional(a); return `Move ${shortPath(p[0] ?? "")} → ${shortPath(p[1] ?? "")}`; },
	tag: () => "Git tags",
	"for-each-ref": () => "List git refs",
	"cat-file": () => "Inspect git object",
	describe: () => "Describe commit",
	"rev-list": () => "Count commits",
	"update-index": () => "Update git index",
	"format-patch": () => "Export commit as a patch",
	"ls-remote": (a) => `Check remote branches${positional(a).slice(1).length ? ` ${positional(a).slice(1).join(" ")}` : ""}`,
	am: () => "Apply patch",
	apply: () => "Apply patch",
	init: () => "Init repo",
	shortlog: () => "Git shortlog",
	reflog: () => "Git reflog",
	notes: () => "Git notes",
	gc: () => "Git gc",
	"symbolic-ref": () => "Resolve git ref",
	"check-ignore": (a) => `Check if ${paths(positional(a))} is git-ignored`,
};

const ghPr: Record<string, (n: string, a: string[]) => string> = {
	create: () => "Open PR",
	view: (n, a) => (a.includes("--comments") ? `Read comments on PR ${n}` : `View PR ${n}`),
	checks: (n) => `Check CI on PR ${n}`,
	merge: (n) => `Merge PR ${n}`,
	list: () => "List PRs",
	edit: (n) => `Edit PR ${n}`,
	comment: (n) => `Comment on PR ${n}`,
	diff: (n) => `Diff of PR ${n}`,
	review: (n) => `Review PR ${n}`,
	close: (n) => `Close PR ${n}`,
	ready: (n) => `Mark PR ${n} ready`,
	checkout: (n) => `Check out PR ${n}`,
	status: () => "PR status",
	update_branch: (n) => `Update branch of PR ${n}`,
};

function nested(inner: string, host: string, _ctx: Ctx): SegOut {
	const r = summarizeShell(inner, { host });
	if (!r.sum) { _ctx.miss = r.miss; return null; }
	return { sum: r.sum, host, rule: "nested", parts: r.parts?.map((p) => ({ sum: p.sum, host: p.host ?? host })) };
}

const RULES: Rule[] = [
	{ id: "sed-read", cmd: /^sed$/, fn: (a, _raw, _ctx, seg) => {
		if (a.some((x) => /^-i/.test(x))) { const f = positional(a.filter((x) => !/^-i/.test(x) && x !== ""), ["-e"]).slice(a.includes("-e") ? 0 : 1); return `Edit ${paths(f)} (sed)`; }
		const p = positional(a, ["-e"]);
		const range = p[0]?.match(/^(\d+)(?:,(\d+|\$))?p$/);
		if (range && p[1]) return `Read ${shortPath(p[1])}:${range[1]}${range[2] ? `–${range[2]}` : ""}`;
		if (p[0] && /^\//.test(p[0]) && p[1]) return `Read part of ${shortPath(p[1])}`;
		if (a.includes("-n") && p.length === 2 && /p$/.test(p[0]) && p[0].includes("$")) return `Read part of ${shortPath(p[1])}`;
		// sed SCRIPT FILE… (or -e … FILE…): a filtered copy, to stdout or a redirect
		const files = a.includes("-e") || a.includes("--expression") ? p : p.slice(1);
		if (!files.length) return;
		const out = seg.match(/(?:^|\s)>\s*([^\s<>&|;]+)\s*$/)?.[1];
		return out ? `Write ${shortPath(out)} from ${paths(files)} (sed)` : `Filter ${paths(files)} with sed`;
	} },
	{ id: "cat", cmd: /^cat$/, fn: (a, _raw, _ctx, seg) => {
		const out = seg.match(/(>>?)\s*([^\s<>]+)/);
		if (out && /<</.test(seg)) return `${out[1] === ">>" ? "Append to" : "Write"} ${shortPath(out[2])}`;
		const p = positional(a);
		if (!p.length && /<</.test(seg)) return "noise";
		if (!p.length && out && !/^&|^\/dev\//.test(out[2])) return `${out[1] === ">>" ? "Append to" : "Write"} ${shortPath(out[2])}`;
		return p.length ? `Read ${paths(p)}` : undefined;
	} },
	{ id: "head-tail", cmd: /^(head|tail)$/, fn: (a, raw) => {
		const p = positional(a, ["-n", "-c"]);
		if (!p.length) return;
		if (a.includes("-f") || a.includes("-F")) return `Follow ${paths(p)}`;
		return `Read ${/^head/.test(raw) ? "start" : "end"} of ${paths(p)}`;
	} },
	{ id: "grep", cmd: /^(grep|rg|egrep)$/, fn: (a) => {
		const p = positional(a, ["-e", "-A", "-B", "-C", "-m", "-g", "--glob", "-t", "--type", "--max-count", "-f", "--include", "--exclude"]);
		const pat = flagVal(a, "-e") ?? p.shift();
		if (pat === undefined) return;
		if (pat === "" && a.includes("-c") && p.length) return `Count lines in ${paths(p)}`;
		if (!pat) return;
		const where = paths(p.filter((x) => x !== "."));
		return `Search "${clip(pat.replace(/\\\|/g, "|"), 40)}"${where ? ` in ${where}` : ""}`;
	} },
	{ id: "ls", cmd: /^(ls|tree|eza)$/, fn: (a) => `List ${paths(positional(a, ["-I", "-L"])) || "directory"}` },
	{ id: "find", cmd: /^(find|fd)$/, fn: (a) => {
		const name = flagVal(a, "-name", "-iname", "-path");
		const root = a.find((x) => !x.startsWith("-") && x !== name);
		return `Find ${name ? `"${name}" ` : "files "}in ${shortPath(root ?? ".")}`;
	} },
	{ id: "wc", cmd: /^wc$/, fn: (a, _r, _c, seg) => { const p = positional(a); const f = p.length ? p : (seg.match(/<\s*([^\s<>|;]+)/)?.slice(1) ?? []); if (!f.length) return; const what = a.some((x) => /^-\w*[cm]/.test(x)) && !a.some((x) => /^-\w*l/.test(x)) ? "bytes" : a.some((x) => /^-\w*w/.test(x)) && !a.some((x) => /^-\w*l/.test(x)) ? "words" : "lines"; return `Count ${what} in ${paths(f)}`; } },
	{ id: "perl", cmd: /^perl$/, fn: (a) => (a.some((x) => /^-\w*i/.test(x)) ? `Edit ${paths(positional(a, ["-e", "-E"]))} (perl)` : "Run Perl snippet") },
	{ id: "awk", cmd: /^(awk|gawk)$/, fn: (a) => { const p = positional(a, ["-F", "-v", "-f"]); return p[1] ? `Scan ${paths(p.slice(1))}` : undefined; } },
	{ id: "macos-log", cmd: /^log$/, fn: (a) => (a[0] === "show" || a[0] === "stream" ? `Read macOS logs${a.join(" ").match(/process == \\?"([^"\\]+)/)?.[1] ? ` of ${a.join(" ").match(/process == \\?"([^"\\]+)/)![1]}` : ""}` : undefined) },
	{ id: "dig", cmd: /^(dig|nslookup|host|ping|traceroute|nc|whois)$/, fn: (a, raw) => `${raw.startsWith("ping") ? "Ping" : raw.startsWith("nc") ? "Probe" : "Look up"} ${positional(a, ["-p", "-c", "-W", "-w", "-t"]).filter((x) => !/^(\+\w+|MX|TXT|A|AAAA|CNAME|NS)$/.test(x))[0] ?? ""}`.trim() },
	{ id: "keychain", cmd: /^security$/, fn: (a) => { const s = flagVal(a, "-s", "-l"); const sub = a[0] ?? ""; const v = /^add|^set/.test(sub) ? "Store" : /^delete/.test(sub) ? "Delete" : /^find/.test(sub) ? "Read" : "Inspect"; return `${v} Keychain item${s ? ` "${clip(s, 40)}"` : ""}`; } },
	{ id: "hw", cmd: /^(ioreg|system_profiler|pmset|caffeinate|diskutil|sysctl|networksetup|scutil|csrutil|spctl|tccutil|codesign)$/, fn: (_a, raw) => `macOS ${raw.split(/\s/)[0]}` },
	{ id: "swift", cmd: /^(swift|swiftc|xcodebuild|xcrun|make|cmake|go|cargo)$/, fn: (a, raw) => `${raw.split(/\s/)[0]} ${positional(a, ["-scheme", "-project", "-destination", "-configuration", "-o"])[0] ?? ""}`.trim() },
	{ id: "format", cmd: /^(?:\.?\/?node_modules\/\.bin\/)?(oxfmt|prettier|biome|eslint|oxlint|tsc|svelte-check)$/, fn: (a, raw) => `Run ${raw.split(/\s/)[0].replace(/^.*\//, "")}${positional(a)[0] ? ` on ${paths(positional(a), 1)}` : ""}` },
	{ id: "ts-api", cmd: /^ts-api$/, fn: (a) => `Tailscale API ${a[0] ?? ""} ${a[1] ?? ""}`.trim() },
	{ id: "clipboard", cmd: /^(pbcopy|pbpaste)$/, fn: (_a, raw) => (raw.startsWith("pbcopy") ? "Copy to clipboard" : "Read clipboard") },
	{ id: "seq", cmd: /^(seq|yes|jot|shuf|sort|uniq|tr|cut|base64|xxd|od|column|nl|tee|fold|expr|bc|true|mktemp|who|w|stty|tput)$/, fn: () => "noise" as const },
	{ id: "jq", cmd: /^jq$/, fn: (a) => { const p = positional(a, ["--arg", "--argjson", "--slurpfile", "--rawfile"]); return p[1] ? `Query JSON in ${paths(p.slice(1))}` : undefined; } },
	{ id: "stat-file", cmd: /^(stat|file|du|df|realpath|readlink|basename|dirname|md5|shasum|sha256sum)$/, fn: (a, raw) => `${raw.split(/\s/)[0] === "du" || raw.startsWith("df") ? "Disk usage of" : "Inspect"} ${paths(positional(a)) || "disk"}` },
	{ id: "python", cmd: /^(python3?|uv)$/, fn: (a, raw, _ctx, seg) => {
		if (raw.startsWith("uv")) { const [sub, ...r] = positional(a); if (sub === "run") return `Run ${shortPath(r[0] ?? "script")} (uv)`; if (sub === "add") return `Add Python package ${r.join(" ")}`; return `uv ${sub ?? ""}`.trim(); }
		if (a[0] === "-" || /<</.test(seg)) return "Run Python script";
		if (a[0] === "-c") return "Run Python snippet";
		if (a[0] === "-m") return `Run python -m ${a[1] ?? ""}`.trim();
		const f = positional(a)[0];
		return f ? `Run ${shortPath(f)}` : undefined;
	} },
	{ id: "node", cmd: /^(node|bun|deno|tsx|bunx|npx|npm|pnpm)$/, fn: (a, raw, _ctx, seg) => {
		const tool = raw.split(/\s/)[0];
		const p = positional(a, ["-c", "--cwd", "--filter"]);
		if (tool === "node" || tool === "deno" || tool === "tsx") {
			if (a[0] === "-e" || a[0] === "--eval" || a[0] === "-" || /<</.test(seg)) return "Run Node script";
			if (a[0] === "--check") return `Syntax-check ${shortPath(a[1] ?? "")}`;
			return p[0] ? `Run ${shortPath(p[0])}` : undefined;
		}
		if (tool === "bun" && p[0] === "scripts/db" && (a.includes("--help") || a.includes("-h"))) return "Read scripts/db help";
		if (tool === "bun" && p[0] === "scripts/db") {
			const stage = flagVal(a, "--stage") ?? "local";
			const db = positional(a, ["--stage"]).find((x, i, arr) => i > 1 && arr[i - 1] === "query") ?? positional(a, ["--stage"])[2];
			const sql = positional(a, ["--stage"]).slice(3).join(" ");
			const table = sql.match(/\b(?:from|into|update|join)\s+([a-z_][\w.]*)/i)?.[1];
			return `Query ${stage} ${db ?? ""} DB${table ? `: ${table}` : ""}`.replace(/\s+/g, " ");
		}
		if (tool === "bun" && (p[0] === "-e" || a[0] === "-e")) return "Run Bun snippet";
		const sub = tool === "bunx" || tool === "npx" ? p[0] : p[0] === "run" || p[0] === "x" ? p[1] : p[0];
		if (!sub) return tool === "bun" ? "Run Bun" : undefined;
		if (/^(install|i|add|ci)$/.test(sub)) return p.length > 1 && sub !== "install" && sub !== "ci" ? `Add package ${p.slice(1).join(" ")}` : "Install dependencies";
		if (/^(test|vitest|jest|playwright)$/.test(sub)) return `Run tests${p.slice(p.indexOf(sub) + 1).find((x) => /\.(test|spec)\.|\//.test(x)) ? ` (${shortPath(p.slice(p.indexOf(sub) + 1).find((x) => /\.(test|spec)\.|\//.test(x))!)})` : ""}`;
		if (/^(check|lint|typecheck|tsc|svelte-check|biome|eslint|prettier|format)$/.test(sub)) return `Run ${sub}`;
		if (/^(build|dev|preview|start)$/.test(sub)) return `Run ${sub}`;
		if (sub === "sync") return `Sync ${p[p.indexOf(sub) + 1] ?? ""}`.trim();
		return `Run ${shortPath(sub)}`;
	} },
	{ id: "git", cmd: /^git$/, fn: (a) => {
		const i = a.findIndex((x) => !x.startsWith("-") && a[a.indexOf(x) - 1] !== "-C");
		const sub = a[i];
		const f = gitSub[sub];
		const s = f?.(a.slice(i + 1));
		const dir = flagVal(a, "-C");
		return s ? `${s}${dir ? ` (${shortPath(dir)})` : ""}` : undefined;
	} },
	{ id: "gh", cmd: /^gh$/, fn: (a) => {
		const p = positional(a, ["--json", "-q", "--jq", "--repo", "-R", "-t", "--title", "-b", "--body", "--body-file", "-F", "-f", "--method", "-X", "--add-reviewer", "--base", "-B", "--head", "-H", "--label", "--limit", "-L", "--search", "--state", "--template"]);
		const [group, sub, n] = p;
		const num = n && /^\d+$/.test(n) ? `#${n}` : "";
		if (group === "pr" && ghPr[sub]) return ghPr[sub](num, a).replace(/\s+$/, "");
		if (group === "run") return sub === "list" ? "List CI runs" : sub === "rerun" ? "Re-run CI" : sub === "cancel" ? "Cancel CI run" : `Check CI run${n ? ` ${n}` : ""}`;
		if (group === "api") return `GitHub API ${clip(sub ?? "", 50)}`;
		if (group === "issue") return `${cap(sub ?? "")} issue ${num}`.trim();
		if (group === "repo") return `${cap(sub ?? "")} repo`;
		if (group === "auth") return "GitHub auth";
		if (group === "workflow") return `Workflow ${sub ?? ""}`.trim();
		if (group === "release") return `${cap(sub ?? "")} release`;
		if (group === "search") return `Search GitHub ${sub ?? ""}`.trim();
		if (a.includes("--version")) return "Check gh version";
	} },
	{ id: "curl", cmd: /^(curl|wget|http|xh)$/, fn: (a) => {
		const url = positional(a, ["-H", "-d", "--data", "--data-binary", "--data-raw", "-X", "-o", "-u", "-m", "--max-time", "-w", "-A", "-b", "-c", "-e", "-F", "--connect-timeout", "--retry", "-T", "--json"]).find((x) => /^(https?:\/\/|[\w.-]+:\d+|\/|localhost|127\.|\d+\.\d+|\$\{?\w+\}?\/\w)/.test(x) || /\.\w{2,}\//.test(x));
		// a URL held in variables ("$u", $B/$p, $(session-link)) is shown as written
		const vurl = url ?? positional(a, ["-H", "-d", "--data", "--data-binary", "--data-raw", "-X", "-o", "-u", "-m", "--max-time", "-w", "-A", "-b", "-c", "-e", "-F", "--connect-timeout", "--retry", "-T", "--json", "-D"]).find((x) => /^(?:\$\{?\w+\}?|\$\(session-link\))(?:[\w./$-]|\$\{?\w+\}?)*$/.test(x));
		if (!vurl) return;
		const head = a.some((x) => /^-[a-zA-Z]*I[a-zA-Z]*$/.test(x) || x === "--head");
		const method = flagVal(a, "-X", "--request") ?? (a.some((x) => /^(-d|--data|--data-binary|--data-raw|-F|--json|-T)$/.test(x)) ? "POST" : head ? "HEAD" : "GET");
		return `${method.toUpperCase()} ${url ? shortUrl(url) : clip(vurl, 40)}`;
	} },
	{ id: "ssh", cmd: /^ssh$/, fn: (a, _raw, ctx) => {
		const p = positional(a, ["-o", "-i", "-p", "-J", "-L", "-R", "-F", "-l", "-E", "-W"]);
		const host = p[0];
		if (!host) return;
		const h = normHost(host);
		const inner = p.slice(1).join(" ");
		if (!inner || /^(?:bash|sh|zsh)(?: -\w+)*$/.test(inner.trim())) return { sum: inner ? `Run a script on ${h}` : `SSH to ${h}`, host: h, rule: "ssh" };
		if (/^(?:true|exit|:|hostname|echo [\w .:-]*)$/.test(inner.trim())) return { sum: `Check ${h} is reachable`, host: h, rule: "ssh" };
		return nested(inner, h, ctx);
	} },
	{ id: "scp", cmd: /^(scp|rsync)$/, fn: (a) => {
		const p = positional(a, ["-e", "-P", "-i", "-o", "--exclude"]);
		if (p.length < 2) return;
		const src = p.slice(0, -1);
		const dst = p[p.length - 1];
		const remote = [...src, dst].find((x) => /^[\w.@-]+:/.test(x));
		const h = remote ? normHost(remote.split(":")[0]) : undefined;
		const s = `Copy ${paths(src.map((x) => x.replace(/^[\w.@-]+:/, "")), 1)} ${dst === remote ? "to" : "from"} ${h ?? shortPath(dst)}`;
		return h ? { sum: s, host: h, rule: "scp" } : s;
	} },
	{ id: "mac", cmd: /^mac$/, fn: (a, _raw, ctx) => {
		const [sub, ...r] = a;
		if (sub === "run") return nested(r.join(" ").replace(/^--\s*/, ""), "ag-mac", ctx);
		if (sub === "cua") { const t = positional(r, ["--why", "--caller"]).join(" "); if (r[0] === "--status" || !t) return { sum: "Check the computer-use queue", host: "ag-mac", rule: "mac-cua" }; const s = cuaSummary(t); return s ? { sum: s, host: "ag-mac", rule: "mac-cua" } : null; }
		if (sub === "push") return { sum: `Copy ${paths(r.slice(0, -1).length ? r.slice(0, -1) : r, 1)} to ag-mac`, host: "ag-mac", rule: "mac-push" };
		if (sub === "pull") return { sum: `Copy ${paths(r.slice(0, 1), 1)} from ag-mac`, host: "ag-mac", rule: "mac-pull" };
		if (sub === "show") return { sum: `Show ${shortPath(r[0] ?? "")} on Nathan's screen`, host: "ag-mac", rule: "mac-show" };
		if (sub === "status") return { sum: "Check ag-mac status", host: "ag-mac", rule: "mac-status" };
	} },
	{ id: "cua", cmd: /^(chatgpt-cua|client-cua)$/, fn: (a, raw, ctx) => {
		const host = raw.startsWith("client-cua") ? "ag-client" : "ag-mac";
		const t = positional(a, ["--why", "--caller", "--timeout"]).join(" ");
		if (!t || a.includes("--status")) return { sum: "Check computer use", host, rule: "cua" };
		const { task, file } = cuaTask(t, ctx);
		if (file) return { sum: `Run computer-use task from ${shortPath(file)}`, host, rule: "cua" };
		const s = task ? cuaSummary(task) : undefined;
		return s ? { sum: s, host, rule: "cua" } : null;
	} },
	{ id: "ag-mux", cmd: /^(ag-mux|herdr)$/, fn: (a, raw) => {
		// herdr is ag-mux's predecessor with the same CLI; old traces still use it
		const tool = raw.split(/\s/)[0];
		const p = positional(a, ["--workspace", "--label", "--cwd", "--direction", "--source", "--lines", "--timeout", "--regex", "--body", "--sound", "--tab", "--pane"]);
		const [g, sub, tgt] = p;
		const label = flagVal(a, "--label");
		const map: Record<string, string | undefined> = {
			"pane read": `Read pane ${tgt ?? ""}`, "pane list": "List panes", "pane split": "Split pane", "pane run": `Run command in pane ${tgt ?? ""}`,
			"pane send-text": `Type into pane ${tgt ?? ""}`, "pane send-keys": `Send keys to pane ${tgt ?? ""}`, "pane wait-output": `Wait for output in pane ${tgt ?? ""}`,
			"pane current": "Find current pane", "pane get": `Inspect pane ${tgt ?? ""}`, "pane close": `Close pane ${tgt ?? ""}`, "pane neighbor": "Find neighbouring pane", "pane move": `Move pane ${tgt ?? ""}`,
			"agent prompt": `Prompt agent in ${tgt ?? ""}`, "agent list": "List agents", "agent start": `Start agent in ${tgt ?? ""}`, "agent get": `Inspect agent ${tgt ?? ""}`, "agent send-keys": `Send keys to agent ${tgt ?? ""}`, "agent wait": `Wait for agent ${tgt ?? ""}`,
			"tab create": `Open tab${label ? ` "${label}"` : ""}`, "tab close": `Close tab ${tgt ?? ""}`, "tab list": "List tabs", "tab rename": `Rename tab ${tgt ?? ""}`, "tab get": `Inspect tab ${tgt ?? ""}`, "tab move": `Move tab ${tgt ?? ""}`, "tab focus": `Focus tab ${tgt ?? ""}`,
			"workspace list": "List workspaces", "workspace create": `Create workspace${label ? ` "${label}"` : ""}`, "workspace get": "Inspect workspace",
			"agent read": `Read agent ${tgt ?? ""}`, "pane process-info": `Inspect pane ${flagVal(a, "--pane") ?? tgt ?? ""}`, "agent rename": `Rename agent ${tgt ?? ""}`,
			"api snapshot": "Read session snapshot", "notification show": "Show a notification", "layout export": "Export layout",
			"pane rename": `Rename pane ${tgt ?? ""}`, "pane focus": `Focus pane ${tgt ?? ""}`, "pane layout": `Inspect layout of pane ${flagVal(a, "--pane") ?? tgt ?? ""}`,
			"workspace close": `Close workspace ${tgt ?? ""}`, "workspace focus": `Focus workspace ${tgt ?? ""}`, "workspace rename": `Rename workspace ${tgt ?? ""}`,
			"api schema": `Read the ${tool} API schema`, "server reload-config": `Reload ${tool} config`, "server stop": `Stop the ${tool} server`,
			"config check": `Check ${tool} config`, "machine list": `List ${tool} machines`, "worktree create": "Create worktree", "worktree list": "List worktrees",
		};
		if (g === "status" && !sub) return `Check ${tool} status`;
		if (!g && a.includes("--skill")) return `Read the ${tool} skill`;
		const s = map[`${g} ${sub}`];
		return s?.trim();
	} },
	{ id: "session-link", cmd: /^session-link$/, fn: () => "Get session link" },
	{ id: "herdr-link", cmd: /^herdr-link$/, fn: (a) => {
		// herdr-link (predecessor of `ag link`): tabs by id, --grep PATTERN, or --session [file|id]
		if (a.includes("--grep")) { const g = a.slice(a.indexOf("--grep") + 1).find((x) => !x.startsWith("-")); return g ? `Get links to tabs matching "${clip(g, 30)}"` : undefined; }
		const self = (x: string) => /^"?\$\{?(?:HERDR_TAB_ID|PI_SESSION_FILE|PI_SESSION_ID)\}?"?$/.test(x);
		const p = positional(a).filter((x) => x !== "-i");
		if (a.includes("--session")) return !p.length || self(p[0]) ? "Get link to this session" : `Get link to session ${shortPath(p[0].replace(/^.*\//, ""))}`;
		if (!p.length || p.every(self)) return "Get link to this tab";
		return `Get link to ${p.slice(0, 3).map((x) => clip(x, 20)).join(", ")}${p.length > 3 ? ` +${p.length - 3}` : ""}`;
	} },
	{ id: "osascript", cmd: /^osascript$/, fn: (a, raw) => {
		const app = raw.match(/tell (?:application|app) (?:id )?\\?"([^"\\]+)\\?"/)?.[1];
		if (app) return `AppleScript → ${app.replace(/^com\.google\.Chrome$/, "Chrome")}`;
		const f = positional(a, ["-e", "-l"])[0];
		return f ? `Run AppleScript ${shortPath(f)}` : "Run AppleScript";
	} },
	{ id: "open", cmd: /^open$/, fn: (a) => {
		const app = flagVal(a, "-a", "-b");
		const p = positional(a, ["-a", "-b"]);
		if (app) return `Open ${app.replace(/\.app$/, "").replace(/^.*\//, "")}${p[0] ? ` with ${shortPath(p[0])}` : ""}`;
		return p[0] ? `Open ${/^\w+:/.test(p[0]) ? shortUrl(p[0]) : shortPath(p[0])}` : undefined;
	} },
	{ id: "screencapture", cmd: /^screencapture$/, fn: (a) => { const f = positional(a, ["-R", "-l", "-D", "-T", "-t"])[0]; return `Take a screenshot${f ? ` → ${shortPath(f)}` : ""}`; } },
	{ id: "cliclick", cmd: /^cliclick$/, fn: (a) => { const c = a.find((x) => /^(c|dc|rc|m):/.test(x)); const kp = a.filter((x) => /^k[pdu]:/.test(x)); if (!c && kp.length && kp.length === positional(a).filter((x) => !/^w:/.test(x)).length) return `Press ${kp.map((x) => x.slice(3)).join(", ")}`; return c ? `${c.startsWith("m") ? "Move mouse" : c.startsWith("dc") ? "Double-click" : c.startsWith("rc") ? "Right-click" : "Click"} at ${c.split(":")[1]}` : "Mouse/keyboard input"; } },
	{ id: "kill", cmd: /^(pkill|killall|kill)$/, fn: (a, raw) => { const p = positional(a, ["-s", "-signal"]); if (!p.length) return "Stop processes"; return raw.startsWith("kill ") ? `Stop process ${p.join(" ")}` : `Stop ${p.map((x) => clip(x, 30)).join(", ")}`; } },
	{ id: "pgrep", cmd: /^(pgrep|pidof)$/, fn: (a) => `Find process "${clip(positional(a).join(" "), 30)}"` },
	{ id: "ps", cmd: /^(ps|top|htop|uptime|free|vm_stat)$/, fn: () => "Check processes/load" },
	{ id: "lsof", cmd: /^(lsof|ss|netstat)$/, fn: () => "List open ports/files" },
	{ id: "fs", cmd: /^(mkdir|rm|rmdir|cp|mv|ln|chmod|chown|touch|trash|install)$/, fn: (a, raw) => {
		const tool = raw.split(/\s/)[0];
		const p = positional(a, ["-m", "-o", "-g"]);
		if (!p.length) return;
		const verb: Record<string, string> = { mkdir: "Make folder", rm: "Delete", rmdir: "Delete", touch: "Create", trash: "Trash", chmod: "Set permissions on", chown: "Set owner of" };
		if (verb[tool]) return `${verb[tool]} ${paths(tool === "chmod" || tool === "chown" ? p.slice(1) : p)}`;
		if (tool === "ln") return `Link ${shortPath(p[1] ?? p[0])} → ${shortPath(p[0])}`;
		return `${tool === "mv" ? "Move" : "Copy"} ${paths(p.slice(0, -1), 1)} → ${shortPath(p[p.length - 1])}`;
	} },
	{ id: "systemctl", cmd: /^(systemctl|journalctl|launchctl)$/, fn: (a, raw) => {
		const tool = raw.split(/\s/)[0];
		const p = positional(a, ["-u", "--unit", "-n", "--lines", "--since", "-p", "--property", "-o", "--output"]);
		const unit = (s?: string) => (s ?? "").replace(/^gui\/\S+?\//, "").replace(/^(?:com\.nathan\.|ag\.)/, "").replace(/\.(service|timer|plist)$/, "").replace(/^.*\//, "");
		if (tool === "journalctl") return `Read logs${flagVal(a, "-u", "--unit") ? ` of ${unit(flagVal(a, "-u", "--unit"))}` : ""}`;
		const [sub, ...rest] = p;
		const verbs: Record<string, string> = { start: "Start", stop: "Stop", restart: "Restart", "try-restart": "Restart", reload: "Reload", status: "Check", enable: "Enable", disable: "Disable", "is-active": "Check", show: "Inspect", cat: "Show unit", kickstart: "Restart", bootstrap: "Load", bootout: "Unload", load: "Load", unload: "Unload", print: "Inspect", list: "List services", "list-timers": "List timers", "list-units": "List units", "daemon-reload": "Reload systemd", "reset-failed": "Reset failed units", submit: "Run as job", remove: "Remove job" };
		const v = verbs[sub];
		if (!v) return;
		const targets = rest.filter((x) => !/^gui\/\d+$/.test(x)).map(unit).filter(Boolean);
		return `${v}${targets.length ? ` ${targets.slice(0, 2).join(", ")}` : ""}${tool === "systemctl" && !targets.length && !/^list|reload|reset/.test(sub) ? " service" : ""}`;
	} },
	{ id: "op", cmd: /^(op-ag|op-work|op-shared|op)$/, fn: (a, raw, ctx) => {
		const tool = raw.split(/\s/)[0];
		const p = positional(a, ["--vault", "--fields", "--format", "--reveal", "--account", "--title", "--category", "--env-file"]);
		if (p[0] === "run") { const i = a.indexOf("--"); return i >= 0 ? (() => { const r = summarizeShell(a.slice(i + 1).join(" "), ctx); return r.sum ? `${r.sum} (with secrets)` : undefined; })() : undefined; }
		if (p[0] === "read") return `Read a secret (${tool})`;
		if (p[0] === "item" && p[1] === "get") return `Read secret "${clip(p[2] ?? "", 40)}"`;
		if (p[0] === "item" && (p[1] === "create" || p[1] === "edit")) return `Store secret${flagVal(a, "--title") ? ` "${clip(flagVal(a, "--title")!, 40)}"` : p[2] ? ` "${clip(p[2], 40)}"` : ""}`;
		if (p[0] === "item" && p[1] === "list") return `List secrets (${tool})`;
		if (p[0] === "whoami" || p[0] === "vault") return `Check 1Password (${tool})`;
		if (p[0] === "account" && p[1] === "list") return `List 1Password accounts (${tool})`;
		if (p[0] === "item" && p[1] === "share") return `Share secret ${clip(p[2] ?? "", 40)}${flagVal(a, "--emails") ? ` with ${clip(flagVal(a, "--emails")!, 40)}` : ""}`;
	} },
	{ id: "ag-tools", cmd: /^(ag-text|show|shot|presence|tickler|ag-access|ag-host|ag-inbox|nessie-daemon|ag-login-password|machine-role|record-flow|screen-record|ag-dash-stats|toolsum|cua-queue|routine)$/, fn: (a, raw) => {
		const tool = raw.split(/\s/)[0];
		const p = positional(a);
		switch (tool) {
			case "ag-text": return `Text Nathan "${clip(p.join(" "), 50)}"`;
			case "show": return `Show ${p[0] ? (/^\w+:\/\//.test(p[0]) ? shortUrl(p[0]) : shortPath(p[0])) : "it"} on Nathan's screen`;
			case "shot": return "Pull Nathan's screenshots";
			case "presence": return "Check if Nathan is at his Mac";
			case "ag-access": return p[0] === "allow" ? "Allow pending permission prompt" : "Check macOS permissions";
			case "ag-host": return "Find the session host";
			case "nessie-daemon": return `Nessie ${p[0] ?? ""}`.trim();
			case "machine-role": return "Check machine role";
			case "record-flow": case "screen-record": return "Record a screen flow";
			case "cua-queue": return "Check the computer-use queue";
			default: return `${tool} ${p[0] ?? ""}`.trim();
		}
	} },
	{ id: "browser-tools", cmd: /^(?:\.\/|.*\/)?(browser-[\w-]+|content|search)\.js$/, fn: (a, raw) => {
		const tool = raw.match(/(browser-[\w-]+|content|search)\.js/)![1];
		const p = positional(a);
		if (tool === "search") return `Web search "${clip(p.join(" "), 40)}"`;
		if (tool === "content") return `Read web page ${shortUrl(p[0] ?? "")}`;
		if (tool === "browser-nav") return `Browser: go to ${shortUrl(p[0] ?? "")}`;
		if (tool === "browser-screenshot") return "Browser screenshot";
		if (tool === "browser-eval") return "Browser: run JavaScript";
		if (tool === "browser-start") return "Start browser";
		return `Browser: ${tool.replace(/^browser-/, "")}`;
	} },
	{ id: "media", cmd: /^(ffmpeg|ffprobe|sips|magick|convert|pdftoppm|pdftotext)$/, fn: (a, raw) => {
		const tool = raw.split(/\s/)[0];
		if (tool === "ffprobe") return `Inspect media ${shortPath(positional(a)[0] ?? "")}`.trim();
		const out = positional(a, ["-i", "-r", "-t", "-ss", "-vf", "-c:v", "-c:a", "-crf", "-preset", "-f", "-s", "-b:v", "-filter_complex", "-map", "-pix_fmt", "--out", "-o", "-Z", "-z", "-loglevel", "-framerate", "-to", "-frames:v", "-q:v", "-an", "-y"]).pop();
		return `Convert media${out ? ` → ${shortPath(out)}` : ""}`;
	} },
	{ id: "pkg", cmd: /^(brew|apt|apt-get|pip3?|cargo|go|stow)$/, fn: (a, raw) => { const tool = raw.split(/\s/)[0]; const p = positional(a); return `${tool} ${p.slice(0, 2).join(" ")}`.trim(); } },
	{ id: "which", cmd: /^(which|type|command|whereis)$/, fn: (a) => `Locate ${positional(a).filter((x) => x !== "-v").join(", ")}` },
	{ id: "defaults", cmd: /^(defaults|plutil|PlistBuddy|\/usr\/libexec\/PlistBuddy)$/, fn: (a) => { const p = positional(a); return `${/^(write|delete)$/.test(p[0] ?? "") ? "Change" : "Read"} macOS setting ${shortPath(p[1] ?? "")}`.trim(); } },
	{ id: "xattr", cmd: /^xattr$/, fn: (a) => (a.some((x) => x.includes("quarantine")) && a.some((x) => /^-\w*d/.test(x)) ? `Clear quarantine on ${paths(positional(a).filter((x) => !x.includes("quarantine")))}` : `Inspect attributes of ${paths(positional(a))}`) },
	{ id: "tailscale", cmd: /^tailscale$/, fn: (a) => `Tailscale ${positional(a)[0] ?? ""}`.trim() },
	{ id: "docker", cmd: /^(docker|podman)$/, fn: (a) => `Docker ${positional(a).slice(0, 2).join(" ")}`.trim() },
	{ id: "agents-build", cmd: /^(?:\.\/)?(?:agents\.md|agent-instructions)\/build$/, fn: () => "Rebuild AGENTS.md" },
	{ id: "editor", cmd: /^(diff|cmp|comm)$/, fn: (a) => `Compare ${paths(positional(a), 2)}` },
	{ id: "archive", cmd: /^(tar|zip|unzip|gzip|gunzip)$/, fn: (a, raw) => `${/^(unzip|gunzip)/.test(raw) || a.some((x) => /^-?\w*x/.test(x)) ? "Extract" : "Archive"} ${paths(positional(a, ["-C", "-f", "-d"]), 1)}` },
	{ id: "env", cmd: /^(env|printenv|hostname|whoami|id|uname|sw_vers|tty|nproc|locale|ulimit)$/, fn: () => "Check environment" },
	{ id: "sqlite", cmd: /^(sqlite3|psql|duckdb)$/, fn: (a, raw) => `Query ${shortPath(positional(a)[0] ?? raw.split(/\s/)[0])}` },
	{ id: "pi", cmd: /^(pi|omp|claude|codex|amp)$/, fn: (a, raw) => { const tool = raw.split(/\s/)[0]; return a.includes("-p") || a.includes("--print") || a[0] === "exec" ? `Run ${tool} non-interactively` : `${tool} ${positional(a)[0] ?? ""}`.trim(); } },
	{ id: "hammerspoon", cmd: /^hs$/, fn: (a) => {
		const lua = flagVal(a, "-c");
		if (lua === undefined) return;
		if (/^\s*hs\.reload\(\)\s*$/.test(lua)) return "Reload Hammerspoon";
		const app = lua.match(/tell (?:application|app) \\?"([^"\\]+)/)?.[1];
		return app ? `AppleScript → ${app} (via Hammerspoon)` : "Run Lua in Hammerspoon";
	} },
	{ id: "tmux", cmd: /^tmux$/, fn: (a) => {
		const p = positional(a, ["-L", "-S", "-t", "-s", "-n", "-F", "-c", "-f", "-S", "-E"]);
		const t = flagVal(a, "-t");
		const sub: Record<string, string> = { ls: "List tmux sessions", "list-sessions": "List tmux sessions", "list-windows": "List tmux windows", "list-panes": "List tmux panes", "list-clients": "List tmux clients",
			"capture-pane": `Read tmux pane${t ? ` ${t}` : ""}`, "send-keys": `Send keys to tmux pane${t ? ` ${t}` : ""}`, "kill-session": `Close tmux session${t ? ` ${t}` : ""}`, "kill-window": `Close tmux window${t ? ` ${t}` : ""}`,
			"kill-pane": `Close tmux pane${t ? ` ${t}` : ""}`, "new-window": "Open tmux window", "new-session": "Start tmux session", "has-session": `Check tmux session${t ? ` ${t}` : ""}`,
			"show-options": "Read tmux options", "display-message": "Query tmux", display: "Query tmux", "source-file": "Reload tmux config", "set-option": "Set tmux option", show: "Read tmux options", "list-keys": "List tmux key bindings",
			"show-environment": "Read tmux environment", "kill-server": `Stop tmux server${flagVal(a, "-L") ? ` ${flagVal(a, "-L")}` : ""}`, "rename-window": `Rename tmux window${t ? ` ${t}` : ""}` };
		return p[0] ? sub[p[0]] : undefined;
	} },
	{ id: "strings", cmd: /^strings$/, fn: (a) => { const p = positional(a, ["-n", "-t"]); return p.length ? `Extract strings from ${paths(p)}` : undefined; } },
	{ id: "luac", cmd: /^luac$/, fn: (a) => (a.includes("-p") ? `Syntax-check ${paths(positional(a))}` : undefined) },
	{ id: "chrome-headless", cmd: /(?:^|\/)(?:Google Chrome|chromium|google-chrome|chrome)$/, fn: (a) => {
		if (!a.some((x) => x.startsWith("--headless"))) return;
		const shot = flagVal(a, "--screenshot");
		const url = positional(a)[0];
		if (shot) return `Screenshot ${url ? shortUrl(url.replace(/^file:\/\//, "")) : "page"} in headless Chrome → ${shortPath(shot)}`;
		const pdf = flagVal(a, "--print-to-pdf");
		if (pdf) return `Print ${url ? shortUrl(url.replace(/^file:\/\//, "")) : "page"} to PDF → ${shortPath(pdf)}`;
	} },
	{ id: "agrec", cmd: /^agrec$/, fn: (a) => {
		const [sub, ...r] = positional(a, ["-s", "--fps", "--max", "-o"]);
		if (sub === "start") return "Start recording ag-mac's screen";
		if (sub === "stop") return "Stop the screen recording";
		if (sub === "status") return "Check the screen recording";
		if (sub === "export") return `Export screen recording${r.length ? ` → ${shortPath(r[r.length - 1])}` : ""}`;
	} },
	{ id: "ag-cli", cmd: /^(?:~\/\.local\/bin\/)?ag$/, fn: (a, _raw, ctx) => {
		// the ag CLI (docs/ag-cli.md, bin/dot-local/lib/ag/<verb>)
		const p = positional(a, ["--lines", "-n", "--last", "--days", "--limit", "--ws", "--workspace", "--cwd", "--label", "-f", "--file", "--to", "--into", "--note", "--after", "--only"]);
		const [v, ...r] = p;
		const s = (x?: string, me = "this session") => (x ? clip(x, 40) : me);
		const q = (x?: string, n = 50) => `"${clip((x ?? "").replace(/\s+/g, " "), n)}"`;
		const has = (f: string) => a.includes(f);
		switch (v) {
			case undefined: return has("--help") ? "List ag verbs" : "Attach to Ag";
			case "attach": return "Attach to Ag";
			case "help": return "List ag verbs";
			case "me": return r[0] ? `Get my ${r[0]}` : "Find this session (tab, pane, link)";
			case "ls": { const f = ["--hot", "--waiting", "--needs-you", "--working"].filter(has).map((x) => x.slice(2)); return `List ${f.length ? f.join("/") + " " : ""}sessions${r.length ? ` in ${r.join(" ")}` : ""}`; }
			case "find": return `Find sessions matching ${q(r.join(" "), 40)}`;
			case "read": return `Read ${has("--user") ? "prompts of " : has("--assistant") ? "answers of " : "transcript of "}${s(r.join(" "))}`;
			case "peek": return `Peek at ${s(r.join(" "))}'s screen`;
			case "link": return `Get ${has("--phone") ? "phone " : ""}link to ${r.length ? r.map((x) => clip(x, 30)).join(", ") : "this session"}`;
			case "send": return r[0] ? `Send ${r[1] ? q(r.slice(1).join(" ")) : "a message"} to ${clip(r[0], 30)}` : undefined;
			case "spawn": { const f = flagVal(a, "-f", "--file"); return f ? `Spawn a session from ${shortPath(f)}` : r.length ? `Spawn a session: ${q(r.join(" "))}` : "Spawn a session"; }
			case "report": return r.length ? `Report back: ${q(r.join(" "))}` : "Report back";
			case "merge": return r.length ? `Merge ${r.map((x) => clip(x, 30)).join(", ")} into ${s(flagVal(a, "--into"))}` : undefined;
			case "close": return `Close ${s(r.join(" "), "this tab")}${flagVal(a, "--after") ? ` in ${flagVal(a, "--after")}s` : ""}`;
			case "rename": return r[0] ? `Rename ${s(r.slice(1).join(" "), "this tab")} → ${q(r[0], 40)}` : undefined;
			case "file": return r[0] ? `File ${s(r.slice(1).join(" "))} into ${r[0]}` : undefined;
			case "hot": { const m = ["on", "off", "toggle"].includes(r[0]) ? r.shift() : "on"; return `${m === "off" ? "Un-hotpath" : m === "toggle" ? "Toggle hotpath on" : "Hotpath"} ${s(r.join(" "))}`; }
			case "wait": return `${has("--off") ? "Take" : "Put"} ${s(r.join(" "))} ${has("--off") ? "out of" : "in"} Waiting for`;
			case "unwait": return `Take ${s(r.join(" "))} out of Waiting for`;
			case "resume": return r.length ? `Resume ${clip(r.join(" "), 40)}` : undefined;
			case "sync": return `Sync ${r[0] && r[0] !== "all" ? r[0] : "ag + dotfiles"} to ${flagVal(a, "--only") ?? "every machine"}`;
			case "status": return "Check Ag's health";
			case "logs": return r[0] ? `Read logs of ${r[0]}` : "List Ag services";
			case "restart": return r.length ? `Restart ${r.join(", ")}` : undefined;
			case "usage": return "Measure ag CLI usage";
			case "doctor": return "Check what Ag still lacks on this machine";
			case "setup": return "Install or update Ag on this machine";
			case "discord": {
				const [sub, x] = r;
				const ch = (c?: string) => (c && /^https?:/.test(c) ? "a Discord message" : `Discord #${clip(c ?? "", 30)}`);
				if (sub === "read") return x ? `Read ${ch(x)}` : undefined;
				if (sub === "threads") return x ? `List threads in ${ch(x)}` : undefined;
				if (sub === "get") return x ? `Read ${ch(x)}` : undefined;
				if (sub === "post") return flagVal(a, "--reply-to") ? "Reply on Discord" : x ? `Post to ${ch(x)}` : undefined;
				if (sub === "whoami") return "Check the Discord bot identity";
				return;
			}
			case "routine": return `${r[0] ? `${r[0][0].toUpperCase()}${r[0].slice(1)} ` : "List "}routine${r[1] ? ` ${r[1]}` : "s"}`;
		}
		// passthrough verbs: `ag text …` runs ag-text, so summarize it as that
		return summarizeShell([`ag-${v}`, ...a.slice(a.indexOf(v) + 1)].join(" "), ctx).sum;
	} },
	{ id: "ag-messages", cmd: /^ag-messages$/, fn: (a) => {
		const [sub, x] = positional(a, ["--file"]);
		switch (sub) {
			case "chats": return "List recent iMessage chats";
			case "thread": return x ? `Read iMessage thread with ${clip(x, 30)}` : undefined;
			case "search": return x ? `Search iMessages for "${clip(x, 40)}"` : undefined;
			case "contact": return x ? `Look up contact "${clip(x, 30)}"` : undefined;
			case "send": return x ? `Send iMessage to ${clip(x, 30)}` : undefined;
			case "cat": case "get": return x ? `Read iMessage attachment ${shortPath(x)}` : undefined;
		}
	} },
	{ id: "moshi-hook", cmd: /^moshi-hook$/, fn: (a) => {
		const p = positional(a, ["--target"]);
		if (p[0] === "service" && p[1]) return `${cap(p[1])} the moshi-hook service`;
		if (p[0] === "install") return `Install moshi-hook${flagVal(a, "--target") ? ` for ${flagVal(a, "--target")}` : ""}`;
		if (p[0] === "uninstall") return "Uninstall moshi-hook";
		if (p[0] === "status") return "Check moshi-hook status";
	} },
	{ id: "ag-script", cmd: /^(?:~|\$HOME)?\/?(?:\.local\/bin\/)?(mcp-gateway|ag-board|ag-mux-smoke\.sh|ag-nav|tickler|agd)$/, fn: (a, raw) => `${raw.split(/\s/)[0].replace(/^.*\//, "")} ${positional(a)[0] ?? ""}`.trim() },
];

/** One simple command (no ; && | at top level) → summary, "noise", or null (not understood). */
function summarizeSegment(seg: string, ctx: Ctx): SegOut {
	let s = seg.trim();
	// grouping and control words
	s = s.replace(/^(?:time|then|do|else|!)\s+/, "").trim();
	if (!s || s.startsWith("#")) return "noise";
	let g = s;
	for (let k = 0; k < 3; k++) g = g.replace(/([)}])\s*\d*>>?&?\s*[^\s)}]+$/, "$1");
	const group = g.match(/^\(([\s\S]*)\)$/) ?? g.match(/^\{\s([\s\S]*?);?\s*\}$/);
	if (group) return summarizeOne(group[1], ctx);
	if (/^(?:for|while|until|select)\s/.test(s) || /^(?:if|elif)\s/.test(s) || /^case\s/.test(s)) {
		const cond = s.replace(/^(?:if|elif|while|until)\s+/, "");
		if (/^(?:for|select|case)\s/.test(s) || /^\[/.test(cond)) return "noise";
		return summarizeSegment(cond, ctx);
	}
	// function definitions are remembered (calls are summarised by their body); assignments by what they run
	const def = s.match(/^(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{\s*([\s\S]*?);?\s*\}$/);
	if (def) { (ctx.fns ??= {})[def[1]] = def[2]; return "noise"; }
	if (/^(?:function\s+)?[A-Za-z_][\w-]*\s*\(\)/.test(s)) return "noise";
	const bare = s.replace(/^(?:local|export|readonly|declare)\s+/, "");
	const asg = bare.match(/^[A-Za-z_]\w*\+?=("?)\$\(([\s\S]*)\)\1$/);
	if (asg && substitutions(bare).length === 1) return summarizeOne(asg[2], ctx);
	const ws = words(bare);
	if (ws.length === 1 && /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/.test(ws[0])) {
		const val = ws[0].replace(/^[^=]*=/, "");
		if (val.startsWith("$((")) return "noise";
		const sub = val.match(/^\$\(([\s\S]*)\)$/);
		return sub ? summarizeOne(sub[1], ctx) : "noise";
	}
	let w = dropRedirs(words(s));
	// prefixes: env assignments, timeout, nohup, sudo, command, exec, time, caffeinate
	for (;;) {
		if (!w.length) return "noise";
		if (/^[A-Za-z_]\w*=/.test(w[0])) { w = w.slice(1); continue; }
		if (/^(?:timeout|gtimeout)$/.test(w[0])) { w = w.slice(1); while (w[0]?.startsWith("-")) w = w.slice(w[0] === "-s" || w[0] === "-k" ? 2 : 1); w = w.slice(1); continue; }
		if (/^(?:nohup|sudo|exec|time|caffeinate|nice|stdbuf|env|unbuffer|setsid)$/.test(w[0]) && w.length > 1) { w = w.slice(1); while (w[0]?.startsWith("-")) w = w.slice(1); continue; }
		if (w[0] === "command" && w[1] && w[1] !== "-v") { w = w.slice(1); continue; }
		break;
	}
	const [cmd0, ...args] = w;
	const fn = ctx.fns?.[cmd0];
	if (fn) return summarizeOne(fn.replace(/"?\$\{?(\d|@|\*)\}?"?/g, (_m, k) => { const v = k === "@" || k === "*" ? args.join(" ") : args[Number(k) - 1] ?? ""; return `'${v.replace(/'/g, "")}'`; }), ctx);
	const cmd = cmd0.replace(/^(?:~|\/home\/nathan|\/Users\/\w+)\/\.local\/bin\//, "").replace(/^\/(?:usr\/(?:local\/)?|opt\/homebrew\/)?s?bin\//, "");
	if (/^(?:echo|printf)$/.test(cmd)) {
		// echo "x: $(cmd)" runs cmd; summarise the substitutions when they are all understood
		const subs = substitutions(s).map((x) => summarizeOne(x, { ...ctx, miss: undefined }));
		const real = subs.filter((x): x is Exclude<SegOut, "noise" | null> => !!x && x !== "noise");
		if (!real.length || subs.includes(null)) return "noise";
		return { sum: real.map((x) => x.sum).join(" · "), rule: "echo-subst", parts: real.flatMap((x) => x.parts ?? [{ sum: x.sum, host: x.host }]) };
	}
	if (NOISE.test(cmd)) return "noise";
	// `tool [sub…] --help` / `tool --version`, for any plainly named tool
	if (/^[\w.-]+(?:\/[\w.-]+)*$/.test(cmd) && args.length) {
		const last = args[args.length - 1];
		const subs = args.slice(0, -1);
		if (subs.every((x) => /^[a-z][\w-]*$/.test(x))) {
			const name = [cmd.replace(/^.*\//, ""), ...subs].join(" ");
			if (/^(?:--help|-h)$/.test(last)) return { sum: `Read ${name} help`, rule: "help" };
			if (/^(?:--version|-V)$/.test(last) && !subs.length) return { sum: `Check ${name} version`, rule: "help" };
		}
	}
	if (cmd === "bash" || cmd === "sh" || cmd === "zsh") {
		const c = args.indexOf("-c") >= 0 ? args[args.indexOf("-c") + 1] : args.find((x) => x === "-lc" || x === "-c") ? args[args.indexOf(args.find((x) => x === "-lc")!) + 1] : undefined;
		if (c) return summarizeOne(c, ctx);
		const f = positional(args)[0];
		return f ? { sum: `Run ${shortPath(f)}`, rule: "script" } : null;
	}
	const rebuilt = [cmd, ...args].join(" ");
	for (const r of RULES) {
		if (!r.cmd.test(cmd)) continue;
		const out = r.fn(args, rebuilt, ctx, s);
		if (out === undefined || out === null || out === "") return null;
		if (out === "noise") return "noise";
		if (typeof out === "string") return { sum: out, rule: r.id };
		return out;
	}
	if (/^(?:\.{0,2}\/|~\/|\$HOME\/)\S*$/.test(cmd) && !cmd.includes("$(")) return { sum: `Run ${cmd.split("/").pop()}`, rule: "script" };
	return null;
}

/** A segment that may itself be a pipeline/list (from $( ) or ssh 'cmd'). */
function summarizeOne(cmd: string, ctx: Ctx): SegOut {
	const r = summarizeShell(cmd, { ...ctx, miss: undefined });
	if (!r.sum) { ctx.miss = r.miss; return r.allNoise ? "noise" : null; }
	return { sum: r.sum, host: r.hosts.find((h) => h !== ctx.host), rule: "nested", parts: r.parts };
}

/** A top-level command that is only "noise" but still has a point: printing variables, checking the time. */
function quietSum(segs: { seg: string }[]): string | undefined {
	const out: string[] = [];
	const printed: string[] = [];
	for (const { seg } of segs) {
		const s = seg.trim();
		const vars = s.match(/^echo((?:\s+"?\$\{?[A-Za-z_]\w*\}?"?)+)$/);
		if (vars) { if (!printed.length) out.push("PRINT"); printed.push(...vars[1].replace(/["{}]/g, "").trim().split(/\s+/)); continue; }
		const d = s.match(/^(?:TZ=(\S+)\s+)?date(?:\s+(?:-u|'\+[^']*'|"\+[^"]*"|\+\S+))?$/);
		if (d) { out.push(`Show the time${d[1] ? ` in ${d[1].replace(/^.*\//, "").replace(/_/g, " ")}` : ""}`); continue; }
		if (/^(?:cd|pushd|popd)(?:\s|$)/.test(s)) continue;
		return;
	}
	return out.length ? [...new Set(out)].map((x) => (x === "PRINT" ? `Print ${[...new Set(printed)].join(", ")}` : x)).join(" · ") : undefined;
}

export function summarizeShell(command: string, ctx: Ctx, top = false): Summary & { allNoise?: boolean } {
	const bodies: Record<string, string> = { ...ctx.heredocs };
	const segs = splitShell(stripHeredocs(command, bodies));
	ctx = { ...ctx, heredocs: bodies };
	const outs: { sum: string; host?: string }[] = [];
	const rules = new Set<string>();
	let sleep = 0;
	let unknown = false;
	let afterPipe = false;
	let miss: string | undefined;
	for (const { seg, pipeAfter } of segs) {
		if (afterPipe) {
			const c = words(seg)[0] ?? "";
			afterPipe = pipeAfter;
			if (FILTERS.has(c.replace(/^.*\//, "")) || /^(?:while|for|until)$/.test(c)) continue;
			if (c !== "xargs") {
				// a sink that is a command of its own (| pbcopy, | ssh host 'cat > f', | tee f)
				ctx.miss = undefined;
				const po = summarizeSegment(seg, ctx);
				if (po === "noise") continue;
				if (!po) { unknown = true; miss = `| ${seg}`; break; }
				rules.add(po.rule);
				for (const part of po.parts ?? [{ sum: po.sum, host: po.host }]) outs.push(part);
				continue;
			}
			const w = words(seg).slice(1);
			while (w[0]?.startsWith("-")) w.splice(0, /^-[InPLsd]$/.test(w[0]) ? 2 : 1);
			if (!w.length) continue;
			const q = (x: string) => (/[\s'"$`\\]/.test(x) ? `'${x.replace(/'/g, "'\\''")}'` : x);
			let xo = summarizeSegment(w.map(q).join(" "), ctx);
			let each = " (each)";
			if (!xo) { xo = summarizeSegment([...w.map(q), "XARGS_INPUT"].join(" "), ctx); each = ""; }
			if (xo === "noise") continue;
			if (!xo || (each === "" && !xo.sum.includes("XARGS_INPUT"))) { unknown = true; miss = `| ${seg}`; break; }
			rules.add(xo.rule);
			outs.push({ sum: `${xo.sum.replace("XARGS_INPUT", "the listed files")}${each}`, host: xo.host });
			continue;
		}
		afterPipe = pipeAfter;
		const sl = seg.match(/^sleep\s+(\d+(?:\.\d+)?)/);
		if (sl) sleep += Number(sl[1]);
		ctx.miss = undefined;
		const o = summarizeSegment(seg, ctx);
		if (o === "noise") continue;
		if (!o) { unknown = true; miss = ctx.miss ?? seg; break; }
		rules.add(o.rule);
		for (const part of o.parts ?? [{ sum: o.sum, host: o.host }]) if (outs[outs.length - 1]?.sum !== part.sum) outs.push(part);
	}
	const hosts = [...new Set([...outs.map((o) => o.host ?? ctx.host)])];
	if (unknown) return { hosts: hosts.length ? hosts : [ctx.host], miss };
	if (!outs.length) {
		if (sleep) return { sum: `Wait ${sleep}s`, hosts: [ctx.host], rule: "sleep" };
		const q = top ? quietSum(segs) : undefined;
		return q ? { sum: q, hosts: [ctx.host], rule: "quiet" } : { hosts: [ctx.host], allNoise: true };
	}
	const local = ctx.host;
	const label = (o: { sum: string; host?: string }) => o.sum;
	// "Stop A · Stop B" → "Stop A, B"
	const merged: string[] = [];
	for (const o of outs.map(label)) {
		const verb = o.match(/^(Stop|Delete|Read|List|Make folder|Search repo for|Find process|Check CI on|Run) /)?.[1];
		const prev = merged[merged.length - 1];
		if (verb && prev?.startsWith(`${verb} `) && !prev.includes(" · ")) merged[merged.length - 1] = `${prev}, ${o.slice(verb.length + 1)}`;
		else merged.push(o);
	}
	let sum = merged.slice(0, 3).join(" · ");
	if (merged.length > 3) sum += ` +${merged.length - 3}`;
	if (sleep >= 10) sum = `Wait ${sleep}s, then ${sum.charAt(0).toLowerCase()}${sum.slice(1)}`;
	return { sum, hosts: hosts.length ? hosts : [local], rule: [...rules].join("+"), parts: outs };
}

// ---------- non-shell tools ----------

const MCP_SERVERS: [RegExp, string, string?][] = [
	[/^mcp_linear_/, "Linear"],
	[/^mcp_slack_alpha_|^mcp_slack_slack_|^mcp_slack_/, "Slack"],
	[/^mcp_honeycomb_/, "Honeycomb"],
	[/^mcp_arcade_school_/, "TSA"],
	[/^mcp_tsa_courses_/, "TSA courses"],
	[/^mcp_tapkit_/, "iPhone", "ag-phone"],
	[/^mcp_github_/, "GitHub"],
];

function mcpSummary(name: string, args: any): Summary | undefined {
	const srv = MCP_SERVERS.find(([re]) => re.test(name));
	if (!srv) return;
	const verb = name.replace(srv[0], "").replace(/_/g, " ");
	const key = ["id", "issueId", "query", "search_query", "keywords", "title", "name", "table", "facility", "courseId", "moduleId", "channel_id", "text", "message", "body", "sql", "urlOrId"].find((k) => args?.[k] !== undefined && args[k] !== "");
	let v = key ? args[key] : undefined;
	if (Array.isArray(v)) v = v.join(" ");
	const detail = v !== undefined ? ` ${typeof v === "string" ? `"${clip(v.replace(/\s+/g, " "), 40)}"` : clip(JSON.stringify(v), 40)}` : "";
	return { sum: `${srv[1]}: ${verb}${detail}`, hosts: [srv[2] ?? "mcp"], rule: "mcp" };
}

const IMG = /\.(png|jpe?g|gif|webp|heic|svg)$/i;

export function summarize(name: string, args: any, ctx: Ctx = { host: "ag-engine" }): Summary {
	const local = { hosts: [ctx.host] };
	if (!args || typeof args !== "object") return local;
	try {
		switch (name) {
			case "bash":
			case "zsh":
			case "shell":
				return typeof args.command === "string" ? summarizeShell(args.command, ctx, true) : local;
			case "read": {
				const p = String(args.path ?? args.file_path ?? "");
				if (IMG.test(p)) return { sum: `View image ${p.split("/").pop()}`, hosts: [ctx.host], rule: "read-image" };
				const range = args.offset ? `:${args.offset}${args.limit ? `–${Number(args.offset) + Number(args.limit) - 1}` : ""}` : "";
				return { sum: `Read ${shortPath(p)}${range}`, hosts: [ctx.host], rule: "read" };
			}
			case "write":
				return { sum: `Write ${shortPath(String(args.path ?? ""))}`, hosts: [ctx.host], rule: "write" };
			case "edit": {
				const n = Array.isArray(args.edits) ? args.edits.length : 1;
				return { sum: `Edit ${shortPath(String(args.path ?? ""))}${n > 1 ? ` (${n} changes)` : ""}`, hosts: [ctx.host], rule: "edit" };
			}
			case "chatgpt_cua": {
				const s = typeof args.task === "string" ? cuaSummary(args.task) : undefined;
				return { sum: s, hosts: ["ag-mac"], rule: s ? "cua" : undefined };
			}
			case "tickler": {
				const a = args.action;
				if (a === "list") return { sum: "List tickler items", hosts: [ctx.host], rule: "tickler" };
				if (a === "cancel") return { sum: `Cancel tickler item ${args.id ?? ""}`.trim(), hosts: [ctx.host], rule: "tickler" };
				if (a === "schedule") {
					const when = args.when === "online" ? "when Nathan is online" : args.when === "check" ? "when its check passes" : args.when === "event" ? "on an event" : args.at ? `at ${String(args.at).replace(/:00(?=[+-Z])/, "").replace("T", " ").replace(/[+-]\d\d:\d\d$|Z$/, "")}` : "";
					return { sum: `Schedule "${clip(String(args.title ?? args.task ?? "").replace(/\s+/g, " "), 40)}"${when ? ` ${when}` : ""}`, hosts: [ctx.host], rule: "tickler" };
				}
				return local;
			}
			case "todo":
				return { sum: `${cap(String(args.action ?? "update"))} todo${args.title ? ` "${clip(args.title, 40)}"` : args.id ? ` ${args.id}` : ""}`, hosts: [ctx.host], rule: "todo" };
			case "subagent": {
				const t = args.task ?? args.tasks?.[0]?.task ?? args.chain?.[0]?.task ?? "";
				const n = args.tasks?.length ?? args.chain?.length;
				return { sum: `Delegate${n ? ` ${n} tasks` : ""} to ${args.agent ?? args.tasks?.[0]?.agent ?? "subagent"}: ${clip(String(t).replace(/\s+/g, " "), 50)}`, hosts: [ctx.host], rule: "subagent" };
			}
			case "signal_loop_success":
				return { sum: "Signal loop success", hosts: [ctx.host], rule: "loop" };
			case "ship_done":
			case "ship_halt":
				return { sum: `${name === "ship_done" ? "Finish" : "Halt"} /ship${args.pr ? ` (PR #${args.pr})` : ""}`, hosts: [ctx.host], rule: "ship" };
		}
		if (name.startsWith("mcp_")) return mcpSummary(name, args) ?? { hosts: ["mcp"] };
	} catch {
		// A rule that throws is a rule that didn't match.
	}
	return local;
}

/** The machine a Pi session runs on, from its working directory. */
export function sessionHost(cwd?: string): string {
	if (!cwd) return "ag-engine";
	if (cwd.startsWith("/Users/natkoersch")) return "ag-mac";
	if (cwd.startsWith("/Users/nathan")) return "ag-client";
	return "ag-engine";
}
