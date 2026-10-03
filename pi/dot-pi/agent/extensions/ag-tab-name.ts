// Keeps this tab's label (the session's title in ag-dash) accurate. On every prompt (in the
// background, never delaying the turn):
//   1. Default numeric label ("9")        → name it right away from the prompt's first words
//      (quickName: deterministic, no model); a fast LLM only if that yields under 2 words.
//   2. Otherwise ask the `tab-name` ag-rule (default tab-name-fit: Jev) whether the label still names
//      the session. If it says not to keep it  → rename it with the fast LLM. No rule → keep.
// Both look at the whole session (the first prompt plus a spread of later ones), not just the latest
// prompts: a name should carry the keywords the session is about, and follow-up steps ("review the
// PR", "run it") shouldn't rename it.
// A label you change by hand is pinned: this session never touches it again, and it's saved as the pi
// session name, so it persists. A session that has a name (renamed by hand here, in ag-dash, or with
// `ag rename`) starts with its tab named that, pinned, so waking or resuming it keeps the name.
// Every decision is logged to ~/.local/state/ag-tab-name/log.jsonl.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promptGist } from "./ag-origin.ts";

const SAMPLE = 12; // later prompts Jev and the namer see, spread evenly across the session
// First one that exists with auth wins.
const NAMERS: [string, string][] = [
	["truefoundry-chat", "gemini-group/gemini-3.5-flash-lite"],
	["truefoundry-openai", "gpt-5.4-nano"],
];
const LOG_DIR = `${homedir()}/.local/state/ag-tab-name`;

function mux(args: string[]): any {
	return JSON.parse(execFileSync("ag-mux", args, { encoding: "utf8", timeout: 3000 })).result;
}

function tabLabel(tab: string): string {
	return mux(["tab", "get", tab]).tab.label;
}

function log(data: Record<string, unknown>) {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(`${LOG_DIR}/log.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n");
	} catch {}
}


function text(content: any): string {
	return typeof content === "string" ? content : content.filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
}

// The session in brief: its first prompt (which usually sets the topic) plus up to SAMPLE later
// prompts spread evenly across the session, always including the latest. Trivial replies ("yes",
// "run it") are dropped: they carry no topic, and so is the capture boilerplate ("Screenshot of my
// screen when I wrote this (<window title>)…" plus file paths), whose window title is a red herring.
const NOISE = [/Screenshot of my screen when I wrote this[^\n]*/g, /(?:\/(?:home|Users)\/|~\/)\S+/g];
export function digest(all: string[]): { first: string; later: string[] } {
	const prompts = all.map((p) => NOISE.reduce((t, re) => t.replace(re, ""), p).trim()).filter((p) => p.length >= 15);
	const [first = all.at(-1)?.trim() ?? "", ...rest] = prompts;
	const pick = rest.length <= SAMPLE ? rest : Array.from({ length: SAMPLE }, (_, i) => rest[Math.round((i * (rest.length - 1)) / (SAMPLE - 1))]);
	return { first: first.slice(0, 1200), later: pick.map((p) => p.slice(0, 300)) };
}

// Deterministic first name: the opening clause of the first prompt, minus paths, URLs, code and
// capture boilerplate, capped at 8 words / 48 chars. "AG Sessions should get better initial names,
// maybe …" → "AG Sessions should get better initial names". Empty if nothing word-like is left.
export function quickName(prompt: string): string {
	const t = prompt
		.split(/\n\s*Session context \(snapshot/)[0]
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/Screenshot of my[^\n]*/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/(?:\/(?:home|Users|tmp|var|etc|opt)\/|~\/|\.\.?\/)\S*/g, " ")
		.replace(/\[[^\]]*\]/g, " ") // [meta notes]
		.replace(/[`*_#>]/g, " ")
		.replace(/\brun it\b[\s.:,!-]*/gi, " ") // magic word, not a topic
		.replace(/^\s*(?:(?:hey|hi|ok|okay|so|please|pls|can you|could you|would you)\b[\s,]*)+/i, "");
	const clause = t
		.split(/\n|[.!?](?:\s|$)|[,;:(]\s|\s[-–—]\s/)
		.map((c) => c.trim())
		.find((c) => /[A-Za-z]{2}/.test(c));
	if (!clause) return "";
	let name = "";
	for (const w of clause.split(/\s+/).slice(0, 8)) {
		if ((name + " " + w).trim().length > 48) break;
		name = (name + " " + w).trim();
	}
	// Paths were cut out, so don't leave a dangling "… bug in".
	name = name.replace(/(?:[^\p{L}\p{N})]|\s(?:in|on|at|for|to|of|the|a|an|and|or|with|from|into|my|this|that))+$/iu, "");
	return name.charAt(0).toUpperCase() + name.slice(1);
}

// The `tab-name` ag-rule (~/ag/ag-rules; default tab-name-fit): keep `label`, or rename? Its P(accurate) is logged.
export async function labelVerdict(label: string, d: ReturnType<typeof digest>): Promise<{ keep: boolean; p?: number }> {
	const engine = await import(`${process.env.AG_DIR || `${homedir()}/ag`}/ag-rules/engine.ts`);
	return (await engine.runRule("tab-name", { label, first: d.first, later: d.later })) ?? { keep: true };
}

export function namerPrompt(label: string | null, d: ReturnType<typeof digest>): string {
	return [
		"Name a terminal tab for this work session in 1-3 words (ideally 2), Title Case, no quotes or punctuation.",
		"Use the most distinctive keywords of what the session as a whole is about: the specific product, system, feature, ticket or person (e.g. \"Stripe Refunds\", \"ARC-944 Demo\"). The first request usually sets the topic; later requests are usually follow-up steps on it (fixes, reviews, PRs, \"run it\"), so don't name those steps. Name a later topic only if the session clearly moved on to it for good. Avoid generic words like Review, PR, Fix, Update or Check on their own.",
		label ? `Current name: ${label} (it was judged a poor fit; keep any of its keywords that are still right).` : "",
		"Reply with only the name.",
		"",
		`First request:\n${d.first}`,
		d.later.length ? `\nLater requests, oldest first:\n${d.later.map((q) => `- ${q}`).join("\n")}` : "",
	]
		.filter((l) => l !== "")
		.join("\n");
}

export default function (pi: ExtensionAPI) {
	let initial: string | undefined; // label when this session first looked
	let lastSet: string | undefined; // label this session last wrote
	let pinned = false;

	pi.on("session_start", () => {
		const name = pi.getSessionName();
		if (!name || process.env.AG_MUX !== "1") return;
		pinned = true;
		setTimeout(() => { // after startup: don't hold up the first render
			try {
				const tab = mux(["pane", "current"]).pane.tab_id;
				if (tabLabel(tab) !== name) mux(["tab", "rename", tab, name]);
				log({ tab, label: name, action: "restore" });
			} catch {}
		}, 0);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (pinned || process.env.AG_MUX !== "1" || !event.prompt.trim()) return;
		// Resolve the tab live: AG_TAB_ID goes stale if the pane moves to another tab.
		let tab: string;
		try {
			tab = mux(["pane", "current"]).pane.tab_id;
		} catch {
			return;
		}

		const d = digest([
			...ctx.sessionManager
				.getEntries()
				.filter((e: any) => e.type === "message" && e.message?.role === "user")
				.map((e: any) => promptGist(text(e.message.content))),
			promptGist(event.prompt),
		]);

		void (async () => {
			try {
				const label = tabLabel(tab);
				initial ??= label;
				if (label !== initial && label !== lastSet) {
					pinned = true; // renamed by hand
					if (pi.getSessionName() !== label) pi.setSessionName(label); // persist it
					log({ tab, label, action: "pinned" });
					return;
				}

				let p: number | null = null;
				if (/^\d+$/.test(label)) {
					const quick = quickName(d.first);
					if (quick.includes(" ")) { // one word ("Look") says too little: let the LLM name it
						mux(["tab", "rename", tab, quick]);
						lastSet = quick;
						return log({ tab, label, action: "rename", name: quick, via: "quick" });
					}
				} else {
					const v = await labelVerdict(label, d);
					p = v.p ?? null;
					if (v.keep) return log({ tab, label, p_accurate: p, action: "keep" });
				}

				const model = NAMERS.map(([prov, id]) => ctx.modelRegistry.find(prov, id)).find(
					(m) => m && ctx.modelRegistry.hasConfiguredAuth(m),
				);
				if (!model) return;
				const res = await ctx.modelRegistry.complete(
					model,
					{
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: namerPrompt(p === null ? null : label, d),
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ cacheRetention: "none" },
				);
				const name = text(res.content).replace(/["'`*.]/g, "").trim().split(/\s+/).slice(0, 3).join(" ");
				// Re-check: the label may have changed while we were thinking.
				if (!name || name === label || tabLabel(tab) !== label) return;
				mux(["tab", "rename", tab, name]);
				lastSet = name;
				log({ tab, label, p_accurate: p, action: "rename", name });
			} catch (e) {
				log({ tab, action: "error", error: String(e) }); // best-effort
			}
		})();
	});
}
