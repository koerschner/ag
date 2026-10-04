// A transcript as turns: a user message, then everything until the next one. The last assistant text of a finished
// turn is its answer; the thinking, tool calls and in-between text before it fold into a "Worked for …" timeline.
// Pure functions (no DOM), so they're unit-tested (turns.test.ts).
import { plural } from "./format";
import type { TxItem } from "./types";

export type Step = Exclude<TxItem, { role: "user" } | { role: "error" }> | { k: string; role: "note"; ts: number; text: string };
export type ToolItem = Extract<TxItem, { role: "tool" }>;
export type Block =
	| { kind: "steps"; key: string; steps: Step[]; startTs?: number; endTs?: number; live: boolean }
	| { kind: "answer"; key: string; item: Extract<TxItem, { role: "assistant" }>; last: boolean }
	| { kind: "error"; key: string; text: string };
export type Turn = { key: string; user?: Extract<TxItem, { role: "user" }>; blocks: Block[] };

export function buildTurns(items: TxItem[], working: boolean): Turn[] {
	const raw: { user?: Extract<TxItem, { role: "user" }>; items: TxItem[] }[] = [];
	let cur: (typeof raw)[number] | null = null;
	for (const x of items) {
		if (x.role === "user") {
			cur = { user: x, items: [] };
			raw.push(cur);
			continue;
		}
		if (!cur) raw.push((cur = { items: [] }));
		cur.items.push(x);
	}
	const liveTurn = working ? raw.length - 1 : -1;
	return raw.map((t, ti) => {
		let lastText = -1;
		if (ti !== liveTurn) for (let i = t.items.length - 1; i >= 0; i--) if (t.items[i].role === "assistant") ((lastText = i), (i = -1));
		const blocks: Block[] = [];
		let steps: Step[] = [];
		const startTs = t.user?.ts;
		const flush = (endTs?: number) => {
			if (!steps.length) return;
			const live = ti === liveTurn && !endTs;
			blocks.push({ kind: "steps", key: `s:${steps[0].k}`, steps, startTs: startTs || steps[0].ts, endTs: endTs || (live ? undefined : steps.at(-1)!.ts), live });
			steps = [];
		};
		t.items.forEach((x, i) => {
			if (x.role === "error") {
				flush(x.ts);
				blocks.push({ kind: "error", key: x.k, text: x.text });
			} else if (x.role === "assistant" && i === lastText) {
				flush(x.ts);
				blocks.push({ kind: "answer", key: x.k, item: x, last: ti === raw.length - 1 });
			} else if (x.role === "assistant") steps.push({ k: x.k, role: "note", ts: x.ts, text: x.text });
			else if (x.role !== "user") steps.push(x);
		});
		flush();
		return { key: t.user?.k ?? `t:${t.items[0]?.k ?? ti}`, user: t.user, blocks };
	});
}

// ---------- steps ----------
export type StepKind = "think" | "note" | "explore" | "edit" | "run" | "web" | "agent" | "mcp" | "tool";
const EXPLORE_RE = /^(Read|View|Show|Print|Search|Find|Locate|List|Count|Inspect|Check|Git (log|status|diff|show|blame)|GET|Fetch|Tail|Head)\b/;
export const parseArgs = (x: { args?: string }) => {
	try {
		return x.args ? JSON.parse(x.args) : null;
	} catch {
		return null;
	}
};
const segs = (x: { sum?: string }) =>
	String(x.sum || "")
		.split(" · ")
		.map((t) => t.replace(/\s\+\d+$/, ""));
export function stepKind(x: Step): StepKind {
	if (x.role === "thinking") return "think";
	if (x.role === "note" || x.role === "assistant") return "note";
	const n = String(x.name || "");
	if (n === "read" || n === "grep" || n === "find" || n === "ls") return "explore";
	if (n === "edit" || n === "write") return "edit";
	if (n === "bash") return x.sum && segs(x).every((t) => EXPLORE_RE.test(t)) ? "explore" : "run";
	if (/search|fetch|web|browser/i.test(n)) return "web";
	if (n === "subagent" || n === "ag_cua" || n === "ag cua") return "agent";
	if (n.startsWith("mcp_") || n.startsWith("mcp ")) return "mcp";
	return "tool";
}
export const KIND_ICON = { think: "bulb", note: "chat", explore: "search", edit: "pencil", run: "term", web: "globe", agent: "agent", mcp: "plug", tool: "bolt" } as const;

// "6 files, 2 searches": what a run of reads/searches looked at, from the per-command summaries.
export function exploreCounts(list: Step[], brief = false) {
	let files = 0, searches = 0, lists = 0, other = 0;
	for (const x of list) {
		if (x.role !== "tool") continue;
		if (x.name === "read") {
			files++;
			continue;
		}
		for (const t of segs(x)) {
			if (/^(Read|View|Show|Print|Tail|Head|Inspect)\b/.test(t)) files += Math.max(1, (t.match(/, /g) || []).length + 1);
			else if (/^(Search|Find|Locate)\b/.test(t)) searches++;
			else if (/^List\b/.test(t)) lists++;
			else other++;
		}
	}
	if (brief) return [files && plural(files, "file"), searches && plural(searches, "search", "searches")].filter(Boolean).join(", ") || plural(lists + other, "check");
	return [files && plural(files, "file"), searches && plural(searches, "search", "searches"), lists && plural(lists, "list"), other && plural(other, "check")].filter(Boolean).join(", ");
}

// Fold runs of exploration (reads, searches, listings, plus the thinking between them) into one "Explored …" row.
export type Row = { group: Step[]; key: string } | Step;
export function groupSteps(steps: Step[]): Row[] {
	const out: Row[] = [];
	for (let i = 0; i < steps.length; ) {
		if (stepKind(steps[i]) !== "explore") {
			out.push(steps[i++]);
			continue;
		}
		let j = i, last = i;
		while (j < steps.length && ["explore", "think"].includes(stepKind(steps[j]))) {
			if (stepKind(steps[j]) === "explore") last = j;
			j++;
		}
		const run = steps.slice(i, last + 1);
		if (run.filter((x) => x.role === "tool").length >= 2) out.push({ group: run, key: `g:${run[0].k}` });
		else out.push(...run);
		i = last + 1;
	}
	return out;
}

// Line-level +/− for edit/write args; capped so a huge write doesn't swamp the page.
export type Diff = { path: string; add: number; del: number; hunks: { cls: "add" | "del"; text: string }[][]; more: number };
export function diffOf(x: ToolItem): Diff | null {
	const a = parseArgs(x);
	if (!a) return null;
	const lines = (t: unknown) => String(t ?? "").replace(/\n$/, "").split("\n");
	const raw: { del: string[]; add: string[] }[] =
		x.name === "write" ? [{ del: [], add: lines(a.content) }] : (a.edits || (a.oldText != null ? [a] : [])).map((e: any) => ({ del: lines(e.oldText), add: lines(e.newText) }));
	if (!raw.length) return null;
	const add = raw.reduce((n, h) => n + h.add.length, 0), del = raw.reduce((n, h) => n + h.del.length, 0);
	let shown = 0;
	const hunks = raw.map((h) =>
		[...h.del.map((text) => ({ cls: "del" as const, text })), ...h.add.map((text) => ({ cls: "add" as const, text }))].filter(() => shown++ < 400),
	);
	return { path: String(a.path || x.detail || ""), add, del, hunks: hunks.filter((h) => h.length), more: Math.max(0, add + del - 400) };
}

export function stepsDetail(steps: Step[]) {
	const tools = steps.filter((s): s is ToolItem => s.role === "tool");
	const by = (k: StepKind) => tools.filter((x) => stepKind(x) === k);
	const edited = new Set(by("edit").map((x) => parseArgs(x)?.path || x.detail)).size;
	const explored = by("explore").length ? exploreCounts(by("explore"), true) : "";
	const failed = tools.filter((x) => x.result?.error).length;
	const parts = [
		explored && `explored ${explored}`,
		by("run").length && `ran ${plural(by("run").length, "command")}`,
		edited && `edited ${plural(edited, "file")}`,
		by("web").length && plural(by("web").length, "web lookup"),
		by("agent").length && plural(by("agent").length, "agent run"),
		by("mcp").length + by("tool").length && plural(by("mcp").length + by("tool").length, "tool call"),
	].filter(Boolean) as string[];
	let detail = parts.map((t) => t[0].toUpperCase() + t.slice(1)).join(" · ");
	if (failed) detail += `${detail ? " · " : ""}${failed} failed`;
	return { detail, thoughtOnly: !tools.length && steps.some((s) => s.role === "thinking") };
}
